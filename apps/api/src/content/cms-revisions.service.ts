import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  PlatformRole,
  SiteAccessEntity,
  SiteRole,
  SiteEntity,
} from '../database/entities';
import {
  hasSitePermission,
  type SiteAccessGrant,
  SitePermission,
} from './content.permissions';
import {
  approveRevision,
  publishRevision,
  requestChanges,
  saveDraftRevision,
  submitRevision,
  type RevisionPointers,
} from './revision-workflow';

export type CmsResourceType =
  | 'article'
  | 'category'
  | 'author'
  | 'page'
  | 'banner'
  | 'site_globals'
  | 'site_header'
  | 'site_footer'
  | 'site_variables'
  | 'site_seo'
  | 'site_search'
  | 'site_not_found'
  | 'site_privacy'
  | 'site_article_list'
  | 'site_layout_bindings'
  | 'media_alt'
  | 'site_variable';

export type ManagedCmsResourceType = 'chunk_instance' | 'chunk_layout';

type RevisionResourceType = CmsResourceType | ManagedCmsResourceType;

export type RevisionActor = { userId: string; platformRole: PlatformRole };

export type RevisionCreatedHook = (
  db: EntityManager,
  revision: CmsRevisionEntity,
  resource: CmsRevisionResourceEntity,
) => Promise<void>;

export type ManagedRevisionLifecycleContext = {
  resource: CmsRevisionResourceEntity;
  revision: CmsRevisionEntity;
};

export type ManagedRevisionLifecyclePrepare = (
  db: EntityManager,
) => Promise<ManagedRevisionLifecycleContext>;

export type ManagedRevisionRestorePrepare = (
  db: EntityManager,
) => Promise<ManagedRevisionLifecycleContext>;

type VerifiedManagedRevision = ManagedRevisionLifecycleContext &
  (
    | { kind: 'instance'; contractId: string }
    | { kind: 'layout'; placementSet: string[] }
  );

