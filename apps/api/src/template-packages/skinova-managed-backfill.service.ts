import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  BannerEntity,
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkMigrationProvenanceEntity,
  ManagedChunkPlacementEntity,
  PageBannerAssignmentEntity,
  PageEntity,
  SiteEntity,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  canonicalSkinovaSourceChecksum,
  projectSkinovaManagedBackfill,
  type SkinovaManagedInstanceProjection,
  type SkinovaManagedLayoutProjection,
  type SkinovaManagedPlacementProjection,
} from './skinova-managed-backfill.projection';

type BackfillCounts = {
  instances: number;
  layouts: number;
  placements: number;
  provenance: number;
};

export type SkinovaManagedBackfillResult = {
  siteId: string;
  status: 'created' | 'repaired' | 'unchanged';
  created: BackfillCounts;
  repairedProvenance: number;
};

const REQUIRED_CONTRACTS = [
  'skinova-promo-strip',
  'skinova-consultation-banner',
  'skinova-article-sidebar-banner',
] as const;

const sameJson = (left: unknown, right: unknown): boolean =>
  canonicalSkinovaSourceChecksum(left) ===
  canonicalSkinovaSourceChecksum(right);

@Injectable()
export class SkinovaManagedBackfillService {
  constructor(private readonly dataSource: DataSource) {}

  async backfill(siteId: string): Promise<SkinovaManagedBackfillResult> {
    if (!isUUID(siteId)) {
      throw new BadRequestException('Некорректный идентификатор сайта');
    }
    return this.dataSource.transaction((db) =>
      this.backfillUsingManager(db, siteId),
    );
  }

