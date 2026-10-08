/* eslint-disable @typescript-eslint/no-unsafe-assignment,
   @typescript-eslint/no-unsafe-argument,
   @typescript-eslint/no-unsafe-call,
   @typescript-eslint/no-unsafe-member-access */ import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkPlacementEntity,
  PlatformRole,
  SiteAccessEntity,
  SiteEntity,
} from '../database/entities';
import { createDataSourceOptions } from '../database/data-source';
import { CmsRevisionsService } from '../content/cms-revisions.service';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import type { ManagedChunkDefinition } from './managed-chunk.types';
const EXPECTED_DATABASE = 'wispo_managed_chunks_phase2_test';

export function assertDisposableManagedChunkDatabase(
  databaseUrl: string | undefined,
  optInDatabase: string | undefined,
): URL {
  const reject = (): never => {
    throw new Error('Refusing non-disposable local managed chunk database');
  };
  if (!databaseUrl || optInDatabase !== EXPECTED_DATABASE) reject();
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    reject();
  }
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '55440' ||
    parsed.pathname !== '/' + EXPECTED_DATABASE ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    reject();
  }
  return parsed;
}

describe('managed chunk disposable PostgreSQL guard', () => {
  it.each([
    [undefined, EXPECTED_DATABASE],
    ['', EXPECTED_DATABASE],
    ['postgresql://test:test@127.0.0.1:55440/wispo_cms', EXPECTED_DATABASE],
    [
      'postgresql://test:test@localhost:55440/' + EXPECTED_DATABASE,
      EXPECTED_DATABASE,
    ],
    [
      'postgresql://test:test@127.0.0.1:5432/' + EXPECTED_DATABASE,
      EXPECTED_DATABASE,
    ],
    [
      'mysql://test:test@127.0.0.1:55440/' + EXPECTED_DATABASE,
      EXPECTED_DATABASE,
    ],
    [
      'postgresql://test:test@127.0.0.1:55440/' + EXPECTED_DATABASE + '?ssl=1',
      EXPECTED_DATABASE,
    ],
    [
      'postgresql://test:test@127.0.0.1:55440/' + EXPECTED_DATABASE + '#x',
      EXPECTED_DATABASE,
    ],
    [
      'postgresql://test:test@127.0.0.1:55440/' + EXPECTED_DATABASE,
      'another_database',
    ],
  ])('rejects an unsafe or incomplete opt-in (%s)', (databaseUrl, optIn) => {
    expect(() =>
      assertDisposableManagedChunkDatabase(databaseUrl, optIn),
    ).toThrow('disposable local');
  });

  it.each(['postgres:', 'postgresql:'])(
    'accepts only the exact disposable target with %s',
    (protocol) => {
      const parsed = assertDisposableManagedChunkDatabase(
        `${protocol}//any-user:any-password@127.0.0.1:55440/${EXPECTED_DATABASE}`,
        EXPECTED_DATABASE,
      );

      expect(parsed.protocol).toBe(protocol);
      expect(parsed.hostname).toBe('127.0.0.1');
      expect(parsed.port).toBe('55440');
      expect(parsed.pathname).toBe('/' + EXPECTED_DATABASE);
    },
  );

  it('preserves the primary failure while cleaning blockers, pending work, runners, and sources in order', async () => {
    const order: string[] = [];
    const primary = new Error('injected assertion failure');
    const cleanupFailure = new Error('injected destroy failure');
    let releasePending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releasePending = () => {
        order.push('pending');
        resolve();
      };
    });
    const runner = {
      isReleased: false,
      isTransactionActive: true,
      rollbackTransaction: jest.fn(() => {
        order.push('rollback');
        return Promise.resolve();
      }),
      release: jest.fn(() => {
        order.push('release-runner');
        return Promise.resolve();
      }),
    } as unknown as QueryRunner;
    const source = {
      isInitialized: true,
      destroy: jest.fn(() => {
        order.push('destroy-source');
        return Promise.reject(cleanupFailure);
      }),
    } as unknown as DataSource;

    let caught: unknown;
    try {
      await withDatabaseTestCleanup((cleanup) => {
        cleanup.ownRunner(runner);
        cleanup.ownSource(source);
        void cleanup.track(pending);
        cleanup.releaseBlocker(() => {
          order.push('release-blocker');
          releasePending?.();
          return Promise.resolve();
        });
        return Promise.reject(primary);
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(primary);
    expect(order).toEqual([
      'release-blocker',
      'pending',
      'rollback',
      'release-runner',
      'destroy-source',
    ]);
    expect((primary as CleanupErrorCarrier).cleanupErrors).toEqual([
      cleanupFailure,
    ]);
  });
});

const integrationEnvironmentPresent =
  process.env.MANAGED_CHUNK_TEST_DATABASE_URL !== undefined ||
  process.env.WISPO_MANAGED_CHUNK_ISOLATED_DB !== undefined;

type AcceptanceFixture = {
  userId: string;
  workspaceId: string;
  packageId: string;
  packageVersionId: string;
  otherPackageId: string;
  otherPackageVersionId: string;
  siteId: string;
  otherSiteId: string;
  pageId: string;
  otherPageId: string;
};

const managedDefinition = (
  key: string,
  fieldKey = 'headline',
): ManagedChunkDefinition => ({
  key,
  schemaVersion: '1',
  title: key,
  categoryKey: 'banners',
  rendererKey: key + '-renderer',
  fields: [
    {
      key: fieldKey,
      label: fieldKey,
      widget: 'text',
      required: true,
    },
  ],
});

const sqlState = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.driverError?.code ?? candidate.code;
};

const expectSqlState = async (
  operation: Promise<unknown>,
  expected: string,
): Promise<void> => {
  try {
    await operation;
  } catch (error) {
    expect(sqlState(error)).toBe(expected);
    return;
  }
  throw new Error('Expected PostgreSQL SQLSTATE ' + expected);
};

const servicesFor = (dataSource: DataSource) => {
  const revisions = new CmsRevisionsService(
    dataSource,
    dataSource.getRepository(SiteEntity),
    dataSource.getRepository(SiteAccessEntity),
  );
  return {
    revisions,
    repository: new ManagedChunkPersistenceRepository(dataSource, revisions),
  };
};

type CleanupAction = () => Promise<unknown>;
type CleanupErrorCarrier = { cleanupErrors?: unknown[] };

const cleanupFailure = (errors: unknown[]): Error =>
  Object.assign(new Error('Database test cleanup failed'), {
    cleanupErrors: errors,
  });

const attachCleanupErrors = (
  primaryError: unknown,
  cleanupErrors: unknown[],
): void => {
  if (
    primaryError &&
    (typeof primaryError === 'object' || typeof primaryError === 'function')
  ) {
    try {
      Object.defineProperty(primaryError, 'cleanupErrors', {
        configurable: true,
        value: cleanupErrors,
      });
    } catch {
      // The original error remains authoritative even when it is not extensible.
    }
  }
};

const runCleanupGroups = async (
  groups: readonly (readonly CleanupAction[])[],
  primaryError?: unknown,
): Promise<void> => {
  const cleanupErrors: unknown[] = [];
  for (const group of groups) {
    const results = await Promise.allSettled(
      group.map(async (action) => action()),
    );
    for (const result of results) {
      if (result.status === 'rejected') cleanupErrors.push(result.reason);
    }
  }
  if (cleanupErrors.length === 0) return;
  if (primaryError !== undefined) {
    attachCleanupErrors(primaryError, cleanupErrors);
    return;
  }
  throw cleanupFailure(cleanupErrors);
};

const destroySource = async (source: DataSource | undefined): Promise<void> => {
  if (source?.isInitialized) await source.destroy();
};