@Injectable()
export class CmsRevisionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(SiteAccessEntity)
    private readonly siteAccesses: Repository<SiteAccessEntity>,
  ) {}

  private permission(resourceType: RevisionResourceType) {
    return resourceType === 'site_layout_bindings' ||
      resourceType === 'site_article_list'
      ? SitePermission.MANAGE_STRUCTURE
      : SitePermission.EDIT_CONTENT;
  }

  private assertGenericResourceType(
    resourceType: RevisionResourceType,
  ): asserts resourceType is CmsResourceType {
    if (resourceType === 'chunk_instance' || resourceType === 'chunk_layout') {
      throw new BadRequestException(
        'Управляемый ресурс требует типизированного workflow',
      );
    }
  }

  private assertManagedResourceType(
    resourceType: RevisionResourceType,
  ): asserts resourceType is ManagedCmsResourceType {
    if (resourceType !== 'chunk_instance' && resourceType !== 'chunk_layout') {
      throw new BadRequestException('Ожидался тип управляемого ресурса');
    }
  }

  private templateAssignmentFields(resourceType: CmsResourceType) {
    if (resourceType === 'article' || resourceType === 'category')
      return [
        'displayTemplateKey',
        'displayTemplateVersion',
        'displayTemplateConfig',
      ] as const;
    if (resourceType === 'site_privacy') return ['displayTemplate'] as const;
    if (resourceType === 'site_not_found')
      return ['templateKey', 'templateVersion'] as const;
    return [] as const;
  }

  private templateAssignment(
    resourceType: CmsResourceType,
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (resourceType === 'article' || resourceType === 'category')
      return {
        key: snapshot.displayTemplateKey,
        version: snapshot.displayTemplateVersion,
        config: snapshot.displayTemplateConfig ?? {},
      };
    if (resourceType === 'site_privacy') {
      const value = snapshot.displayTemplate;
      const template =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return {
        key: template.key,
        version: template.version,
        config: template.config ?? {},
      };
    }
    if (resourceType === 'site_not_found')
      return {
        key: snapshot.templateKey,
        version: snapshot.templateVersion,
      };
    return null;
  }

  private changesTemplateAssignment(
    resourceType: CmsResourceType,
    next: Record<string, unknown>,
    published: Record<string, unknown>,
  ) {
    const nextAssignment = this.templateAssignment(resourceType, next);
    const publishedAssignment = this.templateAssignment(
      resourceType,
      published,
    );
    return (
      nextAssignment !== null &&
      publishedAssignment !== null &&
      !isDeepStrictEqual(nextAssignment, publishedAssignment)
    );
  }
  private preserveTemplateAssignment(
    resourceType: CmsResourceType,
    restoredSnapshot: Record<string, unknown>,
    currentSnapshot: Record<string, unknown>,
  ) {
    const snapshot = structuredClone(restoredSnapshot);
    for (const field of this.templateAssignmentFields(resourceType)) {
      if (Object.hasOwn(currentSnapshot, field))
        snapshot[field] = structuredClone(currentSnapshot[field]);
      else delete snapshot[field];
    }
    return snapshot;
  }

  private async requireSite(
    siteId: string,
    actor: RevisionActor,
    permission: SitePermission,
    manager?: EntityManager,
  ): Promise<SiteAccessGrant | null> {
    const site = manager
      ? await manager.findOne(SiteEntity, { where: { id: siteId } })
      : await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole === PlatformRole.WISPO_ADMIN) return null;
    const options = {
      select: {
        role: true,
        requiresApproval: true,
      },
      where: { userId: actor.userId, siteId },
    } as const;
    const access = manager
      ? await manager.findOne(SiteAccessEntity, {
          ...options,
          lock: { mode: 'pessimistic_read' },
        })
      : await this.siteAccesses.findOne(options);
    if (!access || !hasSitePermission(actor.platformRole, access, permission))
      throw new ForbiddenException('Недостаточно прав для этого сайта');
    return access;
  }

  assertSitePermission(
    siteId: string,
    actor: RevisionActor,
    permission: SitePermission,
  ) {
    return this.requireSite(siteId, actor, permission);
  }

  private async authorizeManagedPermissionUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      actor: RevisionActor;
    },
    permission: SitePermission,
  ): Promise<SiteAccessGrant | null> {
    this.assertManagedResourceType(input.resourceType);
    if (input.actor.platformRole === PlatformRole.WISPO_ADMIN) return null;
    // Match access reassignment order: never hold a site/target lock while
    // waiting for the actor's access row.
    const access = await db.findOne(SiteAccessEntity, {
      select: {
        role: true,
        requiresApproval: true,
      },
      where: { userId: input.actor.userId, siteId: input.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      !access ||
      !hasSitePermission(input.actor.platformRole, access, permission)
    ) {
      throw new ForbiddenException('Недостаточно прав для этого сайта');
    }
    return access;
  }

  async authorizeManagedWriteUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      actor: RevisionActor;
    },
  ): Promise<void> {
    await this.authorizeManagedPermissionUsingManager(
      db,
      input,
      this.permission(input.resourceType),
    );
  }

  private async lockedResource(
    db: EntityManager,
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
  ) {
    const resource = await db.findOne(CmsRevisionResourceEntity, {
      where: { siteId, resourceType, entityId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) throw new NotFoundException('Ресурс не найден');
    return resource;
  }

  private pointers(resource: CmsRevisionResourceEntity): RevisionPointers {
    return {
      draftRevisionId: resource.draftRevisionId,
      approvedRevisionId: resource.approvedRevisionId,
      publishedRevisionId: resource.publishedRevisionId,
      reviewState: resource.reviewState,
    };
  }

  private async event(
    db: EntityManager,
    resourceId: string,
    revisionId: string,
    eventType: string,
    actorUserId: string,
    reason: string | null = null,
  ) {
    await db.save(
      Object.assign(new CmsRevisionEventEntity(), {
        id: randomUUID(),
        resourceId,
        revisionId,
        eventType,
        actorUserId,
        reason,
      }),
    );
  }

  private async saveDraftInTransaction(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: RevisionResourceType;
      entityId: string;
      snapshot: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
    eventType = 'draft_saved',
    reason: string | null = null,
    revisionCreatedHook?: RevisionCreatedHook,
  ) {
    let resource = await db.findOne(CmsRevisionResourceEntity, {
      where: {
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) {
      resource = Object.assign(new CmsRevisionResourceEntity(), {
        id: randomUUID(),
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
        latestVersionNumber: 0,
        draftRevisionId: null,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft' as const,
      });
      await db.save(resource);
    }
    const revisionId = randomUUID();
    const next = saveDraftRevision(
      this.pointers(resource),
      revisionId,
      input.expectedDraftRevisionId,
    );
    const version = Object.assign(new CmsRevisionEntity(), {
      id: revisionId,
      resourceId: resource.id,
      versionNumber: resource.latestVersionNumber + 1,
      snapshot: structuredClone(input.snapshot),
      actorUserId: input.actor.userId,
    });
    await db.save(version);
    await revisionCreatedHook?.(db, version, resource);
    Object.assign(resource, next, {
      latestVersionNumber: version.versionNumber,
    });
    await db.save(resource);
    await this.event(
      db,
      resource.id,
      revisionId,
      eventType,
      input.actor.userId,
      reason,
    );
    return { id: revisionId, versionNumber: version.versionNumber };
  }

  async saveDraft(input: {
    siteId: string;
    resourceType: CmsResourceType;
    entityId: string;
    snapshot: Record<string, unknown>;
    expectedDraftRevisionId: string | null;
    actor: RevisionActor;
  }): Promise<{ id: string; versionNumber: number }> {
    this.assertGenericResourceType(input.resourceType);
    return this.dataSource.transaction(async (db) => {
      await this.requireSite(
        input.siteId,
        input.actor,
        this.permission(input.resourceType),
        db,
      );
      return this.saveDraftInTransaction(db, input);
    });
  }

  async saveDraftUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: CmsResourceType;
      entityId: string;
      snapshot: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
  ): Promise<{ id: string; versionNumber: number }> {
    this.assertGenericResourceType(input.resourceType);
    await this.requireSite(
      input.siteId,
      input.actor,
      this.permission(input.resourceType),
      db,
    );
    return this.saveDraftInTransaction(db, input);
  }

  async savePreparedManagedDraftUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      snapshot: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
    prepare: (manager: EntityManager) => Promise<{ entityId: string }>,
    revisionCreatedHook: RevisionCreatedHook,
  ): Promise<{ id: string; versionNumber: number; entityId: string }> {
    this.assertManagedResourceType(input.resourceType);
    if (
      typeof prepare !== 'function' ||
      typeof revisionCreatedHook !== 'function'
    ) {
      throw new BadRequestException(
        'Управляемый ресурс требует prepare и revision-created hook',
      );
    }
    await this.authorizeManagedWriteUsingManager(db, {
      siteId: input.siteId,
      resourceType: input.resourceType,
      actor: input.actor,
    });
    const prepared = await prepare(db);
    const revision = await this.saveDraftInTransaction(
      db,
      { ...input, entityId: prepared.entityId },
      'draft_saved',
      null,
      revisionCreatedHook,
    );
    return { ...revision, entityId: prepared.entityId };
  }

  async saveManagedDraftUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      snapshot: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
    revisionCreatedHook: RevisionCreatedHook,
  ): Promise<{ id: string; versionNumber: number }> {
    const { entityId, ...managedInput } = input;
    const revision = await this.savePreparedManagedDraftUsingManager(
      db,
      managedInput,
      async (prepareDb) => {
        const site = await prepareDb.findOne(SiteEntity, {
          where: { id: input.siteId },
          lock: { mode: 'pessimistic_read' },
        });
        if (!site) throw new NotFoundException('Сайт не найден');
        return { entityId };
      },
      revisionCreatedHook,
    );
    return { id: revision.id, versionNumber: revision.versionNumber };
  }
  private managedLifecycleNotFound(): never {
    throw new NotFoundException('Версия управляемого ресурса не найдена');
  }

  private managedRestoreConflict(): never {
    throw new ConflictException(
      'Восстановленная managed-версия не совпадает с исходной',
    );
  }

  private assertManagedLifecycleContext(
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      revisionId: string;
    },
    context: unknown,
  ): asserts context is ManagedRevisionLifecycleContext {
    if (!context || typeof context !== 'object') {
      this.managedLifecycleNotFound();
    }
    const candidate = context as Partial<ManagedRevisionLifecycleContext>;
    if (
      !candidate.resource ||
      typeof candidate.resource !== 'object' ||
      !candidate.revision ||
      typeof candidate.revision !== 'object' ||
      candidate.resource.siteId !== input.siteId ||
      candidate.resource.resourceType !== input.resourceType ||
      candidate.resource.entityId !== input.entityId ||
      candidate.revision.id !== input.revisionId ||
      candidate.revision.resourceId !== candidate.resource.id
    ) {
      this.managedLifecycleNotFound();
    }
  }

  private placementSet(
    placements: readonly ManagedChunkPlacementEntity[],
  ): string[] {
    return placements
      .map((placement) =>
        JSON.stringify([
          placement.instanceId,
          placement.slotKey,
          placement.position,
        ]),
      )
      .sort();
  }

  private async verifyManagedRevisionUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      revisionId: string;
    },
    prepared: unknown,
  ): Promise<VerifiedManagedRevision> {
    this.assertManagedLifecycleContext(input, prepared);
    const site = await db.findOne(SiteEntity, {
      where: { id: input.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!site) this.managedLifecycleNotFound();

    if (input.resourceType === 'chunk_instance') {
      const instance = await db.findOne(ManagedChunkInstanceEntity, {
        where: { id: input.entityId, siteId: input.siteId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!instance) this.managedLifecycleNotFound();
      const resource = await db.findOne(CmsRevisionResourceEntity, {
        where: {
          id: instance.revisionResourceId,
          siteId: input.siteId,
          resourceType: input.resourceType,
          entityId: input.entityId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!resource) this.managedLifecycleNotFound();
      const revision = await db.findOne(CmsRevisionEntity, {
        where: { id: input.revisionId, resourceId: resource.id },
        lock: { mode: 'pessimistic_read' },
      });
      if (!revision) this.managedLifecycleNotFound();
      const link = await db.findOne(ManagedChunkInstanceRevisionEntity, {
        where: {
          revisionId: input.revisionId,
          revisionResourceId: resource.id,
          siteId: input.siteId,
          instanceId: input.entityId,
        },
        lock: { mode: 'pessimistic_read' },
      });
      if (
        !link ||
        prepared.resource.id !== resource.id ||
        prepared.revision.id !== revision.id
      ) {
        this.managedLifecycleNotFound();
      }
      return {
        resource,
        revision,
        kind: 'instance',
        contractId: link.contractId,
      };
    }

    const layout = await db.findOne(ManagedChunkLayoutEntity, {
      where: { id: input.entityId, siteId: input.siteId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!layout) this.managedLifecycleNotFound();
    const resource = await db.findOne(CmsRevisionResourceEntity, {
      where: {
        id: layout.revisionResourceId,
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (!resource) this.managedLifecycleNotFound();
    const revision = await db.findOne(CmsRevisionEntity, {
      where: { id: input.revisionId, resourceId: resource.id },
      lock: { mode: 'pessimistic_read' },
    });
    if (!revision) this.managedLifecycleNotFound();
    if (
      prepared.resource.id !== resource.id ||
      prepared.revision.id !== revision.id
    ) {
      this.managedLifecycleNotFound();
    }
    const placements = await db.find(ManagedChunkPlacementEntity, {
      where: { layoutRevisionId: input.revisionId },
    });
    const instanceIds = new Set<string>();
    for (const placement of placements) {
      if (
        placement.siteId !== input.siteId ||
        placement.layoutId !== input.entityId ||
        placement.layoutRevisionResourceId !== resource.id ||
        placement.layoutRevisionId !== input.revisionId
      ) {
        this.managedLifecycleNotFound();
      }
      instanceIds.add(placement.instanceId);
    }
    for (const instanceId of [...instanceIds].sort()) {
      const instance = await db.findOne(ManagedChunkInstanceEntity, {
        where: { id: instanceId, siteId: input.siteId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!instance) this.managedLifecycleNotFound();
    }
    return {
      resource,
      revision,
      kind: 'layout',
      placementSet: this.placementSet(placements),
    };
  }

  private async verifyManagedRestoreCopyUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
    },
    resource: CmsRevisionResourceEntity,
    revision: CmsRevisionEntity,
    source: VerifiedManagedRevision,
  ): Promise<void> {
    if (source.kind === 'instance') {
      const link = await db.findOne(ManagedChunkInstanceRevisionEntity, {
        where: {
          revisionId: revision.id,
          revisionResourceId: resource.id,
          siteId: input.siteId,
          instanceId: input.entityId,
        },
        lock: { mode: 'pessimistic_read' },
      });
      if (!link || link.contractId !== source.contractId) {
        this.managedRestoreConflict();
      }
      return;
    }

    const placements = await db.find(ManagedChunkPlacementEntity, {
      where: { layoutRevisionId: revision.id },
    });
    const instanceIds = new Set<string>();
    for (const placement of placements) {
      if (
        placement.siteId !== input.siteId ||
        placement.layoutId !== input.entityId ||
        placement.layoutRevisionResourceId !== resource.id ||
        placement.layoutRevisionId !== revision.id
      ) {
        this.managedRestoreConflict();
      }
      instanceIds.add(placement.instanceId);
    }
    for (const instanceId of [...instanceIds].sort()) {
      const instance = await db.findOne(ManagedChunkInstanceEntity, {
        where: { id: instanceId, siteId: input.siteId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!instance) this.managedRestoreConflict();
    }
    if (
      !isDeepStrictEqual(this.placementSet(placements), source.placementSet)
    ) {
      this.managedRestoreConflict();
    }
  }

  async restoreManagedRevisionUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      sourceRevisionId: string;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
    prepare: ManagedRevisionRestorePrepare,
    revisionCreatedHook: RevisionCreatedHook,
  ): Promise<{ id: string; versionNumber: number }> {
    this.assertManagedResourceType(input.resourceType);
    if (
      typeof prepare !== 'function' ||
      typeof revisionCreatedHook !== 'function'
    ) {
      throw new BadRequestException(
        'Управляемое восстановление требует prepare и revision-created hook',
      );
    }
    await this.authorizeManagedPermissionUsingManager(
      db,
      input,
      this.permission(input.resourceType),
    );
    const prepared = await prepare(db);
    const context = await this.verifyManagedRevisionUsingManager(
      db,
      {
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
        revisionId: input.sourceRevisionId,
      },
      prepared,
    );

    const revisionId = randomUUID();
    const next = saveDraftRevision(
      this.pointers(context.resource),
      revisionId,
      input.expectedDraftRevisionId,
    );
    const restored = Object.assign(new CmsRevisionEntity(), {
      id: revisionId,
      resourceId: context.resource.id,
      versionNumber: context.resource.latestVersionNumber + 1,
      snapshot: structuredClone(context.revision.snapshot),
      actorUserId: input.actor.userId,
    });
    await db.save(restored);
    await revisionCreatedHook(db, restored, context.resource);
    await this.verifyManagedRestoreCopyUsingManager(
      db,
      input,
      context.resource,
      restored,
      context,
    );
    Object.assign(context.resource, next, {
      latestVersionNumber: restored.versionNumber,
    });
    await db.save(context.resource);
    await this.event(
      db,
      context.resource.id,
      restored.id,
      'version_restored',
      input.actor.userId,
      `restored from ${input.sourceRevisionId}`,
    );
    return { id: restored.id, versionNumber: restored.versionNumber };
  }

  async approveManagedRevisionUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      revisionId: string;
      actor: RevisionActor;
    },
    prepare: ManagedRevisionLifecyclePrepare,
  ): Promise<void> {
    this.assertManagedResourceType(input.resourceType);
    if (typeof prepare !== 'function') {
      throw new BadRequestException(
        'Управляемое согласование требует typed precondition',
      );
    }
    await this.authorizeManagedPermissionUsingManager(
      db,
      input,
      SitePermission.APPROVE,
    );
    const prepared = await prepare(db);
    const context = await this.verifyManagedRevisionUsingManager(
      db,
      input,
      prepared,
    );
    Object.assign(
      context.resource,
      approveRevision(this.pointers(context.resource), input.revisionId),
    );
    await db.save(context.resource);
    await this.event(
      db,
      context.resource.id,
      input.revisionId,
      'approved',
      input.actor.userId,
    );
  }

  async publishManagedRevisionUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: ManagedCmsResourceType;
      entityId: string;
      revisionId: string;
      actor: RevisionActor;
    },
    prepare: ManagedRevisionLifecyclePrepare,
  ): Promise<void> {
    this.assertManagedResourceType(input.resourceType);
    if (typeof prepare !== 'function') {
      throw new BadRequestException(
        'Управляемая публикация требует typed precondition',
      );
    }
    const access = await this.authorizeManagedPermissionUsingManager(
      db,
      input,
      input.resourceType === 'chunk_layout'
        ? SitePermission.MANAGE_STRUCTURE
        : SitePermission.PUBLISH_CONTENT,
    );
    const prepared = await prepare(db);
    const context = await this.verifyManagedRevisionUsingManager(
      db,
      input,
      prepared,
    );
    const next = publishRevision(
      this.pointers(context.resource),
      input.revisionId,
      access?.role === SiteRole.CONTENT_MANAGER
        ? access.requiresApproval
        : false,
    );
    Object.assign(context.resource, next);
    await db.save(context.resource);
    await this.event(
      db,
      context.resource.id,
      input.revisionId,
      'published',
      input.actor.userId,
    );
  }
  /** Trusted publication adapter for actors allowed to publish directly; never
   * expose this as a generic route or let it overwrite an outstanding CMS draft.
   * Caller must hold the article lock and include the live write in this transaction.
   */
  async recordOwnerPublicationUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      entityId: string;
      snapshot: Record<string, unknown>;
      previousSnapshot: Record<string, unknown> | null;
      actor: RevisionActor;
    },
  ): Promise<void> {
    await this.requireSite(
      input.siteId,
      input.actor,
      SitePermission.PUBLISH_CONTENT,
    );
    let resource = await db.findOne(CmsRevisionResourceEntity, {
      where: {
        siteId: input.siteId,
        resourceType: 'article',
        entityId: input.entityId,
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (resource && resource.draftRevisionId !== resource.publishedRevisionId)
      throw new ConflictException(
        'В CMS уже есть отдельный черновик статьи. Завершите работу с ним перед публикацией из контент-центра.',
      );
    // Preserve the pre-integration public state in the new ledger as well.
    if (!resource && input.previousSnapshot) {
      const baseline = await this.saveDraftInTransaction(
        db,
        {
          ...input,
          snapshot: input.previousSnapshot,
          resourceType: 'article',
          expectedDraftRevisionId: null,
        },
        'baseline_imported',
      );
      resource = await this.lockedResource(
        db,
        input.siteId,
        'article',
        input.entityId,
      );
      Object.assign(resource, {
        approvedRevisionId: baseline.id,
        publishedRevisionId: baseline.id,
        reviewState: 'approved',
      });
      await db.save(resource);
    }
    const next = await this.saveDraftInTransaction(db, {
      ...input,
      resourceType: 'article',
      expectedDraftRevisionId: resource?.draftRevisionId ?? null,
    });
    resource = await this.lockedResource(
      db,
      input.siteId,
      'article',
      input.entityId,
    );
    Object.assign(resource, submitRevision(this.pointers(resource), next.id));
    Object.assign(resource, approveRevision(this.pointers(resource), next.id));
    await this.event(
      db,
      resource.id,
      next.id,
      'approved',
      input.actor.userId,
      'Публикация владельцем или администратором из контент-центра',
    );
    Object.assign(resource, publishRevision(this.pointers(resource), next.id));
    await db.save(resource);
    await this.event(db, resource.id, next.id, 'published', input.actor.userId);
  }

  /**
   * Trusted adapter only: call after verifying that the supplied snapshot is
   * exactly what the public site currently renders. Never expose as an API route.
   */
  async importPublishedBaseline(input: {
    siteId: string;
    resourceType: CmsResourceType;
    entityId: string;
    snapshot: Record<string, unknown>;
    actor: RevisionActor;
  }): Promise<{ id: string; versionNumber: number }> {
    this.assertGenericResourceType(input.resourceType);
    await this.requireSite(
      input.siteId,
      input.actor,
      this.permission(input.resourceType),
    );
    return this.dataSource.transaction(async (db) => {
      const existing = await db.findOne(CmsRevisionResourceEntity, {
        where: {
          siteId: input.siteId,
          resourceType: input.resourceType,
          entityId: input.entityId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing) {
        if (!existing.publishedRevisionId)
          throw new ConflictException(
            'Нельзя заменить неопубликованный черновик исходной публикацией',
          );
        const version = await db.findOne(CmsRevisionEntity, {
          where: {
            id: existing.publishedRevisionId,
            resourceId: existing.id,
          },
        });
        if (!version) throw new NotFoundException('Версия не найдена');
        return { id: version.id, versionNumber: version.versionNumber };
      }
      const resourceId = randomUUID();
      const revisionId = randomUUID();
      const resource = Object.assign(new CmsRevisionResourceEntity(), {
        id: resourceId,
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
        latestVersionNumber: 0,
        draftRevisionId: null,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft' as const,
      });
      await db.save(resource);
      await db.save(
        Object.assign(new CmsRevisionEntity(), {
          id: revisionId,
          resourceId,
          versionNumber: 1,
          snapshot: structuredClone(input.snapshot),
          actorUserId: null,
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
      await this.event(
        db,
        resourceId,
        revisionId,
        'baseline_imported',
        input.actor.userId,
      );
      return { id: revisionId, versionNumber: 1 };
    });
  }

  private async restoreUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: CmsResourceType;
      entityId: string;
      sourceRevisionId: string;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
      canManageStructure: boolean;
    },
  ): Promise<{ id: string; versionNumber: number }> {
    const resource = await this.lockedResource(
      db,
      input.siteId,
      input.resourceType,
      input.entityId,
    );
    const source = await db.findOne(CmsRevisionEntity, {
      where: { id: input.sourceRevisionId, resourceId: resource.id },
    });
    if (!source) throw new NotFoundException('Версия не найдена');
    let snapshot = source.snapshot;
    if (!input.canManageStructure) {
      const currentRevisionId =
        resource.draftRevisionId ??
        resource.publishedRevisionId ??
        resource.approvedRevisionId;
      const current = currentRevisionId
        ? await db.findOne(CmsRevisionEntity, {
            where: { id: currentRevisionId, resourceId: resource.id },
          })
        : null;
      snapshot = this.preserveTemplateAssignment(
        input.resourceType,
        source.snapshot,
        current?.snapshot ?? {},
      );
    }
    return this.saveDraftInTransaction(
      db,
      {
        siteId: input.siteId,
        resourceType: input.resourceType,
        entityId: input.entityId,
        snapshot,
        expectedDraftRevisionId: input.expectedDraftRevisionId,
        actor: input.actor,
      },
      'version_restored',
      `restored from ${input.sourceRevisionId}`,
    );
  }

  async restore(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    sourceRevisionId: string,
    expectedDraftRevisionId: string | null,
    actor: RevisionActor,
  ) {
    this.assertGenericResourceType(resourceType);
    const access = await this.requireSite(
      siteId,
      actor,
      this.permission(resourceType),
    );
    const canManageStructure = hasSitePermission(
      actor.platformRole,
      access,
      SitePermission.MANAGE_STRUCTURE,
    );
    return this.dataSource.transaction((db) =>
      this.restoreUsingManager(db, {
        siteId,
        resourceType,
        entityId,
        sourceRevisionId,
        expectedDraftRevisionId,
        actor,
        canManageStructure,
      }),
    );
  }
  async requestChanges(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
    reason: string,
  ): Promise<void> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    await this.dataSource.transaction(async (db) => {
      const resource = await this.lockedResource(
        db,
        siteId,
        resourceType,
        entityId,
      );
      Object.assign(
        resource,
        requestChanges(this.pointers(resource), revisionId, reason),
      );
      await db.save(resource);
      await this.event(
        db,
        resource.id,
        revisionId,
        'changes_requested',
        actor.userId,
        reason.trim(),
      );
    });
  }

  async submit(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ): Promise<void> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, this.permission(resourceType));
    await this.dataSource.transaction(async (db) => {
      const resource = await this.lockedResource(
        db,
        siteId,
        resourceType,
        entityId,
      );
      Object.assign(
        resource,
        submitRevision(this.pointers(resource), revisionId),
      );
      await db.save(resource);
      await this.event(db, resource.id, revisionId, 'submitted', actor.userId);
    });
  }

  private async approveUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: CmsResourceType;
      entityId: string;
      revisionId: string;
      actor: RevisionActor;
    },
  ): Promise<void> {
    const resource = await this.lockedResource(
      db,
      input.siteId,
      input.resourceType,
      input.entityId,
    );
    Object.assign(
      resource,
      approveRevision(this.pointers(resource), input.revisionId),
    );
    await db.save(resource);
    await this.event(
      db,
      resource.id,
      input.revisionId,
      'approved',
      input.actor.userId,
    );
  }

  async approve(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ): Promise<void> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    await this.dataSource.transaction((db) =>
      this.approveUsingManager(db, {
        siteId,
        resourceType,
        entityId,
        revisionId,
        actor,
      }),
    );
  }
  private async publishUsingManager(
    db: EntityManager,
    input: {
      siteId: string;
      resourceType: CmsResourceType;
      entityId: string;
      revisionId: string;
      actor: RevisionActor;
    },
    activate?: (
      manager: EntityManager,
      snapshot: Record<string, unknown>,
    ) => Promise<void>,
  ): Promise<void> {
    const access = await this.requireSite(
      input.siteId,
      input.actor,
      input.resourceType === 'site_layout_bindings' ||
        input.resourceType === 'site_article_list'
        ? SitePermission.MANAGE_STRUCTURE
        : SitePermission.PUBLISH_CONTENT,
      db,
    );
    const resource = await this.lockedResource(
      db,
      input.siteId,
      input.resourceType,
      input.entityId,
    );
    const next = publishRevision(
      this.pointers(resource),
      input.revisionId,
      access?.role === SiteRole.CONTENT_MANAGER
        ? access.requiresApproval
        : false,
    );
    const revision = await db.findOne(CmsRevisionEntity, {
      where: { id: input.revisionId, resourceId: resource.id },
    });
    if (!revision) throw new NotFoundException('Версия не найдена');
    const published = resource.publishedRevisionId
      ? await db.findOne(CmsRevisionEntity, {
          where: {
            id: resource.publishedRevisionId,
            resourceId: resource.id,
          },
        })
      : null;
    if (
      published &&
      this.changesTemplateAssignment(
        input.resourceType,
        revision.snapshot,
        published.snapshot,
      ) &&
      !hasSitePermission(
        input.actor.platformRole,
        access,
        SitePermission.MANAGE_STRUCTURE,
      )
    ) {
      throw new ForbiddenException(
        'Недостаточно прав для публикации структурных изменений',
      );
    }
    if (activate) await activate(db, revision.snapshot);
    Object.assign(resource, next);
    await db.save(resource);
    await this.event(
      db,
      resource.id,
      input.revisionId,
      'published',
      input.actor.userId,
    );
  }

  async publish(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
    activate?: (
      manager: EntityManager,
      snapshot: Record<string, unknown>,
    ) => Promise<void>,
  ): Promise<void> {
    this.assertGenericResourceType(resourceType);
    await this.dataSource.transaction((db) =>
      this.publishUsingManager(
        db,
        { siteId, resourceType, entityId, revisionId, actor },
        activate,
      ),
    );
  }
  async published(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ): Promise<Record<string, unknown> | null> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.READ);
    return this.dataSource.transaction(async (db) => {
      const resource = await db.findOne(CmsRevisionResourceEntity, {
        where: { siteId, resourceType, entityId },
      });
      if (!resource?.publishedRevisionId) return null;
      const revision = await db.findOne(CmsRevisionEntity, {
        where: {
          id: resource.publishedRevisionId,
          resourceId: resource.id,
        },
      });
      return revision?.snapshot ?? null;
    });
  }

  async current(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ): Promise<{
    draft: {
      id: string;
      versionNumber: number;
      snapshot: Record<string, unknown>;
    } | null;
    approvedRevisionId: string | null;
    publishedRevisionId: string | null;
    reviewState: RevisionPointers['reviewState'];
  } | null> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.READ);
    return this.dataSource.transaction(async (db) => {
      const resource = await db.findOne(CmsRevisionResourceEntity, {
        where: { siteId, resourceType, entityId },
      });
      if (!resource) return null;
      const revision = resource.draftRevisionId
        ? await db.findOne(CmsRevisionEntity, {
            where: {
              id: resource.draftRevisionId,
              resourceId: resource.id,
            },
          })
        : null;
      return {
        draft: revision
          ? {
              id: revision.id,
              versionNumber: revision.versionNumber,
              snapshot: revision.snapshot,
            }
          : null,
        approvedRevisionId: resource.approvedRevisionId,
        publishedRevisionId: resource.publishedRevisionId,
        reviewState: resource.reviewState,
      };
    });
  }

  async getVersion(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ): Promise<{
    id: string;
    versionNumber: number;
    snapshot: Record<string, unknown>;
  }> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.READ);
    return this.dataSource.transaction(async (db) => {
      const resource = await db.findOne(CmsRevisionResourceEntity, {
        where: { siteId, resourceType, entityId },
      });
      if (!resource) throw new NotFoundException('Версия не найдена');
      const revision = await db.findOne(CmsRevisionEntity, {
        where: { id: revisionId, resourceId: resource.id },
      });
      if (!revision) throw new NotFoundException('Версия не найдена');
      return {
        id: revision.id,
        versionNumber: revision.versionNumber,
        snapshot: revision.snapshot,
      };
    });
  }

  async listVersions(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ): Promise<CmsRevisionEntity[]> {
    this.assertGenericResourceType(resourceType);
    await this.requireSite(siteId, actor, SitePermission.READ);
    return this.dataSource.transaction(async (db) => {
      const resource = await db.findOne(CmsRevisionResourceEntity, {
        where: { siteId, resourceType, entityId },
      });
      if (!resource) throw new NotFoundException('Ресурс не найден');
      return db.find(CmsRevisionEntity, {
        where: { resourceId: resource.id },
        order: { versionNumber: 'DESC' },
      });
    });
  }
}
