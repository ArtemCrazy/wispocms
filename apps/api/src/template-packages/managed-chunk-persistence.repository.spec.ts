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

function cloneContract(row: ManagedChunkContractEntity) {
  return {
    ...row,
    fieldContract: structuredClone(row.fieldContract),
    dataSchema: structuredClone(row.dataSchema),
    createdAt: new Date(row.createdAt),
  };
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

  const dataSource = {
    transaction: jest.fn(
      async (
        callback: (manager: EntityManager) => Promise<unknown>,
      ): Promise<unknown> => {
        const workingContracts = contracts.map(cloneContract);
        const contractRepository = {
          findOne: jest.fn(({ where }: { where: ContractIdentity }) =>
            Promise.resolve(
              workingContracts.find((row) => sameIdentity(row, where)) ??
                (concurrentRowVisible &&
                options?.concurrentRow &&
                sameIdentity(options.concurrentRow, where)
                  ? options.concurrentRow
                  : null),
            ),
          ),
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
            }) =>
              Promise.resolve(
                versions.find(
                  (version) =>
                    version.id === where.id &&
                    version.templatePackageId === where.templatePackageId &&
                    version.manifestVersion === where.manifestVersion,
                ) ?? null,
              ),
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
    expect(harness.contracts.map((row) => row.definitionKey)).toEqual([
      'promo',
      'hero',
    ]);
    expect(harness.contracts[0]).toMatchObject({
      templatePackageId: PACKAGE_ID,
      firstSeenTemplatePackageVersionId: VERSION_ID,
      definitionKey: 'promo',
      schemaVersion: '2',
    });
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
