import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  PageEntity,
  PlatformRole,
  SiteAccessEntity,
  SiteEntity,
  SiteRole,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import { CmsRevisionsService } from '../content/cms-revisions.service';
import {
  checkManagedChunkContractCompatibility,
  type ManagedChunkCompatibilityCandidate,
} from './managed-chunk-compatibility';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import type { ManagedChunkDefinition } from './managed-chunk.types';

const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';
const PAGE_ID = '66666666-6666-4666-8666-666666666666';
const HERO_INSTANCE_ID = '77777777-7777-4777-8777-777777777777';
const PROMO_INSTANCE_ID = '88888888-8888-4888-8888-888888888888';
const ACTOR = {
  userId: '55555555-5555-4555-8555-555555555555',
  platformRole: PlatformRole.EMPLOYEE,
};
const ADMIN_ACTOR = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  platformRole: PlatformRole.WISPO_ADMIN,
};

function definition(
  overrides: Partial<ManagedChunkDefinition> = {},
): ManagedChunkDefinition {
  return {
    key: 'hero',
    schemaVersion: '1',
    title: 'Hero banner',
    categoryKey: 'banners',
    rendererKey: 'hero-banner',
    fields: [
      {
        key: 'headline',
        label: 'Headline',
        help: 'Shown above the fold',
        widget: 'text',
        required: true,
        constraints: { minLength: 1, maxLength: 120 },
      },
      {
        key: 'theme',
        label: 'Theme',
        widget: 'select',
        options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      },
    ],
    ...overrides,
  };
}

function storedContract(
  source: ManagedChunkDefinition,
  overrides: Partial<ManagedChunkContractEntity> = {},
): ManagedChunkContractEntity {
  return {
    id: 'contract-existing',
    templatePackageId: PACKAGE_ID,
    firstSeenTemplatePackageVersionId: VERSION_ID,
    definitionKey: source.key,
    schemaVersion: source.schemaVersion,
    contractDigest: computeManagedChunkContractDigest(source.fields),
    fieldContract: JSON.parse(
      canonicalManagedChunkContract(source.fields),
    ) as Record<string, unknown>,
    dataSchema: deriveManagedChunkDataSchema(source.fields),
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

type ContractIdentity = Pick<
  ManagedChunkContractEntity,
  'templatePackageId' | 'definitionKey' | 'schemaVersion'
>;

type InsertQueryBuilder = {
  insert(): InsertQueryBuilder;
  into(entity: typeof ManagedChunkContractEntity): InsertQueryBuilder;
  values(value: Partial<ManagedChunkContractEntity>): InsertQueryBuilder;
  orIgnore(): InsertQueryBuilder;
  execute(): Promise<{ raw: unknown[] }>;
};

function sameIdentity(
  row: ContractIdentity,
  identity: ContractIdentity,
): boolean {
  return (
    row.templatePackageId === identity.templatePackageId &&
    row.definitionKey === identity.definitionKey &&
    row.schemaVersion === identity.schemaVersion
  );
}

const identityLabel = (identity: ContractIdentity): string =>
  `${identity.definitionKey}@${identity.schemaVersion}`;

function cloneContract(row: ManagedChunkContractEntity) {
  return {
    ...row,
    fieldContract: structuredClone(row.fieldContract),
    dataSchema: structuredClone(row.dataSchema),
    createdAt: new Date(row.createdAt),
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function createHarness(options?: {
  versions?: Array<
    Pick<
      TemplatePackageVersionEntity,
      'id' | 'templatePackageId' | 'manifestVersion'
    >
  >;
  contracts?: ManagedChunkContractEntity[];
  concurrentRow?: ManagedChunkContractEntity;
  beforeTransaction?: () => Promise<void>;
}) {
  const versions = options?.versions ?? [
    {
      id: VERSION_ID,
      templatePackageId: PACKAGE_ID,
      manifestVersion: 2,
    },
  ];
  const contracts = (options?.contracts ?? []).map(cloneContract);
  let nextId = contracts.length + 1;
  let insertAttempts = 0;
  let concurrentRowVisible = false;
  const versionLookups: Array<{
    id: string;
    templatePackageId: string;
    manifestVersion: number;
  }> = [];
  const contractLookups: ContractIdentity[] = [];
  const contractInserts: ContractIdentity[] = [];
  let lastRegistrationManager: EntityManager | null = null;

  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        await options?.beforeTransaction?.();
        const workingContracts = contracts.map(cloneContract);
        const contractRepository = {
          findOne: jest.fn(({ where }: { where: ContractIdentity }) => {
            contractLookups.push({ ...where });
            return Promise.resolve(
              workingContracts.find((row) => sameIdentity(row, where)) ??
                (concurrentRowVisible &&
                options?.concurrentRow &&
                sameIdentity(options.concurrentRow, where)
                  ? options.concurrentRow
                  : null),
            );
          }),
        };
        const versionRepository = {
          findOne: jest.fn(
            ({
              where,
            }: {
              where: {
                id: string;
                templatePackageId: string;
                manifestVersion: number;
              };
            }) => {
              versionLookups.push({ ...where });
              return Promise.resolve(
                versions.find(
                  (version) =>
                    version.id === where.id &&
                    version.templatePackageId === where.templatePackageId &&
                    version.manifestVersion === where.manifestVersion,
                ) ?? null,
              );
            },
          ),
        };
        let pendingInsert: Partial<ManagedChunkContractEntity> | undefined;
        let usesConflictIgnore = false;
        const queryBuilder: InsertQueryBuilder = {
          insert: jest.fn(() => queryBuilder),
          into: jest.fn((entity: typeof ManagedChunkContractEntity) => {
            if (entity !== ManagedChunkContractEntity)
              throw new Error('Unexpected insert entity');
            return queryBuilder;
          }),
          values: jest.fn((value: Partial<ManagedChunkContractEntity>) => {
            pendingInsert = value;
            return queryBuilder;
          }),
          orIgnore: jest.fn(() => {
            usesConflictIgnore = true;
            return queryBuilder;
          }),
          execute: jest.fn(() => {
            insertAttempts += 1;
            if (!pendingInsert || !usesConflictIgnore)
              throw new Error('Insert must use ON CONFLICT DO NOTHING');
            if (options?.concurrentRow && !concurrentRowVisible) {
              concurrentRowVisible = true;
              contracts.push(cloneContract(options.concurrentRow));
              return Promise.resolve({ raw: [] });
            }
            const identity = pendingInsert as ContractIdentity;
            contractInserts.push({ ...identity });
            if (workingContracts.some((row) => sameIdentity(row, identity)))
              return Promise.resolve({ raw: [] });
            const saved = {
              id: `contract-${nextId}`,
              createdAt: new Date('2026-10-08T00:00:00.000Z'),
              ...pendingInsert,
            } as ManagedChunkContractEntity;
            nextId += 1;
            workingContracts.push(saved);
            return Promise.resolve({ raw: [saved] });
          }),
        };
        const manager = {
          getRepository: jest.fn((entity: unknown) => {
            if (entity === TemplatePackageVersionEntity)
              return versionRepository;
            if (entity === ManagedChunkContractEntity)
              return contractRepository;
            throw new Error('Unexpected repository');
          }),
          createQueryBuilder: jest.fn(() => queryBuilder),
        } as unknown as EntityManager;
        lastRegistrationManager = manager;

        const result = await callback(manager);
        contracts.splice(
          0,
          contracts.length,
          ...workingContracts.map(cloneContract),
        );
        if (
          concurrentRowVisible &&
          options?.concurrentRow &&
          !contracts.some((row) => sameIdentity(row, options.concurrentRow!))
        ) {
          contracts.push(cloneContract(options.concurrentRow));
        }
        return result;
      },
    ),
  };

  return {
    repository: new ManagedChunkPersistenceRepository(
      dataSource as never,
      {
        saveManagedDraftUsingManager: jest.fn(() => {
          throw new Error('Unexpected revision draft');
        }),
      } as never,
    ),
    contracts,
    dataSource,
    versionLookups,
    contractLookups,
    contractInserts,
    get lastRegistrationManager() {
      return lastRegistrationManager;
    },
    get insertAttempts() {
      return insertAttempts;
    },
  };
}

type InstanceState = {
  resources: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  instances: Record<string, unknown>[];
  links: Record<string, unknown>[];
  events: Record<string, unknown>[];
};

function createInstanceHarness(options?: {
  contract?: ManagedChunkContractEntity | null;
  siteTemplatePackageId?: string | null;
  siteDisappearsAfterAuthorization?: boolean;
  denyAccess?: boolean;
  failOnSave?: 'instance' | 'link';
  corruptAfterTypedSave?: (
    state: InstanceState,
    kind: 'instance' | 'link',
  ) => void;
  beforeTransaction?: () => Promise<void>;
}) {
  let committed: InstanceState = {
    resources: [],
    revisions: [],
    instances: [],
    links: [],
    events: [],
  };
  const contract =
    options?.contract === undefined
      ? storedContract(definition(), {
          id: CONTRACT_ID,
          templatePackageId: PACKAGE_ID,
        })
      : options.contract;
  const contractLookups: string[] = [];
  const lookupOperations: Array<{
    entity: string;
    lock: unknown;
  }> = [];
  const saveAttempts: string[] = [];
  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        await options?.beforeTransaction?.();
        const working = structuredClone(committed);
        const manager = {
          findOne: jest.fn(
            (
              entity: { name: string },
              query: {
                where: Record<string, unknown>;
                lock?: { mode: string };
              },
            ) => {
              if (entity === SiteEntity) {
                lookupOperations.push({
                  entity: 'site',
                  lock: query.lock ?? null,
                });
                const siteVisible = !options?.siteDisappearsAfterAuthorization;
                return Promise.resolve(
                  query.where.id === SITE_ID && siteVisible
                    ? {
                        id: SITE_ID,
                        templatePackageId:
                          options?.siteTemplatePackageId === undefined
                            ? PACKAGE_ID
                            : options.siteTemplatePackageId,
                      }
                    : null,
                );
              }
              if (entity === SiteAccessEntity) {
                lookupOperations.push({
                  entity: 'access',
                  lock: query.lock ?? null,
                });
                return Promise.resolve(
                  options?.denyAccess
                    ? null
                    : {
                        role: SiteRole.CONTENT_MANAGER,
                        requiresApproval: true,
                      },
                );
              }
              if (entity === CmsRevisionResourceEntity) {
                lookupOperations.push({
                  entity: 'resource',
                  lock: query.lock ?? null,
                });
                return Promise.resolve(
                  working.resources.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === ManagedChunkInstanceEntity) {
                lookupOperations.push({
                  entity: 'instance',
                  lock: query.lock ?? null,
                });
                return Promise.resolve(
                  working.instances.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === ManagedChunkInstanceRevisionEntity) {
                lookupOperations.push({
                  entity: 'link',
                  lock: query.lock ?? null,
                });
                return Promise.resolve(
                  working.links.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === ManagedChunkContractEntity) {
                lookupOperations.push({
                  entity: 'contract',
                  lock: query.lock ?? null,
                });
                contractLookups.push(String(query.where.id));
                return Promise.resolve(
                  contract?.id === query.where.id ? contract : null,
                );
              }
              throw new Error(`Unexpected lookup: ${entity.name}`);
            },
          ),
          save: jest.fn((value: object) => {
            const kind =
              value instanceof CmsRevisionResourceEntity
                ? 'resource'
                : value instanceof CmsRevisionEntity
                  ? 'revision'
                  : value instanceof ManagedChunkInstanceEntity
                    ? 'instance'
                    : value instanceof ManagedChunkInstanceRevisionEntity
                      ? 'link'
                      : value instanceof CmsRevisionEventEntity
                        ? 'event'
                        : 'unknown';
            saveAttempts.push(kind);
            if (options?.failOnSave === kind)
              throw new Error(`${kind}-save-failed`);
            const rows =
              kind === 'resource'
                ? working.resources
                : kind === 'revision'
                  ? working.revisions
                  : kind === 'instance'
                    ? working.instances
                    : kind === 'link'
                      ? working.links
                      : kind === 'event'
                        ? working.events
                        : null;
            if (!rows) throw new Error('Unexpected save entity');
            const record = value as Record<string, unknown>;
            const identity =
              value instanceof ManagedChunkInstanceRevisionEntity
                ? 'revisionId'
                : 'id';
            const existing = rows.findIndex(
              (row) => row[identity] === record[identity],
            );
            if (existing >= 0) rows[existing] = structuredClone(record);
            else rows.push(structuredClone(record));
            if (kind === 'instance' || kind === 'link') {
              options?.corruptAfterTypedSave?.(working, kind);
            }
            return Promise.resolve(value);
          }),
        } as unknown as EntityManager;
        const result = await callback(manager);
        committed = working;
        return result;
      },
    ),
  };
  const revisionsService = new CmsRevisionsService(
    dataSource as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Site authorization escaped the transaction');
      }),
    } as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Access authorization escaped the transaction');
      }),
    } as never,
  );
  const repository = new ManagedChunkPersistenceRepository(
    dataSource as never,
    revisionsService,
  );

  return {
    repository,
    dataSource,
    revisionsService,
    contractLookups,
    lookupOperations,
    saveAttempts,
    get state() {
      return committed;
    },
  };
}
type LayoutState = {
  resources: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  layouts: Record<string, unknown>[];
  placements: Record<string, unknown>[];
  events: Record<string, unknown>[];
};

function createLayoutHarness(options?: {
  pages?: Array<{ id: string; siteId: string }>;
  instances?: Array<{ id: string; siteId: string }>;
  failOnSave?: 'layout' | 'placement';
  corruptAfterTypedSave?: (
    state: LayoutState,
    kind: 'layout' | 'placement',
  ) => void;
  denyAccess?: boolean;
  siteExists?: boolean;
  beforeTransaction?: () => Promise<void>;
}) {
  let committed: LayoutState = {
    resources: [],
    revisions: [],
    layouts: [],
    placements: [],
    events: [],
  };
  const pages = options?.pages ?? [{ id: PAGE_ID, siteId: SITE_ID }];
  const instances = options?.instances ?? [
    { id: HERO_INSTANCE_ID, siteId: SITE_ID },
  ];
  const lookupOperations: Array<{
    entity: string;
    where: Record<string, unknown>;
    lock: unknown;
  }> = [];
  const saveAttempts: string[] = [];
  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        await options?.beforeTransaction?.();
        const working = structuredClone(committed);
        const manager = {
          findOne: jest.fn(
            (
              entity: { name: string },
              query: {
                where: Record<string, unknown>;
                lock?: { mode: string };
              },
            ) => {
              const entityName =
                entity === SiteEntity
                  ? 'site'
                  : entity === SiteAccessEntity
                    ? 'access'
                    : entity === PageEntity
                      ? 'page'
                      : entity === ManagedChunkLayoutEntity
                        ? 'layout'
                        : entity === ManagedChunkInstanceEntity
                          ? 'instance'
                          : entity === CmsRevisionResourceEntity
                            ? 'resource'
                            : 'unknown';
              lookupOperations.push({
                entity: entityName,
                where: { ...query.where },
                lock: query.lock ?? null,
              });
              if (entity === SiteEntity) {
                return Promise.resolve(
                  query.where.id === SITE_ID && options?.siteExists !== false
                    ? { id: SITE_ID, templatePackageId: PACKAGE_ID }
                    : null,
                );
              }
              if (entity === SiteAccessEntity) {
                return Promise.resolve(
                  options?.denyAccess
                    ? null
                    : {
                        role: SiteRole.CONTENT_MANAGER,
                        requiresApproval: true,
                      },
                );
              }
              if (entity === PageEntity) {
                return Promise.resolve(
                  pages.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key as keyof typeof row] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === ManagedChunkLayoutEntity) {
                return Promise.resolve(
                  working.layouts.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === ManagedChunkInstanceEntity) {
                return Promise.resolve(
                  instances.find((row) =>
                    Object.entries(query.where).every(
                      ([key, value]) => row[key as keyof typeof row] === value,
                    ),
                  ) ?? null,
                );
              }
              if (entity === CmsRevisionResourceEntity) {
                const stored = working.resources.find((row) =>
                  Object.entries(query.where).every(
                    ([key, value]) => row[key] === value,
                  ),
                );
                return Promise.resolve(
                  stored
                    ? Object.assign(
                        new CmsRevisionResourceEntity(),
                        structuredClone(stored),
                      )
                    : null,
                );
              }
              throw new Error('Unexpected lookup: ' + entity.name);
            },
          ),
          find: jest.fn(
            (
              entity: { name: string },
              query: { where: Record<string, unknown> },
            ) => {
              if (entity !== ManagedChunkPlacementEntity) {
                throw new Error('Unexpected collection lookup: ' + entity.name);
              }
              lookupOperations.push({
                entity: 'placements',
                where: { ...query.where },
                lock: null,
              });
              return Promise.resolve(
                working.placements.filter((row) =>
                  Object.entries(query.where).every(
                    ([key, value]) => row[key] === value,
                  ),
                ),
              );
            },
          ),
          save: jest.fn((value: object | object[]) => {
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
              const kind =
                item instanceof CmsRevisionResourceEntity
                  ? 'resource'
                  : item instanceof CmsRevisionEntity
                    ? 'revision'
                    : item instanceof ManagedChunkLayoutEntity
                      ? 'layout'
                      : item instanceof ManagedChunkPlacementEntity
                        ? 'placement'
                        : item instanceof CmsRevisionEventEntity
                          ? 'event'
                          : 'unknown';
              saveAttempts.push(kind);
              if (options?.failOnSave === kind)
                throw new Error(kind + '-save-failed');
              const rows =
                kind === 'resource'
                  ? working.resources
                  : kind === 'revision'
                    ? working.revisions
                    : kind === 'layout'
                      ? working.layouts
                      : kind === 'placement'
                        ? working.placements
                        : kind === 'event'
                          ? working.events
                          : null;
              if (!rows) throw new Error('Unexpected save entity');
              const record = item as Record<string, unknown>;
              const existing = rows.findIndex((row) => row.id === record.id);
              if (existing >= 0) rows[existing] = structuredClone(record);
              else rows.push(structuredClone(record));
              if (kind === 'layout' || kind === 'placement') {
                options?.corruptAfterTypedSave?.(working, kind);
              }
            }
            return Promise.resolve(value);
          }),
        } as unknown as EntityManager;
        const result = await callback(manager);
        committed = working;
        return result;
      },
    ),
  };
  const revisionsService = new CmsRevisionsService(
    dataSource as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Site authorization escaped the transaction');
      }),
    } as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Access authorization escaped the transaction');
      }),
    } as never,
  );

  return {
    repository: new ManagedChunkPersistenceRepository(
      dataSource as never,
      revisionsService,
    ),
    dataSource,
    lookupOperations,
    saveAttempts,
    get state() {
      return committed;
    },
  };
}
const register = (
  repository: ManagedChunkPersistenceRepository,
  definitions: readonly ManagedChunkDefinition[],
  overrides: Partial<{
    templatePackageId: string;
    templatePackageVersionId: string;
  }> = {},
) =>
  repository.registerContracts({
    templatePackageId: PACKAGE_ID,
    templatePackageVersionId: VERSION_ID,
    definitions,
    ...overrides,
  });

