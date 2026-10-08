import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  CmsRevisionEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  PageEntity,
  SiteEntity,
  TemplatePackageEntity,
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
import type {
  ManagedChunkContentSource,
  ManagedChunkContractRequirement,
  ManagedChunkPlacementRequirement,
} from './managed-chunk-compatibility';
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

  async readCompatibilityInventory(input: {
    siteId: string;
    templatePackageId: string;
  }): Promise<{
    contracts: ManagedChunkContractRequirement[];
    placements: ManagedChunkPlacementRequirement[];
  }> {
    const siteId = String(input.siteId);
    const templatePackageId = String(input.templatePackageId);
    if (!isUUID(siteId) || !isUUID(templatePackageId)) {
      this.compatibilityInventoryNotFound();
    }

    return this.dataSource.transaction('REPEATABLE READ', async (db) => {
      const site = await db.findOne(SiteEntity, {
        where: { id: siteId, templatePackageId },
      });
      if (!site) this.compatibilityInventoryNotFound();
      const templatePackage = await db.findOne(TemplatePackageEntity, {
        where: { id: templatePackageId },
      });
      if (!templatePackage) this.compatibilityInventoryNotFound();

      const resources = await db.find(CmsRevisionResourceEntity, {
        where: {
          siteId,
          resourceType: In(['chunk_instance', 'chunk_layout']),
        },
      });
      const instances = await db.find(ManagedChunkInstanceEntity, {
        where: { siteId },
      });
      const layouts = await db.find(ManagedChunkLayoutEntity, {
        where: { siteId },
      });
      const pointerRevisionIds = [
        ...new Set(
          resources.flatMap((resource) =>
            [resource.draftRevisionId, resource.publishedRevisionId].filter(
              (revisionId): revisionId is string => revisionId !== null,
            ),
          ),
        ),
      ];
      const revisions = await db.find(CmsRevisionEntity, {
        where: { id: In(pointerRevisionIds) },
      });
      const instanceLinks = await db.find(ManagedChunkInstanceRevisionEntity, {
        where: {
          siteId,
          revisionId: In(pointerRevisionIds),
        },
      });
      const linkedContractIds = [
        ...new Set(instanceLinks.map((link) => link.contractId)),
      ];
      const packageContracts = await db.find(ManagedChunkContractEntity, {
        where: {
          templatePackageId,
          id: In(linkedContractIds),
        },
      });
      const storedPlacements = await db.find(ManagedChunkPlacementEntity, {
        where: {
          siteId,
          layoutRevisionId: In(pointerRevisionIds),
        },
      });

      const sourceOrder = ['draft', 'published'] as const;
      const sourceRank = new Map<ManagedChunkContentSource, number>(
        sourceOrder.map((source, index) => [source, index]),
      );
      const resourceById = new Map(
        resources.map((resource) => [resource.id, resource]),
      );
      const revisionByIdentity = new Map(
        revisions.map((revision) => [
          JSON.stringify([revision.id, revision.resourceId]),
          revision,
        ]),
      );
      const linkByIdentity = new Map(
        instanceLinks.map((link) => [
          JSON.stringify([
            link.revisionId,
            link.revisionResourceId,
            link.siteId,
            link.instanceId,
          ]),
          link,
        ]),
      );
      const contractById = new Map(
        packageContracts.map((contract) => [contract.id, contract]),
      );
      const instanceById = new Map(
        instances.map((instance) => [instance.id, instance]),
      );
      const placementsByLayoutRevision = new Map<
        string,
        ManagedChunkPlacementEntity[]
      >();
      for (const placement of storedPlacements) {
        const identity = JSON.stringify([
          placement.siteId,
          placement.layoutId,
          placement.layoutRevisionResourceId,
          placement.layoutRevisionId,
        ]);
        const grouped = placementsByLayoutRevision.get(identity);
        if (grouped) grouped.push(placement);
        else placementsByLayoutRevision.set(identity, [placement]);
      }

      const resolveInstanceContract = (
        instance: ManagedChunkInstanceEntity,
        source: ManagedChunkContentSource,
      ): ManagedChunkContractEntity | null => {
        const resource = resourceById.get(instance.revisionResourceId);
        if (
          !resource ||
          resource.siteId !== siteId ||
          resource.resourceType !== 'chunk_instance' ||
          resource.entityId !== instance.id
        ) {
          return null;
        }
        const revisionId =
          source === 'draft'
            ? resource.draftRevisionId
            : resource.publishedRevisionId;
        if (!revisionId) return null;
        if (
          !revisionByIdentity.has(JSON.stringify([revisionId, resource.id]))
        ) {
          return null;
        }
        const link = linkByIdentity.get(
          JSON.stringify([revisionId, resource.id, siteId, instance.id]),
        );
        if (!link) return null;
        return contractById.get(link.contractId) ?? null;
      };

      const resolvedInstances = new Map<
        string,
        ManagedChunkContractEntity | null
      >();
      const contractsByIdentity = new Map<
        string,
        ManagedChunkContractRequirement
      >();
      for (const instance of instances) {
        for (const source of sourceOrder) {
          const contract = resolveInstanceContract(instance, source);
          resolvedInstances.set(
            this.inventorySourceIdentity(source, instance.id),
            contract,
          );
          if (!contract) continue;
          const identity = JSON.stringify([
            contract.definitionKey,
            contract.schemaVersion,
            contract.contractDigest,
          ]);
          const existing = contractsByIdentity.get(identity);
          contractsByIdentity.set(identity, {
            packageId: templatePackage.packageId,
            definitionKey: contract.definitionKey,
            schemaVersion: contract.schemaVersion,
            contractDigest: contract.contractDigest,
            sources: sourceOrder.filter(
              (candidateSource) =>
                candidateSource === source ||
                existing?.sources.includes(candidateSource) === true,
            ),
          });
        }
      }

      const placements: ManagedChunkPlacementRequirement[] = [];
      for (const layout of layouts) {
        const layoutKey = this.inventoryLayoutKey(layout);
        if (!layoutKey) continue;
        const resource = resourceById.get(layout.revisionResourceId);
        if (
          !resource ||
          resource.siteId !== siteId ||
          resource.resourceType !== 'chunk_layout' ||
          resource.entityId !== layout.id
        ) {
          continue;
        }

        for (const source of sourceOrder) {
          const layoutRevisionId =
            source === 'draft'
              ? resource.draftRevisionId
              : resource.publishedRevisionId;
          if (!layoutRevisionId) continue;
          const revision = revisionByIdentity.get(
            JSON.stringify([layoutRevisionId, resource.id]),
          );
          if (!revision) continue;
          const snapshot: unknown = revision.snapshot;
          if (
            snapshot === null ||
            typeof snapshot !== 'object' ||
            Array.isArray(snapshot)
          ) {
            continue;
          }
          const snapshotRecord = snapshot as Record<string, unknown>;
          const templateKey = snapshotRecord.templateKey;
          const templateVersion = snapshotRecord.templateVersion;
          if (
            snapshotRecord.formatVersion !== 1 ||
            typeof templateKey !== 'string' ||
            typeof templateVersion !== 'string'
          ) {
            continue;
          }

          const layoutPlacements =
            placementsByLayoutRevision.get(
              JSON.stringify([
                siteId,
                layout.id,
                resource.id,
                layoutRevisionId,
              ]),
            ) ?? [];
          for (const placement of layoutPlacements) {
            if (!instanceById.has(placement.instanceId)) continue;
            const contract = resolvedInstances.get(
              this.inventorySourceIdentity(source, placement.instanceId),
            );
            if (!contract) continue;
            placements.push({
              source,
              layoutKey,
              templateKey,
              templateVersion,
              slotKey: placement.slotKey,
              definitionKey: contract.definitionKey,
              schemaVersion: contract.schemaVersion,
              contractDigest: contract.contractDigest,
              position: placement.position,
            });
          }
        }
      }

      const contracts = [...contractsByIdentity.values()].sort((left, right) =>
        this.compareInventoryTuples(
          [
            left.definitionKey,
            left.schemaVersion,
            left.contractDigest,
            left.packageId,
          ],
          [
            right.definitionKey,
            right.schemaVersion,
            right.contractDigest,
            right.packageId,
          ],
        ),
      );
      placements.sort((left, right) => {
        const sourceOrderResult =
          (sourceRank.get(left.source) ?? Number.MAX_SAFE_INTEGER) -
          (sourceRank.get(right.source) ?? Number.MAX_SAFE_INTEGER);
        if (sourceOrderResult !== 0) return sourceOrderResult;
        const textOrder = this.compareInventoryTuples(
          [left.layoutKey, left.slotKey],
          [right.layoutKey, right.slotKey],
        );
        if (textOrder !== 0) return textOrder;
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        return this.compareInventoryTuples(
          [
            left.definitionKey,
            left.schemaVersion,
            left.contractDigest,
            left.templateKey,
            left.templateVersion,
          ],
          [
            right.definitionKey,
            right.schemaVersion,
            right.contractDigest,
            right.templateKey,
            right.templateVersion,
          ],
        );
      });
      return { contracts, placements };
    });
  }
  private inventorySourceIdentity(
    source: ManagedChunkContentSource,
    instanceId: string,
  ): string {
    return JSON.stringify([source, instanceId]);
  }

  private inventoryLayoutKey(layout: ManagedChunkLayoutEntity): string | null {
    if (layout.scopeKind === 'page' && layout.pageId) {
      return 'page:' + layout.pageId;
    }
    if (layout.scopeKind === 'site_surface' && layout.surfaceKey) {
      return 'site_surface:' + layout.surfaceKey;
    }
    return null;
  }

  private compareInventoryTuples(
    left: readonly string[],
    right: readonly string[],
  ): number {
    for (let index = 0; index < left.length; index += 1) {
      const result = this.compareStrings(left[index], right[index]);
      if (result !== 0) return result;
    }
    return 0;
  }

  private compatibilityInventoryNotFound(): never {
    throw new NotFoundException('Сайт или пакет не найден');
  }

  async restoreInstanceRevision(input: {
    siteId: string;
    instanceId: string;
    sourceRevisionId: string;
    expectedDraftRevisionId: string | null;
    actor: RevisionActor;
  }): Promise<{ id: string; versionNumber: number }> {
    const siteId = String(input.siteId);
    const instanceId = String(input.instanceId);
    const sourceRevisionId = String(input.sourceRevisionId);
    const expectedDraftRevisionId = input.expectedDraftRevisionId;
    const actor = { ...input.actor };
    return this.dataSource.transaction(async (db) => {
      let sourceLink: ManagedChunkInstanceRevisionEntity | null = null;
      return this.revisions.restoreManagedRevisionUsingManager(
        db,
        {
          siteId,
          resourceType: 'chunk_instance',
          entityId: instanceId,
          sourceRevisionId,
          expectedDraftRevisionId,
          actor,
        },
        async (prepareDb) => {
          const prepared = await this.prepareInstanceRevision(prepareDb, {
            siteId,
            instanceId,
            revisionId: sourceRevisionId,
          });
          sourceLink = prepared.link;
          return prepared;
        },
        async (hookDb, revision, resource) => {
          if (!sourceLink) this.managedRevisionNotFound();
          await hookDb.save(
            Object.assign(new ManagedChunkInstanceRevisionEntity(), {
              revisionId: revision.id,
              revisionResourceId: resource.id,
              siteId,
              instanceId,
              contractId: sourceLink.contractId,
            }),
          );
        },
      );
    });
  }

  async approveInstanceRevision(input: {
    siteId: string;
    instanceId: string;
    revisionId: string;
    actor: RevisionActor;
  }): Promise<void> {
    return this.runInstanceLifecycle(input, 'approve');
  }

  async publishInstanceRevision(input: {
    siteId: string;
    instanceId: string;
    revisionId: string;
    actor: RevisionActor;
  }): Promise<void> {
    return this.runInstanceLifecycle(input, 'publish');
  }

  async restoreLayoutRevision(input: {
    siteId: string;
    layoutId: string;
    sourceRevisionId: string;
    expectedDraftRevisionId: string | null;
    actor: RevisionActor;
  }): Promise<{ id: string; versionNumber: number }> {
    const siteId = String(input.siteId);
    const layoutId = String(input.layoutId);
    const sourceRevisionId = String(input.sourceRevisionId);
    const expectedDraftRevisionId = input.expectedDraftRevisionId;
    const actor = { ...input.actor };
    return this.dataSource.transaction(async (db) => {
      let sourcePlacements: ManagedChunkPlacementEntity[] | null = null;
      return this.revisions.restoreManagedRevisionUsingManager(
        db,
        {
          siteId,
          resourceType: 'chunk_layout',
          entityId: layoutId,
          sourceRevisionId,
          expectedDraftRevisionId,
          actor,
        },
        async (prepareDb) => {
          const prepared = await this.prepareLayoutRevision(prepareDb, {
            siteId,
            layoutId,
            revisionId: sourceRevisionId,
          });
          sourcePlacements = prepared.placements.map((placement) =>
            Object.assign(
              new ManagedChunkPlacementEntity(),
              structuredClone(placement),
            ),
          );
          return prepared;
        },
        async (hookDb, revision, resource) => {
          if (!sourcePlacements) this.managedRevisionNotFound();
          if (sourcePlacements.length === 0) return;
          await hookDb.save(
            sourcePlacements.map((placement) =>
              Object.assign(new ManagedChunkPlacementEntity(), {
                id: randomUUID(),
                siteId,
                layoutId,
                layoutRevisionResourceId: resource.id,
                layoutRevisionId: revision.id,
                instanceId: placement.instanceId,
                slotKey: placement.slotKey,
                position: placement.position,
              }),
            ),
          );
        },
      );
    });
  }

  async approveLayoutRevision(input: {
    siteId: string;
    layoutId: string;
    revisionId: string;
    actor: RevisionActor;
  }): Promise<void> {
    return this.runLayoutLifecycle(input, 'approve');
  }

  async publishLayoutRevision(input: {
    siteId: string;
    layoutId: string;
    revisionId: string;
    actor: RevisionActor;
  }): Promise<void> {
    return this.runLayoutLifecycle(input, 'publish');
  }

  private async runInstanceLifecycle(
    input: {
      siteId: string;
      instanceId: string;
      revisionId: string;
      actor: RevisionActor;
    },
    operation: 'approve' | 'publish',
  ): Promise<void> {
    const siteId = String(input.siteId);
    const instanceId = String(input.instanceId);
    const revisionId = String(input.revisionId);
    const actor = { ...input.actor };
    await this.dataSource.transaction(async (db) => {
      const prepare = async (prepareDb: EntityManager) =>
        this.prepareInstanceRevision(prepareDb, {
          siteId,
          instanceId,
          revisionId,
        });
      const lifecycleInput = {
        siteId,
        resourceType: 'chunk_instance' as const,
        entityId: instanceId,
        revisionId,
        actor,
      };
      if (operation === 'approve') {
        await this.revisions.approveManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      } else {
        await this.revisions.publishManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      }
    });
  }

  private async runLayoutLifecycle(
    input: {
      siteId: string;
      layoutId: string;
      revisionId: string;
      actor: RevisionActor;
    },
    operation: 'approve' | 'publish',
  ): Promise<void> {
    const siteId = String(input.siteId);
    const layoutId = String(input.layoutId);
    const revisionId = String(input.revisionId);
    const actor = { ...input.actor };
    await this.dataSource.transaction(async (db) => {
      const prepare = async (prepareDb: EntityManager) =>
        this.prepareLayoutRevision(prepareDb, {
          siteId,
          layoutId,
          revisionId,
        });
      const lifecycleInput = {
        siteId,
        resourceType: 'chunk_layout' as const,
        entityId: layoutId,
        revisionId,
        actor,
      };
      if (operation === 'approve') {
        await this.revisions.approveManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      } else {
        await this.revisions.publishManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      }
    });
  }

  private async prepareInstanceRevision(
    db: EntityManager,
    input: { siteId: string; instanceId: string; revisionId: string },
  ): Promise<{
    resource: CmsRevisionResourceEntity;
    revision: CmsRevisionEntity;
    link: ManagedChunkInstanceRevisionEntity;
  }> {
    await this.requireLifecycleSite(db, input.siteId);
    const instance = await db.findOne(ManagedChunkInstanceEntity, {
      where: { id: input.instanceId, siteId: input.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!instance) this.managedRevisionNotFound();
    const resource = await db.findOne(CmsRevisionResourceEntity, {
      where: {
        id: instance.revisionResourceId,
        siteId: input.siteId,
        resourceType: 'chunk_instance',
        entityId: input.instanceId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) this.managedRevisionNotFound();
    const revision = await db.findOne(CmsRevisionEntity, {
      where: { id: input.revisionId, resourceId: resource.id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!revision) this.managedRevisionNotFound();
    const link = await db.findOne(ManagedChunkInstanceRevisionEntity, {
      where: {
        revisionId: input.revisionId,
        revisionResourceId: resource.id,
        siteId: input.siteId,
        instanceId: input.instanceId,
      },
      lock: { mode: 'pessimistic_read' },
    });
    if (!link) this.managedRevisionNotFound();
    return { resource, revision, link };
  }

  private async prepareLayoutRevision(
    db: EntityManager,
    input: { siteId: string; layoutId: string; revisionId: string },
  ): Promise<{
    resource: CmsRevisionResourceEntity;
    revision: CmsRevisionEntity;
    placements: ManagedChunkPlacementEntity[];
  }> {
    await this.requireLifecycleSite(db, input.siteId);
    const layout = await db.findOne(ManagedChunkLayoutEntity, {
      where: { id: input.layoutId, siteId: input.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!layout) this.managedRevisionNotFound();
    const resource = await db.findOne(CmsRevisionResourceEntity, {
      where: {
        id: layout.revisionResourceId,
        siteId: input.siteId,
        resourceType: 'chunk_layout',
        entityId: input.layoutId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) this.managedRevisionNotFound();
    const revision = await db.findOne(CmsRevisionEntity, {
      where: { id: input.revisionId, resourceId: resource.id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!revision) this.managedRevisionNotFound();
    const placements = await db.find(ManagedChunkPlacementEntity, {
      where: { layoutRevisionId: input.revisionId },
    });
    const instanceIds = new Set<string>();
    for (const placement of placements) {
      if (
        placement.siteId !== input.siteId ||
        placement.layoutId !== input.layoutId ||
        placement.layoutRevisionResourceId !== resource.id ||
        placement.layoutRevisionId !== input.revisionId
      ) {
        this.managedRevisionNotFound();
      }
      instanceIds.add(placement.instanceId);
    }
    for (const instanceId of [...instanceIds].sort()) {
      const instance = await db.findOne(ManagedChunkInstanceEntity, {
        where: { id: instanceId, siteId: input.siteId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!instance) this.managedRevisionNotFound();
    }
    return { resource, revision, placements };
  }

  private async requireLifecycleSite(
    db: EntityManager,
    siteId: string,
  ): Promise<void> {
    const site = await db.findOne(SiteEntity, {
      where: { id: siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!site) this.managedRevisionNotFound();
  }

  private managedRevisionNotFound(): never {
    throw new NotFoundException('Версия управляемого ресурса не найдена');
  }
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
      let layout: ManagedChunkLayoutEntity | null = null;
      const revision =
        await this.revisions.savePreparedManagedDraftUsingManager(
          db,
          {
            siteId,
            resourceType: 'chunk_layout',
            snapshot,
            expectedDraftRevisionId,
            actor,
          },
          async (prepareDb) => {
            const site = await prepareDb.findOne(SiteEntity, {
              where: { id: siteId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!site) throw new NotFoundException('Сайт не найден');

            if (target.kind === 'page') {
              const page = await prepareDb.findOne(PageEntity, {
                where: { id: target.pageId, siteId },
                lock: { mode: 'pessimistic_write' },
              });
              if (!page) {
                throw new NotFoundException('Цель раскладки не найдена');
              }
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
            layout = await prepareDb.findOne(ManagedChunkLayoutEntity, {
              where: layoutWhere,
              lock: { mode: 'pessimistic_write' },
            });
            return { entityId: layout?.id ?? randomUUID() };
          },
          async (hookDb, savedRevision, resource) => {
            const instanceIds = [
              ...new Set(placements.map((row) => row.instanceId)),
            ].sort();
            for (const instanceId of instanceIds) {
              const instance = await hookDb.findOne(
                ManagedChunkInstanceEntity,
                {
                  where: { id: instanceId, siteId },
                  lock: { mode: 'pessimistic_read' },
                },
              );
              if (!instance) {
                throw new NotFoundException('Экземпляр чанка не найден');
              }
            }

            if (!layout) {
              await hookDb.save(
                Object.assign(new ManagedChunkLayoutEntity(), {
                  id: resource.entityId,
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
                    layoutId: resource.entityId,
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
        layoutId: revision.entityId,
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
      const revision =
        await this.revisions.savePreparedManagedDraftUsingManager(
          db,
          {
            siteId,
            resourceType: 'chunk_instance',
            snapshot,
            expectedDraftRevisionId: null,
            actor,
          },
          async (prepareDb) => {
            const site = await prepareDb.findOne(SiteEntity, {
              where: { id: siteId },
              lock: { mode: 'pessimistic_read' },
            });
            if (!site) {
              throw new NotFoundException('Контракт чанка не найден');
            }
            const contract = await prepareDb.findOne(
              ManagedChunkContractEntity,
              { where: { id: contractId } },
            );
            if (
              !contract ||
              site.templatePackageId !== contract.templatePackageId
            ) {
              throw new NotFoundException('Контракт чанка не найден');
            }
            return { entityId: instanceId };
          },
          async (hookDb, savedRevision, resource) => {
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
