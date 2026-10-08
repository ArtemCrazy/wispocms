import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  ManagedChunkContractEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import type { ManagedChunkDefinition } from './managed-chunk.types';

type RegisterManagedChunkContractsInput = {
  templatePackageId: string;
  templatePackageVersionId: string;
  definitions: readonly ManagedChunkDefinition[];
};

type DerivedContract = {
  contractDigest: string;
  fieldContract: Record<string, unknown>;
  dataSchema: Record<string, unknown>;
};

type ContractIdentity = {
  templatePackageId: string;
  definitionKey: string;
  schemaVersion: string;
};

type ContractWorkItem = Readonly<{
  identityKey: string;
  identity: Readonly<ContractIdentity>;
  derived: Readonly<DerivedContract>;
}>;

type PreparedRegistration = Readonly<{
  templatePackageId: string;
  templatePackageVersionId: string;
  workItems: readonly ContractWorkItem[];
  resultIdentityKeys: readonly string[];
}>;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

@Injectable()
export class ManagedChunkPersistenceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async registerContracts(
    input: RegisterManagedChunkContractsInput,
  ): Promise<ManagedChunkContractEntity[]> {
    const prepared = this.prepareRegistration(input);
    return this.dataSource.transaction(async (manager) => {
      const storedByIdentity = await this.registerInTransaction(
        manager,
        prepared,
      );
      return prepared.resultIdentityKeys.map((identityKey) => {
        const stored = storedByIdentity.get(identityKey);
        if (!stored) {
          throw new ConflictException(
            'Контракт чанка не удалось зарегистрировать',
          );
        }
        return stored;
      });
    });
  }

  private prepareRegistration(
    input: RegisterManagedChunkContractsInput,
  ): PreparedRegistration {
    const templatePackageId = String(input.templatePackageId);
    const templatePackageVersionId = String(input.templatePackageVersionId);
    const uniqueItems = new Map<string, ContractWorkItem>();
    const resultIdentityKeys: string[] = [];

    for (const definition of input.definitions) {
      const identity = Object.freeze({
        templatePackageId,
        definitionKey: String(definition.key),
        schemaVersion: String(definition.schemaVersion),
      });
      const identityKey = JSON.stringify([
        identity.templatePackageId,
        identity.definitionKey,
        identity.schemaVersion,
      ]);
      const derived = Object.freeze(this.deriveContract(definition));
      const existing = uniqueItems.get(identityKey);
      if (existing) {
        this.assertSameDerivedContract(existing.derived, derived);
      } else {
        uniqueItems.set(
          identityKey,
          Object.freeze({ identityKey, identity, derived }),
        );
      }
      resultIdentityKeys.push(identityKey);
    }

    const workItems = [...uniqueItems.values()].sort((left, right) => {
      const keyOrder = this.compareStrings(
        left.identity.definitionKey,
        right.identity.definitionKey,
      );
      return keyOrder === 0
        ? this.compareStrings(
            left.identity.schemaVersion,
            right.identity.schemaVersion,
          )
        : keyOrder;
    });
    return Object.freeze({
      templatePackageId,
      templatePackageVersionId,
      workItems,
      resultIdentityKeys,
    });
  }

  private async registerInTransaction(
    manager: EntityManager,
    prepared: PreparedRegistration,
  ): Promise<Map<string, ManagedChunkContractEntity>> {
    const version = await manager
      .getRepository(TemplatePackageVersionEntity)
      .findOne({
        where: {
          id: prepared.templatePackageVersionId,
          templatePackageId: prepared.templatePackageId,
          manifestVersion: 2,
        },
      });
    if (!version) throw new NotFoundException('Версия пакета не найдена');

    const contracts = manager.getRepository(ManagedChunkContractEntity);
    const registered = new Map<string, ManagedChunkContractEntity>();
    for (const workItem of prepared.workItems) {
      const { identity, identityKey, derived } = workItem;
      let stored = await contracts.findOne({ where: identity });

      if (!stored) {
        const insertValues = {
          ...identity,
          firstSeenTemplatePackageVersionId: prepared.templatePackageVersionId,
          ...derived,
        };
        await manager
          .createQueryBuilder()
          .insert()
          .into(ManagedChunkContractEntity)
          // TypeORM's deep-partial type recurses into JSONB records even
          // though the PostgreSQL driver accepts these plain JSON objects.
          .values(
            insertValues as unknown as QueryDeepPartialEntity<ManagedChunkContractEntity>,
          )
          .orIgnore()
          .execute();
        stored = await contracts.findOne({ where: identity });
      }

      if (!stored) {
        throw new ConflictException(
          'Контракт чанка не удалось зарегистрировать',
        );
      }
      this.assertSameContract(stored, derived);
      registered.set(identityKey, stored);
    }
    return registered;
  }

  private compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  private deriveContract(definition: ManagedChunkDefinition): DerivedContract {
    const canonical = canonicalManagedChunkContract(definition.fields);
    return {
      fieldContract: JSON.parse(canonical) as Record<string, unknown>,
      dataSchema: deriveManagedChunkDataSchema(definition.fields),
      contractDigest: computeManagedChunkContractDigest(definition.fields),
    };
  }

  private assertSameContract(
    stored: ManagedChunkContractEntity,
    derived: DerivedContract,
  ): void {
    this.assertSameDerivedContract(stored, derived);
  }

  private assertSameDerivedContract(
    stored: DerivedContract,
    derived: DerivedContract,
  ): void {
    if (
      stored.contractDigest !== derived.contractDigest ||
      canonicalJson(stored.fieldContract) !==
        canonicalJson(derived.fieldContract) ||
      canonicalJson(stored.dataSchema) !== canonicalJson(derived.dataSchema)
    ) {
      throw new ConflictException(
        'Контракт чанка уже зарегистрирован с другим содержимым',
      );
    }
  }
}
