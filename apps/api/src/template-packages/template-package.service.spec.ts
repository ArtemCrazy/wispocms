import { ConflictException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryFailedError } from 'typeorm';
import {
  SiteContentTemplateEntity,
  SiteEntity,
  SiteType,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import type { TemplatePackageManifestV2 } from './managed-chunk.types';
import type { TemplatePackageManifest } from './template-package.types';
import {
  canonicalManifestDigest,
  TemplatePackageService,
} from './template-package.service';

function skinovaManifest(): TemplatePackageManifest {
  const template = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../web/template-packages/skinova/manifest.template.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return {
    ...template,
    source: {
      ...(template.source as Record<string, unknown>),
      revision: '0123456789abcdef0123456789abcdef01234567',
    },
    build: {
      ...(template.build as Record<string, unknown>),
      releaseDigest:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      artifactDigest: null,
      builtAt: '2026-10-02T09:30:00Z',
    },
  } as TemplatePackageManifest;
}

function skinovaV2Manifest(): TemplatePackageManifestV2 {
  const template = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../web/template-packages/skinova/manifest.v2.template.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return {
    ...template,
    source: {
      ...(template.source as Record<string, unknown>),
      revision: '0123456789abcdef0123456789abcdef01234567',
    },
    build: {
      ...(template.build as Record<string, unknown>),
      releaseDigest:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      artifactDigest: null,
      builtAt: '2026-10-08T09:30:00Z',
    },
  } as TemplatePackageManifestV2;
}

function createHarness(options?: {
  siteType?: SiteType;
  assignments?: Array<
    Pick<SiteContentTemplateEntity, 'kind' | 'key' | 'version'>
  >;
  failAuditEvent?: 'template_package_registered' | 'template_package_deployed';
}) {
  const packages: TemplatePackageEntity[] = [];
  const versions: TemplatePackageVersionEntity[] = [];
  const site = {
    id: 'site-id',
    workspaceId: 'workspace-id',
    slug: 'skinova',
    siteType: options?.siteType ?? SiteType.MEDIA,
    templatePackageId: null,
    currentTemplatePackageVersionId: null,
  } as SiteEntity;
  const assignments = (options?.assignments ?? [
    { kind: 'article', key: 'skinova-article', version: '1' },
  ]) as SiteContentTemplateEntity[];
  let siteSaveCount = 0;
  const siteFindOne = jest.fn(({ where }: { where: { slug: string } }) =>
    Promise.resolve(site.slug === where.slug ? site : null),
  );

  const repositories = new Map<unknown, Record<string, jest.Mock>>([
    [
      TemplatePackageEntity,
      {
        findOne: jest.fn(({ where }: { where: { packageId: string } }) =>
          Promise.resolve(
            packages.find((item) => item.packageId === where.packageId) ?? null,
          ),
        ),
        create: jest.fn((value: Partial<TemplatePackageEntity>) => value),
        save: jest.fn((value: Partial<TemplatePackageEntity>) => {
          const saved = {
            id: `package-${packages.length + 1}`,
            ...value,
          } as TemplatePackageEntity;
          packages.push(saved);
          return Promise.resolve(saved);
        }),
      },
    ],
    [
      TemplatePackageVersionEntity,
      {
        findOne: jest.fn(
          ({
            where,
          }: {
            where: { templatePackageId: string; packageVersion: string };
          }) =>
            Promise.resolve(
              versions.find(
                (item) =>
                  item.templatePackageId === where.templatePackageId &&
                  item.packageVersion === where.packageVersion,
              ) ?? null,
            ),
        ),
        create: jest.fn(
          (value: Partial<TemplatePackageVersionEntity>) => value,
        ),
        save: jest.fn((value: Partial<TemplatePackageVersionEntity>) => {
          const saved = {
            id: `version-${versions.length + 1}`,
            ...value,
          } as TemplatePackageVersionEntity;
          versions.push(saved);
          return Promise.resolve(saved);
        }),
      },
    ],
    [
      SiteEntity,
      {
        findOne: siteFindOne,
        save: jest.fn((value: SiteEntity) => {
          siteSaveCount += 1;
          Object.assign(site, value);
          return Promise.resolve(site);
        }),
      },
    ],
    [
      SiteContentTemplateEntity,
      {
        find: jest.fn(
          ({ where }: { where: { siteId: string; isActive: boolean } }) =>
            Promise.resolve(
              where.siteId === site.id && where.isActive ? assignments : [],
            ),
        ),
      },
    ],
  ]);
  const manager = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const dataSource = {
    transaction: jest.fn(
      async (callback: (value: typeof manager) => Promise<unknown>) => {
        const packagesBefore = [...packages];
        const versionsBefore = [...versions];
        const packagePointerBefore = site.templatePackageId;
        const versionPointerBefore = site.currentTemplatePackageVersionId;
        const siteSaveCountBefore = siteSaveCount;
        try {
          return await callback(manager);
        } catch (error) {
          packages.splice(0, packages.length, ...packagesBefore);
          versions.splice(0, versions.length, ...versionsBefore);
          site.templatePackageId = packagePointerBefore;
          site.currentTemplatePackageVersionId = versionPointerBefore;
          siteSaveCount = siteSaveCountBefore;
          throw error;
        }
      },
    ),
  };
  const audit = {
    recordSystemEvent: jest.fn((event: { event: string }) =>
      event.event === options?.failAuditEvent
        ? Promise.reject(new Error('audit unavailable'))
        : Promise.resolve(undefined),
    ),
  };
  const managedChunks = {
    registerContractsUsingManager: jest.fn().mockResolvedValue([]),
  };
  return {
    service: new TemplatePackageService(
      dataSource as never,
      audit as never,
      managedChunks as never,
    ),
    packages,
    versions,
    site,
    assignments,
    audit,
    managedChunks,
    manager,
    siteFindOne,
    get siteSaveCount() {
      return siteSaveCount;
    },
  };
}

function uniqueViolation() {
  return new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );
}

