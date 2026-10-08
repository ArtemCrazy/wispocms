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