describe('ManagedChunkPersistenceRepository', () => {
  it('can register contracts with the caller transaction manager', async () => {
    const harness = createHarness();
    const source = definition();
    await register(harness.repository, [source]);
    const manager = harness.lastRegistrationManager;
    if (!manager) throw new Error('Registration manager was not captured');
    harness.dataSource.transaction.mockClear();

    await expect(
      harness.repository.registerContractsUsingManager(manager, {
        templatePackageId: PACKAGE_ID,
        templatePackageVersionId: VERSION_ID,
        definitions: [source],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ definitionKey: source.key }),
    ]);

    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('persists exactly one contract per definition and returns input order', async () => {
    const harness = createHarness();
    const hero = definition();
    const promo = definition({
      key: 'promo',
      schemaVersion: '2',
      title: 'Promo',
      rendererKey: 'promo-card',
    });

    const result = await register(harness.repository, [promo, hero]);

    expect(result.map((row) => row.definitionKey)).toEqual(['promo', 'hero']);
    expect(harness.contracts).toHaveLength(2);
    expect(harness.contracts).toContainEqual(
      expect.objectContaining({
        templatePackageId: PACKAGE_ID,
        firstSeenTemplatePackageVersionId: VERSION_ID,
        definitionKey: 'promo',
        schemaVersion: '2',
      }),
    );
  });

  it('returns the same row for an identical repeat without inserting again', async () => {
    const harness = createHarness();
    const source = definition();

    const [first] = await register(harness.repository, [source]);
    const [second] = await register(harness.repository, [source]);

    expect(second.id).toBe(first.id);
    expect(harness.contracts).toHaveLength(1);
    expect(harness.insertAttempts).toBe(1);
  });

  it('returns one stored entity in every position for semantic duplicates', async () => {
    const harness = createHarness();
    const first = definition();
    const presentationDuplicate = definition({
      title: 'Новый заголовок',
      categoryKey: 'featured',
      rendererKey: 'hero-v2',
    });

    const result = await register(harness.repository, [
      first,
      presentationDuplicate,
      first,
    ]);

    expect(result.map((row) => row.id)).toEqual([
      result[0].id,
      result[0].id,
      result[0].id,
    ]);
    expect(result[1]).toBe(result[0]);
    expect(result[2]).toBe(result[0]);
    expect(harness.contracts).toHaveLength(1);
    expect(harness.insertAttempts).toBe(1);
  });

  it('rejects conflicting duplicate identities before opening a transaction', async () => {
    const harness = createHarness();
    const conflicting = definition({
      fields: [
        {
          key: 'headline',
          label: 'Headline',
          widget: 'textarea',
        },
      ],
    });

    await expect(
      register(harness.repository, [definition(), conflicting]),
    ).rejects.toMatchObject({
      message: 'Контракт чанка уже зарегистрирован с другим содержимым',
    });

    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    expect(harness.contracts).toHaveLength(0);
    expect(harness.insertAttempts).toBe(0);
  });

  it('processes unique identities in sorted lock order and restores input order', async () => {
    const harness = createHarness();
    const zeta = definition({ key: 'zeta', schemaVersion: '1' });
    const alpha2 = definition({ key: 'alpha', schemaVersion: '2' });
    const alpha10 = definition({ key: 'alpha', schemaVersion: '10' });

    const result = await register(harness.repository, [zeta, alpha2, alpha10]);

    expect(result.map(identityLabel)).toEqual([
      'zeta@1',
      'alpha@2',
      'alpha@10',
    ]);
    expect(harness.contractInserts.map(identityLabel)).toEqual([
      'alpha@10',
      'alpha@2',
      'zeta@1',
    ]);
    expect(harness.contractLookups.map(identityLabel)).toEqual([
      'alpha@10',
      'alpha@10',
      'alpha@2',
      'alpha@2',
      'zeta@1',
      'zeta@1',
    ]);
  });

  it('validates the exact v2 package version for an empty batch', async () => {
    const harness = createHarness();

    await expect(register(harness.repository, [])).resolves.toEqual([]);

    expect(harness.versionLookups).toEqual([
      {
        id: VERSION_ID,
        templatePackageId: PACKAGE_ID,
        manifestVersion: 2,
      },
    ]);
    expect(harness.contractLookups).toHaveLength(0);
    expect(harness.insertAttempts).toBe(0);
  });

  it('snapshots mutable caller definitions before the transaction can await', async () => {
    const transactionGate = deferred();
    const source = definition();
    const expectedFieldContract = JSON.parse(
      canonicalManagedChunkContract(source.fields),
    ) as Record<string, unknown>;
    const expectedDataSchema = deriveManagedChunkDataSchema(source.fields);
    const harness = createHarness({
      beforeTransaction: () => transactionGate.promise,
    });

    const registration = register(harness.repository, [source]);
    source.key = 'mutated';
    source.schemaVersion = '99';
    source.fields = [
      {
        key: 'mutated_field',
        label: 'Mutated',
        widget: 'boolean',
      },
    ];
    transactionGate.release();

    const [stored] = await registration;

    expect(stored).toMatchObject({
      definitionKey: 'hero',
      schemaVersion: '1',
      fieldContract: expectedFieldContract,
      dataSchema: expectedDataSchema,
    });
  });

  it('ignores presentation-only changes and stores a canonical contract', async () => {
    const harness = createHarness();
    const initial = definition();
    const presentedDifferently = definition({
      title: 'Completely new title',
      categoryKey: 'featured',
      rendererKey: 'hero-banner-v2',
      fields: [
        {
          key: 'headline',
          label: 'Заголовок',
          help: 'Другая подсказка',
          widget: 'text',
          required: true,
          constraints: { minLength: 1, maxLength: 120 },
        },
        {
          key: 'theme',
          label: 'Оформление',
          help: 'Новая подсказка',
          widget: 'select',
          options: [
            { value: 'light', label: 'Светлое' },
            { value: 'dark', label: 'Тёмное' },
          ],
        },
      ],
    });

    const [first] = await register(harness.repository, [initial]);
    const [second] = await register(harness.repository, [presentedDifferently]);

    expect(second.id).toBe(first.id);
    expect(harness.contracts).toHaveLength(1);
    expect(harness.contracts[0].fieldContract).toEqual(
      JSON.parse(canonicalManagedChunkContract(initial.fields)),
    );
    expect(harness.contracts[0].dataSchema).toEqual(
      deriveManagedChunkDataSchema(initial.fields),
    );
    expect(JSON.stringify(harness.contracts[0].fieldContract)).not.toContain(
      'Headline',
    );
    expect(JSON.stringify(harness.contracts[0].fieldContract)).not.toContain(
      'Light',
    );
  });

  it('rejects a semantic change for an existing identity without mutation', async () => {
    const initial = definition();
    const existing = storedContract(initial);
    const harness = createHarness({ contracts: [existing] });
    const changed = definition({
      fields: [
        {
          key: 'headline',
          label: 'Headline',
          widget: 'text',
          required: true,
          constraints: { minLength: 1, maxLength: 80 },
        },
      ],
    });

    await expect(
      register(harness.repository, [changed]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.contracts).toEqual([existing]);
    expect(harness.insertAttempts).toBe(0);
  });

  it('rejects a stored canonical mismatch even when the digest matches', async () => {
    const source = definition();
    const existing = storedContract(source, {
      fieldContract: {
        fields: [{ key: 'headline', widget: 'boolean' }],
      },
    });
    const harness = createHarness({ contracts: [existing] });

    await expect(register(harness.repository, [source])).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(harness.contracts).toEqual([existing]);
  });

  it('rejects an altered stored data schema without mutation', async () => {
    const source = definition();
    const existing = storedContract(source, {
      dataSchema: {
        ...deriveManagedChunkDataSchema(source.fields),
        additionalProperties: true,
      } as unknown as Record<string, unknown>,
    });
    const harness = createHarness({ contracts: [existing] });

    await expect(register(harness.repository, [source])).rejects.toMatchObject({
      message: 'Контракт чанка уже зарегистрирован с другим содержимым',
    });

    expect(harness.contracts).toEqual([existing]);
    expect(harness.insertAttempts).toBe(0);
  });

  it('rejects an altered concurrent data schema after conflict-do-nothing reread', async () => {
    const source = definition();
    const concurrentRow = storedContract(source, {
      id: 'contract-concurrent',
      dataSchema: {
        ...deriveManagedChunkDataSchema(source.fields),
        properties: {},
      },
    });
    const harness = createHarness({ concurrentRow });

    await expect(register(harness.repository, [source])).rejects.toMatchObject({
      message: 'Контракт чанка уже зарегистрирован с другим содержимым',
    });

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.insertAttempts).toBe(1);
    expect(harness.contracts).toEqual([concurrentRow]);
  });

  it.each([
    ['an unknown version', []],
    [
      'a version owned by another package',
      [
        {
          id: VERSION_ID,
          templatePackageId: '33333333-3333-4333-8333-333333333333',
          manifestVersion: 2,
        },
      ],
    ],
    [
      'a manifest v1 version',
      [
        {
          id: VERSION_ID,
          templatePackageId: PACKAGE_ID,
          manifestVersion: 1,
        },
      ],
    ],
  ])('uses the same safe not-found for %s', async (_case, versions) => {
    const harness = createHarness({ versions });

    await expect(register(harness.repository, [definition()])).rejects.toEqual(
      new NotFoundException('Версия пакета не найдена'),
    );

    expect(harness.contracts).toHaveLength(0);
    expect(harness.insertAttempts).toBe(0);
  });

  it('rolls back all earlier inserts when a later definition conflicts', async () => {
    const conflictingSource = definition({ key: 'z-conflict' });
    const existing = storedContract(conflictingSource);
    const harness = createHarness({ contracts: [existing] });
    const changedConflict = definition({
      key: 'z-conflict',
      fields: [
        {
          key: 'enabled',
          label: 'Enabled',
          widget: 'boolean',
        },
      ],
    });

    await expect(
      register(harness.repository, [
        changedConflict,
        definition({ key: 'a-new' }),
      ]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.insertAttempts).toBe(1);
    expect(harness.contractInserts.map(identityLabel)).toEqual(['a-new@1']);
    expect(harness.contracts).toEqual([existing]);
    expect(harness.contracts.some((row) => row.definitionKey === 'a-new')).toBe(
      false,
    );
  });

  it('rereads a concurrent same-identity insert without retrying the transaction', async () => {
    const source = definition();
    const concurrentRow = storedContract(source, { id: 'contract-concurrent' });
    const harness = createHarness({ concurrentRow });

    const [result] = await register(harness.repository, [source]);

    expect(result.id).toBe('contract-concurrent');
    expect(harness.contracts).toEqual([concurrentRow]);
    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.insertAttempts).toBe(1);
  });

  it('rejects a semantically different concurrent same-identity row', async () => {
    const source = definition();
    const different = definition({
      fields: [
        {
          key: 'headline',
          label: 'Headline',
          widget: 'textarea',
        },
      ],
    });
    const concurrentRow = storedContract(different, {
      id: 'contract-concurrent',
    });
    const harness = createHarness({ concurrentRow });

    await expect(register(harness.repository, [source])).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.insertAttempts).toBe(1);
    expect(harness.contracts).toEqual([concurrentRow]);
  });

  it('accepts PostgreSQL jsonb key reordering for the same canonical object', async () => {
    const source = definition();
    const canonical = JSON.parse(
      canonicalManagedChunkContract(source.fields),
    ) as { fields: Array<Record<string, unknown>> };
    const reordered = {
      fields: canonical.fields.map((field) =>
        Object.fromEntries(Object.entries(field).reverse()),
      ),
    };
    const existing = storedContract(source, { fieldContract: reordered });
    const harness = createHarness({ contracts: [existing] });

    const [result] = await register(harness.repository, [source]);

    expect(result.id).toBe(existing.id);
    expect(harness.insertAttempts).toBe(0);
  });
  describe('createInstanceDraft', () => {
    it('atomically creates an instance, revision resource, strict snapshot, and typed revision link', async () => {
      const harness = createInstanceHarness();
      const data = {
        headline: 'Safe synthetic payload',
        nested: { enabled: true },
      };

      const result = await harness.repository.createInstanceDraft({
        siteId: SITE_ID,
        displayName: 'Hero instance',
        contractId: CONTRACT_ID,
        data,
        sanitizerPolicyVersion: 'policy-1',
        actor: ACTOR,
      });

      expect(result).toEqual({
        instanceId: harness.state.instances[0].id,
        revisionId: harness.state.revisions[0].id,
        versionNumber: 1,
      });
      expect(harness.state.instances).toEqual([
        expect.objectContaining({
          id: result.instanceId,
          siteId: SITE_ID,
          revisionResourceId: harness.state.resources[0].id,
          displayName: 'Hero instance',
          isArchived: false,
          createdByUserId: ACTOR.userId,
        }),
      ]);
      expect(harness.state.resources).toEqual([
        expect.objectContaining({
          siteId: SITE_ID,
          resourceType: 'chunk_instance',
          entityId: result.instanceId,
          draftRevisionId: result.revisionId,
          latestVersionNumber: 1,
        }),
      ]);
      expect(harness.state.revisions).toEqual([
        expect.objectContaining({
          id: result.revisionId,
          resourceId: harness.state.resources[0].id,
          versionNumber: 1,
          snapshot: {
            formatVersion: 1,
            data,
            sanitizerPolicyVersion: 'policy-1',
          },
        }),
      ]);
      expect(harness.state.links).toEqual([
        expect.objectContaining({
          revisionId: result.revisionId,
          revisionResourceId: harness.state.resources[0].id,
          siteId: SITE_ID,
          instanceId: result.instanceId,
          contractId: CONTRACT_ID,
        }),
      ]);
      expect(harness.state.events).toHaveLength(1);
      expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(harness.lookupOperations).toEqual([
        { entity: 'access', lock: { mode: 'pessimistic_read' } },
        { entity: 'site', lock: { mode: 'pessimistic_read' } },
        { entity: 'contract', lock: null },
        { entity: 'resource', lock: { mode: 'pessimistic_write' } },
        { entity: 'resource', lock: null },
        { entity: 'instance', lock: null },
        { entity: 'link', lock: null },
      ]);
    });

    it.each([
      ['an unknown contract', { contract: null }],
      [
        'a contract from another site package',
        {
          siteTemplatePackageId: '66666666-6666-4666-8666-666666666666',
        },
      ],
      [
        'a site missing after authorization',
        { siteDisappearsAfterAuthorization: true },
      ],
    ])('uses the same safe not-found for %s', async (_case, options) => {
      const harness = createInstanceHarness(options);

      await expect(
        harness.repository.createInstanceDraft({
          siteId: SITE_ID,
          displayName: 'Hero instance',
          contractId: CONTRACT_ID,
          data: {},
          sanitizerPolicyVersion: null,
          actor: ACTOR,
        }),
      ).rejects.toEqual(new NotFoundException('Контракт чанка не найден'));

      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        instances: [],
        links: [],
        events: [],
      });
    });

    it('denies site access before contract lookup or any write', async () => {
      const harness = createInstanceHarness({ denyAccess: true });

      await expect(
        harness.repository.createInstanceDraft({
          siteId: SITE_ID,
          displayName: 'Hero instance',
          contractId: CONTRACT_ID,
          data: {},
          sanitizerPolicyVersion: null,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(harness.contractLookups).toEqual([]);
      expect(harness.lookupOperations).toEqual([
        { entity: 'access', lock: { mode: 'pessimistic_read' } },
        { entity: 'access', lock: { mode: 'pessimistic_read' } },
      ]);
      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        instances: [],
        links: [],
        events: [],
      });
    });

    it('returns safe not-found for an admin and missing site before any revision save', async () => {
      const harness = createInstanceHarness({
        siteDisappearsAfterAuthorization: true,
      });

      await expect(
        harness.repository.createInstanceDraft({
          siteId: SITE_ID,
          displayName: 'Missing site',
          contractId: CONTRACT_ID,
          data: {},
          sanitizerPolicyVersion: null,
          actor: ADMIN_ACTOR,
        }),
      ).rejects.toEqual(new NotFoundException('Контракт чанка не найден'));

      expect(harness.lookupOperations).toEqual([
        { entity: 'site', lock: { mode: 'pessimistic_read' } },
      ]);
      expect(harness.contractLookups).toEqual([]);
      expect(harness.saveAttempts).toEqual([]);
      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        instances: [],
        links: [],
        events: [],
      });
    });
    it.each(['instance', 'link'] as const)(
      'rolls back every draft write when the %s save fails inside the hook',
      async (failOnSave) => {
        const harness = createInstanceHarness({ failOnSave });

        await expect(
          harness.repository.createInstanceDraft({
            siteId: SITE_ID,
            displayName: 'Hero instance',
            contractId: CONTRACT_ID,
            data: { headline: 'Uncommitted' },
            sanitizerPolicyVersion: null,
            actor: ACTOR,
          }),
        ).rejects.toThrow(`${failOnSave}-save-failed`);

        expect(harness.saveAttempts).toEqual(
          failOnSave === 'instance'
            ? ['resource', 'revision', 'instance']
            : ['resource', 'revision', 'instance', 'link'],
        );
        expect(harness.state).toEqual({
          resources: [],
          revisions: [],
          instances: [],
          links: [],
          events: [],
        });
      },
    );

    it.each([
      [
        'missing instance owner',
        (state: InstanceState) => {
          state.instances = [];
        },
      ],
      [
        'wrong instance owner resource',
        (state: InstanceState) => {
          state.instances[0].revisionResourceId = 'wrong-resource';
        },
      ],
      [
        'missing typed revision link',
        (state: InstanceState) => {
          state.links = [];
        },
      ],
      [
        'wrong typed revision contract',
        (state: InstanceState) => {
          state.links[0].contractId = 'wrong-contract';
        },
      ],
    ] as const)(
      'fails closed after the hook leaves %s and rolls back pointer/event writes',
      async (_, corrupt) => {
        const harness = createInstanceHarness({
          corruptAfterTypedSave: (state, kind) => {
            if (kind === 'link') corrupt(state);
          },
        });

        const saving = harness.repository.createInstanceDraft({
          siteId: SITE_ID,
          displayName: 'Corrupt instance',
          contractId: CONTRACT_ID,
          data: {},
          sanitizerPolicyVersion: null,
          actor: ACTOR,
        });
        await expect(saving).rejects.toEqual(
          new ConflictException(
            'Состояние управляемого черновика не подтверждено',
          ),
        );
        await expect(saving).rejects.not.toThrow(DATABASE_UUID_PATTERN);
        expect(harness.saveAttempts).toEqual([
          'resource',
          'revision',
          'instance',
          'link',
        ]);
        expect(harness.state).toEqual({
          resources: [],
          revisions: [],
          instances: [],
          links: [],
          events: [],
        });
      },
    );

    it('captures input data before the first await and ignores later caller mutation', async () => {
      const transactionGate = deferred();
      const harness = createInstanceHarness({
        beforeTransaction: () => transactionGate.promise,
      });
      const data = { nested: { headline: 'Original' } };

      const creation = harness.repository.createInstanceDraft({
        siteId: SITE_ID,
        displayName: 'Hero instance',
        contractId: CONTRACT_ID,
        data,
        sanitizerPolicyVersion: 'policy-1',
        actor: ACTOR,
      });
      data.nested.headline = 'Mutated after call';
      transactionGate.release();
      await creation;

      expect(harness.state.revisions[0].snapshot).toEqual({
        formatVersion: 1,
        data: { nested: { headline: 'Original' } },
        sanitizerPolicyVersion: 'policy-1',
      });
    });

    it('preserves a safe synthetic payload without sanitization or transformation', async () => {
      const harness = createInstanceHarness();
      const data = {
        html: '<script data-safe="synthetic">kept verbatim</script>',
        values: [0, false, null, { custom_key: 'custom-value' }],
      };

      await harness.repository.createInstanceDraft({
        siteId: SITE_ID,
        displayName: 'Synthetic',
        contractId: CONTRACT_ID,
        data,
        sanitizerPolicyVersion: null,
        actor: ACTOR,
      });

      expect(harness.state.revisions[0].snapshot).toEqual({
        formatVersion: 1,
        data,
        sanitizerPolicyVersion: null,
      });
    });
  });

  describe('saveLayoutDraft', () => {
    const savePageLayout = (
      repository: ManagedChunkPersistenceRepository,
      overrides: Partial<{
        target: { kind: 'page'; pageId: string };
        expectedDraftRevisionId: string | null;
        placements: Array<{
          slotKey: string;
          position: number;
          instanceId: string;
        }>;
      }> = {},
    ) =>
      repository.saveLayoutDraft({
        siteId: SITE_ID,
        target: { kind: 'page', pageId: PAGE_ID },
        templateKey: 'skinova-home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [
          {
            slotKey: 'hero',
            position: 0,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
        actor: ACTOR,
        ...overrides,
      });

    it('atomically saves metadata and the complete placement set for one exact page revision', async () => {
      const harness = createLayoutHarness({
        instances: [
          { id: HERO_INSTANCE_ID, siteId: SITE_ID },
          { id: PROMO_INSTANCE_ID, siteId: SITE_ID },
        ],
      });

      const result = await savePageLayout(harness.repository, {
        placements: [
          {
            slotKey: 'hero',
            position: 0,
            instanceId: HERO_INSTANCE_ID,
          },
          {
            slotKey: 'promo',
            position: 0,
            instanceId: PROMO_INSTANCE_ID,
          },
        ],
      });

      expect(result).toEqual({
        layoutId: harness.state.layouts[0].id,
        revisionId: harness.state.revisions[0].id,
        versionNumber: 1,
      });
      expect(harness.state.layouts).toEqual([
        expect.objectContaining({
          id: result.layoutId,
          siteId: SITE_ID,
          revisionResourceId: harness.state.resources[0].id,
          scopeKind: 'page',
          pageId: PAGE_ID,
          surfaceKey: null,
        }),
      ]);
      expect(harness.state.revisions).toEqual([
        expect.objectContaining({
          id: result.revisionId,
          snapshot: {
            formatVersion: 1,
            templateKey: 'skinova-home',
            templateVersion: '1',
          },
        }),
      ]);
      expect(harness.state.revisions[0].snapshot).not.toHaveProperty(
        'placements',
      );
      expect(harness.state.placements).toEqual([
        expect.objectContaining({
          siteId: SITE_ID,
          layoutId: result.layoutId,
          layoutRevisionResourceId: harness.state.resources[0].id,
          layoutRevisionId: result.revisionId,
          slotKey: 'hero',
          position: 0,
          instanceId: HERO_INSTANCE_ID,
        }),
        expect.objectContaining({
          siteId: SITE_ID,
          layoutId: result.layoutId,
          layoutRevisionResourceId: harness.state.resources[0].id,
          layoutRevisionId: result.revisionId,
          slotKey: 'promo',
          position: 0,
          instanceId: PROMO_INSTANCE_ID,
        }),
      ]);
      expect(harness.state.resources).toEqual([
        expect.objectContaining({
          entityId: result.layoutId,
          resourceType: 'chunk_layout',
          draftRevisionId: result.revisionId,
          latestVersionNumber: 1,
        }),
      ]);
      expect(harness.state.events).toHaveLength(1);
      expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(harness.lookupOperations).toEqual([
        {
          entity: 'access',
          where: { userId: ACTOR.userId, siteId: SITE_ID },
          lock: { mode: 'pessimistic_read' },
        },
        {
          entity: 'site',
          where: { id: SITE_ID },
          lock: { mode: 'pessimistic_write' },
        },
        {
          entity: 'page',
          where: { id: PAGE_ID, siteId: SITE_ID },
          lock: { mode: 'pessimistic_write' },
        },
        {
          entity: 'layout',
          where: {
            siteId: SITE_ID,
            scopeKind: 'page',
            pageId: PAGE_ID,
          },
          lock: { mode: 'pessimistic_write' },
        },
        {
          entity: 'resource',
          where: {
            siteId: SITE_ID,
            resourceType: 'chunk_layout',
            entityId: result.layoutId,
          },
          lock: { mode: 'pessimistic_write' },
        },
        {
          entity: 'instance',
          where: { id: HERO_INSTANCE_ID, siteId: SITE_ID },
          lock: { mode: 'pessimistic_read' },
        },
        {
          entity: 'instance',
          where: { id: PROMO_INSTANCE_ID, siteId: SITE_ID },
          lock: { mode: 'pessimistic_read' },
        },
        {
          entity: 'resource',
          where: {
            id: harness.state.resources[0].id,
            siteId: SITE_ID,
            resourceType: 'chunk_layout',
            entityId: result.layoutId,
          },
          lock: null,
        },
        {
          entity: 'layout',
          where: {
            id: result.layoutId,
            siteId: SITE_ID,
            revisionResourceId: harness.state.resources[0].id,
          },
          lock: null,
        },
        {
          entity: 'placements',
          where: { layoutRevisionId: result.revisionId },
          lock: null,
        },
      ]);
    });

    it('reuses the stable page target identity and treats an empty array as a complete empty revision', async () => {
      const harness = createLayoutHarness();
      const first = await savePageLayout(harness.repository);
      const second = await savePageLayout(harness.repository, {
        expectedDraftRevisionId: first.revisionId,
        placements: [],
      });

      expect(second).toEqual({
        layoutId: first.layoutId,
        revisionId: harness.state.revisions[1].id,
        versionNumber: 2,
      });
      expect(harness.state.layouts).toHaveLength(1);
      expect(harness.state.resources).toHaveLength(1);
      expect(harness.state.revisions).toHaveLength(2);
      expect(
        harness.state.placements.filter(
          (row) => row.layoutRevisionId === second.revisionId,
        ),
      ).toEqual([]);
      expect(harness.state.placements).toHaveLength(1);
    });

    it('reuses one stable site-surface identity across revisions', async () => {
      const harness = createLayoutHarness();
      const first = await harness.repository.saveLayoutDraft({
        siteId: SITE_ID,
        target: { kind: 'site_surface', surfaceKey: 'header' },
        templateKey: 'skinova-header',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements: [],
        actor: ACTOR,
      });
      const second = await harness.repository.saveLayoutDraft({
        siteId: SITE_ID,
        target: { kind: 'site_surface', surfaceKey: 'header' },
        templateKey: 'skinova-header',
        templateVersion: '2',
        expectedDraftRevisionId: first.revisionId,
        placements: [],
        actor: ACTOR,
      });

      expect(second.layoutId).toBe(first.layoutId);
      expect(second.versionNumber).toBe(2);
      expect(harness.state.layouts).toEqual([
        expect.objectContaining({
          scopeKind: 'site_surface',
          pageId: null,
          surfaceKey: 'header',
        }),
      ]);
      expect(
        harness.lookupOperations.filter(
          (operation) => operation.entity === 'page',
        ),
      ).toEqual([]);
    });

    it.each([
      [
        'duplicate slot positions',
        [
          {
            slotKey: 'hero',
            position: 0,
            instanceId: HERO_INSTANCE_ID,
          },
          {
            slotKey: 'hero',
            position: 0,
            instanceId: PROMO_INSTANCE_ID,
          },
        ],
      ],
      [
        'negative positions',
        [
          {
            slotKey: 'hero',
            position: -1,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
      ],
      [
        'non-integer positions',
        [
          {
            slotKey: 'hero',
            position: 0.5,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
      ],
      [
        'PostgreSQL int32 overflow positions',
        [
          {
            slotKey: 'hero',
            position: 2_147_483_648,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
      ],
      [
        'unsafe integer positions',
        [
          {
            slotKey: 'hero',
            position: Number.MAX_SAFE_INTEGER + 1,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
      ],
    ])('rejects %s before opening a transaction', async (_case, placements) => {
      const harness = createLayoutHarness();

      await expect(
        savePageLayout(harness.repository, { placements }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(harness.dataSource.transaction).not.toHaveBeenCalled();
      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });

    it('accepts the PostgreSQL int32 maximum position', async () => {
      const harness = createLayoutHarness();

      await savePageLayout(harness.repository, {
        placements: [
          {
            slotKey: 'hero',
            position: 2_147_483_647,
            instanceId: HERO_INSTANCE_ID,
          },
        ],
      });

      expect(harness.state.placements).toEqual([
        expect.objectContaining({ position: 2_147_483_647 }),
      ]);
    });

    it.each([
      ['an unknown page', []],
      [
        'a page owned by another site',
        [
          {
            id: PAGE_ID,
            siteId: '99999999-9999-4999-8999-999999999999',
          },
        ],
      ],
    ])('uses the same safe not-found for %s', async (_case, pages) => {
      const harness = createLayoutHarness({ pages });

      await expect(savePageLayout(harness.repository)).rejects.toEqual(
        new NotFoundException('Цель раскладки не найдена'),
      );

      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });

    it.each([
      ['an unknown instance', []],
      [
        'an instance owned by another site',
        [
          {
            id: HERO_INSTANCE_ID,
            siteId: '99999999-9999-4999-8999-999999999999',
          },
        ],
      ],
    ])('uses the same safe not-found for %s', async (_case, instances) => {
      const harness = createLayoutHarness({ instances });

      await expect(savePageLayout(harness.repository)).rejects.toEqual(
        new NotFoundException('Экземпляр чанка не найден'),
      );

      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });

    it('rolls back a new identity and every revision row for a stale expected pointer', async () => {
      const harness = createLayoutHarness();

      await expect(
        savePageLayout(harness.repository, {
          expectedDraftRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });

    it.each(['layout', 'placement'] as const)(
      'rolls back every row when the %s hook save fails',
      async (failOnSave) => {
        const harness = createLayoutHarness({ failOnSave });

        await expect(savePageLayout(harness.repository)).rejects.toThrow(
          failOnSave + '-save-failed',
        );

        expect(harness.state).toEqual({
          resources: [],
          revisions: [],
          layouts: [],
          placements: [],
          events: [],
        });
      },
    );

    it.each([
      [
        'missing layout owner',
        (state: LayoutState) => {
          state.layouts = [];
        },
      ],
      [
        'wrong layout owner resource',
        (state: LayoutState) => {
          state.layouts[0].revisionResourceId = 'wrong-resource';
        },
      ],
      [
        'missing placement',
        (state: LayoutState) => {
          state.placements = [];
        },
      ],
      [
        'extra placement',
        (state: LayoutState) => {
          state.placements.push({
            ...state.placements[0],
            id: 'extra-placement',
            slotKey: 'extra',
            position: 1,
          });
        },
      ],
      [
        'changed placement',
        (state: LayoutState) => {
          state.placements[0].slotKey = 'changed';
        },
      ],
    ] as const)(
      'fails closed after the hook leaves a %s and rolls back the layout draft',
      async (_, corrupt) => {
        const harness = createLayoutHarness({
          corruptAfterTypedSave: (state, kind) => {
            if (kind === 'placement') corrupt(state);
          },
        });

        const saving = savePageLayout(harness.repository);
        await expect(saving).rejects.toEqual(
          new ConflictException(
            'Состояние управляемого черновика не подтверждено',
          ),
        );
        await expect(saving).rejects.not.toThrow(DATABASE_UUID_PATTERN);
        expect(harness.saveAttempts).toEqual([
          'resource',
          'revision',
          'layout',
          'placement',
        ]);
        expect(harness.state).toEqual({
          resources: [],
          revisions: [],
          layouts: [],
          placements: [],
          events: [],
        });
      },
    );

    it('captures target and placement inputs before the first await', async () => {
      const transactionGate = deferred();
      const harness = createLayoutHarness({
        beforeTransaction: () => transactionGate.promise,
      });
      const target = { kind: 'page' as const, pageId: PAGE_ID };
      const placements = [
        {
          slotKey: 'hero',
          position: 0,
          instanceId: HERO_INSTANCE_ID,
        },
      ];

      const saving = harness.repository.saveLayoutDraft({
        siteId: SITE_ID,
        target,
        templateKey: 'skinova-home',
        templateVersion: '1',
        expectedDraftRevisionId: null,
        placements,
        actor: ACTOR,
      });
      target.pageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      placements[0].slotKey = 'mutated';
      placements.push({
        slotKey: 'late',
        position: 1,
        instanceId: HERO_INSTANCE_ID,
      });
      transactionGate.release();
      await saving;

      expect(harness.state.layouts[0]).toEqual(
        expect.objectContaining({ pageId: PAGE_ID }),
      );
      expect(harness.state.placements).toEqual([
        expect.objectContaining({ slotKey: 'hero', position: 0 }),
      ]);
    });

    it('denies access without committing layout workflow rows', async () => {
      const harness = createLayoutHarness({ denyAccess: true });

      await expect(savePageLayout(harness.repository)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(harness.lookupOperations).toEqual([
        {
          entity: 'access',
          where: { userId: ACTOR.userId, siteId: SITE_ID },
          lock: { mode: 'pessimistic_read' },
        },
        {
          entity: 'access',
          where: { userId: ACTOR.userId, siteId: SITE_ID },
          lock: { mode: 'pessimistic_read' },
        },
      ]);
      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });

    it('returns safe not-found for an admin and missing site before any revision save', async () => {
      const harness = createLayoutHarness({ siteExists: false });

      await expect(
        harness.repository.saveLayoutDraft({
          siteId: SITE_ID,
          target: { kind: 'page', pageId: PAGE_ID },
          templateKey: 'skinova-home',
          templateVersion: '1',
          expectedDraftRevisionId: null,
          placements: [],
          actor: ADMIN_ACTOR,
        }),
      ).rejects.toEqual(new NotFoundException('Сайт не найден'));

      expect(harness.lookupOperations).toEqual([
        {
          entity: 'site',
          where: { id: SITE_ID },
          lock: { mode: 'pessimistic_write' },
        },
      ]);
      expect(harness.saveAttempts).toEqual([]);
      expect(harness.state).toEqual({
        resources: [],
        revisions: [],
        layouts: [],
        placements: [],
        events: [],
      });
    });
    it('does not expose a partial placement write API', () => {
      const harness = createLayoutHarness();

      expect(
        (harness.repository as unknown as { savePlacement?: unknown })
          .savePlacement,
      ).toBeUndefined();
    });
  });
});

type ManagedLifecycleState = {
  resources: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  instances: Record<string, unknown>[];
  links: Record<string, unknown>[];
  layouts: Record<string, unknown>[];
  placements: Record<string, unknown>[];
  events: Record<string, unknown>[];
};

const OTHER_SITE_ID = '99999999-9999-4999-8999-999999999999';
const INSTANCE_ID = '10101010-1010-4010-8010-101010101010';
const OTHER_INSTANCE_ID = '20202020-2020-4020-8020-202020202020';
const INSTANCE_RESOURCE_ID = '30303030-3030-4030-8030-303030303030';
const OTHER_INSTANCE_RESOURCE_ID = '40404040-4040-4040-8040-404040404040';
const INSTANCE_REVISION_ID = '50505050-5050-4050-8050-505050505050';
const OTHER_INSTANCE_REVISION_ID = '60606060-6060-4060-8060-606060606060';
const LAYOUT_ID = '70707070-7070-4070-8070-707070707070';
const EMPTY_LAYOUT_ID = '80808080-8080-4080-8080-808080808080';
const LAYOUT_RESOURCE_ID = '90909090-9090-4090-8090-909090909090';
const EMPTY_LAYOUT_RESOURCE_ID = 'abababab-abab-4bab-8bab-abababababab';
const LAYOUT_REVISION_ID = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
const EMPTY_LAYOUT_REVISION_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

function initialManagedLifecycleState(): ManagedLifecycleState {
  return {
    resources: [
      {
        id: INSTANCE_RESOURCE_ID,
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: INSTANCE_ID,
        latestVersionNumber: 1,
        draftRevisionId: INSTANCE_REVISION_ID,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      },
      {
        id: OTHER_INSTANCE_RESOURCE_ID,
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: OTHER_INSTANCE_ID,
        latestVersionNumber: 1,
        draftRevisionId: OTHER_INSTANCE_REVISION_ID,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      },
      {
        id: LAYOUT_RESOURCE_ID,
        siteId: SITE_ID,
        resourceType: 'chunk_layout',
        entityId: LAYOUT_ID,
        latestVersionNumber: 1,
        draftRevisionId: LAYOUT_REVISION_ID,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      },
      {
        id: EMPTY_LAYOUT_RESOURCE_ID,
        siteId: SITE_ID,
        resourceType: 'chunk_layout',
        entityId: EMPTY_LAYOUT_ID,
        latestVersionNumber: 1,
        draftRevisionId: EMPTY_LAYOUT_REVISION_ID,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      },
    ],
    revisions: [
      {
        id: INSTANCE_REVISION_ID,
        resourceId: INSTANCE_RESOURCE_ID,
        versionNumber: 1,
        snapshot: {
          formatVersion: 1,
          data: { headline: 'Historic' },
          sanitizerPolicyVersion: null,
        },
        actorUserId: ACTOR.userId,
      },
      {
        id: OTHER_INSTANCE_REVISION_ID,
        resourceId: OTHER_INSTANCE_RESOURCE_ID,
        versionNumber: 1,
        snapshot: {
          formatVersion: 1,
          data: { headline: 'Other' },
          sanitizerPolicyVersion: null,
        },
        actorUserId: ACTOR.userId,
      },
      {
        id: LAYOUT_REVISION_ID,
        resourceId: LAYOUT_RESOURCE_ID,
        versionNumber: 1,
        snapshot: {
          formatVersion: 1,
          templateKey: 'skinova-home',
          templateVersion: '1',
        },
        actorUserId: ACTOR.userId,
      },
      {
        id: EMPTY_LAYOUT_REVISION_ID,
        resourceId: EMPTY_LAYOUT_RESOURCE_ID,
        versionNumber: 1,
        snapshot: {
          formatVersion: 1,
          templateKey: 'skinova-empty',
          templateVersion: '1',
        },
        actorUserId: ACTOR.userId,
      },
    ],
    instances: [
      {
        id: INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: INSTANCE_RESOURCE_ID,
        displayName: 'Hero',
        isArchived: false,
      },
      {
        id: OTHER_INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: OTHER_INSTANCE_RESOURCE_ID,
        displayName: 'Promo',
      },
    ],
    links: [
      {
        revisionId: INSTANCE_REVISION_ID,
        revisionResourceId: INSTANCE_RESOURCE_ID,
        siteId: SITE_ID,
        instanceId: INSTANCE_ID,
        contractId: CONTRACT_ID,
      },
      {
        revisionId: OTHER_INSTANCE_REVISION_ID,
        revisionResourceId: OTHER_INSTANCE_RESOURCE_ID,
        siteId: SITE_ID,
        instanceId: OTHER_INSTANCE_ID,
        contractId: CONTRACT_ID,
      },
    ],
    layouts: [
      {
        id: LAYOUT_ID,
        siteId: SITE_ID,
        revisionResourceId: LAYOUT_RESOURCE_ID,
        scopeKind: 'page',
        pageId: PAGE_ID,
        surfaceKey: null,
      },
      {
        id: EMPTY_LAYOUT_ID,
        siteId: SITE_ID,
        revisionResourceId: EMPTY_LAYOUT_RESOURCE_ID,
        scopeKind: 'site_surface',
        pageId: null,
        surfaceKey: 'footer',
      },
    ],
    placements: [
      {
        id: 'dededede-dede-4ede-8ede-dededededede',
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        layoutRevisionResourceId: LAYOUT_RESOURCE_ID,
        layoutRevisionId: LAYOUT_REVISION_ID,
        instanceId: INSTANCE_ID,
        slotKey: 'hero',
        position: 0,
      },
    ],
    events: [],
  };
}

function createManagedLifecycleHarness(options?: {
  requiresApproval?: boolean;
}) {
  let committed = initialManagedLifecycleState();
  let failOnSave: null | 'link' | 'placement' = null;
  const operations: Array<{
    operation: 'findOne' | 'find' | 'save';
    entity: string;
    lock: string | null;
  }> = [];
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) => Object.entries(where).every(([key, value]) => row[key] === value);
  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        const working = structuredClone(committed);
        const manager = {
          findOne: jest.fn(
            (
              entity: unknown,
              query: {
                where: Record<string, unknown>;
                lock?: { mode: string };
              },
            ) => {
              const [label, rows] =
                entity === SiteEntity
                  ? ['site', null]
                  : entity === SiteAccessEntity
                    ? ['access', null]
                    : entity === ManagedChunkInstanceEntity
                      ? ['instance', working.instances]
                      : entity === ManagedChunkLayoutEntity
                        ? ['layout', working.layouts]
                        : entity === CmsRevisionResourceEntity
                          ? ['resource', working.resources]
                          : entity === CmsRevisionEntity
                            ? ['revision', working.revisions]
                            : entity === ManagedChunkInstanceRevisionEntity
                              ? ['link', working.links]
                              : ['unknown', null];
              operations.push({
                operation: 'findOne',
                entity: label,
                lock: query.lock?.mode ?? null,
              });
              if (entity === SiteEntity) {
                return Promise.resolve(
                  [SITE_ID, OTHER_SITE_ID].includes(String(query.where.id))
                    ? { id: query.where.id, templatePackageId: PACKAGE_ID }
                    : null,
                );
              }
              if (entity === SiteAccessEntity) {
                return Promise.resolve(
                  query.where.userId === ACTOR.userId
                    ? options?.requiresApproval
                      ? {
                          role: SiteRole.CONTENT_MANAGER,
                          requiresApproval: true,
                        }
                      : { role: SiteRole.OWNER, requiresApproval: false }
                    : null,
                );
              }
              if (!rows) throw new Error('Unexpected lifecycle lookup');
              const found = rows.find((row) => matches(row, query.where));
              if (!found) return Promise.resolve(null);
              if (entity === CmsRevisionResourceEntity)
                return Promise.resolve(
                  Object.assign(
                    new CmsRevisionResourceEntity(),
                    structuredClone(found),
                  ),
                );
              if (entity === CmsRevisionEntity)
                return Promise.resolve(
                  Object.assign(
                    new CmsRevisionEntity(),
                    structuredClone(found),
                  ),
                );
              return Promise.resolve(structuredClone(found));
            },
          ),
          find: jest.fn(
            (entity: unknown, query: { where: Record<string, unknown> }) => {
              if (entity !== ManagedChunkPlacementEntity)
                throw new Error('Unexpected lifecycle collection lookup');
              operations.push({
                operation: 'find',
                entity: 'placements',
                lock: null,
              });
              return Promise.resolve(
                working.placements
                  .filter((row) => matches(row, query.where))
                  .map((row) => structuredClone(row)),
              );
            },
          ),
          save: jest.fn((value: object | object[]) => {
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
              const kind =
                item instanceof CmsRevisionResourceEntity
                  ? 'resource'
                  : item instanceof CmsRevisionEntity
                    ? 'revision'
                    : item instanceof ManagedChunkInstanceRevisionEntity
                      ? 'link'
                      : item instanceof ManagedChunkPlacementEntity
                        ? 'placement'
                        : item instanceof CmsRevisionEventEntity
                          ? 'event'
                          : 'unknown';
              operations.push({
                operation: 'save',
                entity: kind,
                lock: null,
              });
              if (failOnSave === kind) throw new Error(`${kind}-copy-failed`);
              const rows =
                kind === 'resource'
                  ? working.resources
                  : kind === 'revision'
                    ? working.revisions
                    : kind === 'link'
                      ? working.links
                      : kind === 'placement'
                        ? working.placements
                        : kind === 'event'
                          ? working.events
                          : null;
              if (!rows) throw new Error('Unexpected lifecycle save');
              const row = structuredClone(item as Record<string, unknown>);
              const identity = kind === 'link' ? 'revisionId' : 'id';
              const index = rows.findIndex(
                (existing) => existing[identity] === row[identity],
              );
              if (index >= 0) rows[index] = row;
              else rows.push(row);
            }
            return Promise.resolve(value);
          }),
        } as unknown as EntityManager;
        const result = await callback(manager);
        committed = working;
        return result;
      },
    ),
  };
  const revisions = new CmsRevisionsService(
    dataSource as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Lifecycle site lookup escaped transaction');
      }),
    } as never,
    {
      findOne: jest.fn(() => {
        throw new Error('Lifecycle access lookup escaped transaction');
      }),
    } as never,
  );
  return {
    repository: new ManagedChunkPersistenceRepository(
      dataSource as never,
      revisions,
    ),
    operations,
    get state() {
      return committed;
    },
    snapshot() {
      return structuredClone(committed);
    },
    failNext(kind: 'link' | 'placement') {
      failOnSave = kind;
    },
  };
}

describe('ManagedChunkPersistenceRepository typed lifecycle', () => {
  it('saves an immutable instance draft with the current typed contract and preserves published pointer', async () => {
    const harness = createManagedLifecycleHarness();
    const resource = harness.state.resources.find(
      (row) => row.id === INSTANCE_RESOURCE_ID,
    )!;
    resource.publishedRevisionId = INSTANCE_REVISION_ID;
    const data = { headline: 'Next' };

    const saved = await harness.repository.saveInstanceDraft({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      data,
      expectedDraftRevisionId: INSTANCE_REVISION_ID,
      actor: ACTOR,
    });

    expect(resource.publishedRevisionId).toBe(INSTANCE_REVISION_ID);
    expect(
      harness.state.revisions.find((row) => row.id === saved.revisionId)
        ?.snapshot,
    ).toEqual({
      formatVersion: 1,
      data,
      sanitizerPolicyVersion: null,
    });
    expect(
      harness.state.links.find((row) => row.revisionId === saved.revisionId)
        ?.contractId,
    ).toBe(CONTRACT_ID);
    data.headline = 'Mutated';
    expect(
      (
        harness.state.revisions.find((row) => row.id === saved.revisionId)
          ?.snapshot as any
      ).data.headline,
    ).toBe('Next');
  });

  it('rejects a stale instance draft without partial rows', async () => {
    const harness = createManagedLifecycleHarness();
    const first = await harness.repository.saveInstanceDraft({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      data: { headline: 'First' },
      expectedDraftRevisionId: INSTANCE_REVISION_ID,
      actor: ACTOR,
    });
    const before = harness.snapshot();
    await expect(
      harness.repository.saveInstanceDraft({
        siteId: SITE_ID,
        instanceId: INSTANCE_ID,
        data: { headline: 'Stale' },
        expectedDraftRevisionId: INSTANCE_REVISION_ID,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(harness.state).toEqual(before);
    expect(first.revisionId).toBe(before.resources[0].draftRevisionId);
  });

  it('submits and requests changes only through the verified instance link', async () => {
    const harness = createManagedLifecycleHarness();
    await harness.repository.submitInstanceRevision({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      revisionId: INSTANCE_REVISION_ID,
      actor: ACTOR,
    });
    expect(harness.state.resources[0].reviewState).toBe('in_review');
    await harness.repository.requestInstanceRevisionChanges({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      revisionId: INSTANCE_REVISION_ID,
      actor: ADMIN_ACTOR,
      reason: 'Fix',
    });
    expect(harness.state.resources[0].reviewState).toBe('changes_requested');
    expect(harness.state.events.map((event) => event.eventType)).toEqual([
      'submitted',
      'changes_requested',
    ]);
  });

  it('blocks direct managed publish when the content-manager grant requires approval', async () => {
    const harness = createManagedLifecycleHarness({ requiresApproval: true });
    const before = harness.snapshot();
    await expect(
      harness.repository.publishInstanceRevision({
        siteId: SITE_ID,
        instanceId: INSTANCE_ID,
        revisionId: INSTANCE_REVISION_ID,
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.state).toEqual(before);
  });
  it.each(['approve', 'publish'] as const)(
    'blocks instance %s when the exact typed contract link is missing',
    async (operation) => {
      const harness = createManagedLifecycleHarness();
      harness.state.links.splice(0, 1);
      const resource = harness.state.resources.find(
        (row) => row.id === INSTANCE_RESOURCE_ID,
      )!;
      if (operation === 'approve') resource.reviewState = 'in_review';
      const before = harness.snapshot();
      const call =
        operation === 'approve'
          ? harness.repository.approveInstanceRevision({
              siteId: SITE_ID,
              instanceId: INSTANCE_ID,
              revisionId: INSTANCE_REVISION_ID,
              actor: ADMIN_ACTOR,
            })
          : harness.repository.publishInstanceRevision({
              siteId: SITE_ID,
              instanceId: INSTANCE_ID,
              revisionId: INSTANCE_REVISION_ID,
              actor: ADMIN_ACTOR,
            });

      await expect(call).rejects.toBeInstanceOf(NotFoundException);
      expect(harness.state).toEqual(before);
    },
  );

  it('restores an instance into a new immutable revision with an exact copied contract link', async () => {
    const harness = createManagedLifecycleHarness();

    const restored = await harness.repository.restoreInstanceRevision({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      sourceRevisionId: INSTANCE_REVISION_ID,
      expectedDraftRevisionId: INSTANCE_REVISION_ID,
      actor: ACTOR,
    });

    expect(restored.id).not.toBe(INSTANCE_REVISION_ID);
    expect(restored.versionNumber).toBe(2);
    const resource = harness.state.resources.find(
      (row) => row.id === INSTANCE_RESOURCE_ID,
    );
    expect(resource).toMatchObject({
      draftRevisionId: restored.id,
      latestVersionNumber: 2,
      approvedRevisionId: null,
      publishedRevisionId: null,
    });
    expect(
      harness.state.links.find((row) => row.revisionId === restored.id),
    ).toEqual({
      revisionId: restored.id,
      revisionResourceId: INSTANCE_RESOURCE_ID,
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      contractId: CONTRACT_ID,
    });
    expect(
      harness.state.links.find(
        (row) => row.revisionId === INSTANCE_REVISION_ID,
      ),
    ).toBeDefined();
    const source = harness.state.revisions.find(
      (row) => row.id === INSTANCE_REVISION_ID,
    )!;
    const copy = harness.state.revisions.find((row) => row.id === restored.id)!;
    (source.snapshot as { data: { headline: string } }).data.headline =
      'Mutated';
    expect(copy.snapshot).toEqual({
      formatVersion: 1,
      data: { headline: 'Historic' },
      sanitizerPolicyVersion: null,
    });
    expect(harness.operations.slice(0, 6)).toEqual([
      { operation: 'findOne', entity: 'access', lock: 'pessimistic_read' },
      { operation: 'findOne', entity: 'site', lock: 'pessimistic_read' },
      { operation: 'findOne', entity: 'instance', lock: 'pessimistic_read' },
      { operation: 'findOne', entity: 'resource', lock: 'pessimistic_write' },
      { operation: 'findOne', entity: 'revision', lock: 'pessimistic_read' },
      { operation: 'findOne', entity: 'link', lock: 'pessimistic_read' },
    ]);
  });

  it('rolls back every instance restore write when typed copy fails', async () => {
    const harness = createManagedLifecycleHarness();
    const before = harness.snapshot();
    harness.failNext('link');

    await expect(
      harness.repository.restoreInstanceRevision({
        siteId: SITE_ID,
        instanceId: INSTANCE_ID,
        sourceRevisionId: INSTANCE_REVISION_ID,
        expectedDraftRevisionId: INSTANCE_REVISION_ID,
        actor: ACTOR,
      }),
    ).rejects.toThrow('link-copy-failed');

    expect(harness.state).toEqual(before);
  });

  it.each([
    ['unknown', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
    ['cross-resource', OTHER_INSTANCE_REVISION_ID],
  ])(
    'returns safe not-found for an %s instance revision',
    async (_, revisionId) => {
      const harness = createManagedLifecycleHarness();
      const before = harness.snapshot();

      await expect(
        harness.repository.publishInstanceRevision({
          siteId: SITE_ID,
          instanceId: INSTANCE_ID,
          revisionId,
          actor: ADMIN_ACTOR,
        }),
      ).rejects.toEqual(
        new NotFoundException('Версия управляемого ресурса не найдена'),
      );
      expect(harness.state).toEqual(before);
    },
  );

  it('returns the same safe not-found for a cross-site instance substitution', async () => {
    const harness = createManagedLifecycleHarness();
    const before = harness.snapshot();

    await expect(
      harness.repository.publishInstanceRevision({
        siteId: OTHER_SITE_ID,
        instanceId: INSTANCE_ID,
        revisionId: INSTANCE_REVISION_ID,
        actor: ADMIN_ACTOR,
      }),
    ).rejects.toEqual(
      new NotFoundException('Версия управляемого ресурса не найдена'),
    );
    expect(harness.state).toEqual(before);
  });

  it.each(['approve', 'publish'] as const)(
    'blocks layout %s when a placement row does not belong to the exact layout identity',
    async (operation) => {
      const harness = createManagedLifecycleHarness();
      harness.state.placements[0].layoutId = EMPTY_LAYOUT_ID;
      const resource = harness.state.resources.find(
        (row) => row.id === LAYOUT_RESOURCE_ID,
      )!;
      if (operation === 'approve') resource.reviewState = 'in_review';
      const before = harness.snapshot();
      const call =
        operation === 'approve'
          ? harness.repository.approveLayoutRevision({
              siteId: SITE_ID,
              layoutId: LAYOUT_ID,
              revisionId: LAYOUT_REVISION_ID,
              actor: ADMIN_ACTOR,
            })
          : harness.repository.publishLayoutRevision({
              siteId: SITE_ID,
              layoutId: LAYOUT_ID,
              revisionId: LAYOUT_REVISION_ID,
              actor: ADMIN_ACTOR,
            });

      await expect(call).rejects.toBeInstanceOf(NotFoundException);
      expect(harness.state).toEqual(before);
    },
  );

  it('blocks layout publication when typed ownership is not exact', async () => {
    const harness = createManagedLifecycleHarness();
    harness.state.layouts[0].revisionResourceId = EMPTY_LAYOUT_RESOURCE_ID;
    const before = harness.snapshot();

    await expect(
      harness.repository.publishLayoutRevision({
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        revisionId: LAYOUT_REVISION_ID,
        actor: ADMIN_ACTOR,
      }),
    ).rejects.toEqual(
      new NotFoundException('Версия управляемого ресурса не найдена'),
    );
    expect(harness.state).toEqual(before);
  });

  it('restores the complete layout placement set into a new immutable revision', async () => {
    const harness = createManagedLifecycleHarness();

    const restored = await harness.repository.restoreLayoutRevision({
      siteId: SITE_ID,
      layoutId: LAYOUT_ID,
      sourceRevisionId: LAYOUT_REVISION_ID,
      expectedDraftRevisionId: LAYOUT_REVISION_ID,
      actor: ACTOR,
    });

    expect(restored.id).not.toBe(LAYOUT_REVISION_ID);
    expect(restored.versionNumber).toBe(2);
    expect(
      harness.state.placements.filter(
        (row) => row.layoutRevisionId === LAYOUT_REVISION_ID,
      ),
    ).toHaveLength(1);
    expect(
      harness.state.placements.filter(
        (row) => row.layoutRevisionId === restored.id,
      ),
    ).toEqual([
      expect.objectContaining({
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        layoutRevisionResourceId: LAYOUT_RESOURCE_ID,
        instanceId: INSTANCE_ID,
        slotKey: 'hero',
        position: 0,
      }),
    ]);
    expect(harness.state.events).toContainEqual(
      expect.objectContaining({
        revisionId: restored.id,
        eventType: 'version_restored',
        reason: `restored from ${LAYOUT_REVISION_ID}`,
      }),
    );
  });

  it('restores a valid complete empty layout as another empty revision', async () => {
    const harness = createManagedLifecycleHarness();

    const restored = await harness.repository.restoreLayoutRevision({
      siteId: SITE_ID,
      layoutId: EMPTY_LAYOUT_ID,
      sourceRevisionId: EMPTY_LAYOUT_REVISION_ID,
      expectedDraftRevisionId: EMPTY_LAYOUT_REVISION_ID,
      actor: ACTOR,
    });

    expect(restored.versionNumber).toBe(2);
    expect(
      harness.state.placements.filter(
        (row) => row.layoutRevisionId === restored.id,
      ),
    ).toEqual([]);
    expect(
      harness.state.resources.find(
        (row) => row.id === EMPTY_LAYOUT_RESOURCE_ID,
      ),
    ).toMatchObject({ draftRevisionId: restored.id });
  });

  it('rolls back every layout restore write when placement copy fails', async () => {
    const harness = createManagedLifecycleHarness();
    const before = harness.snapshot();
    harness.failNext('placement');

    await expect(
      harness.repository.restoreLayoutRevision({
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        sourceRevisionId: LAYOUT_REVISION_ID,
        expectedDraftRevisionId: LAYOUT_REVISION_ID,
        actor: ACTOR,
      }),
    ).rejects.toThrow('placement-copy-failed');

    expect(harness.state).toEqual(before);
  });
});
describe('ManagedChunkPersistenceRepository typed lifecycle success paths', () => {
  it('approves an instance only after its exact typed link precondition', async () => {
    const harness = createManagedLifecycleHarness();
    const resource = harness.state.resources.find(
      (row) => row.id === INSTANCE_RESOURCE_ID,
    )!;
    resource.reviewState = 'in_review';

    await harness.repository.approveInstanceRevision({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      revisionId: INSTANCE_REVISION_ID,
      actor: ADMIN_ACTOR,
    });

    expect(
      harness.state.resources.find((row) => row.id === INSTANCE_RESOURCE_ID),
    ).toMatchObject({
      approvedRevisionId: INSTANCE_REVISION_ID,
      reviewState: 'approved',
    });
    expect(harness.state.events).toContainEqual(
      expect.objectContaining({
        revisionId: INSTANCE_REVISION_ID,
        eventType: 'approved',
      }),
    );
  });

  it('publishes an instance only after its exact typed link precondition', async () => {
    const harness = createManagedLifecycleHarness();

    await harness.repository.publishInstanceRevision({
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      revisionId: INSTANCE_REVISION_ID,
      actor: ADMIN_ACTOR,
    });

    expect(
      harness.state.resources.find((row) => row.id === INSTANCE_RESOURCE_ID),
    ).toMatchObject({
      approvedRevisionId: INSTANCE_REVISION_ID,
      publishedRevisionId: INSTANCE_REVISION_ID,
      reviewState: 'approved',
    });
    expect(harness.state.events).toContainEqual(
      expect.objectContaining({
        revisionId: INSTANCE_REVISION_ID,
        eventType: 'published',
      }),
    );
  });

  it('accepts a complete empty layout for approve and publish', async () => {
    const harness = createManagedLifecycleHarness();
    const resource = harness.state.resources.find(
      (row) => row.id === EMPTY_LAYOUT_RESOURCE_ID,
    )!;
    resource.reviewState = 'in_review';

    await harness.repository.approveLayoutRevision({
      siteId: SITE_ID,
      layoutId: EMPTY_LAYOUT_ID,
      revisionId: EMPTY_LAYOUT_REVISION_ID,
      actor: ADMIN_ACTOR,
    });
    await harness.repository.publishLayoutRevision({
      siteId: SITE_ID,
      layoutId: EMPTY_LAYOUT_ID,
      revisionId: EMPTY_LAYOUT_REVISION_ID,
      actor: ADMIN_ACTOR,
    });

    expect(
      harness.state.resources.find(
        (row) => row.id === EMPTY_LAYOUT_RESOURCE_ID,
      ),
    ).toMatchObject({
      approvedRevisionId: EMPTY_LAYOUT_REVISION_ID,
      publishedRevisionId: EMPTY_LAYOUT_REVISION_ID,
      reviewState: 'approved',
    });
    expect(
      harness.state.placements.filter(
        (row) => row.layoutRevisionId === EMPTY_LAYOUT_REVISION_ID,
      ),
    ).toEqual([]);
  });

  it('blocks a layout whose complete placement set references a missing site instance', async () => {
    const harness = createManagedLifecycleHarness();
    harness.state.instances.splice(
      harness.state.instances.findIndex((row) => row.id === INSTANCE_ID),
      1,
    );
    const before = harness.snapshot();

    await expect(
      harness.repository.publishLayoutRevision({
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        revisionId: LAYOUT_REVISION_ID,
        actor: ADMIN_ACTOR,
      }),
    ).rejects.toEqual(
      new NotFoundException('Версия управляемого ресурса не найдена'),
    );
    expect(harness.state).toEqual(before);
  });

  it('blocks cross-resource layout revision substitution without leaking ownership', async () => {
    const harness = createManagedLifecycleHarness();
    const before = harness.snapshot();

    await expect(
      harness.repository.publishLayoutRevision({
        siteId: SITE_ID,
        layoutId: LAYOUT_ID,
        revisionId: EMPTY_LAYOUT_REVISION_ID,
        actor: ADMIN_ACTOR,
      }),
    ).rejects.toEqual(
      new NotFoundException('Версия управляемого ресурса не найдена'),
    );
    expect(harness.state).toEqual(before);
  });
});

describe('ManagedChunkPersistenceRepository single-transition lifecycle', () => {
  it.each([
    ['instance', 'approve'],
    ['instance', 'publish'],
    ['layout', 'approve'],
    ['layout', 'publish'],
  ] as const)(
    'rejects a duplicate managed %s %s without changing pointers or adding an event',
    async (resourceType, operation) => {
      const harness = createManagedLifecycleHarness();
      const isInstance = resourceType === 'instance';
      const resourceId = isInstance ? INSTANCE_RESOURCE_ID : LAYOUT_RESOURCE_ID;
      const revisionId = isInstance ? INSTANCE_REVISION_ID : LAYOUT_REVISION_ID;
      const resource = harness.state.resources.find(
        (row) => row.id === resourceId,
      )!;
      if (operation === 'approve') resource.reviewState = 'in_review';
      const invoke = () => {
        if (isInstance) {
          return operation === 'approve'
            ? harness.repository.approveInstanceRevision({
                siteId: SITE_ID,
                instanceId: INSTANCE_ID,
                revisionId,
                actor: ADMIN_ACTOR,
              })
            : harness.repository.publishInstanceRevision({
                siteId: SITE_ID,
                instanceId: INSTANCE_ID,
                revisionId,
                actor: ADMIN_ACTOR,
              });
        }
        return operation === 'approve'
          ? harness.repository.approveLayoutRevision({
              siteId: SITE_ID,
              layoutId: LAYOUT_ID,
              revisionId,
              actor: ADMIN_ACTOR,
            })
          : harness.repository.publishLayoutRevision({
              siteId: SITE_ID,
              layoutId: LAYOUT_ID,
              revisionId,
              actor: ADMIN_ACTOR,
            });
      };

      await invoke();
      const afterFirst = harness.snapshot();
      const eventType = operation === 'approve' ? 'approved' : 'published';
      expect(
        afterFirst.events.filter(
          (event) =>
            event.revisionId === revisionId && event.eventType === eventType,
        ),
      ).toHaveLength(1);

      await expect(invoke()).rejects.toBeInstanceOf(ConflictException);
      expect(harness.state).toEqual(afterFirst);
    },
  );
});
describe('ManagedChunkPersistenceRepository lifecycle lock contract', () => {
  it.each(['approve', 'publish', 'restore'] as const)(
    'uses Access→Site→instance→resource→revision→link locks for instance %s',
    async (operation) => {
      const harness = createManagedLifecycleHarness();
      const resource = harness.state.resources.find(
        (row) => row.id === INSTANCE_RESOURCE_ID,
      )!;
      if (operation === 'approve') resource.reviewState = 'in_review';

      if (operation === 'approve') {
        await harness.repository.approveInstanceRevision({
          siteId: SITE_ID,
          instanceId: INSTANCE_ID,
          revisionId: INSTANCE_REVISION_ID,
          actor: ACTOR,
        });
      } else if (operation === 'publish') {
        await harness.repository.publishInstanceRevision({
          siteId: SITE_ID,
          instanceId: INSTANCE_ID,
          revisionId: INSTANCE_REVISION_ID,
          actor: ACTOR,
        });
      } else {
        await harness.repository.restoreInstanceRevision({
          siteId: SITE_ID,
          instanceId: INSTANCE_ID,
          sourceRevisionId: INSTANCE_REVISION_ID,
          expectedDraftRevisionId: INSTANCE_REVISION_ID,
          actor: ACTOR,
        });
      }

      expect(harness.operations.slice(0, 11)).toEqual([
        { operation: 'findOne', entity: 'access', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'site', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'instance', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'resource', lock: 'pessimistic_write' },
        { operation: 'findOne', entity: 'revision', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'link', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'site', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'instance', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'resource', lock: 'pessimistic_write' },
        { operation: 'findOne', entity: 'revision', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'link', lock: 'pessimistic_read' },
      ]);
      if (operation === 'restore') {
        expect(harness.operations.slice(11)).toEqual([
          { operation: 'save', entity: 'revision', lock: null },
          { operation: 'save', entity: 'link', lock: null },
          {
            operation: 'findOne',
            entity: 'link',
            lock: 'pessimistic_read',
          },
          { operation: 'save', entity: 'resource', lock: null },
          { operation: 'save', entity: 'event', lock: null },
        ]);
      }
    },
  );

  it.each(['approve', 'publish', 'restore'] as const)(
    'uses Access→Site→layout→resource→revision→placements locks for layout %s',
    async (operation) => {
      const harness = createManagedLifecycleHarness();
      const resource = harness.state.resources.find(
        (row) => row.id === LAYOUT_RESOURCE_ID,
      )!;
      if (operation === 'approve') resource.reviewState = 'in_review';

      if (operation === 'approve') {
        await harness.repository.approveLayoutRevision({
          siteId: SITE_ID,
          layoutId: LAYOUT_ID,
          revisionId: LAYOUT_REVISION_ID,
          actor: ACTOR,
        });
      } else if (operation === 'publish') {
        await harness.repository.publishLayoutRevision({
          siteId: SITE_ID,
          layoutId: LAYOUT_ID,
          revisionId: LAYOUT_REVISION_ID,
          actor: ACTOR,
        });
      } else {
        await harness.repository.restoreLayoutRevision({
          siteId: SITE_ID,
          layoutId: LAYOUT_ID,
          sourceRevisionId: LAYOUT_REVISION_ID,
          expectedDraftRevisionId: LAYOUT_REVISION_ID,
          actor: ACTOR,
        });
      }

      expect(harness.operations.slice(0, 13)).toEqual([
        { operation: 'findOne', entity: 'access', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'site', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'layout', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'resource', lock: 'pessimistic_write' },
        { operation: 'findOne', entity: 'revision', lock: 'pessimistic_read' },
        { operation: 'find', entity: 'placements', lock: null },
        { operation: 'findOne', entity: 'instance', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'site', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'layout', lock: 'pessimistic_read' },
        { operation: 'findOne', entity: 'resource', lock: 'pessimistic_write' },
        { operation: 'findOne', entity: 'revision', lock: 'pessimistic_read' },
        { operation: 'find', entity: 'placements', lock: null },
        { operation: 'findOne', entity: 'instance', lock: 'pessimistic_read' },
      ]);
      if (operation === 'restore') {
        expect(harness.operations.slice(13)).toEqual([
          { operation: 'save', entity: 'revision', lock: null },
          { operation: 'save', entity: 'placement', lock: null },
          { operation: 'find', entity: 'placements', lock: null },
          {
            operation: 'findOne',
            entity: 'instance',
            lock: 'pessimistic_read',
          },
          { operation: 'save', entity: 'resource', lock: null },
          { operation: 'save', entity: 'event', lock: null },
        ]);
      }
    },
  );
});

type CompatibilityInventoryState = Record<
  | 'sites'
  | 'packages'
  | 'resources'
  | 'revisions'
  | 'contracts'
  | 'instances'
  | 'instanceLinks'
  | 'layouts'
  | 'placements',
  Array<Record<string, unknown>>
>;

const INVENTORY_PACKAGE_KEY = 'skinova-media';
const INVENTORY_OTHER_PACKAGE_ID = '12121212-1212-4212-8212-121212121212';
const INVENTORY_UNKNOWN_PACKAGE_ID = '23232323-2323-4323-8323-232323232323';
const INVENTORY_UNKNOWN_SITE_ID = '24242424-2424-4424-8424-242424242424';
const INSTANCE_PAYLOAD_SENTINEL = 'INSTANCE_PAYLOAD_MUST_NOT_MATERIALIZE';
const CONTRACT_PAYLOAD_SENTINEL = 'CONTRACT_JSONB_MUST_NOT_MATERIALIZE';
const INVENTORY_OTHER_SITE_ID = '13131313-1313-4313-8313-131313131313';
const INVENTORY_PAGE_ID = '14141414-1414-4414-8414-141414141414';
const SHARED_INSTANCE_ID = '15151515-1515-4515-8515-151515151515';
const SWITCHED_INSTANCE_ID = '16161616-1616-4616-8616-161616161616';
const PUBLISHED_ONLY_INSTANCE_ID = '17171717-1717-4717-8717-171717171717';
const DRAFT_ONLY_INSTANCE_ID = '22222222-aaaa-4222-8222-222222222222';
const INVENTORY_LAYOUT_ID = '18181818-1818-4818-8818-181818181818';
const INVENTORY_LAYOUT_RESOURCE_ID = '19191919-1919-4919-8919-191919191919';
const INVENTORY_LAYOUT_DRAFT_ID = '20202020-aaaa-4020-8020-202020202020';
const INVENTORY_LAYOUT_PUBLISHED_ID = '21212121-aaaa-4121-8121-212121212121';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_C = `sha256:${'c'.repeat(64)}`;

const DIGEST_D = 'sha256:' + 'd'.repeat(64);
const DIGEST_E = 'sha256:' + 'e'.repeat(64);

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compatibilityInventoryState(): CompatibilityInventoryState {
  return {
    sites: [
      { id: SITE_ID, templatePackageId: PACKAGE_ID },
      {
        id: INVENTORY_OTHER_SITE_ID,
        templatePackageId: INVENTORY_OTHER_PACKAGE_ID,
      },
    ],
    packages: [
      { id: PACKAGE_ID, packageId: INVENTORY_PACKAGE_KEY },
      { id: INVENTORY_OTHER_PACKAGE_ID, packageId: 'other-package' },
    ],
    contracts: [
      {
        id: 'contract-draft-only',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'draft-only',
        schemaVersion: '1',
        contractDigest: DIGEST_D,
        fieldContract: { huge: CONTRACT_PAYLOAD_SENTINEL.repeat(2048) },
        dataSchema: { huge: CONTRACT_PAYLOAD_SENTINEL.repeat(2048) },
      },
      {
        id: 'contract-published-only',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'published-only',
        schemaVersion: '1',
        contractDigest: DIGEST_E,
      },
      {
        id: 'contract-shared-v1',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'shared',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
      },
      {
        id: 'contract-switch-v1',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'switching',
        schemaVersion: '1',
        contractDigest: DIGEST_B,
      },
      {
        id: 'contract-switch-v2',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'switching',
        schemaVersion: '2',
        contractDigest: DIGEST_C,
      },
      {
        id: 'contract-wrong-resource',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'wrong-resource',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
      },
      {
        id: 'contract-wrong-revision',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'wrong-revision',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
      },
      {
        id: 'contract-wrong-link',
        templatePackageId: PACKAGE_ID,
        definitionKey: 'wrong-link',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
      },
      {
        id: 'contract-other-package',
        templatePackageId: INVENTORY_OTHER_PACKAGE_ID,
        definitionKey: 'foreign',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
      },
    ],
    instances: [
      {
        id: SHARED_INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: 'resource-shared',
      },
      {
        id: SWITCHED_INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: 'resource-switch',
      },
      {
        id: PUBLISHED_ONLY_INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: 'resource-published-only',
      },
      {
        id: DRAFT_ONLY_INSTANCE_ID,
        siteId: SITE_ID,
        revisionResourceId: 'resource-draft-only',
      },
      {
        id: 'foreign-instance',
        siteId: SITE_ID,
        revisionResourceId: 'resource-foreign',
      },
      {
        id: 'wrong-type-instance',
        siteId: SITE_ID,
        revisionResourceId: 'resource-wrong-type',
      },
      {
        id: 'wrong-revision-instance',
        siteId: SITE_ID,
        revisionResourceId: 'resource-wrong-revision',
      },
      {
        id: 'wrong-link-instance',
        siteId: SITE_ID,
        revisionResourceId: 'resource-wrong-link',
      },
      {
        id: 'other-site-instance',
        siteId: INVENTORY_OTHER_SITE_ID,
        revisionResourceId: 'resource-other-site',
      },
    ],
    resources: [
      {
        id: 'resource-shared',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: SHARED_INSTANCE_ID,
        draftRevisionId: 'shared-draft',
        publishedRevisionId: 'shared-published',
      },
      {
        id: 'resource-switch',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: SWITCHED_INSTANCE_ID,
        draftRevisionId: 'switch-draft',
        publishedRevisionId: 'switch-published',
      },
      {
        id: 'resource-published-only',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: PUBLISHED_ONLY_INSTANCE_ID,
        draftRevisionId: null,
        publishedRevisionId: 'published-only-published',
      },
      {
        id: 'resource-draft-only',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: DRAFT_ONLY_INSTANCE_ID,
        draftRevisionId: 'draft-only-draft',
        publishedRevisionId: null,
      },
      {
        id: 'resource-foreign',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: 'foreign-instance',
        draftRevisionId: 'foreign-draft',
        publishedRevisionId: null,
      },
      {
        id: 'resource-wrong-type',
        siteId: SITE_ID,
        resourceType: 'article',
        entityId: 'wrong-type-instance',
        draftRevisionId: 'wrong-type-draft',
        publishedRevisionId: null,
      },
      {
        id: 'resource-wrong-revision',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: 'wrong-revision-instance',
        draftRevisionId: 'wrong-revision-draft',
        publishedRevisionId: null,
      },
      {
        id: 'resource-wrong-link',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: 'wrong-link-instance',
        draftRevisionId: 'wrong-link-draft',
        publishedRevisionId: null,
      },
      {
        id: INVENTORY_LAYOUT_RESOURCE_ID,
        siteId: SITE_ID,
        resourceType: 'chunk_layout',
        entityId: INVENTORY_LAYOUT_ID,
        draftRevisionId: INVENTORY_LAYOUT_DRAFT_ID,
        publishedRevisionId: INVENTORY_LAYOUT_PUBLISHED_ID,
      },
      {
        id: 'surface-layout-resource',
        siteId: SITE_ID,
        resourceType: 'chunk_layout',
        entityId: 'surface-layout',
        draftRevisionId: 'surface-layout-draft',
        publishedRevisionId: null,
      },
      {
        id: 'resource-other-site',
        siteId: INVENTORY_OTHER_SITE_ID,
        resourceType: 'chunk_instance',
        entityId: 'other-site-instance',
        draftRevisionId: 'other-site-draft',
        publishedRevisionId: null,
      },
    ],
    revisions: [
      {
        id: 'shared-draft',
        resourceId: 'resource-shared',
        snapshot: { huge: INSTANCE_PAYLOAD_SENTINEL.repeat(2048) },
      },
      {
        id: 'shared-published',
        resourceId: 'resource-shared',
        snapshot: {},
      },
      { id: 'switch-draft', resourceId: 'resource-switch', snapshot: {} },
      {
        id: 'switch-published',
        resourceId: 'resource-switch',
        snapshot: {},
      },
      {
        id: 'published-only-published',
        resourceId: 'resource-published-only',
        snapshot: {},
      },
      {
        id: 'draft-only-draft',
        resourceId: 'resource-draft-only',
        snapshot: {},
      },
      { id: 'foreign-draft', resourceId: 'resource-foreign', snapshot: {} },
      {
        id: 'wrong-type-draft',
        resourceId: 'resource-wrong-type',
        snapshot: {},
      },
      {
        id: 'wrong-revision-draft',
        resourceId: 'another-resource',
        snapshot: {},
      },
      {
        id: 'wrong-link-draft',
        resourceId: 'resource-wrong-link',
        snapshot: {},
      },
      {
        id: INVENTORY_LAYOUT_DRAFT_ID,
        resourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        snapshot: {
          formatVersion: 1,
          templateKey: 'home',
          templateVersion: '2',
        },
      },
      {
        id: INVENTORY_LAYOUT_PUBLISHED_ID,
        resourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        snapshot: {
          formatVersion: 1,
          templateKey: 'home',
          templateVersion: '1',
        },
      },
      {
        id: 'surface-layout-draft',
        resourceId: 'surface-layout-resource',
        snapshot: {
          formatVersion: 1,
          templateKey: 'shell',
          templateVersion: '1',
        },
      },
      {
        id: 'other-site-draft',
        resourceId: 'resource-other-site',
        snapshot: {},
      },
    ],
    instanceLinks: [
      {
        revisionId: 'shared-draft',
        revisionResourceId: 'resource-shared',
        siteId: SITE_ID,
        instanceId: SHARED_INSTANCE_ID,
        contractId: 'contract-shared-v1',
      },
      {
        revisionId: 'shared-published',
        revisionResourceId: 'resource-shared',
        siteId: SITE_ID,
        instanceId: SHARED_INSTANCE_ID,
        contractId: 'contract-shared-v1',
      },
      {
        revisionId: 'switch-draft',
        revisionResourceId: 'resource-switch',
        siteId: SITE_ID,
        instanceId: SWITCHED_INSTANCE_ID,
        contractId: 'contract-switch-v2',
      },
      {
        revisionId: 'switch-published',
        revisionResourceId: 'resource-switch',
        siteId: SITE_ID,
        instanceId: SWITCHED_INSTANCE_ID,
        contractId: 'contract-switch-v1',
      },
      {
        revisionId: 'published-only-published',
        revisionResourceId: 'resource-published-only',
        siteId: SITE_ID,
        instanceId: PUBLISHED_ONLY_INSTANCE_ID,
        contractId: 'contract-published-only',
      },
      {
        revisionId: 'draft-only-draft',
        revisionResourceId: 'resource-draft-only',
        siteId: SITE_ID,
        instanceId: DRAFT_ONLY_INSTANCE_ID,
        contractId: 'contract-draft-only',
      },
      {
        revisionId: 'foreign-draft',
        revisionResourceId: 'resource-foreign',
        siteId: SITE_ID,
        instanceId: 'foreign-instance',
        contractId: 'contract-other-package',
      },
      {
        revisionId: 'wrong-type-draft',
        revisionResourceId: 'resource-wrong-type',
        siteId: SITE_ID,
        instanceId: 'wrong-type-instance',
        contractId: 'contract-wrong-resource',
      },
      {
        revisionId: 'wrong-revision-draft',
        revisionResourceId: 'another-resource',
        siteId: SITE_ID,
        instanceId: 'wrong-revision-instance',
        contractId: 'contract-wrong-revision',
      },
      {
        revisionId: 'wrong-link-draft',
        revisionResourceId: 'resource-wrong-link',
        siteId: INVENTORY_OTHER_SITE_ID,
        instanceId: 'wrong-link-instance',
        contractId: 'contract-wrong-link',
      },
      {
        revisionId: 'other-site-draft',
        revisionResourceId: 'resource-other-site',
        siteId: INVENTORY_OTHER_SITE_ID,
        instanceId: 'other-site-instance',
        contractId: 'contract-other-package',
      },
    ],
    layouts: [
      {
        id: INVENTORY_LAYOUT_ID,
        siteId: SITE_ID,
        revisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        scopeKind: 'page',
        pageId: INVENTORY_PAGE_ID,
        surfaceKey: null,
      },
      {
        id: 'surface-layout',
        siteId: SITE_ID,
        revisionResourceId: 'surface-layout-resource',
        scopeKind: 'site_surface',
        pageId: null,
        surfaceKey: 'header',
      },
      {
        id: 'other-site-layout',
        siteId: INVENTORY_OTHER_SITE_ID,
        revisionResourceId: 'other-site-layout-resource',
        scopeKind: 'site_surface',
        pageId: null,
        surfaceKey: 'secret',
      },
    ],
    placements: [
      {
        id: 'draft-switch',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        layoutRevisionId: INVENTORY_LAYOUT_DRAFT_ID,
        instanceId: SWITCHED_INSTANCE_ID,
        slotKey: 'hero',
        position: 0,
      },
      {
        id: 'draft-missing-pointer',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        layoutRevisionId: INVENTORY_LAYOUT_DRAFT_ID,
        instanceId: PUBLISHED_ONLY_INSTANCE_ID,
        slotKey: 'secondary',
        position: 0,
      },
      {
        id: 'published-shared',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        layoutRevisionId: INVENTORY_LAYOUT_PUBLISHED_ID,
        instanceId: SHARED_INSTANCE_ID,
        slotKey: 'hero',
        position: 1,
      },
      {
        id: 'published-switch',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        layoutRevisionId: INVENTORY_LAYOUT_PUBLISHED_ID,
        instanceId: SWITCHED_INSTANCE_ID,
        slotKey: 'hero',
        position: 0,
      },
      {
        id: 'published-missing-pointer',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: INVENTORY_LAYOUT_RESOURCE_ID,
        layoutRevisionId: INVENTORY_LAYOUT_PUBLISHED_ID,
        instanceId: DRAFT_ONLY_INSTANCE_ID,
        slotKey: 'footer',
        position: 0,
      },
      {
        id: 'surface-shared',
        siteId: SITE_ID,
        layoutId: 'surface-layout',
        layoutRevisionResourceId: 'surface-layout-resource',
        layoutRevisionId: 'surface-layout-draft',
        instanceId: SHARED_INSTANCE_ID,
        slotKey: 'header',
        position: 0,
      },
      {
        id: 'wrong-layout-revision-resource',
        siteId: SITE_ID,
        layoutId: INVENTORY_LAYOUT_ID,
        layoutRevisionResourceId: 'wrong-resource',
        layoutRevisionId: INVENTORY_LAYOUT_DRAFT_ID,
        instanceId: SHARED_INSTANCE_ID,
        slotKey: 'leak',
        position: 0,
      },
      {
        id: 'other-site-placement',
        siteId: INVENTORY_OTHER_SITE_ID,
        layoutId: 'other-site-layout',
        layoutRevisionResourceId: 'other-site-layout-resource',
        layoutRevisionId: 'other-site-layout-draft',
        instanceId: 'other-site-instance',
        slotKey: 'secret',
        position: 0,
      },
    ],
  };
}

function createCompatibilityInventoryHarness(options?: { reverse?: boolean }) {
  const state = compatibilityInventoryState();
  const invalidInstanceIds = new Set([
    'foreign-instance',
    'wrong-type-instance',
    'wrong-revision-instance',
    'wrong-link-instance',
  ]);
  const invalidResourceIds = new Set([
    'resource-foreign',
    'resource-wrong-type',
    'resource-wrong-revision',
    'resource-wrong-link',
  ]);
  state.instances = state.instances.filter(
    (row) => !invalidInstanceIds.has(String(row.id)),
  );
  state.resources = state.resources.filter(
    (row) => !invalidResourceIds.has(String(row.id)),
  );
  state.revisions = state.revisions.filter(
    (row) => !invalidResourceIds.has(String(row.resourceId)),
  );
  state.instanceLinks = state.instanceLinks.filter(
    (row) => !invalidResourceIds.has(String(row.revisionResourceId)),
  );
  state.placements = state.placements.filter(
    (row) =>
      row.id !== 'draft-missing-pointer' &&
      row.id !== 'published-missing-pointer' &&
      row.id !== 'wrong-layout-revision-resource',
  );
  if (options?.reverse) {
    for (const rows of Object.values(state)) rows.reverse();
  }
  const before = structuredClone(state);
  const transactionCalls: unknown[][] = [];
  const rawCommands: string[] = [];
  const mutationAttempts: string[] = [];
  const materializedRows: Array<Record<string, unknown>> = [];
  const managerOperations: Array<{
    operation: 'query' | 'find' | 'findOne' | 'mutation';
    entity?: unknown;
    sql?: string;
  }> = [];
  const queryCalls: Array<{
    operation: 'find' | 'findOne';
    entity: unknown;
    where?: Record<string, unknown> | Array<Record<string, unknown>>;
    select?: Record<string, boolean>;
  }> = [];
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown> | Array<Record<string, unknown>>,
  ): boolean =>
    (Array.isArray(where) ? where : [where]).some((candidate) =>
      Object.entries(candidate).every(([key, value]) => {
        const findOperator = value as {
          _type?: unknown;
          _value?: unknown;
        };
        if (
          findOperator?._type === 'in' &&
          Array.isArray(findOperator._value)
        ) {
          return findOperator._value.includes(row[key]);
        }
        return row[key] === value;
      }),
    );
  const rowsFor = (entity: unknown): Array<Record<string, unknown>> => {
    if (entity === CmsRevisionResourceEntity) return state.resources;
    if (entity === CmsRevisionEntity) return state.revisions;
    if (entity === ManagedChunkContractEntity) return state.contracts;
    if (entity === ManagedChunkInstanceEntity) return state.instances;
    if (entity === ManagedChunkInstanceRevisionEntity)
      return state.instanceLinks;
    if (entity === ManagedChunkLayoutEntity) return state.layouts;
    if (entity === ManagedChunkPlacementEntity) return state.placements;
    throw new Error(
      `Unexpected inventory collection: ${(entity as { name?: string }).name}`,
    );
  };
  const project = (
    row: Record<string, unknown>,
    select?: Record<string, boolean>,
  ): Record<string, unknown> => {
    const projected = select
      ? Object.fromEntries(
          Object.entries(select)
            .filter(([, selected]) => selected)
            .map(([key]) => [key, structuredClone(row[key])]),
        )
      : structuredClone(row);
    materializedRows.push(structuredClone(projected));
    return projected;
  };
  const rejectMutation = (operation: string): Promise<never> => {
    mutationAttempts.push(operation);
    managerOperations.push({ operation: 'mutation' });
    return Promise.reject(
      new Error(`Compatibility inventory attempted mutation: ${operation}`),
    );
  };
  const manager = {
    query: jest.fn((sql: string): Promise<unknown[]> => {
      rawCommands.push(sql);
      managerOperations.push({ operation: 'query', sql });
      const normalized = sql.trim().replace(/\s+/g, ' ').toUpperCase();
      if (normalized !== 'SET TRANSACTION READ ONLY') {
        return rejectMutation(`raw:${normalized}`);
      }
      return Promise.resolve([]);
    }),
    findOne: jest.fn(
      (
        entity: unknown,
        options: {
          where: Record<string, unknown>;
          select?: Record<string, boolean>;
        },
      ): Promise<Record<string, unknown> | null> => {
        queryCalls.push({
          operation: 'findOne',
          entity,
          where: options.where,
          select: options.select,
        });
        managerOperations.push({ operation: 'findOne', entity });
        if (
          (entity === SiteEntity &&
            !DATABASE_UUID_PATTERN.test(String(options.where.id))) ||
          (entity === TemplatePackageEntity &&
            !DATABASE_UUID_PATTERN.test(String(options.where.id)))
        ) {
          return Promise.reject(
            Object.assign(new Error('invalid input syntax for type uuid'), {
              code: '22P02',
            }),
          );
        }
        const rows =
          entity === SiteEntity
            ? state.sites
            : entity === TemplatePackageEntity
              ? state.packages
              : rowsFor(entity);
        const row = rows.find((candidate) => matches(candidate, options.where));
        return Promise.resolve(row ? project(row, options.select) : null);
      },
    ),
    find: jest.fn(
      (
        entity: unknown,
        options?: {
          where?: Record<string, unknown> | Array<Record<string, unknown>>;
          select?: Record<string, boolean>;
        },
      ): Promise<Array<Record<string, unknown>>> => {
        queryCalls.push({
          operation: 'find',
          entity,
          where: options?.where,
          select: options?.select,
        });
        managerOperations.push({ operation: 'find', entity });
        return Promise.resolve(
          rowsFor(entity)
            .filter((row) => !options?.where || matches(row, options.where))
            .map((row) => project(row, options?.select)),
        );
      },
    ),
    save: jest.fn(() => rejectMutation('save')),
    insert: jest.fn(() => rejectMutation('insert')),
    update: jest.fn(() => rejectMutation('update')),
    delete: jest.fn(() => rejectMutation('delete')),
    remove: jest.fn(() => rejectMutation('remove')),
  };
  const dataSource = {
    transaction: jest.fn(async (...args: unknown[]) => {
      transactionCalls.push(args);
      const callback = args.at(-1) as (db: EntityManager) => Promise<unknown>;
      return callback(manager as unknown as EntityManager);
    }),
  };
  return {
    repository: new ManagedChunkPersistenceRepository(
      dataSource as never,
      {} as CmsRevisionsService,
    ),
    manager,
    state,
    before,
    transactionCalls,
    rawCommands,
    mutationAttempts,
    materializedRows,
    managerOperations,
    queryCalls,
  };
}
function exactSourceCandidate(
  source: 'draft' | 'published',
): ManagedChunkCompatibilityCandidate {
  if (source === 'draft') {
    return {
      packageId: INVENTORY_PACKAGE_KEY,
      definitions: [
        {
          definitionKey: 'draft-only',
          schemaVersion: '1',
          contractDigest: DIGEST_D,
          rendererKey: 'single-source-renderer',
        },
        {
          definitionKey: 'shared',
          schemaVersion: '1',
          contractDigest: DIGEST_A,
          rendererKey: 'shared-renderer',
        },
        {
          definitionKey: 'switching',
          schemaVersion: '2',
          contractDigest: DIGEST_C,
          rendererKey: 'switching-renderer',
        },
      ],
      slots: [
        {
          templateKey: 'home',
          templateVersion: '2',
          slotKey: 'hero',
          maxItems: 1,
          allowedChunks: [{ definitionKey: 'switching', schemaVersion: '2' }],
        },
        {
          templateKey: 'shell',
          templateVersion: '1',
          slotKey: 'header',
          maxItems: 1,
          allowedChunks: [{ definitionKey: 'shared', schemaVersion: '1' }],
        },
      ],
    };
  }
  return {
    packageId: INVENTORY_PACKAGE_KEY,
    definitions: [
      {
        definitionKey: 'published-only',
        schemaVersion: '1',
        contractDigest: DIGEST_E,
        rendererKey: 'single-source-renderer',
      },
      {
        definitionKey: 'shared',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
        rendererKey: 'shared-renderer',
      },
      {
        definitionKey: 'switching',
        schemaVersion: '1',
        contractDigest: DIGEST_B,
        rendererKey: 'switching-renderer',
      },
    ],
    slots: [
      {
        templateKey: 'home',
        templateVersion: '1',
        slotKey: 'hero',
        maxItems: 2,
        allowedChunks: [
          { definitionKey: 'shared', schemaVersion: '1' },
          { definitionKey: 'switching', schemaVersion: '1' },
        ],
      },
    ],
  };
}

describe('ManagedChunkPersistenceRepository compatibility inventory', () => {
  it('reads draft and published independently and aggregates exact contracts', async () => {
    const harness = createCompatibilityInventoryHarness();

    const inventory = await harness.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });

    expect(inventory.contracts).toEqual([
      {
        packageId: INVENTORY_PACKAGE_KEY,
        definitionKey: 'draft-only',
        schemaVersion: '1',
        contractDigest: DIGEST_D,
        sources: ['draft'],
      },
      {
        packageId: INVENTORY_PACKAGE_KEY,
        definitionKey: 'published-only',
        schemaVersion: '1',
        contractDigest: DIGEST_E,
        sources: ['published'],
      },
      {
        packageId: INVENTORY_PACKAGE_KEY,
        definitionKey: 'shared',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
        sources: ['draft', 'published'],
      },
      {
        packageId: INVENTORY_PACKAGE_KEY,
        definitionKey: 'switching',
        schemaVersion: '1',
        contractDigest: DIGEST_B,
        sources: ['published'],
      },
      {
        packageId: INVENTORY_PACKAGE_KEY,
        definitionKey: 'switching',
        schemaVersion: '2',
        contractDigest: DIGEST_C,
        sources: ['draft'],
      },
    ]);
    expect(inventory.placements).toEqual([
      {
        source: 'draft',
        layoutKey: `page:${INVENTORY_PAGE_ID}`,
        templateKey: 'home',
        templateVersion: '2',
        slotKey: 'hero',
        definitionKey: 'switching',
        schemaVersion: '2',
        contractDigest: DIGEST_C,
        position: 0,
      },
      {
        source: 'draft',
        layoutKey: 'site_surface:header',
        templateKey: 'shell',
        templateVersion: '1',
        slotKey: 'header',
        definitionKey: 'shared',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
        position: 0,
      },
      {
        source: 'published',
        layoutKey: `page:${INVENTORY_PAGE_ID}`,
        templateKey: 'home',
        templateVersion: '1',
        slotKey: 'hero',
        definitionKey: 'switching',
        schemaVersion: '1',
        contractDigest: DIGEST_B,
        position: 0,
      },
      {
        source: 'published',
        layoutKey: `page:${INVENTORY_PAGE_ID}`,
        templateKey: 'home',
        templateVersion: '1',
        slotKey: 'hero',
        definitionKey: 'shared',
        schemaVersion: '1',
        contractDigest: DIGEST_A,
        position: 1,
      },
    ]);
    expect(JSON.stringify(inventory)).not.toContain('foreign');
    expect(JSON.stringify(inventory)).not.toContain('secret');
    expect(JSON.stringify(inventory)).not.toContain('leak');
    expect(JSON.stringify(inventory)).not.toContain('wrong-resource');
    expect(JSON.stringify(inventory)).not.toContain('wrong-revision');
    expect(JSON.stringify(inventory)).not.toContain('wrong-link');
  });

  it.each([
    ['an unassigned site', null],
    ['a site assigned to another package', INVENTORY_OTHER_PACKAGE_ID],
  ] as const)(
    'reads the explicit candidate package for %s',
    async (_, assignedTemplatePackageId) => {
      const harness = createCompatibilityInventoryHarness();
      const site = harness.state.sites.find((row) => row.id === SITE_ID);
      if (!site) throw new Error('Fixture site is missing');
      site.templatePackageId = assignedTemplatePackageId;

      const inventory = await harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      });

      expect(inventory.contracts).not.toHaveLength(0);
      expect(
        inventory.contracts.every(
          (requirement) => requirement.packageId === INVENTORY_PACKAGE_KEY,
        ),
      ).toBe(true);
      expect(JSON.stringify(inventory)).not.toContain('foreign');
      const siteRead = harness.queryCalls.find(
        (call) => call.operation === 'findOne' && call.entity === SiteEntity,
      );
      expect(siteRead?.where).toEqual({ id: SITE_ID });
      expect(site.templatePackageId).toBe(assignedTemplatePackageId);
    },
  );

  it('sets the standalone snapshot transaction read-only before its first manager read', async () => {
    const harness = createCompatibilityInventoryHarness();

    await harness.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });

    expect(harness.transactionCalls).toEqual([
      ['REPEATABLE READ', expect.any(Function)],
    ]);
    expect(harness.managerOperations[0]).toEqual({
      operation: 'query',
      sql: 'SET TRANSACTION READ ONLY',
    });
    expect(harness.rawCommands).toEqual(['SET TRANSACTION READ ONLY']);
    expect(harness.mutationAttempts).toEqual([]);
  });

  it('reuses the mapper with an existing manager without starting or changing its transaction', async () => {
    const harness = createCompatibilityInventoryHarness();
    const repository = harness.repository as unknown as {
      readCompatibilityInventoryUsingManager(
        manager: EntityManager,
        input: { siteId: string; templatePackageId: string },
      ): ReturnType<
        ManagedChunkPersistenceRepository['readCompatibilityInventory']
      >;
    };

    const inventory = await repository.readCompatibilityInventoryUsingManager(
      harness.manager as unknown as EntityManager,
      { siteId: SITE_ID, templatePackageId: PACKAGE_ID },
    );

    expect(inventory.contracts).not.toHaveLength(0);
    expect(harness.transactionCalls).toEqual([]);
    expect(harness.rawCommands).toEqual([]);
    expect(harness.managerOperations[0]).toEqual({
      operation: 'findOne',
      entity: SiteEntity,
    });
    expect(harness.mutationAttempts).toEqual([]);
  });
  it('does not fallback between missing draft and published instance pointers', async () => {
    const harness = createCompatibilityInventoryHarness();

    const inventory = await harness.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });

    expect(inventory.placements).not.toContainEqual(
      expect.objectContaining({ source: 'draft', slotKey: 'secondary' }),
    );
    expect(inventory.placements).not.toContainEqual(
      expect.objectContaining({ source: 'published', slotKey: 'footer' }),
    );
    const publishedOnlyRequirement = inventory.contracts.find(
      (requirement) => requirement.definitionKey === 'published-only',
    );
    const draftOnlyRequirement = inventory.contracts.find(
      (requirement) => requirement.definitionKey === 'draft-only',
    );
    expect(publishedOnlyRequirement?.sources).toEqual(['published']);
    expect(draftOnlyRequirement?.sources).toEqual(['draft']);
  });

  it.each([
    ['draft', 'published-only'],
    ['published', 'draft-only'],
  ] as const)(
    'does not fabricate a %s contract requirement through source fallback',
    async (source, oppositeOnlyDefinition) => {
      const harness = createCompatibilityInventoryHarness();
      const inventory = await harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      });
      const requirements = inventory.contracts
        .filter((requirement) => requirement.sources.includes(source))
        .map((requirement) => ({ ...requirement, sources: [source] }));
      const placements = inventory.placements.filter(
        (placement) => placement.source === source,
      );
      const result = checkManagedChunkContractCompatibility(
        exactSourceCandidate(source),
        new Set([
          'shared-renderer',
          'single-source-renderer',
          'switching-renderer',
        ]),
        requirements,
        placements,
      );

      expect(result).toEqual({ compatible: true, reasons: [] });
      expect(
        requirements.find(
          (requirement) => requirement.definitionKey === oppositeOnlyDefinition,
        ),
      ).toBeUndefined();
    },
  );

  it('is stable across storage order and caller mutation without writing state', async () => {
    const forward = createCompatibilityInventoryHarness();
    const reverse = createCompatibilityInventoryHarness({ reverse: true });

    const first = await forward.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });
    const second = await reverse.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });
    expect(second).toEqual(first);
    first.contracts.reverse();
    first.placements[0].slotKey = 'mutated';

    expect(
      await forward.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      }),
    ).toEqual(second);
    expect(forward.state).toEqual(forward.before);
    expect(forward.transactionCalls).toEqual([
      ['REPEATABLE READ', expect.any(Function)],
      ['REPEATABLE READ', expect.any(Function)],
    ]);
  });

  it.each([
    [
      'wrong layout resource type',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const resource = harness.state.resources.find(
          (row) => row.id === INVENTORY_LAYOUT_RESOURCE_ID,
        );
        if (!resource) throw new Error('Fixture layout resource is missing');
        resource.resourceType = 'article';
      },
    ],
    [
      'wrong layout resource entity',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const resource = harness.state.resources.find(
          (row) => row.id === INVENTORY_LAYOUT_RESOURCE_ID,
        );
        if (!resource) throw new Error('Fixture layout resource is missing');
        resource.entityId = 'foreign-layout';
      },
    ],
    [
      'wrong layout revision resource',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const revision = harness.state.revisions.find(
          (row) => row.id === INVENTORY_LAYOUT_DRAFT_ID,
        );
        if (!revision) throw new Error('Fixture layout revision is missing');
        revision.resourceId = 'foreign-layout-resource';
      },
    ],
  ])(
    'fails closed for %s',
    async (
      _: string,
      mutate: (
        harness: ReturnType<typeof createCompatibilityInventoryHarness>,
      ) => void,
    ) => {
      const harness = createCompatibilityInventoryHarness();
      mutate(harness);

      const reading = harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      });
      await expect(reading).rejects.toEqual(
        new ConflictException('Данные управляемого контента повреждены'),
      );
      await expect(reading).rejects.not.toThrow(DATABASE_UUID_PATTERN);
    },
  );

  it.each([
    [
      'a managed resource whose owner is missing',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        harness.state.instances = harness.state.instances.filter(
          (row) => row.id !== SHARED_INSTANCE_ID,
        );
      },
    ],
    [
      'a resource owner from another site',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const resource = harness.state.resources.find(
          (row) => row.id === 'resource-shared',
        );
        if (!resource) throw new Error('Fixture resource is missing');
        resource.siteId = INVENTORY_OTHER_SITE_ID;
      },
    ],
    [
      'a missing pointed revision',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        harness.state.revisions = harness.state.revisions.filter(
          (row) => row.id !== 'shared-draft',
        );
      },
    ],
    [
      'a pointed revision owned by another resource',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const revision = harness.state.revisions.find(
          (row) => row.id === 'shared-draft',
        );
        if (!revision) throw new Error('Fixture revision is missing');
        revision.resourceId = 'wrong-resource';
      },
    ],
    [
      'a missing typed instance link',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        harness.state.instanceLinks = harness.state.instanceLinks.filter(
          (row) => row.revisionId !== 'shared-draft',
        );
      },
    ],
    [
      'a typed link to a missing contract',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const link = harness.state.instanceLinks.find(
          (row) => row.revisionId === 'shared-draft',
        );
        if (!link) throw new Error('Fixture link is missing');
        link.contractId = 'missing-contract';
      },
    ],
    [
      'a typed link to a contract outside the explicit candidate',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const link = harness.state.instanceLinks.find(
          (row) => row.revisionId === 'shared-draft',
        );
        if (!link) throw new Error('Fixture link is missing');
        link.contractId = 'contract-other-package';
      },
    ],
    [
      'a placement with the wrong layout identity',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const placement = harness.state.placements.find(
          (row) => row.id === 'draft-switch',
        );
        if (!placement) throw new Error('Fixture placement is missing');
        placement.layoutId = 'wrong-layout';
      },
    ],
    [
      'a placement for an unknown instance',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const placement = harness.state.placements.find(
          (row) => row.id === 'draft-switch',
        );
        if (!placement) throw new Error('Fixture placement is missing');
        placement.instanceId = 'missing-instance';
      },
    ],
    [
      'a placement whose instance has no same-source pointer',
      (harness: ReturnType<typeof createCompatibilityInventoryHarness>) => {
        const placement = harness.state.placements.find(
          (row) => row.id === 'draft-switch',
        );
        if (!placement) throw new Error('Fixture placement is missing');
        placement.instanceId = PUBLISHED_ONLY_INSTANCE_ID;
      },
    ],
  ] as const)(
    'fails closed for present pointer corruption: %s',
    async (_, mutate) => {
      const harness = createCompatibilityInventoryHarness();
      mutate(harness);

      const reading = harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      });
      await expect(reading).rejects.toEqual(
        new ConflictException('Данные управляемого контента повреждены'),
      );
      await expect(reading).rejects.not.toThrow(DATABASE_UUID_PATTERN);
    },
  );

  it('uses bounded projected reads without materializing instance or contract JSON payloads', async () => {
    const harness = createCompatibilityInventoryHarness();

    await harness.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });

    expect(harness.queryCalls).toHaveLength(10);
    const inValues = (value: unknown): unknown[] => {
      expect(value).toBeDefined();
      if (value === null || value === undefined || typeof value !== 'object') {
        return [];
      }
      const operator = value as { _type?: unknown; _value?: unknown };
      expect(operator._type).toBe('in');
      expect(Array.isArray(operator._value)).toBe(true);
      return operator._value as unknown[];
    };
    const read = (entity: unknown) => {
      const call = harness.queryCalls.find(
        (candidate) =>
          candidate.operation === 'find' && candidate.entity === entity,
      );
      expect(call).toBeDefined();
      return call;
    };
    const findOneRead = (entity: unknown) => {
      const call = harness.queryCalls.find(
        (candidate) =>
          candidate.operation === 'findOne' && candidate.entity === entity,
      );
      expect(call).toBeDefined();
      return call;
    };
    expect(findOneRead(SiteEntity)?.select).toEqual({ id: true });
    expect(findOneRead(TemplatePackageEntity)?.select).toEqual({
      id: true,
      packageId: true,
    });
    expect(read(CmsRevisionResourceEntity)?.select).toEqual({
      id: true,
      siteId: true,
      resourceType: true,
      entityId: true,
      draftRevisionId: true,
      publishedRevisionId: true,
    });
    expect(read(ManagedChunkInstanceEntity)?.select).toEqual({
      id: true,
      siteId: true,
      revisionResourceId: true,
    });
    expect(read(ManagedChunkLayoutEntity)?.select).toEqual({
      id: true,
      siteId: true,
      revisionResourceId: true,
      scopeKind: true,
      pageId: true,
      surfaceKey: true,
    });
    const revisionReads = harness.queryCalls.filter(
      (candidate) =>
        candidate.operation === 'find' &&
        candidate.entity === CmsRevisionEntity,
    );
    expect(revisionReads).toHaveLength(2);
    const instanceRevisionRead = revisionReads.find(
      (candidate) => candidate.select?.snapshot !== true,
    );
    const layoutRevisionRead = revisionReads.find(
      (candidate) => candidate.select?.snapshot === true,
    );
    expect(instanceRevisionRead?.select).toEqual({
      id: true,
      resourceId: true,
    });
    expect(inValues(instanceRevisionRead?.where?.id)).toEqual([
      'shared-draft',
      'shared-published',
      'switch-draft',
      'switch-published',
      'published-only-published',
      'draft-only-draft',
    ]);
    expect(layoutRevisionRead?.select).toEqual({
      id: true,
      resourceId: true,
      snapshot: true,
    });
    expect(inValues(layoutRevisionRead?.where?.id)).toEqual([
      INVENTORY_LAYOUT_DRAFT_ID,
      INVENTORY_LAYOUT_PUBLISHED_ID,
      'surface-layout-draft',
    ]);
    expect(read(ManagedChunkInstanceRevisionEntity)?.select).toEqual({
      revisionId: true,
      revisionResourceId: true,
      siteId: true,
      instanceId: true,
      contractId: true,
    });
    const contractRead = read(ManagedChunkContractEntity);
    expect(contractRead?.select).toEqual({
      id: true,
      templatePackageId: true,
      definitionKey: true,
      schemaVersion: true,
      contractDigest: true,
    });
    expect(contractRead?.select).not.toHaveProperty('fieldContract');
    expect(contractRead?.select).not.toHaveProperty('dataSchema');
    expect(read(ManagedChunkPlacementEntity)?.select).toEqual({
      siteId: true,
      layoutId: true,
      layoutRevisionResourceId: true,
      layoutRevisionId: true,
      instanceId: true,
      slotKey: true,
      position: true,
    });
    const resourceRead = read(CmsRevisionResourceEntity);
    expect(Array.isArray(resourceRead?.where)).toBe(true);
    const resourcePredicates = resourceRead?.where as Array<
      Record<string, unknown>
    >;
    expect(inValues(resourcePredicates[0].resourceType)).toEqual([
      'chunk_instance',
      'chunk_layout',
    ]);
    expect(inValues(resourcePredicates[1].id)).toEqual([
      'resource-shared',
      'resource-switch',
      'resource-published-only',
      'resource-draft-only',
      INVENTORY_LAYOUT_RESOURCE_ID,
      'surface-layout-resource',
    ]);
    expect(inValues(contractRead?.where?.id)).not.toContain(
      'contract-wrong-resource',
    );
    const materialized = JSON.stringify(harness.materializedRows);
    expect(materialized).not.toContain(INSTANCE_PAYLOAD_SENTINEL);
    expect(materialized).not.toContain(CONTRACT_PAYLOAD_SENTINEL);
  });

  it('returns an empty inventory without issuing empty-set dependent reads', async () => {
    const harness = createCompatibilityInventoryHarness();
    harness.state.resources = harness.state.resources.filter(
      (row) => row.siteId !== SITE_ID,
    );
    harness.state.instances = harness.state.instances.filter(
      (row) => row.siteId !== SITE_ID,
    );
    harness.state.layouts = harness.state.layouts.filter(
      (row) => row.siteId !== SITE_ID,
    );

    await expect(
      harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      }),
    ).resolves.toEqual({ contracts: [], placements: [] });
    expect(
      harness.queryCalls.filter((call) =>
        [
          CmsRevisionEntity,
          ManagedChunkInstanceRevisionEntity,
          ManagedChunkContractEntity,
          ManagedChunkPlacementEntity,
        ].includes(call.entity as never),
      ),
    ).toEqual([]);
  });
  it.each([null, 'invalid', []])(
    'fails closed for a layout revision with malformed snapshot %p',
    async (snapshot) => {
      const harness = createCompatibilityInventoryHarness();
      const revision = harness.state.revisions.find(
        (row) => row.id === INVENTORY_LAYOUT_DRAFT_ID,
      );
      if (!revision) throw new Error('Fixture layout revision is missing');
      revision.snapshot = snapshot;

      const reading = harness.repository.readCompatibilityInventory({
        siteId: SITE_ID,
        templatePackageId: PACKAGE_ID,
      });
      await expect(reading).rejects.toEqual(
        new ConflictException('Данные управляемого контента повреждены'),
      );
      await expect(reading).rejects.not.toThrow(DATABASE_UUID_PATTERN);
    },
  );

  it.each([
    ['malformed site', 'not-a-uuid', PACKAGE_ID],
    ['malformed package', SITE_ID, 'not-a-uuid'],
  ])(
    'normalizes %s before issuing a database read',
    async (_, siteId, templatePackageId) => {
      const harness = createCompatibilityInventoryHarness();

      await expect(
        harness.repository.readCompatibilityInventory({
          siteId,
          templatePackageId,
        }),
      ).rejects.toThrow('Сайт или пакет не найден');
      expect(harness.rawCommands).toEqual(['SET TRANSACTION READ ONLY']);
      expect(harness.queryCalls).toEqual([]);
    },
  );
  it.each([
    ['unknown site', INVENTORY_UNKNOWN_SITE_ID, PACKAGE_ID],
    ['unknown package', SITE_ID, INVENTORY_UNKNOWN_PACKAGE_ID],
  ])(
    'normalizes %s inventory identity to the same safe error',
    async (_, siteId, templatePackageId) => {
      const harness = createCompatibilityInventoryHarness();

      await expect(
        harness.repository.readCompatibilityInventory({
          siteId,
          templatePackageId,
        }),
      ).rejects.toThrow('Сайт или пакет не найден');
    },
  );

  it('lets an incompatible pending draft block a published-compatible candidate', async () => {
    const harness = createCompatibilityInventoryHarness();
    const inventory = await harness.repository.readCompatibilityInventory({
      siteId: SITE_ID,
      templatePackageId: PACKAGE_ID,
    });
    const candidate: ManagedChunkCompatibilityCandidate = {
      packageId: INVENTORY_PACKAGE_KEY,
      definitions: [
        {
          definitionKey: 'shared',
          schemaVersion: '1',
          contractDigest: DIGEST_A,
          rendererKey: 'shared-renderer',
        },
        {
          definitionKey: 'draft-only',
          schemaVersion: '1',
          contractDigest: DIGEST_D,
          rendererKey: 'single-source-renderer',
        },
        {
          definitionKey: 'published-only',
          schemaVersion: '1',
          contractDigest: DIGEST_E,
          rendererKey: 'single-source-renderer',
        },
        {
          definitionKey: 'switching',
          schemaVersion: '1',
          contractDigest: DIGEST_B,
          rendererKey: 'switching-renderer',
        },
        {
          definitionKey: 'switching',
          schemaVersion: '2',
          contractDigest: DIGEST_A,
          rendererKey: 'switching-renderer',
        },
      ],
      slots: [
        {
          templateKey: 'home',
          templateVersion: '1',
          slotKey: 'hero',
          maxItems: 2,
          allowedChunks: [
            { definitionKey: 'shared', schemaVersion: '1' },
            { definitionKey: 'switching', schemaVersion: '1' },
          ],
        },
        {
          templateKey: 'home',
          templateVersion: '2',
          slotKey: 'hero',
          maxItems: 1,
          allowedChunks: [{ definitionKey: 'switching', schemaVersion: '2' }],
        },
        {
          templateKey: 'shell',
          templateVersion: '1',
          slotKey: 'header',
          maxItems: 1,
          allowedChunks: [{ definitionKey: 'shared', schemaVersion: '1' }],
        },
      ],
    };

    const publishedOnly = checkManagedChunkContractCompatibility(
      candidate,
      new Set([
        'shared-renderer',
        'single-source-renderer',
        'switching-renderer',
      ]),
      inventory.contracts
        .filter((requirement) => requirement.sources.includes('published'))
        .map((requirement) => ({ ...requirement, sources: ['published'] })),
      inventory.placements.filter(
        (placement) => placement.source === 'published',
      ),
    );
    const allSources = checkManagedChunkContractCompatibility(
      candidate,
      new Set([
        'shared-renderer',
        'single-source-renderer',
        'switching-renderer',
      ]),
      inventory.contracts,
      inventory.placements,
    );

    expect(publishedOnly).toEqual({ compatible: true, reasons: [] });

    expect(allSources.reasons).toContainEqual(
      expect.objectContaining({
        code: 'contract_digest_mismatch',
        definitionKey: 'switching',
        schemaVersion: '2',
        expectedDigest: DIGEST_C,
        candidateDigest: DIGEST_A,
      }),
    );
  });
});