function barrier(expected: number) {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolveReady) => {
    release = resolveReady;
  });
  return async () => {
    arrived += 1;
    if (arrived === expected) release();
    await ready;
  };
}

function createRegistrationRaceHarness(raceAt: 'package' | 'version') {
  const packages: TemplatePackageEntity[] =
    raceAt === 'version'
      ? [
          {
            id: 'package-1',
            packageId: 'skinova-media',
            title: 'Skinova Media',
            siteType: SiteType.MEDIA,
            repositoryUrl: 'https://github.com/ArtemCrazy/wispocms.git',
          } as TemplatePackageEntity,
        ]
      : [];
  const versions: TemplatePackageVersionEntity[] = [];
  const initialReadBarrier = barrier(2);
  let releaseWinner!: () => void;
  const winnerCommitted = new Promise<void>((resolveWinner) => {
    releaseWinner = resolveWinner;
  });
  let transactionNumber = 0;
  const audit = { recordSystemEvent: jest.fn().mockResolvedValue(undefined) };

  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: { getRepository: jest.Mock }) => Promise<unknown>,
      ) => {
        const currentTransaction = transactionNumber;
        transactionNumber += 1;
        const packageRepository = {
          findOne: jest.fn(
            async ({ where }: { where: { packageId: string } }) => {
              if (raceAt === 'package' && currentTransaction < 2) {
                await initialReadBarrier();
                return null;
              }
              return (
                packages.find((item) => item.packageId === where.packageId) ??
                null
              );
            },
          ),
          create: jest.fn((value: Partial<TemplatePackageEntity>) => value),
          save: jest.fn(async (value: Partial<TemplatePackageEntity>) => {
            if (currentTransaction === 1) {
              await winnerCommitted;
              throw uniqueViolation();
            }
            const saved = {
              id: 'package-1',
              ...value,
            } as TemplatePackageEntity;
            packages.push(saved);
            return saved;
          }),
        };
        const versionRepository = {
          findOne: jest.fn(
            async ({
              where,
            }: {
              where: { templatePackageId: string; packageVersion: string };
            }) => {
              if (raceAt === 'version' && currentTransaction < 2) {
                await initialReadBarrier();
                return null;
              }
              return (
                versions.find(
                  (item) =>
                    item.templatePackageId === where.templatePackageId &&
                    item.packageVersion === where.packageVersion,
                ) ?? null
              );
            },
          ),
          create: jest.fn(
            (value: Partial<TemplatePackageVersionEntity>) => value,
          ),
          save: jest.fn(
            async (value: Partial<TemplatePackageVersionEntity>) => {
              if (raceAt === 'version' && currentTransaction === 1) {
                await winnerCommitted;
                throw uniqueViolation();
              }
              const saved = {
                id: `version-${String(value.packageVersion)}`,
                ...value,
              } as TemplatePackageVersionEntity;
              versions.push(saved);
              return saved;
            },
          ),
        };
        const manager = {
          getRepository: jest.fn((entity: unknown) => {
            if (entity === TemplatePackageEntity) return packageRepository;
            if (entity === TemplatePackageVersionEntity)
              return versionRepository;
            throw new Error('unexpected repository');
          }),
        };
        const result = await callback(manager);
        if (currentTransaction === 0) releaseWinner();
        return result;
      },
    ),
  };

  return {
    service: new TemplatePackageService(
      dataSource as never,
      audit as never,
      { registerContractsUsingManager: jest.fn() } as never,
    ),
    packages,
    versions,
    audit,
    dataSource,
  };
}

