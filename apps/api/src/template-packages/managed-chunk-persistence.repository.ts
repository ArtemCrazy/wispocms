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
    return this.dataSource.transaction('REPEATABLE READ', async (db) => {
      await db.query('SET TRANSACTION READ ONLY');
      return this.readCompatibilityInventoryUsingManager(db, input);
    });
  }

  async readCompatibilityInventoryUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      templatePackageId: string;
    },
  ): Promise<{
    contracts: ManagedChunkContractRequirement[];
    placements: ManagedChunkPlacementRequirement[];
  }> {
    const siteId = String(input.siteId);
    const templatePackageId = String(input.templatePackageId);
    if (!isUUID(siteId) || !isUUID(templatePackageId)) {
      this.compatibilityInventoryNotFound();
    }

    const site = await db.findOne(SiteEntity, {
      select: { id: true },
      where: { id: siteId },
    });
    if (!site) this.compatibilityInventoryNotFound();
    const templatePackage = await db.findOne(TemplatePackageEntity, {
      select: { id: true, packageId: true },
      where: { id: templatePackageId },
    });
    if (!templatePackage) this.compatibilityInventoryNotFound();

    const instances = await db.find(ManagedChunkInstanceEntity, {
      select: { id: true, siteId: true, revisionResourceId: true },
      where: { siteId },
    });
    const layouts = await db.find(ManagedChunkLayoutEntity, {
      select: {
        id: true,
        siteId: true,
        revisionResourceId: true,
        scopeKind: true,
        pageId: true,
        surfaceKey: true,
      },
      where: { siteId },
    });
    const ownerResourceIds = [
      ...new Set([
        ...instances.map((instance) => instance.revisionResourceId),
        ...layouts.map((layout) => layout.revisionResourceId),
      ]),
    ];
    const resourceWhere: Array<Record<string, unknown>> = [
      {
        siteId,
        resourceType: In(['chunk_instance', 'chunk_layout']),
      },
    ];
    if (ownerResourceIds.length > 0) {
      resourceWhere.push({ id: In(ownerResourceIds) });
    }
    const resources = await db.find(CmsRevisionResourceEntity, {
      select: {
        id: true,
        siteId: true,
        resourceType: true,
        entityId: true,
        draftRevisionId: true,
        publishedRevisionId: true,
      },
      where: resourceWhere,
    });

    const sourceOrder = ['draft', 'published'] as const;
    const pointerFor = (
      resource: CmsRevisionResourceEntity,
      source: ManagedChunkContentSource,
    ): string | null => {
      const pointer =
        source === 'draft'
          ? resource.draftRevisionId
          : resource.publishedRevisionId;
      if (pointer !== null && typeof pointer !== 'string') {
        this.compatibilityInventoryCorrupt();
      }
      return pointer;
    };
    const hasPresentPointer = (resource: CmsRevisionResourceEntity): boolean =>
      sourceOrder.some((source) => pointerFor(resource, source) !== null);
    const activeResources = resources.filter(hasPresentPointer);

    const uniqueBy = <T>(
      rows: readonly T[],
      identity: (row: T) => string,
    ): Map<string, T> => {
      const result = new Map<string, T>();
      for (const row of rows) {
        const key = identity(row);
        if (result.has(key)) this.compatibilityInventoryCorrupt();
        result.set(key, row);
      }
      return result;
    };
    const instanceById = uniqueBy(instances, (instance) => instance.id);
    const layoutById = uniqueBy(layouts, (layout) => layout.id);
    const activeResourceById = uniqueBy(
      activeResources,
      (resource) => resource.id,
    );

    for (const resource of activeResources) {
      if (resource.resourceType === 'chunk_instance') {
        const instance = instanceById.get(resource.entityId);
        if (
          !instance ||
          instance.siteId !== siteId ||
          instance.revisionResourceId !== resource.id ||
          resource.siteId !== siteId
        ) {
          this.compatibilityInventoryCorrupt();
        }
      } else if (resource.resourceType === 'chunk_layout') {
        const layout = layoutById.get(resource.entityId);
        if (
          !layout ||
          layout.siteId !== siteId ||
          layout.revisionResourceId !== resource.id ||
          resource.siteId !== siteId ||
          !this.inventoryLayoutKey(layout)
        ) {
          this.compatibilityInventoryCorrupt();
        }
      } else {
        this.compatibilityInventoryCorrupt();
      }
    }

    const instanceResources = activeResources.filter(
      (resource) => resource.resourceType === 'chunk_instance',
    );
    const layoutResources = activeResources.filter(
      (resource) => resource.resourceType === 'chunk_layout',
    );
    const pointerIdsFor = (
      resourcesForType: readonly CmsRevisionResourceEntity[],
    ): string[] => [
      ...new Set(
        resourcesForType.flatMap((resource) =>
          sourceOrder
            .map((source) => pointerFor(resource, source))
            .filter((revisionId): revisionId is string => revisionId !== null),
        ),
      ),
    ];
    const instancePointerRevisionIds = pointerIdsFor(instanceResources);
    const layoutPointerRevisionIds = pointerIdsFor(layoutResources);
    const instanceRevisions =
      instancePointerRevisionIds.length === 0
        ? []
        : await db.find(CmsRevisionEntity, {
            select: { id: true, resourceId: true },
            where: { id: In(instancePointerRevisionIds) },
          });
    const layoutRevisions =
      layoutPointerRevisionIds.length === 0
        ? []
        : await db.find(CmsRevisionEntity, {
            select: { id: true, resourceId: true, snapshot: true },
            where: { id: In(layoutPointerRevisionIds) },
          });
    const instanceLinks =
      instancePointerRevisionIds.length === 0
        ? []
        : await db.find(ManagedChunkInstanceRevisionEntity, {
            select: {
              revisionId: true,
              revisionResourceId: true,
              siteId: true,
              instanceId: true,
              contractId: true,
            },
            where: { revisionId: In(instancePointerRevisionIds) },
          });
    const linkedContractIds = [
      ...new Set(instanceLinks.map((link) => link.contractId)),
    ];
    const storedContracts =
      linkedContractIds.length === 0
        ? []
        : await db.find(ManagedChunkContractEntity, {
            select: {
              id: true,
              templatePackageId: true,
              definitionKey: true,
              schemaVersion: true,
              contractDigest: true,
            },
            where: { id: In(linkedContractIds) },
          });
    const storedPlacements =
      layoutPointerRevisionIds.length === 0
        ? []
        : await db.find(ManagedChunkPlacementEntity, {
            select: {
              siteId: true,
              layoutId: true,
              layoutRevisionResourceId: true,
              layoutRevisionId: true,
              instanceId: true,
              slotKey: true,
              position: true,
            },
            where: { layoutRevisionId: In(layoutPointerRevisionIds) },
          });

    const groupBy = <T>(
      rows: readonly T[],
      identity: (row: T) => string,
    ): Map<string, T[]> => {
      const result = new Map<string, T[]>();
      for (const row of rows) {
        const key = identity(row);
        const group = result.get(key);
        if (group) group.push(row);
        else result.set(key, [row]);
      }
      return result;
    };
    const instanceRevisionsById = groupBy(
      instanceRevisions,
      (revision) => revision.id,
    );
    const layoutRevisionsById = groupBy(
      layoutRevisions,
      (revision) => revision.id,
    );
    const linksByRevisionId = groupBy(instanceLinks, (link) => link.revisionId);
    const contractsById = groupBy(storedContracts, (contract) => contract.id);
    const placementsByRevisionId = groupBy(
      storedPlacements,
      (placement) => placement.layoutRevisionId,
    );

    const resolveInstanceContract = (
      resource: CmsRevisionResourceEntity,
      source: ManagedChunkContentSource,
    ): ManagedChunkContractEntity | null => {
      const revisionId = pointerFor(resource, source);
      if (revisionId === null) return null;
      const owner = instanceById.get(resource.entityId);
      const revisions = instanceRevisionsById.get(revisionId) ?? [];
      const links = linksByRevisionId.get(revisionId) ?? [];
      if (!owner || revisions.length !== 1 || links.length !== 1) {
        this.compatibilityInventoryCorrupt();
      }
      const revision = revisions[0];
      const link = links[0];
      if (
        revision.resourceId !== resource.id ||
        link.revisionResourceId !== resource.id ||
        link.siteId !== siteId ||
        link.instanceId !== owner.id
      ) {
        this.compatibilityInventoryCorrupt();
      }
      const contracts = contractsById.get(link.contractId) ?? [];
      if (
        contracts.length !== 1 ||
        contracts[0].templatePackageId !== templatePackageId
      ) {
        this.compatibilityInventoryCorrupt();
      }
      return contracts[0];
    };

    const sourceRank = new Map<ManagedChunkContentSource, number>(
      sourceOrder.map((source, index) => [source, index]),
    );
    const resolvedInstances = new Map<
      string,
      ManagedChunkContractEntity | null
    >();
    const contractsByIdentity = new Map<
      string,
      ManagedChunkContractRequirement
    >();
    for (const resource of instanceResources) {
      for (const source of sourceOrder) {
        const contract = resolveInstanceContract(resource, source);
        resolvedInstances.set(
          this.inventorySourceIdentity(source, resource.entityId),
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
    for (const resource of layoutResources) {
      const layout = layoutById.get(resource.entityId);
      if (!layout || activeResourceById.get(resource.id) !== resource) {
        this.compatibilityInventoryCorrupt();
      }
      const layoutKey = this.inventoryLayoutKey(layout);
      if (!layoutKey) this.compatibilityInventoryCorrupt();
      for (const source of sourceOrder) {
        const revisionId = pointerFor(resource, source);
        if (revisionId === null) continue;
        const revisions = layoutRevisionsById.get(revisionId) ?? [];
        if (revisions.length !== 1 || revisions[0].resourceId !== resource.id) {
          this.compatibilityInventoryCorrupt();
        }
        const snapshot: unknown = revisions[0].snapshot;
        if (
          snapshot === null ||
          typeof snapshot !== 'object' ||
          Array.isArray(snapshot) ||
          Object.keys(snapshot).sort().join(',') !==
            'formatVersion,templateKey,templateVersion'
        ) {
          this.compatibilityInventoryCorrupt();
        }
        const snapshotRecord = snapshot as Record<string, unknown>;
        const templateKey = snapshotRecord.templateKey;
        const templateVersion = snapshotRecord.templateVersion;
        if (
          snapshotRecord.formatVersion !== 1 ||
          typeof templateKey !== 'string' ||
          typeof templateVersion !== 'string'
        ) {
          this.compatibilityInventoryCorrupt();
        }

        const revisionPlacements = placementsByRevisionId.get(revisionId) ?? [];
        for (const placement of revisionPlacements) {
          if (
            placement.siteId !== siteId ||
            placement.layoutId !== layout.id ||
            placement.layoutRevisionResourceId !== resource.id ||
            placement.layoutRevisionId !== revisionId ||
            !instanceById.has(placement.instanceId)
          ) {
            this.compatibilityInventoryCorrupt();
          }
          const contract = resolvedInstances.get(
            this.inventorySourceIdentity(source, placement.instanceId),
          );
          if (!contract) this.compatibilityInventoryCorrupt();
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
  }
  private inventorySourceIdentity(
    source: ManagedChunkContentSource,
    instanceId: string,
  ): string {
    return JSON.stringify([source, instanceId]);
  }

  private inventoryLayoutKey(layout: ManagedChunkLayoutEntity): string | null {
    if (
      layout.scopeKind === 'page' &&
      layout.pageId &&
      layout.surfaceKey === null
    ) {
      return 'page:' + layout.pageId;
    }
    if (
      layout.scopeKind === 'site_surface' &&
      layout.pageId === null &&
      layout.surfaceKey
    ) {
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

  private compatibilityInventoryCorrupt(): never {
    throw new ConflictException('Данные управляемого контента повреждены');
  }

  async restoreInstanceRevision(input: {
    siteId: string;
    instanceId: string;
    sourceRevisionId: string;
    expectedDraftRevisionId: string | null;
    actor: RevisionActor;
    validateUsingManager?: (
      db: EntityManager,
      snapshot: Record<string, unknown>,
      contractId: string,
    ) => Promise<void>;
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
          await input.validateUsingManager?.(
            prepareDb,
            prepared.revision.snapshot,
            prepared.link.contractId,
          );
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

  async saveInstanceDraft(input: {
    siteId: string;
    instanceId: string;
    data: Record<string, unknown>;
    expectedDraftRevisionId: string | null;
    actor: RevisionActor;
    validateUsingManager?: (db: EntityManager) => Promise<void>;
  }): Promise<{ revisionId: string; versionNumber: number }> {
    const siteId = String(input.siteId);
    const instanceId = String(input.instanceId);
    const actor = { ...input.actor };
    const snapshot = {
      formatVersion: 1,
      data: structuredClone(input.data),
      sanitizerPolicyVersion: null,
    };
    return this.dataSource.transaction(async (db) => {
      let contractId: string | null = null;
      const revision =
        await this.revisions.savePreparedManagedDraftUsingManager(
          db,
          {
            siteId,
            resourceType: 'chunk_instance',
            snapshot,
            expectedDraftRevisionId: input.expectedDraftRevisionId,
            actor,
          },
          async (prepareDb) => {
            const instance = await prepareDb.findOne(
              ManagedChunkInstanceEntity,
              {
                where: { id: instanceId, siteId, isArchived: false },
                lock: { mode: 'pessimistic_read' },
              },
            );
            if (!instance) this.managedRevisionNotFound();
            const resource = await prepareDb.findOne(
              CmsRevisionResourceEntity,
              {
                where: {
                  id: instance.revisionResourceId,
                  siteId,
                  resourceType: 'chunk_instance',
                  entityId: instanceId,
                },
                lock: { mode: 'pessimistic_write' },
              },
            );
            if (!resource) this.managedRevisionNotFound();
            const currentRevisionId =
              resource.draftRevisionId ??
              resource.publishedRevisionId ??
              resource.approvedRevisionId;
            if (!currentRevisionId) this.managedRevisionNotFound();
            const link = await prepareDb.findOne(
              ManagedChunkInstanceRevisionEntity,
              {
                where: {
                  revisionId: currentRevisionId,
                  revisionResourceId: resource.id,
                  siteId,
                  instanceId,
                },
                lock: { mode: 'pessimistic_read' },
              },
            );
            if (!link) this.managedRevisionNotFound();
            contractId = link.contractId;
            await input.validateUsingManager?.(prepareDb);
            return {
              entityId: instanceId,
              proof: { kind: 'instance' as const, contractId },
            };
          },
          async (hookDb, savedRevision, resource) => {
            if (!contractId) this.managedRevisionNotFound();
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
      return { revisionId: revision.id, versionNumber: revision.versionNumber };
    });
  }

  async submitInstanceRevision(input: {
    siteId: string;
    instanceId: string;
    revisionId: string;
    actor: RevisionActor;
  }): Promise<void> {
    return this.runInstanceLifecycle(input, 'submit');
  }

  async requestInstanceRevisionChanges(input: {
    siteId: string;
    instanceId: string;
    revisionId: string;
    actor: RevisionActor;
    reason: string;
  }): Promise<void> {
    return this.runInstanceLifecycle(input, 'request_changes', input.reason);
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
    operation: 'submit' | 'approve' | 'request_changes' | 'publish',
    reason?: string,
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
      if (operation === 'submit') {
        await this.revisions.submitManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      } else if (operation === 'approve') {
        await this.revisions.approveManagedRevisionUsingManager(
          db,
          lifecycleInput,
          prepare,
        );
      } else if (operation === 'request_changes') {
        await this.revisions.requestManagedRevisionChangesUsingManager(
          db,
          lifecycleInput,
          reason ?? '',
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
            return {
              entityId: layout?.id ?? randomUUID(),
              proof: {
                kind: 'layout' as const,
                placements: placements.map((placement) => ({ ...placement })),
              },
            };
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
    validateUsingManager?: (db: EntityManager) => Promise<void>;
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
            await input.validateUsingManager?.(prepareDb);
            return {
              entityId: instanceId,
              proof: { kind: 'instance' as const, contractId },
            };
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
    return this.dataSource.transaction((manager) =>
      this.registerPreparedContracts(manager, prepared),
    );
  }

  async registerContractsUsingManager(
    manager: EntityManager,
    input: RegisterManagedChunkContractsInput,
  ): Promise<ManagedChunkContractEntity[]> {
    return this.registerPreparedContracts(
      manager,
      this.prepareRegistration(input),
    );
  }

  private async registerPreparedContracts(
    manager: EntityManager,
    prepared: PreparedRegistration,
  ): Promise<ManagedChunkContractEntity[]> {
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
