import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  PageEntity,
  SiteEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  CmsRevisionsService,
  type RevisionActor,
} from '../content/cms-revisions.service';
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly revisions: CmsRevisionsService,
  ) {}

  async saveLayoutDraft(input: {
    siteId: string;
    target:
      | { kind: 'page'; pageId: string }
      | { kind: 'site_surface'; surfaceKey: string };
    templateKey: string;
    templateVersion: string;
    expectedDraftRevisionId: string | null;
    placements: readonly {
      slotKey: string;
      position: number;
      instanceId: string;
    }[];
    actor: RevisionActor;
  }): Promise<{
    layoutId: string;
    revisionId: string;
    versionNumber: number;
  }> {
    const siteId = String(input.siteId);
    const target =
      input.target.kind === 'page'
        ? ({ kind: 'page', pageId: String(input.target.pageId) } as const)
        : ({
            kind: 'site_surface',
            surfaceKey: String(input.target.surfaceKey),
          } as const);
    const actor = { ...input.actor };
    const expectedDraftRevisionId = input.expectedDraftRevisionId;
    const snapshot = {
      formatVersion: 1,
      templateKey: String(input.templateKey),
      templateVersion: String(input.templateVersion),
    };
    const positions = new Set<string>();
    const placements = input.placements.map((placement) => {
      const cloned = {
        slotKey: String(placement.slotKey),
        position: placement.position,
        instanceId: String(placement.instanceId),
      };
      if (
        !Number.isInteger(cloned.position) ||
        cloned.position < 0 ||
        cloned.position > 2_147_483_647
      ) {
        throw new BadRequestException(
          'Позиция чанка должна быть целым числом от 0 до 2147483647',
        );
      }
      const positionKey = JSON.stringify([cloned.slotKey, cloned.position]);
      if (positions.has(positionKey)) {
        throw new BadRequestException(
          'Позиция чанка в слоте должна быть уникальной',
        );
      }
      positions.add(positionKey);
      return cloned;
    });

    return this.dataSource.transaction(async (db) => {
      await this.revisions.authorizeManagedWriteUsingManager(db, {
        siteId,
        resourceType: 'chunk_layout',
        actor,
      });
      const site = await db.findOne(SiteEntity, {
        where: { id: siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!site) throw new NotFoundException('Сайт не найден');

      if (target.kind === 'page') {
        const page = await db.findOne(PageEntity, {
          where: { id: target.pageId, siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!page) throw new NotFoundException('Цель раскладки не найдена');
      }

      const layoutWhere =
        target.kind === 'page'
          ? {
              siteId,
              scopeKind: 'page' as const,
              pageId: target.pageId,
            }
          : {
              siteId,
              scopeKind: 'site_surface' as const,
              surfaceKey: target.surfaceKey,
            };
      const layout = await db.findOne(ManagedChunkLayoutEntity, {
        where: layoutWhere,
        lock: { mode: 'pessimistic_write' },
      });
      const layoutId = layout?.id ?? randomUUID();
      const instanceIds = [
        ...new Set(placements.map((row) => row.instanceId)),
      ].sort();

      const revision = await this.revisions.saveManagedDraftUsingManager(
        db,
        {
          siteId,
          resourceType: 'chunk_layout',
          entityId: layoutId,
          snapshot,
          expectedDraftRevisionId,
          actor,
        },
        async (hookDb, savedRevision, resource) => {
          for (const instanceId of instanceIds) {
            const instance = await hookDb.findOne(ManagedChunkInstanceEntity, {
              where: { id: instanceId, siteId },
              lock: { mode: 'pessimistic_read' },
            });
            if (!instance) {
              throw new NotFoundException('Экземпляр чанка не найден');
            }
          }

          if (!layout) {
            await hookDb.save(
              Object.assign(new ManagedChunkLayoutEntity(), {
                id: layoutId,
                siteId,
                revisionResourceId: resource.id,
                scopeKind: target.kind,
                pageId: target.kind === 'page' ? target.pageId : null,
                surfaceKey:
                  target.kind === 'site_surface' ? target.surfaceKey : null,
              }),
            );
          }

          if (placements.length > 0) {
            await hookDb.save(
              placements.map((placement) =>
                Object.assign(new ManagedChunkPlacementEntity(), {
                  id: randomUUID(),
                  siteId,
                  layoutId,
                  layoutRevisionResourceId: resource.id,
                  layoutRevisionId: savedRevision.id,
                  instanceId: placement.instanceId,
                  slotKey: placement.slotKey,
                  position: placement.position,
                }),
              ),
            );
          }
        },
      );

      return {
        layoutId,
        revisionId: revision.id,
        versionNumber: revision.versionNumber,
      };
    });
  }

  async createInstanceDraft(input: {
    siteId: string;
    displayName: string;
    contractId: string;
    data: Record<string, unknown>;
    sanitizerPolicyVersion: string | null;
    actor: RevisionActor;
  }): Promise<{
    instanceId: string;
    revisionId: string;
    versionNumber: number;
  }> {
    const instanceId = randomUUID();
    const siteId = input.siteId;
    const displayName = input.displayName;
    const contractId = input.contractId;
    const actor = { ...input.actor };
    const snapshot = {
      formatVersion: 1,
      data: structuredClone(input.data),
      sanitizerPolicyVersion: input.sanitizerPolicyVersion,
    };

    return this.dataSource.transaction(async (db) => {
      const revision = await this.revisions.saveManagedDraftUsingManager(
        db,
        {
          siteId,
          resourceType: 'chunk_instance',
          entityId: instanceId,
          snapshot,
          expectedDraftRevisionId: null,
          actor,
        },
        async (hookDb, savedRevision, resource) => {
          const site = await hookDb.findOne(SiteEntity, {
            where: { id: siteId },
            lock: { mode: 'pessimistic_read' },
          });
          const contract = await hookDb.findOne(ManagedChunkContractEntity, {
            where: { id: contractId },
          });
          if (
            !contract ||
            !site ||
            site.templatePackageId !== contract.templatePackageId
          ) {
            throw new NotFoundException('Контракт чанка не найден');
          }

          await hookDb.save(
            Object.assign(new ManagedChunkInstanceEntity(), {
              id: instanceId,
              siteId,
              revisionResourceId: resource.id,
              displayName,
              isArchived: false,
              createdByUserId: actor.userId,
            }),
          );
          await hookDb.save(
            Object.assign(new ManagedChunkInstanceRevisionEntity(), {
              revisionId: savedRevision.id,
              revisionResourceId: resource.id,
              siteId,
              instanceId,
              contractId,
            }),
          );
        },
      );
      return {
        instanceId,
        revisionId: revision.id,
        versionNumber: revision.versionNumber,
      };
    });
  }

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
