import {
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
  | 'chunk_instance'
  | 'chunk_layout'
  | 'media_alt'
  | 'site_variable';

export type RevisionActor = { userId: string; platformRole: PlatformRole };

export type RevisionCreatedHook = (
  db: EntityManager,
  revision: CmsRevisionEntity,
  resource: CmsRevisionResourceEntity,
) => Promise<void>;

@Injectable()
export class CmsRevisionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(SiteAccessEntity)
    private readonly siteAccesses: Repository<SiteAccessEntity>,
  ) {}

  private permission(resourceType: CmsResourceType) {
    return resourceType === 'site_layout_bindings' ||
      resourceType === 'site_article_list'
      ? SitePermission.MANAGE_STRUCTURE
      : SitePermission.EDIT_CONTENT;
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
    revisionCreatedHook?: RevisionCreatedHook,
  ): Promise<{ id: string; versionNumber: number }> {
    await this.requireSite(
      input.siteId,
      input.actor,
      this.permission(input.resourceType),
    );
    return this.saveDraftInTransaction(
      db,
      input,
      'draft_saved',
      null,
      revisionCreatedHook,
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
      let snapshot = source.snapshot;
      if (!canManageStructure) {
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
          resourceType,
          source.snapshot,
          current?.snapshot ?? {},
        );
      }
      return this.saveDraftInTransaction(
        db,
        {
          siteId,
          resourceType,
          entityId,
          snapshot,
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
    await this.dataSource.transaction(async (db) => {
      const access = await this.requireSite(
        siteId,
        actor,
        resourceType === 'site_layout_bindings' ||
          resourceType === 'site_article_list'
          ? SitePermission.MANAGE_STRUCTURE
          : SitePermission.PUBLISH_CONTENT,
        db,
      );
      const resource = await this.lockedResource(
        db,
        siteId,
        resourceType,
        entityId,
      );
      const next = publishRevision(
        this.pointers(resource),
        revisionId,
        access?.role === SiteRole.CONTENT_MANAGER
          ? access.requiresApproval
          : false,
      );
      const revision = await db.findOne(CmsRevisionEntity, {
        where: { id: revisionId, resourceId: resource.id },
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
          resourceType,
          revision.snapshot,
          published.snapshot,
        ) &&
        !hasSitePermission(
          actor.platformRole,
          access,
          SitePermission.MANAGE_STRUCTURE,
        )
      )
        throw new ForbiddenException(
          'Недостаточно прав для публикации структурных изменений',
        );
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