describe('TemplatePackageService', () => {
  it('computes the same canonical digest regardless of object key order', () => {
    const manifest = skinovaManifest();
    const reordered = Object.fromEntries(
      Object.entries(manifest).reverse(),
    ) as TemplatePackageManifest;

    expect(canonicalManifestDigest(reordered)).toBe(
      canonicalManifestDigest(manifest),
    );
  });

  it('registers an immutable candidate and treats an identical retry as idempotent', async () => {
    const harness = createHarness();
    const manifest = skinovaManifest();

    const first = await harness.service.register(manifest);
    const retry = await harness.service.register(
      JSON.parse(JSON.stringify(manifest)) as TemplatePackageManifest,
    );

    expect(first).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '1',
      status: 'registered',
      created: true,
    });
    expect(retry).toEqual({ ...first, created: false });
    expect(harness.packages).toHaveLength(1);
    expect(harness.versions).toHaveLength(1);
    expect(harness.site.templatePackageId).toBeNull();
    expect(harness.site.currentTemplatePackageVersionId).toBeNull();
    expect(harness.assignments).toHaveLength(1);
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'template_package_registered',
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
      harness.manager,
    );
    expect(
      JSON.stringify(harness.audit.recordSystemEvent.mock.calls),
    ).not.toContain('templates');
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledTimes(1);
    expect(harness.audit.recordSystemEvent.mock.calls[0][1]).toBe(
      harness.manager,
    );
    expect(
      harness.managedChunks.registerContractsUsingManager,
    ).not.toHaveBeenCalled();
  });

  it('registers Skinova v2 contracts in the package transaction on create and retry', async () => {
    const harness = createHarness();
    const manifest = skinovaV2Manifest();

    const first = await harness.service.register(manifest);
    const retry = await harness.service.register(structuredClone(manifest));

    expect(first).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '2',
      created: true,
    });
    expect(retry).toEqual({ ...first, created: false });
    expect(harness.versions).toHaveLength(1);
    expect(harness.versions[0]).toMatchObject({ manifestVersion: 2 });
    expect(
      harness.managedChunks.registerContractsUsingManager,
    ).toHaveBeenCalledTimes(2);
    for (const call of harness.managedChunks.registerContractsUsingManager.mock
      .calls) {
      expect(call[0]).toBe(harness.manager);
      expect(call[1]).toMatchObject({
        templatePackageId: 'package-1',
        templatePackageVersionId: 'version-1',
      });
      expect(
        call[1].definitions.map(({ key }: { key: string }) => key),
      ).toEqual([
        'skinova-promo-strip',
        'skinova-consultation-banner',
        'skinova-article-sidebar-banner',
      ]);
    }
  });

  it('rolls back the v2 package candidate when contract materialization fails', async () => {
    const harness = createHarness();
    harness.managedChunks.registerContractsUsingManager.mockRejectedValueOnce(
      new Error('contract materialization failed'),
    );

    await expect(harness.service.register(skinovaV2Manifest())).rejects.toThrow(
      'contract materialization failed',
    );
    expect(harness.packages).toHaveLength(0);
    expect(harness.versions).toHaveLength(0);
    expect(harness.audit.recordSystemEvent).not.toHaveBeenCalled();
  });

  it('resolves concurrent identical first-package registration to one candidate', async () => {
    const harness = createRegistrationRaceHarness('package');
    const manifest = skinovaManifest();

    const results = await Promise.all([
      harness.service.register(manifest),
      harness.service.register(
        JSON.parse(JSON.stringify(manifest)) as TemplatePackageManifest,
      ),
    ]);

    expect(results.map((result) => result.versionId)).toEqual([
      'version-1',
      'version-1',
    ]);
    expect(results.map((result) => result.created).sort()).toEqual([
      false,
      true,
    ]);
    expect(harness.packages).toHaveLength(1);
    expect(harness.versions).toHaveLength(1);
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledTimes(1);
    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(3);
  });

  it('creates both versions when first package registration races with another version', async () => {
    const harness = createRegistrationRaceHarness('package');
    const firstVersion = skinovaManifest();
    const secondVersion = skinovaManifest();
    secondVersion.packageVersion = '2';
    secondVersion.build.releaseDigest = 'b'.repeat(64);

    const results = await Promise.all([
      harness.service.register(firstVersion),
      harness.service.register(secondVersion),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        packageVersion: '1',
        versionId: 'version-1',
        created: true,
      }),
      expect.objectContaining({
        packageVersion: '2',
        versionId: 'version-2',
        created: true,
      }),
    ]);
    expect(harness.packages).toHaveLength(1);
    expect(harness.versions.map((version) => version.packageVersion)).toEqual([
      '1',
      '2',
    ]);
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledTimes(2);
  });

  it('maps a concurrent version race with different content to ConflictException', async () => {
    const harness = createRegistrationRaceHarness('version');
    const winner = skinovaManifest();
    const loser = skinovaManifest();
    loser.build.releaseDigest = 'b'.repeat(64);

    const results = await Promise.allSettled([
      harness.service.register(winner),
      harness.service.register(loser),
    ]);

    expect(results[0]).toMatchObject({ status: 'fulfilled' });
    expect(results[1].status).toBe('rejected');
    if (results[1].status !== 'rejected')
      throw new Error('Concurrent registration unexpectedly succeeded');
    expect(results[1].reason).toBeInstanceOf(ConflictException);
    expect(harness.versions).toHaveLength(1);
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledTimes(1);
  });

  it('does not retry or swallow a non-unique database failure', async () => {
    const databaseError = new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('serialization failure'), { code: '40001' }),
    );
    const dataSource = {
      transaction: jest.fn().mockRejectedValue(databaseError),
    };
    const service = new TemplatePackageService(
      dataSource as never,
      { recordSystemEvent: jest.fn() } as never,
      { registerContractsUsingManager: jest.fn() } as never,
    );

    await expect(service.register(skinovaManifest())).rejects.toBe(
      databaseError,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls back a new candidate when its audit write fails', async () => {
    const harness = createHarness({
      failAuditEvent: 'template_package_registered',
    });

    await expect(harness.service.register(skinovaManifest())).rejects.toThrow(
      'audit unavailable',
    );
    expect(harness.packages).toHaveLength(0);
    expect(harness.versions).toHaveLength(0);
  });

  it('rejects the same package version with a different release digest', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());
    const conflicting = skinovaManifest();
    conflicting.build.releaseDigest = 'b'.repeat(64);

    await expect(harness.service.register(conflicting)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.versions).toHaveLength(1);
  });

  it('rejects the same package version with a different canonical manifest', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());
    const conflicting = skinovaManifest();
    conflicting.templates[0].title = 'Changed title';

    await expect(harness.service.register(conflicting)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.versions).toHaveLength(1);
  });

  it('preflights only the registered version without writing site or catalog', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());
    const beforeAssignments = JSON.stringify(harness.assignments);

    await expect(
      harness.service.preflight('skinova', {
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
    ).resolves.toMatchObject({ status: 'ready', reasons: [] });
    expect(harness.siteSaveCount).toBe(0);
    expect(JSON.stringify(harness.assignments)).toBe(beforeAssignments);
  });

  it('locks the site row for deployed reports but leaves preflight unlocked', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());

    await harness.service.preflight('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(harness.siteFindOne).toHaveBeenLastCalledWith({
      where: { slug: 'skinova' },
    });

    harness.siteFindOne.mockClear();
    await harness.service.reportDeployed('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(harness.siteFindOne).toHaveBeenCalledWith({
      where: { slug: 'skinova' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('rejects preflight for a version that was not registered', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());

    await expect(
      harness.service.preflight('skinova', {
        packageId: 'skinova-media',
        packageVersion: '2',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.siteSaveCount).toBe(0);
  });

  it('reports a current catalog assignment absent from the candidate manifest', async () => {
    const harness = createHarness({
      assignments: [{ kind: 'article', key: 'unknown-article', version: '1' }],
    });
    await harness.service.register(skinovaManifest());

    await expect(
      harness.service.preflight('skinova', {
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
    ).resolves.toMatchObject({
      status: 'mismatch',
      reasons: ['template_assignment_mismatch'],
    });
    expect(harness.siteSaveCount).toBe(0);
  });

  it('persists the truthful deployed pointer and returns mismatch reasons', async () => {
    const harness = createHarness({ siteType: SiteType.CORPORATE });
    await harness.service.register(skinovaManifest());

    const result = await harness.service.reportDeployed('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });

    expect(result.status).toBe('mismatch');
    expect(result.reasons).toContain('site_type_mismatch');
    expect(harness.site.templatePackageId).toBe('package-1');
    expect(harness.site.currentTemplatePackageVersionId).toBe('version-1');
    expect(harness.assignments).toHaveLength(1);
    expect(harness.audit.recordSystemEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'template_package_deployed',
        status: 'mismatch',
        siteId: 'site-id',
      }),
      harness.manager,
    );
  });

  it('does not write the same deployed pointer twice', async () => {
    const harness = createHarness();
    await harness.service.register(skinovaManifest());

    const first = await harness.service.reportDeployed('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    const retry = await harness.service.reportDeployed('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });

    expect(retry).toEqual(first);
    expect(harness.siteSaveCount).toBe(1);
    expect(harness.audit.recordSystemEvent).toHaveBeenCalledTimes(2);
    expect(harness.audit.recordSystemEvent.mock.calls[1][1]).toBe(
      harness.manager,
    );
  });

  it('rolls back the deployed pointer when its audit write fails', async () => {
    const harness = createHarness({
      failAuditEvent: 'template_package_deployed',
    });
    await harness.service.register(skinovaManifest());

    await expect(
      harness.service.reportDeployed('skinova', {
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
    ).rejects.toThrow('audit unavailable');
    expect(harness.site.templatePackageId).toBeNull();
    expect(harness.site.currentTemplatePackageVersionId).toBeNull();
    expect(harness.siteSaveCount).toBe(0);
  });
});