const cleanupRunner = async (
  runner: QueryRunner | undefined,
): Promise<void> => {
  if (!runner || runner.isReleased) return;
  const cleanupErrors: unknown[] = [];
  if (runner.isTransactionActive) {
    try {
      await runner.rollbackTransaction();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await runner.release();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) throw cleanupFailure(cleanupErrors);
};

const initializeDataSourceSafely = async (
  source: DataSource,
  setup: (initialized: DataSource) => Promise<void>,
): Promise<DataSource> => {
  try {
    await source.initialize();
    await setup(source);
    return source;
  } catch (error) {
    await runCleanupGroups([[() => destroySource(source)]], error);
    throw error;
  }
};

const createIndependentSource = async (
  databaseUrl: string,
  setup: (initialized: DataSource) => Promise<void> = async (initialized) => {
    await initialized.query("SET statement_timeout = '15s'");
  },
): Promise<DataSource> =>
  initializeDataSourceSafely(
    new DataSource({
      ...createDataSourceOptions(),
      url: databaseUrl,
      migrationsRun: false,
      logging: false,
      extra: { max: 1 },
    }),
    setup,
  );

class DatabaseTestCleanup {
  private readonly sources: DataSource[] = [];
  private readonly runners: QueryRunner[] = [];
  private readonly pending: Promise<unknown>[] = [];
  private readonly blockerReleases: CleanupAction[] = [];
  private readonly afterPendingActions: CleanupAction[] = [];

  async source(databaseUrl: string): Promise<DataSource> {
    const source = await createIndependentSource(databaseUrl);
    this.sources.push(source);
    return source;
  }

  ownSource(source: DataSource): DataSource {
    this.sources.push(source);
    return source;
  }

  ownRunner(runner: QueryRunner): QueryRunner {
    this.runners.push(runner);
    return runner;
  }

  async runner(
    source: DataSource,
    isolation?: 'READ COMMITTED' | 'REPEATABLE READ',
  ): Promise<QueryRunner> {
    const runner = source.createQueryRunner();
    this.runners.push(runner);
    try {
      await runner.connect();
      await runner.startTransaction(isolation);
      return runner;
    } catch (error) {
      await runCleanupGroups([[() => cleanupRunner(runner)]], error);
      throw error;
    }
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.push(operation);
    void operation.catch(() => undefined);
    return operation;
  }

  releaseBlocker(action: CleanupAction): void {
    this.blockerReleases.push(action);
  }

  afterPending(action: CleanupAction): void {
    this.afterPendingActions.push(action);
  }

  async cleanup(primaryError?: unknown): Promise<void> {
    await runCleanupGroups(
      [
        this.blockerReleases,
        [async () => void (await Promise.allSettled(this.pending))],
        this.afterPendingActions,
        [...this.runners]
          .reverse()
          .map((runner) => () => cleanupRunner(runner)),
        [...this.sources]
          .reverse()
          .map((source) => () => destroySource(source)),
      ],
      primaryError,
    );
  }
}

const withDatabaseTestCleanup = async <T>(
  work: (cleanup: DatabaseTestCleanup) => Promise<T>,
): Promise<T> => {
  const cleanup = new DatabaseTestCleanup();
  let primaryError: unknown;
  try {
    return await work(cleanup);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await cleanup.cleanup(primaryError);
  }
};

const seedAcceptanceFixture = async (
  source: DataSource,
  label: string,
): Promise<AcceptanceFixture> => {
  const suffix = label + '-' + randomUUID().slice(0, 8);
  const ids: AcceptanceFixture = {
    userId: randomUUID(),
    workspaceId: randomUUID(),
    packageId: randomUUID(),
    packageVersionId: randomUUID(),
    otherPackageId: randomUUID(),
    otherPackageVersionId: randomUUID(),
    siteId: randomUUID(),
    otherSiteId: randomUUID(),
    pageId: randomUUID(),
    otherPageId: randomUUID(),
  };
  await source.query(
    `INSERT INTO users
      (id, email, password_hash, full_name, platform_role, account_kind)
     VALUES ($1, $2, 'x', $3, 'employee', 'wispo')`,
    [ids.userId, suffix + '@example.test', suffix],
  );
  await source.query(
    `INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)`,
    [ids.workspaceId, suffix, 'ws-' + suffix],
  );
  await source.query(
    `INSERT INTO template_packages
      (id, package_id, title, site_type, repository_url)
     VALUES
      ($1, $2, $3, 'media', 'https://example.test/a.git'),
      ($4, $5, $6, 'media', 'https://example.test/b.git')`,
    [
      ids.packageId,
      'pkg-' + suffix,
      'Package ' + suffix,
      ids.otherPackageId,
      'pkg-other-' + suffix,
      'Other ' + suffix,
    ],
  );
  await source.query(
    `INSERT INTO template_package_versions
      (id, template_package_id, package_version, source_revision,
       release_digest, artifact_digest, manifest_digest, manifest_version,
       manifest, cms_api_min_schema_version, cms_api_max_schema_version,
       built_at, runtime_mode, runtime_url)
     VALUES
      ($1, $2, '2.0.0', 'source-a', 'release-a', NULL, 'manifest-a', 2,
       '{}'::jsonb, '1', NULL, now(), 'embedded-next', NULL),
      ($3, $4, '2.0.0', 'source-b', 'release-b', NULL, 'manifest-b', 2,
       '{}'::jsonb, '1', NULL, now(), 'embedded-next', NULL)`,
    [
      ids.packageVersionId,
      ids.packageId,
      ids.otherPackageVersionId,
      ids.otherPackageId,
    ],
  );
  await source.query(
    `INSERT INTO sites
      (id, workspace_id, created_by_user_id, name, slug, site_type,
       template_package_id, current_template_package_version_id)
     VALUES
      ($1, $2, $3, $4, $5, 'media', $6, $7),
      ($8, $2, $3, $9, $10, 'media', $11, $12)`,
    [
      ids.siteId,
      ids.workspaceId,
      ids.userId,
      'Site ' + suffix,
      'site-' + suffix,
      ids.packageId,
      ids.packageVersionId,
      ids.otherSiteId,
      'Other site ' + suffix,
      'other-site-' + suffix,
      ids.otherPackageId,
      ids.otherPackageVersionId,
    ],
  );
  await source.query(
    `INSERT INTO site_accesses
      (user_id, site_id, role, requires_approval)
     VALUES ($1, $2, 'site_owner', false), ($1, $3, 'site_owner', false)`,
    [ids.userId, ids.siteId, ids.otherSiteId],
  );
  await source.query(
    `INSERT INTO pages (id, site_id, title, slug)
     VALUES ($1, $2, 'Page A', $3), ($4, $5, 'Page B', $6)`,
    [
      ids.pageId,
      ids.siteId,
      'page-' + suffix,
      ids.otherPageId,
      ids.otherSiteId,
      'other-page-' + suffix,
    ],
  );
  return ids;
};

const employeeActor = (fixture: AcceptanceFixture) => ({
  userId: fixture.userId,
  platformRole: PlatformRole.EMPLOYEE,
});

const adminActor = (fixture: AcceptanceFixture) => ({
  userId: fixture.userId,
  platformRole: PlatformRole.WISPO_ADMIN,
});

const waitForLockWait = async (
  observer: DataSource,
  pid: number,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await observer.query(
      `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Expected backend ' + pid + ' to wait on a PostgreSQL lock');
};
type ObservedLockWait = {
  query: string;
  waitEvent: string;
  waitingLocks: string[];
  heldRelations: string[];
};

const observeLockWait = async (
  observer: DataSource,
  pid: number,
  queryToken: string,
): Promise<ObservedLockWait> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows: ObservedLockWait[] = await observer.query(
      `SELECT a.query,
        COALESCE(a.wait_event, '') AS "waitEvent",
        ARRAY(
          SELECT l.locktype || ':' || l.mode
          FROM pg_locks l
          WHERE l.pid = a.pid AND NOT l.granted
          ORDER BY l.locktype, l.mode
        ) AS "waitingLocks",
        ARRAY(
          SELECT DISTINCT c.relname
          FROM pg_locks l
          JOIN pg_class c ON c.oid = l.relation
          WHERE l.pid = a.pid AND l.granted
          ORDER BY c.relname
        ) AS "heldRelations"
       FROM pg_stat_activity a
       WHERE a.pid = $1 AND a.wait_event_type = 'Lock'`,
      [pid],
    );
    const observed = rows[0];
    if (observed && observed.query.includes(queryToken)) {
      const parseArray = (value: string[] | string): string[] =>
        Array.isArray(value)
          ? value
          : value === '{}'
            ? []
            : value.slice(1, -1).split(',');
      const normalized = {
        ...observed,
        waitingLocks: parseArray(observed.waitingLocks),
        heldRelations: parseArray(observed.heldRelations),
      };
      expect(normalized.waitingLocks.length).toBeGreaterThan(0);
      return normalized;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const activity = await observer.query(
    `SELECT query, state, wait_event_type, wait_event
     FROM pg_stat_activity WHERE pid = $1`,
    [pid],
  );
  throw new Error(
    `Expected backend ${pid} to wait on a PostgreSQL lock in ${queryToken}: ${JSON.stringify(activity)}`,
  );
};
const applyFullLedgerToDatabase = async (
  databaseUrl: string,
): Promise<DataSource> => {
  const options = createDataSourceOptions();
  const migrations = options.migrations ?? [];
  const seedBoundary = migrations.findIndex(
    (migration) =>
      typeof migration === 'function' &&
      migration.name === 'SeedArmaturexHomepage1789502400000',
  );
  const skinovaBoundary = migrations.findIndex(
    (migration) =>
      typeof migration === 'function' &&
      migration.name === 'ImportSkinovaMediaSite1789848000000',
  );
  if (seedBoundary < 0 || skinovaBoundary < 0) {
    throw new Error('Disposable ledger boundaries are missing');
  }
  const phase = async (
    selectedMigrations: typeof migrations,
    after?: (phaseSource: DataSource) => Promise<void>,
  ) =>
    withDatabaseTestCleanup(async (cleanup) => {
      const phaseSource = cleanup.ownSource(
        await initializeDataSourceSafely(
          new DataSource({
            ...options,
            url: databaseUrl,
            migrations: selectedMigrations,
            migrationsRun: false,
            logging: false,
          }),
          async (initialized) => {
            await initialized.query("SET statement_timeout = '20s'");
          },
        ),
      );
      await phaseSource.runMigrations({ transaction: 'all' });
      await after?.(phaseSource);
    });
  await phase(migrations.slice(0, seedBoundary), async (phaseSource) => {
    await phaseSource.query(
      `INSERT INTO workspaces (name, slug)
       VALUES ('Disposable acceptance', 'crazy-studio')
       ON CONFLICT (slug) DO NOTHING`,
    );
  });
  await phase(migrations.slice(0, skinovaBoundary), async (phaseSource) => {
    await phaseSource.query(
      `UPDATE privacy_legal_models
       SET status = 'approved', approved_at = COALESCE(approved_at, now())
       WHERE status = 'draft'`,
    );
  });
  let result: DataSource | undefined;
  try {
    result = new DataSource({
      ...options,
      url: databaseUrl,
      migrationsRun: false,
      logging: false,
    });
    await initializeDataSourceSafely(result, async (initialized) => {
      await initialized.query("SET statement_timeout = '20s'");
    });
    await result.runMigrations({ transaction: 'all' });
    return result;
  } catch (error) {
    await runCleanupGroups([[() => destroySource(result)]], error);
    throw error;
  }
};

const disposableDatabaseUrl = (
  baseUrl: string,
  databaseName: string,
): string => {
  if (!/^wispo_managed_chunks_phase2_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error('Unsafe disposable database name');
  }
  const parsed = new URL(baseUrl);
  parsed.pathname = '/' + databaseName;
  return parsed.href;
};
const integrationSuite = integrationEnvironmentPresent
  ? describe
  : describe.skip;

integrationSuite('managed chunk persistence in disposable PostgreSQL', () => {
  let source: DataSource;
  let firstMigrationCount = 0;

  beforeAll(async () => {
    const databaseUrl = assertDisposableManagedChunkDatabase(
      process.env.MANAGED_CHUNK_TEST_DATABASE_URL,
      process.env.WISPO_MANAGED_CHUNK_ISOLATED_DB,
    );
    const options = createDataSourceOptions();
    const migrations = options.migrations ?? [];
    const seedBoundary = migrations.findIndex(
      (migration) =>
        typeof migration === 'function' &&
        migration.name === 'SeedArmaturexHomepage1789502400000',
    );
    if (seedBoundary < 0)
      throw new Error('Armaturex ledger boundary is missing');

    await withDatabaseTestCleanup(async (cleanup) => {
      const bootstrap = cleanup.ownSource(
        await initializeDataSourceSafely(
          new DataSource({
            ...options,
            url: databaseUrl.href,
            migrations: migrations.slice(0, seedBoundary),
            migrationsRun: false,
            logging: false,
          }),
          async (initialized) => {
            await initialized.query("SET statement_timeout = '20s'");
          },
        ),
      );
      const applied = await bootstrap.runMigrations({ transaction: 'all' });
      firstMigrationCount += applied.length;
      await bootstrap.query(
        `INSERT INTO workspaces (name, slug)
         VALUES ('Disposable acceptance', 'crazy-studio')
         ON CONFLICT (slug) DO NOTHING`,
      );
    });

    const skinovaBoundary = migrations.findIndex(
      (migration) =>
        typeof migration === 'function' &&
        migration.name === 'ImportSkinovaMediaSite1789848000000',
    );
    if (skinovaBoundary < 0)
      throw new Error('Skinova ledger boundary is missing');
    await withDatabaseTestCleanup(async (cleanup) => {
      const legalBootstrap = cleanup.ownSource(
        await initializeDataSourceSafely(
          new DataSource({
            ...options,
            url: databaseUrl.href,
            migrations: migrations.slice(0, skinovaBoundary),
            migrationsRun: false,
            logging: false,
          }),
          async (initialized) => {
            await initialized.query("SET statement_timeout = '20s'");
          },
        ),
      );
      const applied = await legalBootstrap.runMigrations({
        transaction: 'all',
      });
      firstMigrationCount += applied.length;
      await legalBootstrap.query(
        `UPDATE privacy_legal_models
         SET status = 'approved', approved_at = COALESCE(approved_at, now())
         WHERE status = 'draft'`,
      );
    });

    try {
      source = new DataSource({
        ...options,
        url: databaseUrl.href,
        migrationsRun: false,
        logging: false,
      });
      await initializeDataSourceSafely(source, async (initialized) => {
        await initialized.query("SET statement_timeout = '20s'");
      });
      const applied = await source.runMigrations({ transaction: 'all' });
      firstMigrationCount += applied.length;
    } catch (error) {
      await runCleanupGroups([[() => destroySource(source)]], error);
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    await runCleanupGroups([[() => destroySource(source)]]);
  });

  it('applies the complete ledger and makes a second migration run a no-op', async () => {
    const expectedLedgerCount =
      createDataSourceOptions().migrations?.length ?? 0;
    expect([0, expectedLedgerCount]).toContain(firstMigrationCount);
    await expect(source.runMigrations({ transaction: 'all' })).resolves.toEqual(
      [],
    );
    const [{ count }] = await source.query(
      'SELECT count(*)::int AS count FROM migrations',
    );
    expect(count).toBe(expectedLedgerCount);
  });
  it('destroys an initialized source when setup fails and leaves no backend', async () => {
    const injected = new Error('injected source setup failure');
    let failedPid: number | undefined;
    await expect(
      createIndependentSource(
        process.env.MANAGED_CHUNK_TEST_DATABASE_URL!,
        async (initialized) => {
          await initialized.query("SET statement_timeout = '15s'");
          [{ pg_backend_pid: failedPid }] = await initialized.query(
            'SELECT pg_backend_pid()',
          );
          throw injected;
        },
      ),
    ).rejects.toBe(injected);
    expect(failedPid).toEqual(expect.any(Number));
    expect(
      await source.query(`SELECT pid FROM pg_stat_activity WHERE pid = $1`, [
        failedPid,
      ]),
    ).toEqual([]);
  });
  it('keeps v1/v2 checks and rejects unsafe package/contract identities', async () => {
    const fixture = await seedAcceptanceFixture(source, 'checks');
    await source.query(
      `INSERT INTO template_package_versions
        (template_package_id, package_version, source_revision, release_digest,
         artifact_digest, manifest_digest, manifest_version, manifest,
         cms_api_min_schema_version, cms_api_max_schema_version, built_at,
         runtime_mode, runtime_url)
       VALUES ($1, '1.0.0', 'v1', 'release-v1', NULL, 'manifest-v1', 1,
         '{}'::jsonb, '1', NULL, now(), 'embedded-next', NULL)`,
      [fixture.packageId],
    );
    await expectSqlState(
      source.query(
        `INSERT INTO template_package_versions
          (template_package_id, package_version, source_revision, release_digest,
           artifact_digest, manifest_digest, manifest_version, manifest,
           cms_api_min_schema_version, cms_api_max_schema_version, built_at,
           runtime_mode, runtime_url)
         VALUES ($1, '3.0.0', 'v3', 'release-v3', NULL, 'manifest-v3', 3,
           '{}'::jsonb, '1', NULL, now(), 'embedded-next', NULL)`,
        [fixture.packageId],
      ),
      '23514',
    );
    await source.query(
      `INSERT INTO cms_revision_resources
        (site_id, resource_type, entity_id, latest_version_number, review_state)
       VALUES ($1, 'article', $2, 0, 'draft'),
              ($1, 'chunk_instance', $3, 0, 'draft')`,
      [fixture.siteId, randomUUID(), randomUUID()],
    );

    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('checks-contract')],
    });
    expect(contract.templatePackageId).toBe(fixture.packageId);
    await expectSqlState(
      source.query(
        `INSERT INTO managed_chunk_contracts
          (template_package_id, first_seen_template_package_version_id,
           definition_key, schema_version, contract_digest, field_contract,
           data_schema)
         VALUES ($1, $2, 'wrong-version', '1', $3, '{}'::jsonb, '{}'::jsonb)`,
        [
          fixture.packageId,
          fixture.otherPackageVersionId,
          'sha256:' + 'a'.repeat(64),
        ],
      ),
      '23503',
    );
    await expect(
      repository.registerContracts({
        templatePackageId: fixture.packageId,
        templatePackageVersionId: fixture.otherPackageVersionId,
        definitions: [managedDefinition('not-this-package')],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      repository.registerContracts({
        templatePackageId: fixture.packageId,
        templatePackageVersionId: fixture.packageVersionId,
        definitions: [managedDefinition('checks-contract', 'different-field')],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('registers opposite-order batches with observed overlapping lock waits and no partial rows', async () => {
    const fixture = await seedAcceptanceFixture(source, 'contracts-race');
    const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
    const advisoryKey = 187600101;
    const triggerName = 'test_pause_contract_' + randomUUID().replace(/-/g, '');
    const functionName = triggerName + '_fn';
    await withDatabaseTestCleanup(async (cleanup) => {
      const leftSource = await cleanup.source(url);
      const rightSource = await cleanup.source(url);
      const blocker = await cleanup.source(url);
      cleanup.releaseBlocker(async () => {
        await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
      });
      cleanup.afterPending(async () => {
        await runCleanupGroups([
          [
            async () => {
              await source.query(
                `DROP TRIGGER IF EXISTS ${triggerName} ON managed_chunk_contracts`,
              );
            },
          ],
          [
            async () => {
              await source.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
            },
          ],
        ]);
      });
      await source.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
         BEGIN
           IF NEW.template_package_id = '${fixture.packageId}'::uuid THEN
             PERFORM pg_advisory_xact_lock(${advisoryKey});
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql`,
      );
      await source.query(
        `CREATE TRIGGER ${triggerName}
         BEFORE INSERT ON managed_chunk_contracts
         FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      await blocker.query('SELECT pg_advisory_lock($1)', [advisoryKey]);
      const [{ pg_backend_pid: leftPid }] = await leftSource.query(
        'SELECT pg_backend_pid()',
      );
      const [{ pg_backend_pid: rightPid }] = await rightSource.query(
        'SELECT pg_backend_pid()',
      );
      const left = servicesFor(leftSource).repository;
      const right = servicesFor(rightSource).repository;
      const a = managedDefinition('race-a');
      const b = managedDefinition('race-b');
      const leftRegistration = cleanup.track(
        left.registerContracts({
          templatePackageId: fixture.packageId,
          templatePackageVersionId: fixture.packageVersionId,
          definitions: [a, b],
        }),
      );
      const rightRegistration = cleanup.track(
        right.registerContracts({
          templatePackageId: fixture.packageId,
          templatePackageVersionId: fixture.packageVersionId,
          definitions: [b, a],
        }),
      );
      const leftWait = await observeLockWait(
        source,
        leftPid,
        'managed_chunk_contracts',
      );
      const rightWait = await observeLockWait(
        source,
        rightPid,
        'managed_chunk_contracts',
      );
      expect(leftWait.waitingLocks).toContain('advisory:ExclusiveLock');
      expect(rightWait.waitingLocks).toContain('advisory:ExclusiveLock');
      await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
      const results = await Promise.allSettled([
        leftRegistration,
        rightRegistration,
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(sqlState(result.reason)).not.toBe('40P01');
          throw result.reason;
        }
        expect(result.value).toHaveLength(2);
      }
      const rows = await source.query(
        `SELECT definition_key, count(*)::int AS count
         FROM managed_chunk_contracts
         WHERE template_package_id = $1
         GROUP BY definition_key ORDER BY definition_key`,
        [fixture.packageId],
      );
      expect(rows).toEqual([
        { definition_key: 'race-a', count: 1 },
        { definition_key: 'race-b', count: 1 },
      ]);
    });
  }, 30_000);
  it('enforces tenant targets, atomic layout rollback, and draft/published inventory', async () => {
    const fixture = await seedAcceptanceFixture(source, 'tenant-layout');
    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('tenant-banner')],
    });
    const [otherContract] = await repository.registerContracts({
      templatePackageId: fixture.otherPackageId,
      templatePackageVersionId: fixture.otherPackageVersionId,
      definitions: [managedDefinition('other-banner')],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Tenant A',
      contractId: contract.id,
      data: { headline: 'A' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const otherInstance = await repository.createInstanceDraft({
      siteId: fixture.otherSiteId,
      displayName: 'Tenant B',
      contractId: otherContract.id,
      data: { headline: 'B' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const before = await source.query(
      `SELECT
        (SELECT count(*)::int FROM managed_chunk_layouts WHERE site_id = $1) AS layouts,
        (SELECT count(*)::int FROM cms_revision_resources
          WHERE site_id = $1 AND resource_type = 'chunk_layout') AS resources`,
      [fixture.siteId],
    );

    await expect(
      repository.saveLayoutDraft({
        siteId: fixture.siteId,
        target: { kind: 'page', pageId: fixture.otherPageId },
        templateKey: 'home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [],
        actor: adminActor(fixture),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      repository.saveLayoutDraft({
        siteId: fixture.siteId,
        target: { kind: 'page', pageId: fixture.pageId },
        templateKey: 'home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [
          {
            slotKey: 'hero',
            position: 0,
            instanceId: otherInstance.instanceId,
          },
        ],
        actor: adminActor(fixture),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      repository.saveLayoutDraft({
        siteId: fixture.siteId,
        target: { kind: 'page', pageId: fixture.pageId },
        templateKey: 'home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [
          { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
          { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
        ],
        actor: adminActor(fixture),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const afterFailures = await source.query(
      `SELECT
        (SELECT count(*)::int FROM managed_chunk_layouts WHERE site_id = $1) AS layouts,
        (SELECT count(*)::int FROM cms_revision_resources
          WHERE site_id = $1 AND resource_type = 'chunk_layout') AS resources`,
      [fixture.siteId],
    );
    expect(afterFailures[0]).toEqual(before[0]);

    const layout = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [
        { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
      ],
      actor: adminActor(fixture),
    });
    const placementCountBeforeDuplicate = await source
      .getRepository(ManagedChunkPlacementEntity)
      .countBy({ layoutRevisionId: layout.revisionId });
    await expectSqlState(
      source.query(
        `INSERT INTO managed_chunk_placements
          (site_id, layout_id, layout_revision_resource_id,
           layout_revision_id, instance_id, slot_key, position)
         SELECT site_id, layout_id, layout_revision_resource_id,
           layout_revision_id, instance_id, slot_key, position
         FROM managed_chunk_placements
         WHERE layout_revision_id = $1 AND slot_key = 'hero' AND position = 0`,
        [layout.revisionId],
      ),
      '23505',
    );
    expect(
      await source
        .getRepository(ManagedChunkPlacementEntity)
        .countBy({ layoutRevisionId: layout.revisionId }),
    ).toBe(placementCountBeforeDuplicate);
    const draftInventory = await repository.readCompatibilityInventory({
      siteId: fixture.siteId,
      templatePackageId: fixture.packageId,
    });
    expect(draftInventory.contracts).toEqual([
      expect.objectContaining({
        definitionKey: 'tenant-banner',
        sources: ['draft'],
      }),
    ]);
    expect(draftInventory.placements).toEqual([
      expect.objectContaining({
        source: 'draft',
        slotKey: 'hero',
        position: 0,
      }),
    ]);

    await repository.publishInstanceRevision({
      siteId: fixture.siteId,
      instanceId: instance.instanceId,
      revisionId: instance.revisionId,
      actor: adminActor(fixture),
    });
    await repository.publishLayoutRevision({
      siteId: fixture.siteId,
      layoutId: layout.layoutId,
      revisionId: layout.revisionId,
      actor: adminActor(fixture),
    });
    const inventory = await repository.readCompatibilityInventory({
      siteId: fixture.siteId,
      templatePackageId: fixture.packageId,
    });
    expect(inventory.contracts[0].sources).toEqual(['draft', 'published']);
    expect(inventory.placements.map((row) => row.source)).toEqual([
      'draft',
      'published',
    ]);
  }, 30_000);

  it.each(['page', 'site_surface'] as const)(
    'serializes concurrent initial %s layout creation with observed contention and a v2 retry',
    async (kind) => {
      const fixture = await seedAcceptanceFixture(
        source,
        'layout-race-' + kind,
      );
      const { repository } = servicesFor(source);
      const [contract] = await repository.registerContracts({
        templatePackageId: fixture.packageId,
        templatePackageVersionId: fixture.packageVersionId,
        definitions: [managedDefinition('layout-race-banner')],
      });
      const instance = await repository.createInstanceDraft({
        siteId: fixture.siteId,
        displayName: 'Race instance',
        contractId: contract.id,
        data: { headline: 'Race' },
        sanitizerPolicyVersion: null,
        actor: adminActor(fixture),
      });
      const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
      const advisoryKey = kind === 'page' ? 187600102 : 187600103;
      const triggerName =
        'test_pause_layout_resource_' + randomUUID().replace(/-/g, '');
      const functionName = triggerName + '_fn';
      await withDatabaseTestCleanup(async (cleanup) => {
        const firstSource = await cleanup.source(url);
        const secondSource = await cleanup.source(url);
        const blocker = await cleanup.source(url);
        cleanup.releaseBlocker(async () => {
          await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
        });
        cleanup.afterPending(async () => {
          await runCleanupGroups([
            [
              async () => {
                await source.query(
                  `DROP TRIGGER IF EXISTS ${triggerName} ON cms_revision_resources`,
                );
              },
            ],
            [
              async () => {
                await source.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
              },
            ],
          ]);
        });
        await source.query(
          `CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
         BEGIN
           IF NEW.resource_type = 'chunk_layout'
             AND NEW.site_id = '${fixture.siteId}'::uuid THEN
             PERFORM pg_advisory_xact_lock(${advisoryKey});
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql`,
        );
        await source.query(
          `CREATE TRIGGER ${triggerName}
         BEFORE INSERT ON cms_revision_resources
         FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
        );
        await blocker.query('SELECT pg_advisory_lock($1)', [advisoryKey]);
        const [{ pg_backend_pid: firstPid }] = await firstSource.query(
          'SELECT pg_backend_pid()',
        );
        const [{ pg_backend_pid: secondPid }] = await secondSource.query(
          'SELECT pg_backend_pid()',
        );
        const target =
          kind === 'page'
            ? ({ kind: 'page', pageId: fixture.pageId } as const)
            : ({
                kind: 'site_surface',
                surfaceKey: 'surface-' + randomUUID().slice(0, 8),
              } as const);
        const input = {
          siteId: fixture.siteId,
          target,
          templateKey: 'home',
          templateVersion: '1',
          expectedDraftRevisionId: null,
          placements: [
            { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
          ],
          actor: adminActor(fixture),
        };
        const firstSave = cleanup.track(
          servicesFor(firstSource).repository.saveLayoutDraft(input),
        );
        const firstWait = await observeLockWait(
          source,
          firstPid,
          'cms_revision_resources',
        );
        expect(firstWait.waitingLocks).toContain('advisory:ExclusiveLock');
        expect(firstWait.heldRelations).toContain('sites');

        const secondSave = cleanup.track(
          servicesFor(secondSource).repository.saveLayoutDraft(input),
        );
        const secondWait = await observeLockWait(source, secondPid, '');
        expect(secondWait.heldRelations).toContain('sites');
        await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
        const results = await Promise.allSettled([firstSave, secondSave]);
        expect(results[0].status).toBe('fulfilled');
        expect(results[1].status).toBe('rejected');
        if (results[0].status !== 'fulfilled') throw results[0].reason;
        if (results[1].status !== 'rejected') {
          throw new Error('Second initial layout save unexpectedly succeeded');
        }
        expect(results[0].value.versionNumber).toBe(1);
        expect(results[1].reason).toBeInstanceOf(ConflictException);
        expect(sqlState(results[1].reason)).not.toBe('40P01');

        const retried = await servicesFor(
          secondSource,
        ).repository.saveLayoutDraft({
          ...input,
          expectedDraftRevisionId: results[0].value.revisionId,
        });
        expect(retried.versionNumber).toBe(2);
        expect(retried.layoutId).toBe(results[0].value.layoutId);
        const [{ layouts, resources, revisions, placements, orphans }] =
          await source.query(
            `SELECT
              (SELECT count(*)::int FROM managed_chunk_layouts WHERE id = $1) AS layouts,
              (SELECT count(*)::int FROM cms_revision_resources
                WHERE site_id = $2 AND resource_type = 'chunk_layout' AND entity_id = $1) AS resources,
              (SELECT count(*)::int FROM cms_revisions r
                JOIN cms_revision_resources cr ON cr.id = r.resource_id
                WHERE cr.entity_id = $1 AND cr.resource_type = 'chunk_layout') AS revisions,
              (SELECT count(*)::int FROM managed_chunk_placements WHERE layout_id = $1) AS placements,
              (SELECT count(*)::int FROM managed_chunk_placements p
                LEFT JOIN cms_revisions r ON r.id = p.layout_revision_id
                WHERE p.layout_id = $1 AND r.id IS NULL) AS orphans`,
            [results[0].value.layoutId, fixture.siteId],
          );
        expect({ layouts, resources, revisions, placements, orphans }).toEqual({
          layouts: 1,
          resources: 1,
          revisions: 2,
          placements: 2,
          orphans: 0,
        });
      });
    },
    30_000,
  );
  it('orders access reassignment before managed instance writes without deadlock or partial rows', async () => {
    const fixture = await seedAcceptanceFixture(source, 'access-race');
    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('access-banner')],
    });
    const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
    await withDatabaseTestCleanup(async (cleanup) => {
      const assignmentSource = await cleanup.source(url);
      const writerSource = await cleanup.source(url);
      const assignment = await cleanup.runner(assignmentSource);
      cleanup.releaseBlocker(async () => {
        if (assignment.isTransactionActive)
          await assignment.rollbackTransaction();
      });
      await assignment.query("SET LOCAL statement_timeout = '15s'");
      await assignment.query(
        `DELETE FROM site_accesses WHERE user_id = $1 AND site_id = $2`,
        [fixture.userId, fixture.siteId],
      );
      await assignment.query(
        `INSERT INTO site_accesses (user_id, site_id, role, requires_approval)
         VALUES ($1, $2, 'site_owner', false)`,
        [fixture.userId, fixture.siteId],
      );
      const [{ pg_backend_pid: writerPid }] = await writerSource.query(
        'SELECT pg_backend_pid()',
      );
      const write = cleanup.track(
        servicesFor(writerSource).repository.createInstanceDraft({
          siteId: fixture.siteId,
          displayName: 'After reassignment',
          contractId: contract.id,
          data: { headline: 'Allowed' },
          sanitizerPolicyVersion: null,
          actor: employeeActor(fixture),
        }),
      );
      const accessWait = await observeLockWait(
        source,
        writerPid,
        'site_accesses',
      );
      expect(accessWait.heldRelations).toContain('site_accesses');
      expect(accessWait.waitingLocks).toEqual(['transactionid:ShareLock']);
      for (const forbiddenRelation of [
        'sites',
        'pages',
        'managed_chunk_instances',
        'managed_chunk_layouts',
        'cms_revision_resources',
        'cms_revisions',
      ]) {
        expect(accessWait.heldRelations).not.toContain(forbiddenRelation);
      }
      await assignment.commitTransaction();
      const created = await write;
      expect(created.versionNumber).toBe(1);
      expect(
        await source.getRepository(ManagedChunkInstanceEntity).countBy({
          id: created.instanceId,
          siteId: fixture.siteId,
        }),
      ).toBe(1);
    });

    const deniedFixture = await seedAcceptanceFixture(source, 'access-denied');
    const [deniedContract] = await servicesFor(
      source,
    ).repository.registerContracts({
      templatePackageId: deniedFixture.packageId,
      templatePackageVersionId: deniedFixture.packageVersionId,
      definitions: [managedDefinition('denied-banner')],
    });
    await withDatabaseTestCleanup(async (cleanup) => {
      const denySource = await cleanup.source(url);
      const deniedWriter = await cleanup.source(url);
      const denyRunner = await cleanup.runner(denySource);
      cleanup.releaseBlocker(async () => {
        if (denyRunner.isTransactionActive)
          await denyRunner.rollbackTransaction();
      });
      await denyRunner.query(
        `DELETE FROM site_accesses WHERE user_id = $1 AND site_id = $2`,
        [deniedFixture.userId, deniedFixture.siteId],
      );
      const [{ pg_backend_pid: deniedPid }] = await deniedWriter.query(
        'SELECT pg_backend_pid()',
      );
      const before = await source
        .getRepository(CmsRevisionResourceEntity)
        .countBy({
          siteId: deniedFixture.siteId,
          resourceType: 'chunk_instance',
        });
      const denied = cleanup.track(
        servicesFor(deniedWriter).repository.createInstanceDraft({
          siteId: deniedFixture.siteId,
          displayName: 'Denied',
          contractId: deniedContract.id,
          data: { headline: 'Denied' },
          sanitizerPolicyVersion: null,
          actor: employeeActor(deniedFixture),
        }),
      );
      await waitForLockWait(source, deniedPid);
      await denyRunner.commitTransaction();
      await expect(denied).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        await source.getRepository(CmsRevisionResourceEntity).countBy({
          siteId: deniedFixture.siteId,
          resourceType: 'chunk_instance',
        }),
      ).toBe(before);
    });
  }, 30_000);
  it('serializes package activation with instance creation in both lock orders', async () => {
    const fixture = await seedAcceptanceFixture(source, 'package-race');
    const [contract] = await servicesFor(source).repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('package-banner')],
    });
    const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
    const advisoryKey = 187600001;
    const triggerName =
      'test_pause_chunk_instance_' + randomUUID().replace(/-/g, '');
    const functionName = triggerName + '_fn';
    await withDatabaseTestCleanup(async (cleanup) => {
      const blocker = await cleanup.source(url);
      const creatorSource = await cleanup.source(url);
      const activationSource = await cleanup.source(url);
      cleanup.releaseBlocker(async () => {
        await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
      });
      cleanup.afterPending(async () => {
        await runCleanupGroups([
          [
            async () => {
              await source.query(
                `DROP TRIGGER IF EXISTS ${triggerName} ON cms_revision_resources`,
              );
            },
          ],
          [
            async () => {
              await source.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
            },
          ],
        ]);
      });
      await source.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
         BEGIN
           IF NEW.resource_type = 'chunk_instance' AND NEW.site_id = '${fixture.siteId}'::uuid THEN
             PERFORM pg_advisory_xact_lock(${advisoryKey});
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql`,
      );
      await source.query(
        `CREATE TRIGGER ${triggerName}
         BEFORE INSERT ON cms_revision_resources
         FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
      await blocker.query('SELECT pg_advisory_lock($1)', [advisoryKey]);
      const [{ pg_backend_pid: creatorPid }] = await creatorSource.query(
        'SELECT pg_backend_pid()',
      );
      const creation = cleanup.track(
        servicesFor(creatorSource).repository.createInstanceDraft({
          siteId: fixture.siteId,
          displayName: 'Before switch',
          contractId: contract.id,
          data: { headline: 'Before' },
          sanitizerPolicyVersion: null,
          actor: adminActor(fixture),
        }),
      );
      await waitForLockWait(source, creatorPid);

      const activation = await cleanup.runner(activationSource);
      cleanup.releaseBlocker(async () => {
        if (activation.isTransactionActive)
          await activation.rollbackTransaction();
      });
      const [{ pg_backend_pid: activationPid }] = (await activation.query(
        'SELECT pg_backend_pid()',
      )) as Array<{ pg_backend_pid: number }>;
      const switchPackage = cleanup.track(
        activation.query(
          `UPDATE sites
           SET template_package_id = $1, current_template_package_version_id = $2
           WHERE id = $3`,
          [
            fixture.otherPackageId,
            fixture.otherPackageVersionId,
            fixture.siteId,
          ],
        ),
      );
      await waitForLockWait(source, activationPid);
      await blocker.query('SELECT pg_advisory_unlock($1)', [advisoryKey]);
      const created = await creation;
      await switchPackage;
      await activation.commitTransaction();
      expect(
        await source.getRepository(ManagedChunkInstanceRevisionEntity).countBy({
          instanceId: created.instanceId,
          contractId: contract.id,
        }),
      ).toBe(1);
      await cleanupRunner(activation);

      await source.query(
        `UPDATE sites
         SET template_package_id = $1, current_template_package_version_id = $2
         WHERE id = $3`,
        [fixture.packageId, fixture.packageVersionId, fixture.siteId],
      );
      const switchFirst = await cleanup.runner(activationSource);
      cleanup.releaseBlocker(async () => {
        if (switchFirst.isTransactionActive)
          await switchFirst.rollbackTransaction();
      });
      await switchFirst.query(
        `UPDATE sites
         SET template_package_id = $1, current_template_package_version_id = $2
         WHERE id = $3`,
        [fixture.otherPackageId, fixture.otherPackageVersionId, fixture.siteId],
      );
      const [{ pg_backend_pid: secondCreatorPid }] = await creatorSource.query(
        'SELECT pg_backend_pid()',
      );
      const beforeResources = await source
        .getRepository(CmsRevisionResourceEntity)
        .countBy({ siteId: fixture.siteId, resourceType: 'chunk_instance' });
      const rejectedCreation = cleanup.track(
        servicesFor(creatorSource).repository.createInstanceDraft({
          siteId: fixture.siteId,
          displayName: 'After switch',
          contractId: contract.id,
          data: { headline: 'After' },
          sanitizerPolicyVersion: null,
          actor: adminActor(fixture),
        }),
      );
      await waitForLockWait(source, secondCreatorPid);
      await switchFirst.commitTransaction();
      await expect(rejectedCreation).rejects.toBeInstanceOf(NotFoundException);
      expect(
        await source.getRepository(CmsRevisionResourceEntity).countBy({
          siteId: fixture.siteId,
          resourceType: 'chunk_instance',
        }),
      ).toBe(beforeResources);
    });
  }, 30_000);
  it('rolls back invalid managed lifecycle prepares and injected restore copies', async () => {
    const fixture = await seedAcceptanceFixture(source, 'lifecycle-invalid');
    const { repository, revisions } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('lifecycle-banner')],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Lifecycle',
      contractId: contract.id,
      data: { headline: 'Original' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const layout = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [
        { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
      ],
      actor: adminActor(fixture),
    });

    const unlinkedEntityId = randomUUID();
    const unlinkedResourceId = randomUUID();
    const unlinkedRevisionId = randomUUID();
    await source.query(
      `INSERT INTO cms_revision_resources
        (id, site_id, resource_type, entity_id, latest_version_number,
         draft_revision_id, review_state)
       VALUES ($1, $2, 'chunk_instance', $3, 0, NULL, 'in_review')`,
      [unlinkedResourceId, fixture.siteId, unlinkedEntityId],
    );
    await source.query(
      `INSERT INTO cms_revisions
        (id, resource_id, version_number, snapshot, actor_user_id)
       VALUES ($1, $2, 1, $3::jsonb, $4)`,
      [
        unlinkedRevisionId,
        unlinkedResourceId,
        JSON.stringify({
          formatVersion: 1,
          data: {},
          sanitizerPolicyVersion: null,
        }),
        fixture.userId,
      ],
    );
    await source.query(
      `UPDATE cms_revision_resources
       SET latest_version_number = 1, draft_revision_id = $1
       WHERE id = $2`,
      [unlinkedRevisionId, unlinkedResourceId],
    );
    const unlinkedBefore = (
      await source.query(
        `SELECT draft_revision_id, approved_revision_id, published_revision_id,
        (SELECT count(*)::int FROM cms_revision_events WHERE resource_id = $1) AS events,
        (SELECT count(*)::int FROM cms_revisions WHERE resource_id = $1) AS revisions,
        (SELECT count(*)::int FROM managed_chunk_instance_revisions
          WHERE revision_resource_id = $1) AS links
       FROM cms_revision_resources WHERE id = $1`,
        [unlinkedResourceId],
      )
    )[0] as Record<string, unknown>;
    for (const operation of ['approve', 'publish'] as const) {
      const transition =
        operation === 'approve'
          ? revisions.approveManagedRevisionUsingManager.bind(revisions)
          : revisions.publishManagedRevisionUsingManager.bind(revisions);
      await expect(
        source.transaction((db) =>
          transition(
            db,
            {
              siteId: fixture.siteId,
              resourceType: 'chunk_instance',
              entityId: unlinkedEntityId,
              revisionId: unlinkedRevisionId,
              actor: adminActor(fixture),
            },
            async (prepareDb) => ({
              resource: await prepareDb.findOneByOrFail(
                CmsRevisionResourceEntity,
                { id: unlinkedResourceId },
              ),
              revision: await prepareDb.findOneByOrFail(CmsRevisionEntity, {
                id: unlinkedRevisionId,
              }),
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        (
          await source.query(
            `SELECT draft_revision_id, approved_revision_id, published_revision_id,
            (SELECT count(*)::int FROM cms_revision_events WHERE resource_id = $1) AS events,
            (SELECT count(*)::int FROM cms_revisions WHERE resource_id = $1) AS revisions,
            (SELECT count(*)::int FROM managed_chunk_instance_revisions
              WHERE revision_resource_id = $1) AS links
           FROM cms_revision_resources WHERE id = $1`,
            [unlinkedResourceId],
          )
        )[0],
      ).toEqual(unlinkedBefore);
    }

    const resource = await source
      .getRepository(CmsRevisionResourceEntity)
      .findOneByOrFail({
        siteId: fixture.siteId,
        resourceType: 'chunk_instance',
        entityId: instance.instanceId,
      });
    const beforeRestore = {
      revisions: await source.getRepository(CmsRevisionEntity).countBy({
        resourceId: resource.id,
      }),
      links: await source
        .getRepository(ManagedChunkInstanceRevisionEntity)
        .countBy({
          instanceId: instance.instanceId,
        }),
      events: await source.getRepository(CmsRevisionEventEntity).countBy({
        resourceId: resource.id,
      }),
      draft: resource.draftRevisionId,
    };
    await expect(
      source.transaction((db) =>
        revisions.restoreManagedRevisionUsingManager(
          db,
          {
            siteId: fixture.siteId,
            resourceType: 'chunk_instance',
            entityId: instance.instanceId,
            sourceRevisionId: instance.revisionId,
            expectedDraftRevisionId: instance.revisionId,
            actor: adminActor(fixture),
          },
          async (prepareDb) => ({
            resource: await prepareDb.findOneByOrFail(
              CmsRevisionResourceEntity,
              {
                id: resource.id,
              },
            ),
            revision: await prepareDb.findOneByOrFail(CmsRevisionEntity, {
              id: instance.revisionId,
            }),
          }),
          () => Promise.resolve(),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const afterNoop = await source
      .getRepository(CmsRevisionResourceEntity)
      .findOneByOrFail({ id: resource.id });
    expect({
      revisions: await source.getRepository(CmsRevisionEntity).countBy({
        resourceId: resource.id,
      }),
      links: await source
        .getRepository(ManagedChunkInstanceRevisionEntity)
        .countBy({
          instanceId: instance.instanceId,
        }),
      events: await source.getRepository(CmsRevisionEventEntity).countBy({
        resourceId: resource.id,
      }),
      draft: afterNoop.draftRevisionId,
    }).toEqual(beforeRestore);

    const layoutResource = await source
      .getRepository(CmsRevisionResourceEntity)
      .findOneByOrFail({
        siteId: fixture.siteId,
        resourceType: 'chunk_layout',
        entityId: layout.layoutId,
      });
    const layoutState = async () => {
      const current = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({ id: layoutResource.id });
      return {
        draft: current.draftRevisionId,
        approved: current.approvedRevisionId,
        published: current.publishedRevisionId,
        reviewState: current.reviewState,
        revisions: await source.getRepository(CmsRevisionEntity).countBy({
          resourceId: layoutResource.id,
        }),
        placements: await source
          .getRepository(ManagedChunkPlacementEntity)
          .countBy({ layoutId: layout.layoutId }),
        events: await source.getRepository(CmsRevisionEventEntity).countBy({
          resourceId: layoutResource.id,
        }),
      };
    };
    const layoutBeforeInvalid = await layoutState();
    const instanceRevision = await source
      .getRepository(CmsRevisionEntity)
      .findOneByOrFail({ id: instance.revisionId });
    for (const operation of ['approve', 'publish'] as const) {
      const transition =
        operation === 'approve'
          ? revisions.approveManagedRevisionUsingManager.bind(revisions)
          : revisions.publishManagedRevisionUsingManager.bind(revisions);
      const mismatches = [
        {
          entityId: randomUUID(),
          resource: layoutResource,
          revision: await source
            .getRepository(CmsRevisionEntity)
            .findOneByOrFail({ id: layout.revisionId }),
        },
        {
          entityId: layout.layoutId,
          resource,
          revision: instanceRevision,
        },
        {
          entityId: layout.layoutId,
          resource: layoutResource,
          revision: instanceRevision,
        },
      ];
      for (const mismatch of mismatches) {
        await expect(
          source.transaction((db) =>
            transition(
              db,
              {
                siteId: fixture.siteId,
                resourceType: 'chunk_layout',
                entityId: mismatch.entityId,
                revisionId: layout.revisionId,
                actor: adminActor(fixture),
              },
              () =>
                Promise.resolve({
                  resource: mismatch.resource,
                  revision: mismatch.revision,
                }),
            ),
          ),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(await layoutState()).toEqual(layoutBeforeInvalid);
      }
    }

    const layoutRevisionCount = layoutBeforeInvalid.revisions;
    let fkState: string | undefined;
    try {
      await source.transaction((db) =>
        revisions.restoreManagedRevisionUsingManager(
          db,
          {
            siteId: fixture.siteId,
            resourceType: 'chunk_layout',
            entityId: layout.layoutId,
            sourceRevisionId: layout.revisionId,
            expectedDraftRevisionId: layout.revisionId,
            actor: adminActor(fixture),
          },
          async (prepareDb) => ({
            resource: await prepareDb.findOneByOrFail(
              CmsRevisionResourceEntity,
              {
                id: layoutResource.id,
              },
            ),
            revision: await prepareDb.findOneByOrFail(CmsRevisionEntity, {
              id: layout.revisionId,
            }),
          }),
          async (hookDb, savedRevision) => {
            await hookDb.query(
              `INSERT INTO managed_chunk_placements
                (site_id, layout_id, layout_revision_resource_id,
                 layout_revision_id, instance_id, slot_key, position)
               VALUES ($1, $2, $3, $4, $5, 'hero', 0)`,
              [
                fixture.siteId,
                layout.layoutId,
                layoutResource.id,
                savedRevision.id,
                randomUUID(),
              ],
            );
          },
        ),
      );
    } catch (error) {
      fkState = sqlState(error);
    }
    expect(fkState).toBe('23503');
    expect(layoutRevisionCount).toBe(layoutBeforeInvalid.revisions);
    expect(await layoutState()).toEqual(layoutBeforeInvalid);
  }, 30_000);

  it('restores exact instance/layout copies including empty placements', async () => {
    const fixture = await seedAcceptanceFixture(source, 'restore-exact');
    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('restore-banner')],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Restore instance',
      contractId: contract.id,
      data: { headline: 'restore' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const restoredInstance = await repository.restoreInstanceRevision({
      siteId: fixture.siteId,
      instanceId: instance.instanceId,
      sourceRevisionId: instance.revisionId,
      expectedDraftRevisionId: instance.revisionId,
      actor: adminActor(fixture),
    });
    const instanceLinks = await source
      .getRepository(ManagedChunkInstanceRevisionEntity)
      .findBy({ instanceId: instance.instanceId });
    expect(instanceLinks).toHaveLength(2);
    expect(new Set(instanceLinks.map((link) => link.contractId))).toEqual(
      new Set([contract.id]),
    );
    expect(restoredInstance.versionNumber).toBe(2);

    const nonEmpty = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [
        { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
      ],
      actor: adminActor(fixture),
    });
    const restoredLayout = await repository.restoreLayoutRevision({
      siteId: fixture.siteId,
      layoutId: nonEmpty.layoutId,
      sourceRevisionId: nonEmpty.revisionId,
      expectedDraftRevisionId: nonEmpty.revisionId,
      actor: adminActor(fixture),
    });
    const placementSets = await source.query(
      `SELECT layout_revision_id, instance_id, slot_key, position
       FROM managed_chunk_placements WHERE layout_id = $1
       ORDER BY layout_revision_id, slot_key, position`,
      [nonEmpty.layoutId],
    );
    expect(placementSets).toHaveLength(2);
    expect(
      placementSets.map(({ instance_id, slot_key, position }) => ({
        instance_id,
        slot_key,
        position,
      })),
    ).toEqual([
      {
        instance_id: instance.instanceId,
        slot_key: 'hero',
        position: 0,
      },
      {
        instance_id: instance.instanceId,
        slot_key: 'hero',
        position: 0,
      },
    ]);
    expect(restoredLayout.versionNumber).toBe(2);

    const empty = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'site_surface', surfaceKey: 'empty' },
      templateKey: 'shell',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [],
      actor: adminActor(fixture),
    });
    const restoredEmpty = await repository.restoreLayoutRevision({
      siteId: fixture.siteId,
      layoutId: empty.layoutId,
      sourceRevisionId: empty.revisionId,
      expectedDraftRevisionId: empty.revisionId,
      actor: adminActor(fixture),
    });
    expect(restoredEmpty.versionNumber).toBe(2);
    expect(
      await source.getRepository(ManagedChunkPlacementEntity).countBy({
        layoutId: empty.layoutId,
      }),
    ).toBe(0);
  }, 30_000);

  it.each(['approve', 'publish'] as const)(
    'serializes concurrent managed %s with observed resource contention, one event, and exact state',
    async (operation) => {
      const fixture = await seedAcceptanceFixture(
        source,
        'lifecycle-' + operation,
      );
      const { repository } = servicesFor(source);
      const [contract] = await repository.registerContracts({
        templatePackageId: fixture.packageId,
        templatePackageVersionId: fixture.packageVersionId,
        definitions: [managedDefinition('transition-banner')],
      });
      const instance = await repository.createInstanceDraft({
        siteId: fixture.siteId,
        displayName: operation,
        contractId: contract.id,
        data: { headline: operation },
        sanitizerPolicyVersion: null,
        actor: adminActor(fixture),
      });
      const resource = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({
          siteId: fixture.siteId,
          resourceType: 'chunk_instance',
          entityId: instance.instanceId,
        });
      if (operation === 'approve') {
        await source.query(
          `UPDATE cms_revision_resources SET review_state = 'in_review'
           WHERE id = $1`,
          [resource.id],
        );
      }
      const stateBefore = {
        revisions: await source.getRepository(CmsRevisionEntity).countBy({
          resourceId: resource.id,
        }),
        typedRows: await source
          .getRepository(ManagedChunkInstanceRevisionEntity)
          .countBy({ instanceId: instance.instanceId }),
        events: await source.getRepository(CmsRevisionEventEntity).countBy({
          resourceId: resource.id,
        }),
      };
      const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
      await withDatabaseTestCleanup(async (cleanup) => {
        const leftSource = await cleanup.source(url);
        const rightSource = await cleanup.source(url);
        const blockerSource = await cleanup.source(url);
        const blocker = await cleanup.runner(blockerSource);
        cleanup.releaseBlocker(async () => {
          if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        });
        await blocker.query(
          `SELECT id FROM cms_revision_resources WHERE id = $1 FOR UPDATE`,
          [resource.id],
        );
        const [{ pg_backend_pid: leftPid }] = await leftSource.query(
          'SELECT pg_backend_pid()',
        );
        const [{ pg_backend_pid: rightPid }] = await rightSource.query(
          'SELECT pg_backend_pid()',
        );
        const invoke = (dataSource: DataSource) => {
          const candidate = servicesFor(dataSource).repository;
          const input = {
            siteId: fixture.siteId,
            instanceId: instance.instanceId,
            revisionId: instance.revisionId,
            actor: adminActor(fixture),
          };
          return operation === 'approve'
            ? candidate.approveInstanceRevision(input)
            : candidate.publishInstanceRevision(input);
        };
        const leftTransition = cleanup.track(invoke(leftSource));
        const rightTransition = cleanup.track(invoke(rightSource));
        const leftWait = await observeLockWait(
          source,
          leftPid,
          'cms_revision_resources',
        );
        const rightWait = await observeLockWait(
          source,
          rightPid,
          'cms_revision_resources',
        );
        expect(leftWait.heldRelations).toEqual(
          expect.arrayContaining([
            'sites',
            'managed_chunk_instances',
            'cms_revision_resources',
          ]),
        );
        expect(rightWait.heldRelations).toEqual(
          expect.arrayContaining([
            'sites',
            'managed_chunk_instances',
            'cms_revision_resources',
          ]),
        );
        await blocker.commitTransaction();
        const results = await Promise.allSettled([
          leftTransition,
          rightTransition,
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected',
        );
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(ConflictException);
        expect(sqlState(rejected[0].reason)).not.toBe('40P01');
        const saved = await source
          .getRepository(CmsRevisionResourceEntity)
          .findOneByOrFail({ id: resource.id });
        expect(saved.draftRevisionId).toBe(instance.revisionId);
        expect(saved.approvedRevisionId).toBe(instance.revisionId);
        expect(saved.publishedRevisionId).toBe(
          operation === 'publish' ? instance.revisionId : null,
        );
        expect(saved.reviewState).toBe('approved');
        expect(
          await source.getRepository(CmsRevisionEventEntity).countBy({
            resourceId: resource.id,
            eventType: operation === 'approve' ? 'approved' : 'published',
          }),
        ).toBe(1);
        expect({
          revisions: await source.getRepository(CmsRevisionEntity).countBy({
            resourceId: resource.id,
          }),
          typedRows: await source
            .getRepository(ManagedChunkInstanceRevisionEntity)
            .countBy({ instanceId: instance.instanceId }),
          events: await source.getRepository(CmsRevisionEventEntity).countBy({
            resourceId: resource.id,
          }),
        }).toEqual({
          ...stateBefore,
          events: stateBefore.events + 1,
        });
      });
    },
    30_000,
  );
  it('orders manager access before layout site/page locks', async () => {
    const fixture = await seedAcceptanceFixture(source, 'layout-access');
    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('layout-access-banner')],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Layout access instance',
      contractId: contract.id,
      data: { headline: 'layout' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const url = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
    await withDatabaseTestCleanup(async (cleanup) => {
      const assignmentSource = await cleanup.source(url);
      const layoutSource = await cleanup.source(url);
      const assignment = await cleanup.runner(assignmentSource);
      cleanup.releaseBlocker(async () => {
        if (assignment.isTransactionActive)
          await assignment.rollbackTransaction();
      });
      await assignment.query(
        `DELETE FROM site_accesses WHERE user_id = $1 AND site_id = $2`,
        [fixture.userId, fixture.siteId],
      );
      await assignment.query(
        `INSERT INTO site_accesses (user_id, site_id, role, requires_approval)
         VALUES ($1, $2, 'site_owner', false)`,
        [fixture.userId, fixture.siteId],
      );
      const [{ pg_backend_pid: layoutPid }] = await layoutSource.query(
        'SELECT pg_backend_pid()',
      );
      const save = cleanup.track(
        servicesFor(layoutSource).repository.saveLayoutDraft({
          siteId: fixture.siteId,
          target: { kind: 'page', pageId: fixture.pageId },
          templateKey: 'home',
          templateVersion: '1',
          expectedDraftRevisionId: null,
          placements: [
            { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
          ],
          actor: employeeActor(fixture),
        }),
      );
      const accessWait = await observeLockWait(
        source,
        layoutPid,
        'site_accesses',
      );
      expect(accessWait.heldRelations).toContain('site_accesses');
      expect(accessWait.waitingLocks).toEqual(['transactionid:ShareLock']);
      for (const forbiddenRelation of [
        'sites',
        'pages',
        'managed_chunk_instances',
        'managed_chunk_layouts',
        'cms_revision_resources',
        'cms_revisions',
      ]) {
        expect(accessWait.heldRelations).not.toContain(forbiddenRelation);
      }
      expect(
        await source.getRepository(CmsRevisionResourceEntity).countBy({
          siteId: fixture.siteId,
          resourceType: 'chunk_layout',
        }),
      ).toBe(0);
      await assignment.commitTransaction();
      const layout = await save;
      expect(layout.versionNumber).toBe(1);
    });
  }, 30_000);

  it.each(['instance', 'layout'] as const)(
    'observes real %s restore lock order and verifies the exact post-copy state',
    async (kind) => {
      const fixture = await seedAcceptanceFixture(source, 'lock-order-' + kind);
      const { repository } = servicesFor(source);
      const [contract] = await repository.registerContracts({
        templatePackageId: fixture.packageId,
        templatePackageVersionId: fixture.packageVersionId,
        definitions: [managedDefinition('lock-order-banner')],
      });
      const instance = await repository.createInstanceDraft({
        siteId: fixture.siteId,
        displayName: 'Lock order',
        contractId: contract.id,
        data: { headline: kind },
        sanitizerPolicyVersion: null,
        actor: adminActor(fixture),
      });
      const layout = await repository.saveLayoutDraft({
        siteId: fixture.siteId,
        target: { kind: 'page', pageId: fixture.pageId },
        templateKey: 'home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [
          { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
        ],
        actor: adminActor(fixture),
      });
      const entityId =
        kind === 'instance' ? instance.instanceId : layout.layoutId;
      const revisionId =
        kind === 'instance' ? instance.revisionId : layout.revisionId;
      const resourceType =
        kind === 'instance' ? 'chunk_instance' : 'chunk_layout';
      const ownerTable =
        kind === 'instance'
          ? 'managed_chunk_instances'
          : 'managed_chunk_layouts';
      const finalTable =
        kind === 'instance'
          ? 'managed_chunk_instance_revisions'
          : 'managed_chunk_placements';
      const ownerQueryToken =
        kind === 'instance'
          ? '"ManagedChunkInstanceEntity"'
          : '"ManagedChunkLayoutEntity"';
      const finalQueryToken =
        kind === 'instance'
          ? '"ManagedChunkInstanceRevisionEntity"'
          : '"ManagedChunkPlacementEntity"';
      const resource = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({
          siteId: fixture.siteId,
          resourceType,
          entityId,
        });
      await withDatabaseTestCleanup(async (cleanup) => {
        const block = async (sql: string, parameters: unknown[] = []) => {
          const runner = await cleanup.runner(source);
          cleanup.releaseBlocker(async () => {
            if (runner.isTransactionActive) await runner.rollbackTransaction();
          });
          await runner.query("SET LOCAL statement_timeout = '15s'");
          await runner.query(sql, parameters);
          return runner;
        };
        const release = async (runner: QueryRunner) => {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
        };

        const accessBlocker = await block(
          `SELECT id FROM site_accesses
         WHERE user_id = $1 AND site_id = $2 FOR UPDATE`,
          [fixture.userId, fixture.siteId],
        );
        const siteBlocker = await block(
          `SELECT id FROM sites WHERE id = $1 FOR UPDATE`,
          [fixture.siteId],
        );
        const ownerBlocker = await block(
          `SELECT id FROM ${ownerTable} WHERE id = $1 FOR UPDATE`,
          [entityId],
        );
        const resourceBlocker = await block(
          `SELECT id FROM cms_revision_resources WHERE id = $1 FOR UPDATE`,
          [resource.id],
        );
        const revisionBlocker = await block(
          `SELECT id FROM cms_revisions WHERE id = $1 FOR UPDATE`,
          [revisionId],
        );
        const typedBlocker =
          kind === 'instance'
            ? await block(
                `SELECT revision_id FROM managed_chunk_instance_revisions
               WHERE revision_id = $1 FOR UPDATE`,
                [revisionId],
              )
            : await block(
                `LOCK TABLE managed_chunk_placements IN ACCESS EXCLUSIVE MODE`,
              );
        const writerSource = await cleanup.source(
          process.env.MANAGED_CHUNK_TEST_DATABASE_URL!,
        );
        const [{ pg_backend_pid: writerPid }] = await writerSource.query(
          'SELECT pg_backend_pid()',
        );
        const writerRepository = servicesFor(writerSource).repository;
        const restore = cleanup.track(
          kind === 'instance'
            ? writerRepository.restoreInstanceRevision({
                siteId: fixture.siteId,
                instanceId: instance.instanceId,
                sourceRevisionId: instance.revisionId,
                expectedDraftRevisionId: instance.revisionId,
                actor: employeeActor(fixture),
              })
            : writerRepository.restoreLayoutRevision({
                siteId: fixture.siteId,
                layoutId: layout.layoutId,
                sourceRevisionId: layout.revisionId,
                expectedDraftRevisionId: layout.revisionId,
                actor: employeeActor(fixture),
              }),
        );

        const accessWait = await observeLockWait(
          source,
          writerPid,
          'site_accesses',
        );
        expect(accessWait.heldRelations).toContain('site_accesses');
        expect(accessWait.waitingLocks).toEqual(['transactionid:ShareLock']);
        for (const forbiddenRelation of [
          'sites',
          'pages',
          'managed_chunk_instances',
          'managed_chunk_layouts',
          'cms_revision_resources',
          'cms_revisions',
          finalTable,
        ]) {
          expect(accessWait.heldRelations).not.toContain(forbiddenRelation);
        }
        await release(accessBlocker);

        const siteWait = await observeLockWait(
          source,
          writerPid,
          '"SiteEntity"',
        );
        expect(siteWait.heldRelations).toEqual(
          expect.arrayContaining(['site_accesses', 'sites']),
        );
        await release(siteBlocker);

        const ownerWait = await observeLockWait(
          source,
          writerPid,
          ownerQueryToken,
        );
        expect(ownerWait.heldRelations).toEqual(
          expect.arrayContaining(['sites', ownerTable]),
        );
        await release(ownerBlocker);

        const resourceWait = await observeLockWait(
          source,
          writerPid,
          '"CmsRevisionResourceEntity"',
        );
        expect(resourceWait.heldRelations).toEqual(
          expect.arrayContaining([ownerTable, 'cms_revision_resources']),
        );
        await release(resourceBlocker);

        const revisionWait = await observeLockWait(
          source,
          writerPid,
          '"CmsRevisionEntity"',
        );
        expect(revisionWait.heldRelations).toEqual(
          expect.arrayContaining(['cms_revision_resources', 'cms_revisions']),
        );
        await release(revisionBlocker);

        const typedWait = await observeLockWait(
          source,
          writerPid,
          finalQueryToken,
        );
        expect(typedWait.heldRelations).toEqual(
          expect.arrayContaining(['cms_revision_resources', 'cms_revisions']),
        );
        if (kind === 'instance') {
          expect(typedWait.heldRelations).toContain(finalTable);
        } else {
          expect(typedWait.waitingLocks).toContain('relation:AccessShareLock');
        }
        await release(typedBlocker);

        const restored = await restore;
        expect(restored.versionNumber).toBe(2);
        const savedResource = await source
          .getRepository(CmsRevisionResourceEntity)
          .findOneByOrFail({ id: resource.id });
        expect(savedResource).toEqual(
          expect.objectContaining({
            draftRevisionId: restored.id,
            approvedRevisionId: null,
            publishedRevisionId: null,
            latestVersionNumber: 2,
            reviewState: 'draft',
          }),
        );
        expect(
          await source.getRepository(CmsRevisionEventEntity).countBy({
            resourceId: resource.id,
            eventType: 'version_restored',
          }),
        ).toBe(1);
        expect(
          await source.getRepository(CmsRevisionEntity).countBy({
            resourceId: resource.id,
          }),
        ).toBe(2);
        if (kind === 'instance') {
          const links = await source
            .getRepository(ManagedChunkInstanceRevisionEntity)
            .findBy({ instanceId: instance.instanceId });
          expect(links).toHaveLength(2);
          expect(links.map(({ contractId }) => contractId)).toEqual([
            contract.id,
            contract.id,
          ]);
        } else {
          const placements = await source
            .getRepository(ManagedChunkPlacementEntity)
            .findBy({ layoutId: layout.layoutId });
          expect(placements).toHaveLength(2);
          expect(
            placements.map(({ instanceId, slotKey, position }) => ({
              instanceId,
              slotKey,
              position,
            })),
          ).toEqual([
            {
              instanceId: instance.instanceId,
              slotKey: 'hero',
              position: 0,
            },
            {
              instanceId: instance.instanceId,
              slotKey: 'hero',
              position: 0,
            },
          ]);
        }
      });
    },
    45_000,
  );
  it('uses real READ ONLY and REPEATABLE READ compatibility transactions', async () => {
    const fixture = await seedAcceptanceFixture(source, 'compatibility');
    const { repository, revisions } = servicesFor(source);
    const definitionV1 = managedDefinition('compat-banner');
    const definitionV2 = {
      ...managedDefinition('compat-banner', 'headline-v2'),
      schemaVersion: '2',
    } satisfies ManagedChunkDefinition;
    const [contractV1, contractV2] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [definitionV1, definitionV2],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Compatibility',
      contractId: contractV1.id,
      data: { headline: 'old' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const layout = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [
        { slotKey: 'old-slot', position: 0, instanceId: instance.instanceId },
      ],
      actor: adminActor(fixture),
    });
    await repository.publishInstanceRevision({
      siteId: fixture.siteId,
      instanceId: instance.instanceId,
      revisionId: instance.revisionId,
      actor: adminActor(fixture),
    });
    await repository.publishLayoutRevision({
      siteId: fixture.siteId,
      layoutId: layout.layoutId,
      revisionId: layout.revisionId,
      actor: adminActor(fixture),
    });

    let firstManagerCommand = '';
    let readOnlySqlState: string | undefined;
    const readOnlyWrapper = {
      transaction: async <T>(
        isolation: 'REPEATABLE READ',
        work: (manager: EntityManager) => Promise<T>,
      ): Promise<T> => {
        expect(isolation).toBe('REPEATABLE READ');
        return withDatabaseTestCleanup(async (cleanup) => {
          const runner = await cleanup.runner(source, 'REPEATABLE READ');
          const originalQuery = runner.manager.query.bind(runner.manager);
          runner.manager.query = async (
            ...args: Parameters<EntityManager['query']>
          ) => {
            if (!firstManagerCommand) firstManagerCommand = String(args[0]);
            return originalQuery(...args);
          };
          const value = await work(runner.manager);
          try {
            await originalQuery(`UPDATE sites SET name = name WHERE id = $1`, [
              fixture.siteId,
            ]);
          } catch (error) {
            readOnlySqlState = sqlState(error);
          }
          await runner.rollbackTransaction();
          return value;
        });
      },
    } as unknown as DataSource;
    const readOnlyRepository = new ManagedChunkPersistenceRepository(
      readOnlyWrapper,
      revisions,
    );
    const readOnlyInventory =
      await readOnlyRepository.readCompatibilityInventory({
        siteId: fixture.siteId,
        templatePackageId: fixture.packageId,
      });
    expect(firstManagerCommand.trim()).toBe('SET TRANSACTION READ ONLY');
    expect(readOnlySqlState).toBe('25006');
    expect(readOnlyInventory.placements).toHaveLength(2);

    await withDatabaseTestCleanup(async (cleanup) => {
      const repeatableSource = await cleanup.source(
        process.env.MANAGED_CHUNK_TEST_DATABASE_URL!,
      );
      const writerSource = await cleanup.source(
        process.env.MANAGED_CHUNK_TEST_DATABASE_URL!,
      );
      const snapshotRunner = await cleanup.runner(
        repeatableSource,
        'REPEATABLE READ',
      );
      await snapshotRunner.query(`SELECT id FROM sites WHERE id = $1`, [
        fixture.siteId,
      ]);
      const instanceResource = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({
          siteId: fixture.siteId,
          resourceType: 'chunk_instance',
          entityId: instance.instanceId,
        });
      const layoutResource = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({
          siteId: fixture.siteId,
          resourceType: 'chunk_layout',
          entityId: layout.layoutId,
        });
      const newInstanceRevisionId = randomUUID();
      const newLayoutRevisionId = randomUUID();
      await writerSource.transaction(async (db) => {
        await db.query(
          `INSERT INTO cms_revisions
            (id, resource_id, version_number, snapshot, actor_user_id)
           VALUES
            ($1, $2, 2, $3::jsonb, $4),
            ($5, $6, 2, $7::jsonb, $4)`,
          [
            newInstanceRevisionId,
            instanceResource.id,
            JSON.stringify({
              formatVersion: 1,
              data: { 'headline-v2': 'new' },
              sanitizerPolicyVersion: null,
            }),
            fixture.userId,
            newLayoutRevisionId,
            layoutResource.id,
            JSON.stringify({
              formatVersion: 1,
              templateKey: 'home',
              templateVersion: '2',
            }),
          ],
        );
        await db.query(
          `INSERT INTO managed_chunk_instance_revisions
            (revision_id, revision_resource_id, site_id, instance_id, contract_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            newInstanceRevisionId,
            instanceResource.id,
            fixture.siteId,
            instance.instanceId,
            contractV2.id,
          ],
        );
        await db.query(
          `INSERT INTO managed_chunk_placements
            (site_id, layout_id, layout_revision_resource_id,
             layout_revision_id, instance_id, slot_key, position)
           VALUES ($1, $2, $3, $4, $5, 'new-slot', 0)`,
          [
            fixture.siteId,
            layout.layoutId,
            layoutResource.id,
            newLayoutRevisionId,
            instance.instanceId,
          ],
        );
        await db.query(
          `UPDATE cms_revision_resources
           SET draft_revision_id = $1, latest_version_number = 2,
               approved_revision_id = NULL, review_state = 'draft'
           WHERE id = $2`,
          [newInstanceRevisionId, instanceResource.id],
        );
        await db.query(
          `UPDATE cms_revision_resources
           SET draft_revision_id = $1, latest_version_number = 2,
               approved_revision_id = NULL, review_state = 'draft'
           WHERE id = $2`,
          [newLayoutRevisionId, layoutResource.id],
        );
      });

      const oldInventory =
        await repository.readCompatibilityInventoryUsingManager(
          snapshotRunner.manager,
          {
            siteId: fixture.siteId,
            templatePackageId: fixture.packageId,
          },
        );
      const oldDraft = oldInventory.placements.filter(
        (placement) => placement.source === 'draft',
      );
      expect(oldDraft).toEqual([
        expect.objectContaining({
          slotKey: 'old-slot',
          schemaVersion: '1',
          templateVersion: '1',
        }),
      ]);
      await snapshotRunner.commitTransaction();

      const newInventory = await repository.readCompatibilityInventory({
        siteId: fixture.siteId,
        templatePackageId: fixture.packageId,
      });
      const newDraft = newInventory.placements.filter(
        (placement) => placement.source === 'draft',
      );
      expect(newDraft).toEqual([
        expect.objectContaining({
          slotKey: 'new-slot',
          schemaVersion: '2',
          templateVersion: '2',
        }),
      ]);
      expect(
        newInventory.placements.filter(
          (placement) => placement.source === 'published',
        ),
      ).toEqual([
        expect.objectContaining({
          slotKey: 'old-slot',
          schemaVersion: '1',
          templateVersion: '1',
        }),
      ]);
    });

    const originalName = (
      await source
        .getRepository(SiteEntity)
        .findOneByOrFail({ id: fixture.siteId })
    ).name;
    await source.transaction(async (db) => {
      await repository.readCompatibilityInventoryUsingManager(db, {
        siteId: fixture.siteId,
        templatePackageId: fixture.packageId,
      });
      await db.update(
        SiteEntity,
        { id: fixture.siteId },
        { name: originalName + '!' },
      );
    });
    expect(
      (
        await source
          .getRepository(SiteEntity)
          .findOneByOrFail({ id: fixture.siteId })
      ).name,
    ).toBe(originalName + '!');

    await source.query(
      `UPDATE sites SET template_package_id = NULL,
        current_template_package_version_id = NULL WHERE id = $1`,
      [fixture.siteId],
    );
    await expect(
      repository.readCompatibilityInventory({
        siteId: fixture.siteId,
        templatePackageId: fixture.packageId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ placements: expect.any(Array) }),
    );
    await source.query(
      `UPDATE sites SET template_package_id = $1,
        current_template_package_version_id = $2 WHERE id = $3`,
      [fixture.otherPackageId, fixture.otherPackageVersionId, fixture.siteId],
    );
    await expect(
      repository.readCompatibilityInventory({
        siteId: fixture.siteId,
        templatePackageId: fixture.packageId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ placements: expect.any(Array) }),
    );
    expect(
      await source.query(
        `SELECT template_package_id, current_template_package_version_id
         FROM sites WHERE id = $1`,
        [fixture.siteId],
      ),
    ).toEqual([
      {
        template_package_id: fixture.otherPackageId,
        current_template_package_version_id: fixture.otherPackageVersionId,
      },
    ]);

    const captureNotFound = async (
      operation: Promise<unknown>,
    ): Promise<NotFoundException> => {
      try {
        await operation;
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        return error as NotFoundException;
      }
      throw new Error('Expected compatibility inventory NotFoundException');
    };
    const missingSite = await captureNotFound(
      repository.readCompatibilityInventory({
        siteId: randomUUID(),
        templatePackageId: fixture.packageId,
      }),
    );
    const missingPackage = await captureNotFound(
      repository.readCompatibilityInventory({
        siteId: fixture.siteId,
        templatePackageId: randomUUID(),
      }),
    );
    expect(missingSite.message).toBe('Сайт или пакет не найден');
    expect(missingPackage.message).toBe(missingSite.message);
    expect(missingPackage.getResponse()).toEqual(missingSite.getResponse());
  }, 40_000);

  it('enforces owner identity triggers while allowing mutable metadata and actor SET NULL', async () => {
    const fixture = await seedAcceptanceFixture(source, 'owner-triggers');
    const { repository } = servicesFor(source);
    const [contract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [managedDefinition('owner-banner')],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Original',
      contractId: contract.id,
      data: { headline: 'owner' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const layout = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [],
      actor: adminActor(fixture),
    });
    await source.query(
      `UPDATE managed_chunk_layouts SET id = id WHERE id = $1`,
      [layout.layoutId],
    );
    await source.query(
      `UPDATE managed_chunk_instances
       SET display_name = 'Changed', is_archived = true, updated_at = now()
       WHERE id = $1`,
      [instance.instanceId],
    );
    expect(
      await source.getRepository(ManagedChunkInstanceEntity).findOneByOrFail({
        id: instance.instanceId,
      }),
    ).toEqual(
      expect.objectContaining({ displayName: 'Changed', isArchived: true }),
    );

    const forbiddenLayoutUpdates = [
      `id = '${randomUUID()}'::uuid`,
      `site_id = '${fixture.otherSiteId}'::uuid`,
      `revision_resource_id = '${randomUUID()}'::uuid`,
      `scope_kind = 'site_surface'`,
      `page_id = '${randomUUID()}'::uuid`,
      `surface_key = 'forbidden'`,
      `created_at = created_at + interval '1 second'`,
    ];
    for (const update of forbiddenLayoutUpdates) {
      await expectSqlState(
        source.query(
          `UPDATE managed_chunk_layouts SET ${update} WHERE id = $1`,
          [layout.layoutId],
        ),
        '55000',
      );
    }
    await expectSqlState(
      source.query(`DELETE FROM managed_chunk_layouts WHERE id = $1`, [
        layout.layoutId,
      ]),
      '55000',
    );
    const forbiddenInstanceUpdates = [
      `id = '${randomUUID()}'::uuid`,
      `site_id = '${fixture.otherSiteId}'::uuid`,
      `revision_resource_id = '${randomUUID()}'::uuid`,
      `created_at = created_at + interval '1 second'`,
      `created_by_user_id = '${randomUUID()}'::uuid`,
    ];
    for (const update of forbiddenInstanceUpdates) {
      await expectSqlState(
        source.query(
          `UPDATE managed_chunk_instances SET ${update} WHERE id = $1`,
          [instance.instanceId],
        ),
        '55000',
      );
    }
    await expectSqlState(
      source.query(`DELETE FROM managed_chunk_instances WHERE id = $1`, [
        instance.instanceId,
      ]),
      '55000',
    );
    await source.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);
    expect(
      (
        await source.getRepository(ManagedChunkInstanceEntity).findOneByOrFail({
          id: instance.instanceId,
        })
      ).createdByUserId,
    ).toBeNull();
  }, 30_000);
  it('rolls back wrong, missing, extra, and changed managed restore copies', async () => {
    const fixture = await seedAcceptanceFixture(source, 'restore-mutations');
    const { repository, revisions } = servicesFor(source);
    const [contract, wrongContract] = await repository.registerContracts({
      templatePackageId: fixture.packageId,
      templatePackageVersionId: fixture.packageVersionId,
      definitions: [
        managedDefinition('restore-main'),
        managedDefinition('restore-wrong'),
      ],
    });
    const instance = await repository.createInstanceDraft({
      siteId: fixture.siteId,
      displayName: 'Mutation instance',
      contractId: contract.id,
      data: { headline: 'source' },
      sanitizerPolicyVersion: null,
      actor: adminActor(fixture),
    });
    const instanceResource = await source
      .getRepository(CmsRevisionResourceEntity)
      .findOneByOrFail({
        siteId: fixture.siteId,
        resourceType: 'chunk_instance',
        entityId: instance.instanceId,
      });
    const instanceState = async () => {
      const current = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({ id: instanceResource.id });
      return {
        draft: current.draftRevisionId,
        approved: current.approvedRevisionId,
        published: current.publishedRevisionId,
        reviewState: current.reviewState,
        revisions: await source.getRepository(CmsRevisionEntity).countBy({
          resourceId: instanceResource.id,
        }),
        links: await source
          .getRepository(ManagedChunkInstanceRevisionEntity)
          .countBy({ instanceId: instance.instanceId }),
        events: await source.getRepository(CmsRevisionEventEntity).countBy({
          resourceId: instanceResource.id,
        }),
      };
    };
    const instanceBefore = await instanceState();
    await expect(
      source.transaction((db) =>
        revisions.restoreManagedRevisionUsingManager(
          db,
          {
            siteId: fixture.siteId,
            resourceType: 'chunk_instance',
            entityId: instance.instanceId,
            sourceRevisionId: instance.revisionId,
            expectedDraftRevisionId: instance.revisionId,
            actor: adminActor(fixture),
          },
          async (prepareDb) => ({
            resource: await prepareDb.findOneByOrFail(
              CmsRevisionResourceEntity,
              {
                id: instanceResource.id,
              },
            ),
            revision: await prepareDb.findOneByOrFail(CmsRevisionEntity, {
              id: instance.revisionId,
            }),
          }),
          async (hookDb, savedRevision, resource) => {
            await hookDb.save(
              Object.assign(new ManagedChunkInstanceRevisionEntity(), {
                revisionId: savedRevision.id,
                revisionResourceId: resource.id,
                siteId: fixture.siteId,
                instanceId: instance.instanceId,
                contractId: wrongContract.id,
              }),
            );
          },
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await instanceState()).toEqual(instanceBefore);

    const layout = await repository.saveLayoutDraft({
      siteId: fixture.siteId,
      target: { kind: 'page', pageId: fixture.pageId },
      templateKey: 'home',
      templateVersion: '1',
      expectedDraftRevisionId: null,
      placements: [
        { slotKey: 'hero', position: 0, instanceId: instance.instanceId },
      ],
      actor: adminActor(fixture),
    });
    const layoutResource = await source
      .getRepository(CmsRevisionResourceEntity)
      .findOneByOrFail({
        siteId: fixture.siteId,
        resourceType: 'chunk_layout',
        entityId: layout.layoutId,
      });
    const layoutState = async () => {
      const current = await source
        .getRepository(CmsRevisionResourceEntity)
        .findOneByOrFail({ id: layoutResource.id });
      return {
        draft: current.draftRevisionId,
        approved: current.approvedRevisionId,
        published: current.publishedRevisionId,
        reviewState: current.reviewState,
        revisions: await source.getRepository(CmsRevisionEntity).countBy({
          resourceId: layoutResource.id,
        }),
        placements: await source
          .getRepository(ManagedChunkPlacementEntity)
          .countBy({ layoutId: layout.layoutId }),
        events: await source.getRepository(CmsRevisionEventEntity).countBy({
          resourceId: layoutResource.id,
        }),
      };
    };
    const layoutBefore = await layoutState();
    const modes = ['missing', 'extra', 'changed'] as const;
    for (const mode of modes) {
      await expect(
        source.transaction((db) =>
          revisions.restoreManagedRevisionUsingManager(
            db,
            {
              siteId: fixture.siteId,
              resourceType: 'chunk_layout',
              entityId: layout.layoutId,
              sourceRevisionId: layout.revisionId,
              expectedDraftRevisionId: layout.revisionId,
              actor: adminActor(fixture),
            },
            async (prepareDb) => ({
              resource: await prepareDb.findOneByOrFail(
                CmsRevisionResourceEntity,
                { id: layoutResource.id },
              ),
              revision: await prepareDb.findOneByOrFail(CmsRevisionEntity, {
                id: layout.revisionId,
              }),
            }),
            async (hookDb, savedRevision, resource) => {
              if (mode === 'missing') return;
              await hookDb.save(
                Object.assign(new ManagedChunkPlacementEntity(), {
                  siteId: fixture.siteId,
                  layoutId: layout.layoutId,
                  layoutRevisionResourceId: resource.id,
                  layoutRevisionId: savedRevision.id,
                  instanceId: instance.instanceId,
                  slotKey: mode === 'changed' ? 'changed' : 'hero',
                  position: 0,
                }),
              );
              if (mode === 'extra') {
                await hookDb.save(
                  Object.assign(new ManagedChunkPlacementEntity(), {
                    siteId: fixture.siteId,
                    layoutId: layout.layoutId,
                    layoutRevisionResourceId: resource.id,
                    layoutRevisionId: savedRevision.id,
                    instanceId: instance.instanceId,
                    slotKey: 'hero',
                    position: 1,
                  }),
                );
              }
            },
          ),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await layoutState()).toEqual(layoutBefore);
    }
  }, 30_000);

  it('allows empty safe down and blocks populated down before any drop, including the lock race', async () => {
    const baseUrl = process.env.MANAGED_CHUNK_TEST_DATABASE_URL!;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';
    const safeName =
      'wispo_managed_chunks_phase2_test_safe_' +
      randomUUID().replace(/-/g, '').slice(0, 12);
    const guardedName =
      'wispo_managed_chunks_phase2_test_guard_' +
      randomUUID().replace(/-/g, '').slice(0, 12);
    let admin: DataSource | undefined;
    let safeSource: DataSource | undefined;
    let guardedSource: DataSource | undefined;
    let guardWriter: DataSource | undefined;
    let locker: QueryRunner | undefined;
    let insertV2: Promise<unknown> | undefined;
    let primaryError: unknown;
    const cleanupDatabase = async (databaseName: string) => {
      if (!admin?.isInitialized) return;
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    };
    try {
      admin = await createIndependentSource(adminUrl.href);
      await admin.query(`CREATE DATABASE "${safeName}"`);
      safeSource = await applyFullLedgerToDatabase(
        disposableDatabaseUrl(baseUrl, safeName),
      );
      await expect(
        safeSource.undoLastMigration({ transaction: 'all' }),
      ).resolves.toBeUndefined();
      const [safeState] = await safeSource.query(
        `SELECT
          to_regclass('public.managed_chunk_contracts') AS contracts,
          to_regclass('public.managed_chunk_instances') AS instances,
          to_regclass('public.managed_chunk_layouts') AS layouts`,
      );
      expect(safeState).toEqual({
        contracts: null,
        instances: null,
        layouts: null,
      });
      const safePackageId = randomUUID();
      await safeSource.query(
        `INSERT INTO template_packages
          (id, package_id, title, site_type, repository_url)
         VALUES ($1, $2, 'Safe down', 'media', 'https://example.test/safe.git')`,
        [safePackageId, 'safe-' + randomUUID().slice(0, 8)],
      );
      await expectSqlState(
        safeSource.query(
          `INSERT INTO template_package_versions
            (template_package_id, package_version, source_revision,
             release_digest, artifact_digest, manifest_digest,
             manifest_version, manifest, cms_api_min_schema_version,
             cms_api_max_schema_version, built_at, runtime_mode, runtime_url)
           VALUES ($1, 'down-v2', 'x', 'x', NULL, 'x', 2, '{}'::jsonb,
             '1', NULL, now(), 'embedded-next', NULL)`,
          [safePackageId],
        ),
        '23514',
      );
      await safeSource.destroy();
      safeSource = undefined;

      await admin.query(`CREATE DATABASE "${guardedName}"`);
      guardedSource = await applyFullLedgerToDatabase(
        disposableDatabaseUrl(baseUrl, guardedName),
      );
      const packageId = randomUUID();
      await guardedSource.query(
        `INSERT INTO template_packages
          (id, package_id, title, site_type, repository_url)
         VALUES ($1, $2, 'Down guard', 'media', 'https://example.test/down.git')`,
        [packageId, 'down-' + randomUUID().slice(0, 8)],
      );
      locker = guardedSource.createQueryRunner();
      try {
        await locker.connect();
        await locker.startTransaction();
      } catch (error) {
        await runCleanupGroups([[() => cleanupRunner(locker)]], error);
        throw error;
      }
      await locker.query(
        `LOCK TABLE
            template_package_versions,
            cms_revision_resources,
            managed_chunk_contracts,
            managed_chunk_instances,
            managed_chunk_instance_revisions,
            managed_chunk_layouts,
            managed_chunk_placements,
            managed_chunk_migration_provenance
           IN SHARE ROW EXCLUSIVE MODE;
           DO $$ BEGIN
             IF EXISTS (SELECT 1 FROM managed_chunk_contracts)
               OR EXISTS (SELECT 1 FROM managed_chunk_instances)
               OR EXISTS (SELECT 1 FROM managed_chunk_instance_revisions)
               OR EXISTS (SELECT 1 FROM managed_chunk_layouts)
               OR EXISTS (SELECT 1 FROM managed_chunk_placements)
               OR EXISTS (SELECT 1 FROM managed_chunk_migration_provenance)
               OR EXISTS (SELECT 1 FROM cms_revision_resources
                 WHERE resource_type IN ('chunk_instance', 'chunk_layout'))
               OR EXISTS (SELECT 1 FROM template_package_versions
                 WHERE manifest_version = 2)
             THEN RAISE EXCEPTION 'unexpected populated guard';
             END IF;
           END $$`,
      );
      guardWriter = await createIndependentSource(
        disposableDatabaseUrl(baseUrl, guardedName),
      );
      const [{ pg_backend_pid: writerPid }] = await guardWriter.query(
        'SELECT pg_backend_pid()',
      );
      insertV2 = guardWriter.query(
        `INSERT INTO template_package_versions
            (template_package_id, package_version, source_revision,
             release_digest, artifact_digest, manifest_digest,
             manifest_version, manifest, cms_api_min_schema_version,
             cms_api_max_schema_version, built_at, runtime_mode, runtime_url)
           VALUES ($1, '2', 'x', 'x', NULL, 'x', 2, '{}'::jsonb,
             '1', NULL, now(), 'embedded-next', NULL)`,
        [packageId],
      );
      await waitForLockWait(source, writerPid);
      await locker.rollbackTransaction();
      await insertV2;
      await expect(
        guardedSource.undoLastMigration({ transaction: 'all' }),
      ).rejects.toThrow(
        'Cannot safely revert managed chunk persistence while managed data exists',
      );
      const [guardedState] = await guardedSource.query(
        `SELECT
          to_regclass('public.managed_chunk_contracts') IS NOT NULL AS contracts,
          to_regclass('public.managed_chunk_instances') IS NOT NULL AS instances,
          to_regclass('public.managed_chunk_instance_revisions') IS NOT NULL AS revisions,
          to_regclass('public.managed_chunk_layouts') IS NOT NULL AS layouts,
          to_regclass('public.managed_chunk_placements') IS NOT NULL AS placements,
          to_regclass('public.managed_chunk_migration_provenance') IS NOT NULL AS provenance`,
      );
      expect(guardedState).toEqual({
        contracts: true,
        instances: true,
        revisions: true,
        layouts: true,
        placements: true,
        provenance: true,
      });
      expect(
        (
          await guardedSource.query(
            `SELECT manifest_version FROM template_package_versions
             WHERE template_package_id = $1`,
            [packageId],
          )
        )[0].manifest_version,
      ).toBe(2);
      const requiredConstraints = [
        'CHK_cms_revision_resources_type',
        'CHK_managed_chunk_contracts_data_schema_object',
        'CHK_managed_chunk_contracts_digest',
        'CHK_managed_chunk_contracts_field_contract_object',
        'CHK_managed_chunk_layouts_scope',
        'CHK_managed_chunk_migration_provenance_source_type',
        'CHK_managed_chunk_migration_provenance_target',
        'CHK_managed_chunk_placements_position',
        'CHK_template_package_versions_manifest_version',
        'UQ_pages_id_site_id',
      ];
      const constraints: { conname: string; definition: string }[] =
        await guardedSource.query(
          `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname`,
          [requiredConstraints],
        );
      expect(constraints.map(({ conname }) => conname)).toEqual(
        [...requiredConstraints].sort(),
      );
      expect(
        constraints.find(
          ({ conname }) => conname === 'CHK_cms_revision_resources_type',
        ).definition,
      ).toContain('chunk_instance');
      expect(
        constraints.find(
          ({ conname }) =>
            conname === 'CHK_template_package_versions_manifest_version',
        ).definition,
      ).toContain('2');

      const requiredTriggers = [
        'TRG_cms_revision_resources_managed_chunk_identity',
        'TRG_managed_chunk_contracts_immutable',
        'TRG_managed_chunk_instance_revisions_immutable',
        'TRG_managed_chunk_instances_protect_identity',
        'TRG_managed_chunk_instances_resource_identity',
        'TRG_managed_chunk_layouts_protect_identity',
        'TRG_managed_chunk_layouts_resource_identity',
        'TRG_managed_chunk_migration_provenance_immutable',
        'TRG_managed_chunk_placements_immutable',
      ];
      const triggers: { tgname: string }[] = await guardedSource.query(
        `SELECT tgname FROM pg_trigger
         WHERE NOT tgisinternal AND tgname = ANY($1::text[]) ORDER BY tgname`,
        [requiredTriggers],
      );
      expect(triggers.map(({ tgname }) => tgname)).toEqual(
        [...requiredTriggers].sort(),
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await runCleanupGroups(
        [
          [
            async () => {
              if (locker?.isTransactionActive)
                await locker.rollbackTransaction();
            },
          ],
          [
            async () => {
              if (insertV2) await Promise.allSettled([insertV2]);
            },
          ],
          [() => cleanupRunner(locker)],
          [
            () => destroySource(guardWriter),
            () => destroySource(safeSource),
            () => destroySource(guardedSource),
          ],
          [() => cleanupDatabase(safeName), () => cleanupDatabase(guardedName)],
          [() => destroySource(admin)],
        ],
        primaryError,
      );
    }
  }, 120_000);
});
