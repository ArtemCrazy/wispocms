import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  PlatformRole,
  SiteEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { hasSitePermission, SitePermission } from './content.permissions';
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
  | 'site_variable'
  | 'template'
  | 'chunk';

export type RevisionActor = { userId: string; platformRole: PlatformRole };

@Injectable()
export class CmsRevisionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
  ) {}

  private permission(resourceType: CmsResourceType) {
    return resourceType === 'template' ||
      resourceType === 'chunk' ||
      resourceType === 'site_layout_bindings' ||
      resourceType === 'site_article_list'
      ? SitePermission.EDIT_CODE
      : SitePermission.EDIT_CONTENT;
  }

  private readPermission(resourceType: CmsResourceType) {
    return resourceType === 'template' ||
      resourceType === 'chunk' ||
      resourceType === 'site_layout_bindings' ||
      resourceType === 'site_article_list'
      ? SitePermission.EDIT_CODE
      : SitePermission.READ;
  }

  private async requireSite(
    siteId: string,
    actor: RevisionActor,
    permission: SitePermission,
  ) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole === PlatformRole.WISPO_ADMIN) return;
    const membership = await this.memberships.findOne({
      select: { role: true, siteIds: true },
      where: { userId: actor.userId, workspaceId: site.workspaceId },
    });
    if (
      !membership?.siteIds?.includes(siteId) ||
      !hasSitePermission(actor.platformRole, membership.role, permission)
    )
      throw new ForbiddenException('Недостаточно прав для этого сайта');
  }

  assertSitePermission(
    siteId: string,
    actor: RevisionActor,
    permission: SitePermission,
  ) {
    return this.requireSite(siteId, actor, permission);
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
      resourceType: CmsResourceType;
      entityId: string;
      snapshot: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
      actor: RevisionActor;
    },
    eventType = 'draft_saved',
    reason: string | null = null,
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
    await this.requireSite(
      input.siteId,
      input.actor,
      this.permission(input.resourceType),
    );
    return this.dataSource.transaction((db) =>
      this.saveDraftInTransaction(db, input),
    );
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
    await this.requireSite(
      input.siteId,
      input.actor,
      this.permission(input.resourceType),
    );
    return this.saveDraftInTransaction(db, input);
  }

  /** Trusted publication adapter. Owner/admin intent is itself approval; never
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
    await this.requireSite(input.siteId, input.actor, SitePermission.APPROVE);
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

  async restore(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    sourceRevisionId: string,
    expectedDraftRevisionId: string | null,
    actor: RevisionActor,
  ) {
    await this.requireSite(siteId, actor, this.permission(resourceType));
    return this.dataSource.transaction(async (db) => {
      const resource = await this.lockedResource(
        db,
        siteId,
        resourceType,
        entityId,
      );
      const source = await db.findOne(CmsRevisionEntity, {
        where: { id: sourceRevisionId, resourceId: resource.id },
      });
      if (!source) throw new NotFoundException('Версия не найдена');
      return this.saveDraftInTransaction(
        db,
        {
          siteId,
          resourceType,
          entityId,
          snapshot: source.snapshot,
          expectedDraftRevisionId,
          actor,
        },
        'version_restored',
        `restored from ${sourceRevisionId}`,
      );
    });
  }

  async requestChanges(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
    reason: string,
  ): Promise<void> {
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

  async approve(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ): Promise<void> {
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
        approveRevision(this.pointers(resource), revisionId),
      );
      await db.save(resource);
      await this.event(db, resource.id, revisionId, 'approved', actor.userId);
    });
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
    await this.requireSite(
      siteId,
      actor,
      resourceType === 'template' ||
        resourceType === 'chunk' ||
        resourceType === 'site_layout_bindings' ||
        resourceType === 'site_article_list'
        ? SitePermission.PUBLISH_CODE
        : SitePermission.PUBLISH_CONTENT,
    );
    await this.dataSource.transaction(async (db) => {
      const resource = await this.lockedResource(
        db,
        siteId,
        resourceType,
        entityId,
      );
      const next = publishRevision(this.pointers(resource), revisionId);
      const revision = await db.findOne(CmsRevisionEntity, {
        where: { id: revisionId, resourceId: resource.id },
      });
      if (!revision) throw new NotFoundException('Версия не найдена');
      if (activate) await activate(db, revision.snapshot);
      Object.assign(resource, next);
      await db.save(resource);
      await this.event(db, resource.id, revisionId, 'published', actor.userId);
    });
  }

  async published(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ): Promise<Record<string, unknown> | null> {
    await this.requireSite(siteId, actor, this.readPermission(resourceType));
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
    await this.requireSite(siteId, actor, this.readPermission(resourceType));
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
    await this.requireSite(siteId, actor, this.readPermission(resourceType));
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
    await this.requireSite(siteId, actor, this.readPermission(resourceType));
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
