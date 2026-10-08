import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  ManagedChunkContractEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import type { ManagedChunkDefinition } from './managed-chunk.types';

const PACKAGE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';

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
    repository: new ManagedChunkPersistenceRepository(dataSource as never),
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
    const conflictingSource = definition({ key: 'conflict' });
    const existing = storedContract(conflictingSource);
    const harness = createHarness({ contracts: [existing] });
    const changedConflict = definition({
      key: 'conflict',
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
        definition({ key: 'new' }),
        changedConflict,
      ]),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.contracts).toEqual([existing]);
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
});
