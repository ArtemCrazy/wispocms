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
  TemplatePackageVersionEntity,
} from '../database/entities';
import { CmsRevisionsService } from '../content/cms-revisions.service';
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

function createManagedLifecycleHarness() {
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
                    ? { role: SiteRole.OWNER, requiresApproval: false }
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