  private async backfillUsingManager(
    db: EntityManager,
    siteId: string,
  ): Promise<SkinovaManagedBackfillResult> {
    const site = await db.findOne(SiteEntity, {
      where: { id: siteId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!site) throw new NotFoundException('Сайт не найден');

    const templatePackage = await db.findOne(TemplatePackageEntity, {
      where: { packageId: 'skinova-media' },
      lock: { mode: 'pessimistic_read' },
    });
    if (!templatePackage) {
      throw new ConflictException(
        'Skinova managed backfill: package skinova-media is not registered',
      );
    }
    const packageVersion = await db.findOne(TemplatePackageVersionEntity, {
      where: {
        templatePackageId: templatePackage.id,
        packageVersion: '2',
      },
      lock: { mode: 'pessimistic_read' },
    });
    if (!packageVersion || packageVersion.manifestVersion !== 2) {
      throw new ConflictException(
        'Skinova managed backfill: package skinova-media@2 is not registered',
      );
    }

    const contracts = await db.find(ManagedChunkContractEntity, {
      where: { templatePackageId: templatePackage.id },
      lock: { mode: 'pessimistic_read' },
    });
    const contractByKey = new Map(
      contracts
        .filter(({ schemaVersion }) => schemaVersion === '1')
        .map((contract) => [contract.definitionKey, contract]),
    );
    for (const definitionKey of REQUIRED_CONTRACTS) {
      const contract = contractByKey.get(definitionKey);
      if (
        !contract ||
        contract.firstSeenTemplatePackageVersionId !== packageVersion.id
      ) {
        throw new ConflictException(
          `Skinova managed backfill: contract ${definitionKey}@1 is not registered by skinova-media@2`,
        );
      }
    }

    const banners = await db.find(BannerEntity, {
      where: { siteId },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    const pages = await db.find(PageEntity, {
      where: { siteId },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    const assignments = await db.find(PageBannerAssignmentEntity, {
      where: { siteId },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    const projection = projectSkinovaManagedBackfill({
      siteId,
      banners,
      pages,
      assignments,
    });

    const created: BackfillCounts = {
      instances: 0,
      layouts: 0,
      placements: 0,
      provenance: 0,
    };
    let repairedProvenance = 0;

    for (const instance of projection.instances) {
      const contract = contractByKey.get(instance.definitionKey);
      if (!contract) {
        throw new ConflictException(
          `Skinova managed backfill: contract ${instance.definitionKey}@1 disappeared`,
        );
      }
      const result = await this.materializeInstance(
        db,
        instance,
        contract,
        created,
      );
      repairedProvenance += result.repairedProvenance;
    }
    for (const layout of projection.layouts) {
      const result = await this.materializeLayout(db, siteId, layout, created);
      repairedProvenance += result.repairedProvenance;
    }

    const createdAnything = Object.values(created).some((count) => count > 0);
    return {
      siteId,
      status: createdAnything
        ? 'created'
        : repairedProvenance > 0
          ? 'repaired'
          : 'unchanged',
      created,
      repairedProvenance,
    };
  }

  private conflict(message: string): never {
    throw new ConflictException(`Skinova managed backfill: ${message}`);
  }

  private async materializeInstance(
    db: EntityManager,
    expected: SkinovaManagedInstanceProjection,
    contract: ManagedChunkContractEntity,
    created: BackfillCounts,
  ): Promise<{ repairedProvenance: number }> {
    const provenance = await this.findProvenance(db, expected);
    const instance = await db.findOne(ManagedChunkInstanceEntity, {
      where: { id: expected.id, siteId: expected.siteId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!instance) {
      if (provenance)
        this.conflict(`provenance exists without instance ${expected.id}`);
      const partialResource = await db.findOne(CmsRevisionResourceEntity, {
        where: {
          siteId: expected.siteId,
          resourceType: 'chunk_instance',
          entityId: expected.id,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (partialResource) {
        this.conflict(`partial instance resource exists for ${expected.id}`);
      }

      const resourceId = randomUUID();
      const revisionId = randomUUID();
      const resource = Object.assign(new CmsRevisionResourceEntity(), {
        id: resourceId,
        siteId: expected.siteId,
        resourceType: 'chunk_instance',
        entityId: expected.id,
        latestVersionNumber: 0,
        draftRevisionId: null,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft' as const,
      });
      await db.save(resource);
      await db.save(
        Object.assign(new ManagedChunkInstanceEntity(), {
          id: expected.id,
          siteId: expected.siteId,
          revisionResourceId: resourceId,
          displayName: expected.displayName,
          isArchived: false,
          createdByUserId: null,
        }),
      );
      const snapshot = {
        formatVersion: 1,
        data: structuredClone(expected.data),
        sanitizerPolicyVersion: null,
      };
      await db.save(
        Object.assign(new CmsRevisionEntity(), {
          id: revisionId,
          resourceId,
          versionNumber: 1,
          snapshot,
          actorUserId: null,
        }),
      );
      await db.save(
        Object.assign(new ManagedChunkInstanceRevisionEntity(), {
          revisionId,
          revisionResourceId: resourceId,
          siteId: expected.siteId,
          instanceId: expected.id,
          contractId: contract.id,
        }),
      );
      Object.assign(resource, {
        latestVersionNumber: 1,
        draftRevisionId: revisionId,
        approvedRevisionId: revisionId,
        publishedRevisionId: revisionId,
        reviewState: 'approved' as const,
      });
      await db.save(resource);
      await this.saveBaselineEvent(db, resourceId, revisionId);
      await this.saveProvenance(db, expected, {
        instanceId: expected.id,
        layoutId: null,
        placementId: null,
      });
      created.instances += 1;
      created.provenance += 1;
      return { repairedProvenance: 0 };
    }

    const resource = await this.exactResource(
      db,
      expected.siteId,
      'chunk_instance',
      expected.id,
      instance.revisionResourceId,
    );
    if (
      instance.displayName !== expected.displayName ||
      instance.isArchived !== false
    ) {
      this.conflict(`instance ${expected.id} differs from legacy source`);
    }
    const revision = await this.exactPublishedRevision(db, resource, {
      formatVersion: 1,
      data: expected.data,
      sanitizerPolicyVersion: null,
    });
    const link = await db.findOne(ManagedChunkInstanceRevisionEntity, {
      where: {
        revisionId: revision.id,
        revisionResourceId: resource.id,
        siteId: expected.siteId,
        instanceId: expected.id,
      },
      lock: { mode: 'pessimistic_read' },
    });
    if (!link || link.contractId !== contract.id) {
      this.conflict(`instance revision contract differs for ${expected.id}`);
    }

    if (provenance) {
      this.assertProvenance(provenance, expected, {
        instanceId: expected.id,
        layoutId: null,
        placementId: null,
      });
      return { repairedProvenance: 0 };
    }
    await this.saveProvenance(db, expected, {
      instanceId: expected.id,
      layoutId: null,
      placementId: null,
    });
    created.provenance += 1;
    return { repairedProvenance: 1 };
  }

  private async materializeLayout(
    db: EntityManager,
    siteId: string,
    expected: SkinovaManagedLayoutProjection,
    created: BackfillCounts,
  ): Promise<{ repairedProvenance: number }> {
    const where =
      expected.scopeKind === 'page'
        ? {
            siteId,
            scopeKind: 'page' as const,
            pageId: expected.pageId,
          }
        : {
            siteId,
            scopeKind: 'site_surface' as const,
            surfaceKey: expected.surfaceKey,
          };
    const layout = await db.findOne(ManagedChunkLayoutEntity, {
      where,
      lock: { mode: 'pessimistic_write' },
    });

    if (!layout) {
      for (const placement of expected.placements) {
        if (await this.findProvenance(db, placement)) {
          this.conflict(
            `placement provenance exists without layout ${expected.layoutKey}`,
          );
        }
      }
      const layoutId = randomUUID();
      const resourceId = randomUUID();
      const revisionId = randomUUID();
      const resource = Object.assign(new CmsRevisionResourceEntity(), {
        id: resourceId,
        siteId,
        resourceType: 'chunk_layout',
        entityId: layoutId,
        latestVersionNumber: 0,
        draftRevisionId: null,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft' as const,
      });
      await db.save(resource);
      await db.save(
        Object.assign(new ManagedChunkLayoutEntity(), {
          id: layoutId,
          siteId,
          revisionResourceId: resourceId,
          scopeKind: expected.scopeKind,
          pageId: expected.pageId,
          surfaceKey: expected.surfaceKey,
        }),
      );
      const snapshot = {
        formatVersion: 1,
        templateKey: expected.templateKey,
        templateVersion: expected.templateVersion,
      };
      await db.save(
        Object.assign(new CmsRevisionEntity(), {
          id: revisionId,
          resourceId,
          versionNumber: 1,
          snapshot,
          actorUserId: null,
        }),
      );
      for (const placement of expected.placements) {
        const placementId = randomUUID();
        await db.save(
          Object.assign(new ManagedChunkPlacementEntity(), {
            id: placementId,
            siteId,
            layoutId,
            layoutRevisionResourceId: resourceId,
            layoutRevisionId: revisionId,
            instanceId: placement.instanceId,
            slotKey: placement.slotKey,
            position: placement.position,
          }),
        );
        await this.saveProvenance(db, placement, {
          instanceId: null,
          layoutId: null,
          placementId,
        });
        created.placements += 1;
        created.provenance += 1;
      }
      Object.assign(resource, {
        latestVersionNumber: 1,
        draftRevisionId: revisionId,
        approvedRevisionId: revisionId,
        publishedRevisionId: revisionId,
        reviewState: 'approved' as const,
      });
      await db.save(resource);
      await this.saveBaselineEvent(db, resourceId, revisionId);
      created.layouts += 1;
      return { repairedProvenance: 0 };
    }

    if (
      layout.scopeKind !== expected.scopeKind ||
      layout.pageId !== expected.pageId ||
      layout.surfaceKey !== expected.surfaceKey
    ) {
      this.conflict(`layout target differs for ${expected.layoutKey}`);
    }
    const resource = await this.exactResource(
      db,
      siteId,
      'chunk_layout',
      layout.id,
      layout.revisionResourceId,
    );
    const revision = await this.exactPublishedRevision(db, resource, {
      formatVersion: 1,
      templateKey: expected.templateKey,
      templateVersion: expected.templateVersion,
    });
    const placements = await db.find(ManagedChunkPlacementEntity, {
      where: {
        siteId,
        layoutId: layout.id,
        layoutRevisionResourceId: resource.id,
        layoutRevisionId: revision.id,
      },
      order: { slotKey: 'ASC', position: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    const actualByKey = new Map(
      placements.map((placement) => [
        `${placement.slotKey}:${placement.position}:${placement.instanceId}`,
        placement,
      ]),
    );
    if (actualByKey.size !== expected.placements.length) {
      this.conflict(`layout placements differ for ${expected.layoutKey}`);
    }

    let repairedProvenance = 0;
    for (const expectedPlacement of expected.placements) {
      const key = `${expectedPlacement.slotKey}:${expectedPlacement.position}:${expectedPlacement.instanceId}`;
      const actual = actualByKey.get(key);
      if (!actual) {
        this.conflict(`layout placements differ for ${expected.layoutKey}`);
      }
      const provenance = await this.findProvenance(db, expectedPlacement);
      const target = {
        instanceId: null,
        layoutId: null,
        placementId: actual.id,
      };
      if (provenance) {
        this.assertProvenance(provenance, expectedPlacement, target);
      } else {
        await this.saveProvenance(db, expectedPlacement, target);
        created.provenance += 1;
        repairedProvenance += 1;
      }
    }
    return { repairedProvenance };
  }

  private async exactResource(
    db: EntityManager,
    siteId: string,
    resourceType: 'chunk_instance' | 'chunk_layout',
    entityId: string,
    resourceId: string,
  ): Promise<CmsRevisionResourceEntity> {
    const resource = await db.findOne(CmsRevisionResourceEntity, {
      where: { id: resourceId, siteId, resourceType, entityId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !resource ||
      resource.latestVersionNumber !== 1 ||
      resource.reviewState !== 'approved' ||
      !resource.publishedRevisionId ||
      resource.draftRevisionId !== resource.publishedRevisionId ||
      resource.approvedRevisionId !== resource.publishedRevisionId
    ) {
      this.conflict(`managed baseline is partial or changed for ${entityId}`);
    }
    return resource;
  }

  private async exactPublishedRevision(
    db: EntityManager,
    resource: CmsRevisionResourceEntity,
    expectedSnapshot: Record<string, unknown>,
  ): Promise<CmsRevisionEntity> {
    const revision = await db.findOne(CmsRevisionEntity, {
      where: {
        id: resource.publishedRevisionId!,
        resourceId: resource.id,
        versionNumber: 1,
      },
      lock: { mode: 'pessimistic_read' },
    });
    if (!revision || !sameJson(revision.snapshot, expectedSnapshot)) {
      this.conflict(
        `published baseline differs for managed resource ${resource.entityId}`,
      );
    }
    return revision;
  }

  private async saveBaselineEvent(
    db: EntityManager,
    resourceId: string,
    revisionId: string,
  ): Promise<void> {
    await db.save(
      Object.assign(new CmsRevisionEventEntity(), {
        id: randomUUID(),
        resourceId,
        revisionId,
        eventType: 'baseline_imported',
        actorUserId: null,
        reason: 'Skinova legacy published backfill',
      }),
    );
  }

  private findProvenance(
    db: EntityManager,
    source: {
      migrationVersion: string;
      sourceType: 'banner' | 'page_banner_assignment';
      sourceId: string;
    },
  ): Promise<ManagedChunkMigrationProvenanceEntity | null> {
    return db.findOne(ManagedChunkMigrationProvenanceEntity, {
      where: {
        migrationVersion: source.migrationVersion,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private assertProvenance(
    actual: ManagedChunkMigrationProvenanceEntity,
    expected: {
      siteId?: string;
      sourceChecksum: string;
      sourceId: string;
    },
    target: {
      instanceId: string | null;
      layoutId: string | null;
      placementId: string | null;
    },
  ): void {
    const siteId = expected.siteId ?? actual.siteId;
    if (
      actual.siteId !== siteId ||
      actual.sourceChecksum !== expected.sourceChecksum ||
      actual.instanceId !== target.instanceId ||
      actual.layoutId !== target.layoutId ||
      actual.placementId !== target.placementId
    ) {
      this.conflict(`provenance conflict for source ${expected.sourceId}`);
    }
  }

  private async saveProvenance(
    db: EntityManager,
    source:
      SkinovaManagedInstanceProjection | SkinovaManagedPlacementProjection,
    target: {
      instanceId: string | null;
      layoutId: string | null;
      placementId: string | null;
    },
  ): Promise<void> {
    const siteId = source.siteId;
    await db.save(
      Object.assign(new ManagedChunkMigrationProvenanceEntity(), {
        id: randomUUID(),
        siteId,
        migrationVersion: source.migrationVersion,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceChecksum: source.sourceChecksum,
        ...target,
      }),
    );
  }
}
