import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import {
  ArticleEntity,
  ArticleRelatedItemEntity,
  ArticleSectionSettingsEntity,
  ArticleStatus,
  ArticleVersionEntity,
  CategoryEntity,
  CategoryStatus,
  ContentActorKind,
  ContentEntityType,
  ContentEventEntity,
  ContentEventType,
  ContentScheduleStatus,
  ContentStatusScheduleEntity,
  ContentTemplateKind,
  EditorialState,
  PlatformRole,
  PublicationState,
  SiteContentTemplateEntity,
  SiteEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { hasSitePermission, SitePermission } from './content.permissions';
import {
  DuplicateContentDto,
  SchedulePublicationDto,
  UpdateArticleSectionSettingsDto,
  UpdateEditorialStateDto,
  UpdatePublicationStateDto,
  UpdateRelatedArticlesDto,
} from './content.dto';

export type ContentActor = { userId: string; platformRole: PlatformRole };

type EventFilters = {
  eventType?: ContentEventType;
  actorUserId?: string;
  from?: string;
  to?: string;
  search?: string;
  groupId?: string;
};

@Injectable()
export class ContentLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentLifecycleService.name);
  private scheduler?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(ArticleEntity)
    private readonly articles: Repository<ArticleEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(ArticleRelatedItemEntity)
    private readonly relatedItems: Repository<ArticleRelatedItemEntity>,
    @InjectRepository(ArticleVersionEntity)
    private readonly articleVersions: Repository<ArticleVersionEntity>,
    @InjectRepository(ContentEventEntity)
    private readonly events: Repository<ContentEventEntity>,
    @InjectRepository(ContentStatusScheduleEntity)
    private readonly schedules: Repository<ContentStatusScheduleEntity>,
    @InjectRepository(SiteContentTemplateEntity)
    private readonly templates: Repository<SiteContentTemplateEntity>,
    @InjectRepository(ArticleSectionSettingsEntity)
    private readonly articleSectionSettings: Repository<ArticleSectionSettingsEntity>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.runScheduler();
    this.scheduler = setInterval(() => void this.runScheduler(), 30_000);
    this.scheduler.unref();
  }

  onModuleDestroy() {
    if (this.scheduler) clearInterval(this.scheduler);
  }

  private async runScheduler() {
    try {
      await this.processDueSchedules();
    } catch (error) {
      this.logger.error(
        'Не удалось обработать расписание публикаций',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async requireSite(
    siteId: string,
    actor: ContentActor,
    permission = SitePermission.READ,
  ) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN) {
      const membership = await this.memberships.findOne({
        select: { role: true },
        where: { userId: actor.userId, workspaceId: site.workspaceId },
      });
      if (
        !hasSitePermission(
          actor.platformRole,
          membership?.role ?? null,
          permission,
        )
      )
        throw new ForbiddenException('Недостаточно прав для этого действия');
    }
    return site;
  }

  articleSnapshot(article: ArticleEntity): Record<string, unknown> {
    return {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      body: article.body,
      bodyDocument: article.bodyDocument,
      documentVersion: article.documentVersion,
      categoryId: article.categoryId,
      authorId: article.authorId,
      coverMediaId: article.coverMediaId,
      previewMediaId: article.previewMediaId,
      sortOrder: article.sortOrder,
      publicationState: article.publicationState,
      editorialState: article.editorialState,
      displayTemplateKey: article.displayTemplateKey,
      displayTemplateVersion: article.displayTemplateVersion,
      displayTemplateConfig: article.displayTemplateConfig,
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      canonicalUrl: article.canonicalUrl,
      noIndex: article.noIndex,
      revision: article.revision,
    };
  }

  categorySnapshot(category: CategoryEntity): Record<string, unknown> {
    return {
      name: category.name,
      slug: category.slug,
      description: category.description,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      publicationState: category.publicationState,
      displayTemplateKey: category.displayTemplateKey,
      displayTemplateVersion: category.displayTemplateVersion,
      displayTemplateConfig: category.displayTemplateConfig,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      canonicalUrl: category.canonicalUrl,
      noIndex: category.noIndex,
    };
  }

  private changedValues(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    return Object.fromEntries(
      Object.keys({ ...before, ...after })
        .filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        )
        .map((key) => [key, { before: before[key], after: after[key] }]),
    );
  }

  async recordEvent(input: {
    siteId: string;
    entityType: ContentEntityType;
    entityId: string;
    eventType: ContentEventType;
    actorUserId?: string | null;
    actorKind?: ContentActorKind;
    reason?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    versionId?: string | null;
    groupId?: string | null;
  }) {
    const before = input.before ?? null;
    const after = input.after ?? null;
    return this.events.save(
      this.events.create({
        siteId: input.siteId,
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: input.eventType,
        actorKind:
          input.actorKind ??
          (input.actorUserId ? ContentActorKind.USER : ContentActorKind.SYSTEM),
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
        before,
        after,
        changes: before && after ? this.changedValues(before, after) : null,
        versionId: input.versionId ?? null,
        groupId: input.groupId ?? null,
      }),
    );
  }

  async createVersion(
    article: ArticleEntity,
    actorUserId: string | null,
    reason: string,
  ) {
    const row = await this.articleVersions
      .createQueryBuilder('version')
      .select('COALESCE(MAX(version.versionNumber), 0)', 'maximum')
      .where('version.articleId = :articleId', { articleId: article.id })
      .getRawOne<{ maximum: string }>();
    return this.articleVersions.save(
      this.articleVersions.create({
        articleId: article.id,
        versionNumber: Number(row?.maximum ?? 0) + 1,
        snapshot: this.articleSnapshot(article),
        actorUserId,
        reason,
      }),
    );
  }

  async recordArticleChange(
    before: ArticleEntity | null,
    after: ArticleEntity,
    actorUserId: string | null,
    eventType: ContentEventType,
    reason: string,
    createVersion = false,
  ) {
    const version = createVersion
      ? await this.createVersion(after, actorUserId, reason)
      : null;
    return this.recordEvent({
      siteId: after.siteId,
      entityType: ContentEntityType.ARTICLE,
      entityId: after.id,
      eventType,
      actorUserId,
      reason,
      before: before ? this.articleSnapshot(before) : null,
      after: this.articleSnapshot(after),
      versionId: version?.id ?? null,
    });
  }

  async recordCategoryChange(
    before: CategoryEntity | null,
    after: CategoryEntity,
    actorUserId: string | null,
    eventType: ContentEventType,
    reason: string,
  ) {
    return this.recordEvent({
      siteId: after.siteId,
      entityType: ContentEntityType.CATEGORY,
      entityId: after.id,
      eventType,
      actorUserId,
      reason,
      before: before ? this.categorySnapshot(before) : null,
      after: this.categorySnapshot(after),
    });
  }

  async listEvents(
    siteId: string,
    entityType: ContentEntityType,
    entityId: string,
    actor: ContentActor,
    filters: EventFilters,
  ) {
    await this.requireSite(siteId, actor);
    const query = this.events
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.actor', 'actor')
      .where('event.siteId = :siteId', { siteId })
      .andWhere('event.entityType = :entityType', { entityType })
      .andWhere('event.entityId = :entityId', { entityId })
      .orderBy('event.createdAt', 'DESC')
      .take(250);
    if (filters.eventType)
      query.andWhere('event.eventType = :eventType', {
        eventType: filters.eventType,
      });
    if (filters.actorUserId)
      query.andWhere('event.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    if (filters.from)
      query.andWhere('event.createdAt >= :from', {
        from: new Date(filters.from),
      });
    if (filters.to)
      query.andWhere('event.createdAt <= :to', { to: new Date(filters.to) });
    if (filters.search)
      query.andWhere(
        `(event.reason ILIKE :search OR CAST(event.changes AS text) ILIKE :search)`,
        { search: `%${filters.search.trim()}%` },
      );
    if (filters.groupId)
      query.andWhere('event.groupId = :groupId', { groupId: filters.groupId });
    return query.getMany();
  }

  async listTrash(siteId: string, actor: ContentActor) {
    await this.requireSite(siteId, actor);
    const [articles, categories] = await Promise.all([
      this.articles.find({
        where: { siteId, deletedAt: Not(IsNull()) },
        order: { deletedAt: 'DESC' },
      }),
      this.categories.find({
        where: { siteId, deletedAt: Not(IsNull()) },
        order: { deletedAt: 'DESC' },
      }),
    ]);
    return { articles, categories };
  }

  private legacyArticleStatus(
    publicationState: PublicationState,
    editorialState: EditorialState,
  ) {
    if (publicationState === PublicationState.PUBLISHED)
      return ArticleStatus.PUBLISHED;
    if (publicationState === PublicationState.HIDDEN)
      return ArticleStatus.HIDDEN;
    if (editorialState === EditorialState.REVIEW) return ArticleStatus.REVIEW;
    if (editorialState === EditorialState.CHANGES) return ArticleStatus.CHANGES;
    return ArticleStatus.DRAFT;
  }

  private legacyCategoryStatus(publicationState: PublicationState) {
    if (publicationState === PublicationState.PUBLISHED)
      return CategoryStatus.ACTIVE;
    if (publicationState === PublicationState.HIDDEN)
      return CategoryStatus.HIDDEN;
    return CategoryStatus.DRAFT;
  }

  async setArticlePublicationState(
    siteId: string,
    articleId: string,
    actor: ContentActor,
    dto: UpdatePublicationStateDto,
  ) {
    await this.requireSite(
      siteId,
      actor,
      dto.state === PublicationState.PUBLISHED
        ? SitePermission.APPROVE
        : SitePermission.EDIT_CONTENT,
    );
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    if (
      dto.state === PublicationState.PUBLISHED &&
      article.editorialState !== EditorialState.APPROVED
    )
      throw new BadRequestException(
        'Публикация доступна только для одобренной редакционной версии',
      );
    if (
      dto.state === PublicationState.PUBLISHED &&
      !article.body.trim() &&
      !article.bodyDocument?.blocks.length
    )
      throw new BadRequestException('Перед публикацией заполните текст статьи');
    const before = Object.assign(new ArticleEntity(), article);
    article.publicationState = dto.state;
    article.status = this.legacyArticleStatus(
      dto.state,
      article.editorialState,
    );
    article.publishedAt =
      dto.state === PublicationState.PUBLISHED
        ? (article.publishedAt ?? new Date())
        : dto.state === PublicationState.HIDDEN
          ? article.publishedAt
          : null;
    article.updatedByUserId = actor.userId;
    const saved = await this.articles.save(article);
    await this.recordArticleChange(
      before,
      saved,
      actor.userId,
      ContentEventType.PUBLICATION_CHANGED,
      dto.reason ?? 'publication state changed',
      true,
    );
    return saved;
  }

  async setArticleEditorialState(
    siteId: string,
    articleId: string,
    actor: ContentActor,
    dto: UpdateEditorialStateDto,
  ) {
    await this.requireSite(
      siteId,
      actor,
      dto.state === EditorialState.APPROVED
        ? SitePermission.APPROVE
        : SitePermission.EDIT_CONTENT,
    );
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    const allowed: Record<EditorialState, EditorialState[]> = {
      [EditorialState.DRAFT]: [EditorialState.REVIEW],
      [EditorialState.REVIEW]: [
        EditorialState.CHANGES,
        EditorialState.APPROVED,
      ],
      [EditorialState.CHANGES]: [EditorialState.REVIEW],
      [EditorialState.APPROVED]: [EditorialState.DRAFT, EditorialState.CHANGES],
    };
    if (!allowed[article.editorialState].includes(dto.state))
      throw new BadRequestException('Недопустимый редакционный переход');
    const before = Object.assign(new ArticleEntity(), article);
    article.editorialState = dto.state;
    article.status = this.legacyArticleStatus(
      article.publicationState,
      dto.state,
    );
    article.updatedByUserId = actor.userId;
    const saved = await this.articles.save(article);
    await this.recordArticleChange(
      before,
      saved,
      actor.userId,
      ContentEventType.EDITORIAL_CHANGED,
      dto.reason ?? 'editorial state changed',
    );
    return saved;
  }

  async setCategoryPublicationState(
    siteId: string,
    categoryId: string,
    actor: ContentActor,
    dto: UpdatePublicationStateDto,
  ) {
    await this.requireSite(
      siteId,
      actor,
      dto.state === PublicationState.PUBLISHED
        ? SitePermission.APPROVE
        : SitePermission.EDIT_CONTENT,
    );
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    const before = Object.assign(new CategoryEntity(), category);
    category.publicationState = dto.state;
    category.status = this.legacyCategoryStatus(dto.state);
    category.publishedAt =
      dto.state === PublicationState.PUBLISHED
        ? (category.publishedAt ?? new Date())
        : dto.state === PublicationState.HIDDEN
          ? category.publishedAt
          : null;
    category.updatedByUserId = actor.userId;
    const saved = await this.categories.save(category);
    await this.recordCategoryChange(
      before,
      saved,
      actor.userId,
      ContentEventType.PUBLICATION_CHANGED,
      dto.reason ?? 'publication state changed',
    );
    return saved;
  }

  async schedulePublication(
    siteId: string,
    entityType: ContentEntityType,
    entityId: string,
    actor: ContentActor,
    dto: SchedulePublicationDto,
  ) {
    await this.requireSite(
      siteId,
      actor,
      dto.state === PublicationState.PUBLISHED
        ? SitePermission.APPROVE
        : SitePermission.EDIT_CONTENT,
    );
    const executeAt = new Date(dto.executeAt);
    if (executeAt <= new Date())
      throw new BadRequestException('Дата выполнения должна быть в будущем');
    const exists =
      entityType === ContentEntityType.ARTICLE
        ? await this.articles.existsBy({
            id: entityId,
            siteId,
            deletedAt: IsNull(),
          })
        : await this.categories.existsBy({
            id: entityId,
            siteId,
            deletedAt: IsNull(),
          });
    if (!exists) throw new NotFoundException('Материал не найден');
    const schedule = await this.dataSource.transaction(async (manager) => {
      await manager.update(
        ContentStatusScheduleEntity,
        { entityType, entityId, status: ContentScheduleStatus.PENDING },
        { status: ContentScheduleStatus.CANCELLED },
      );
      return manager.save(
        ContentStatusScheduleEntity,
        manager.create(ContentStatusScheduleEntity, {
          siteId,
          entityType,
          entityId,
          targetPublicationState: dto.state,
          executeAt,
          status: ContentScheduleStatus.PENDING,
          requestedByUserId: actor.userId,
        }),
      );
    });
    await this.recordEvent({
      siteId,
      entityType,
      entityId,
      eventType: ContentEventType.SCHEDULED,
      actorUserId: actor.userId,
      reason: dto.reason ?? 'publication scheduled',
      after: { state: dto.state, executeAt: executeAt.toISOString() },
      groupId: schedule.id,
    });
    return schedule;
  }

  async cancelSchedule(
    siteId: string,
    entityType: ContentEntityType,
    entityId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const pending = await this.schedules.findOne({
      where: {
        siteId,
        entityType,
        entityId,
        status: ContentScheduleStatus.PENDING,
      },
    });
    if (!pending) throw new NotFoundException('Активное расписание не найдено');
    pending.status = ContentScheduleStatus.CANCELLED;
    await this.schedules.save(pending);
    await this.recordEvent({
      siteId,
      entityType,
      entityId,
      eventType: ContentEventType.SCHEDULE_CANCELLED,
      actorUserId: actor.userId,
      before: {
        state: pending.targetPublicationState,
        executeAt: pending.executeAt.toISOString(),
      },
      groupId: pending.id,
    });
    return { id: pending.id };
  }

  async getPendingSchedule(
    siteId: string,
    entityType: ContentEntityType,
    entityId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor);
    return this.schedules.findOne({
      where: {
        siteId,
        entityType,
        entityId,
        status: ContentScheduleStatus.PENDING,
      },
    });
  }

  async processDueSchedules(now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const due = await manager
        .createQueryBuilder(ContentStatusScheduleEntity, 'schedule')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('schedule.status = :status', {
          status: ContentScheduleStatus.PENDING,
        })
        .andWhere('schedule.executeAt <= :now', { now })
        .orderBy('schedule.executeAt', 'ASC')
        .take(50)
        .getMany();
      for (const schedule of due) {
        const entity =
          schedule.entityType === ContentEntityType.ARTICLE
            ? await manager.findOne(ArticleEntity, {
                where: {
                  id: schedule.entityId,
                  siteId: schedule.siteId,
                  deletedAt: IsNull(),
                },
              })
            : await manager.findOne(CategoryEntity, {
                where: {
                  id: schedule.entityId,
                  siteId: schedule.siteId,
                  deletedAt: IsNull(),
                },
              });
        schedule.attemptCount += 1;
        if (!entity) {
          schedule.status = ContentScheduleStatus.FAILED;
          schedule.lastError = 'entity_not_found';
          await manager.save(schedule);
          await manager.insert(ContentEventEntity, {
            siteId: schedule.siteId,
            entityType: schedule.entityType,
            entityId: schedule.entityId,
            eventType: ContentEventType.SCHEDULE_FAILED,
            actorKind: ContentActorKind.SYSTEM,
            actorUserId: null,
            reason: schedule.lastError,
            before: null,
            after: null,
            changes: null,
            versionId: null,
            groupId: schedule.id,
          });
          continue;
        }
        if (
          schedule.entityType === ContentEntityType.ARTICLE &&
          schedule.targetPublicationState === PublicationState.PUBLISHED &&
          (entity as ArticleEntity).editorialState !== EditorialState.APPROVED
        ) {
          schedule.status = ContentScheduleStatus.FAILED;
          schedule.lastError = 'editorial_not_approved';
          await manager.save(schedule);
          await manager.insert(ContentEventEntity, {
            siteId: schedule.siteId,
            entityType: schedule.entityType,
            entityId: schedule.entityId,
            eventType: ContentEventType.SCHEDULE_FAILED,
            actorKind: ContentActorKind.SYSTEM,
            actorUserId: null,
            reason: schedule.lastError,
            before: { publicationState: entity.publicationState },
            after: null,
            changes: null,
            versionId: null,
            groupId: schedule.id,
          });
          continue;
        }
        const previous = entity.publicationState;
        entity.publicationState = schedule.targetPublicationState;
        entity.publishedAt =
          schedule.targetPublicationState === PublicationState.PUBLISHED
            ? (entity.publishedAt ?? now)
            : schedule.targetPublicationState === PublicationState.HIDDEN
              ? entity.publishedAt
              : null;
        if (schedule.entityType === ContentEntityType.ARTICLE)
          entity.status = this.legacyArticleStatus(
            entity.publicationState,
            (entity as ArticleEntity).editorialState,
          );
        else entity.status = this.legacyCategoryStatus(entity.publicationState);
        await manager.save(entity);
        schedule.status = ContentScheduleStatus.COMPLETED;
        schedule.executedAt = now;
        schedule.lastError = null;
        await manager.save(schedule);
        await manager.insert(ContentEventEntity, {
          siteId: schedule.siteId,
          entityType: schedule.entityType,
          entityId: schedule.entityId,
          eventType: ContentEventType.SCHEDULE_EXECUTED,
          actorKind: ContentActorKind.SYSTEM,
          actorUserId: null,
          reason: 'Наступило запланированное время публикации',
          before: { publicationState: previous },
          after: { publicationState: schedule.targetPublicationState },
          changes: {
            publicationState: {
              before: previous,
              after: schedule.targetPublicationState,
            },
          },
          versionId: null,
          groupId: schedule.id,
        });
      }
      return due.length;
    });
  }

  async listArticleVersions(
    siteId: string,
    articleId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor);
    if (!(await this.articles.existsBy({ id: articleId, siteId })))
      throw new NotFoundException('Статья не найдена');
    return this.articleVersions.find({
      where: { articleId },
      relations: { actor: true },
      order: { versionNumber: 'DESC' },
    });
  }

  async compareArticleVersions(
    siteId: string,
    articleId: string,
    actor: ContentActor,
    fromVersion: number,
    toVersion: number,
  ) {
    const versions = await this.listArticleVersions(siteId, articleId, actor);
    const from = versions.find((row) => row.versionNumber === fromVersion);
    const to = versions.find((row) => row.versionNumber === toVersion);
    if (!from || !to) throw new NotFoundException('Версия не найдена');
    return {
      from,
      to,
      changes: this.changedValues(from.snapshot, to.snapshot),
    };
  }

  async restoreArticleVersion(
    siteId: string,
    articleId: string,
    versionId: string,
    actor: ContentActor,
    expectedRevision: number,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const [article, version] = await Promise.all([
      this.articles.findOne({
        where: { id: articleId, siteId, deletedAt: IsNull() },
      }),
      this.articleVersions.findOne({ where: { id: versionId, articleId } }),
    ]);
    if (!article || !version) throw new NotFoundException('Версия не найдена');
    if (article.revision !== expectedRevision)
      throw new ConflictException(
        'Материал уже изменён. Обновите данные и повторите восстановление',
      );
    const before = Object.assign(new ArticleEntity(), article);
    await this.createVersion(article, actor.userId, 'before version restore');
    const snapshot = version.snapshot;
    const assignable = [
      'title',
      'slug',
      'excerpt',
      'body',
      'bodyDocument',
      'documentVersion',
      'categoryId',
      'authorId',
      'coverMediaId',
      'previewMediaId',
      'sortOrder',
      'publicationState',
      'editorialState',
      'displayTemplateKey',
      'displayTemplateVersion',
      'displayTemplateConfig',
      'seoTitle',
      'seoDescription',
      'canonicalUrl',
      'noIndex',
    ] as const;
    for (const key of assignable)
      if (Object.prototype.hasOwnProperty.call(snapshot, key))
        (article as unknown as Record<string, unknown>)[key] = snapshot[key];
    article.revision = expectedRevision + 1;
    article.status = this.legacyArticleStatus(
      article.publicationState,
      article.editorialState,
    );
    article.updatedByUserId = actor.userId;
    const saved = await this.articles.save(article);
    await this.recordArticleChange(
      before,
      saved,
      actor.userId,
      ContentEventType.VERSION_RESTORED,
      `restored version ${version.versionNumber}`,
      true,
    );
    return saved;
  }

  async getRelatedArticles(
    siteId: string,
    articleId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor);
    return this.relatedItems.find({
      where: { articleId },
      relations: { relatedArticle: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async resolveRelatedArticles(
    siteId: string,
    articleId: string,
    publishedOnly: boolean,
  ) {
    const rows = await this.relatedItems.find({
      where: { articleId },
      relations: {
        relatedArticle: {
          category: true,
          coverMedia: true,
          previewMedia: true,
        },
      },
      order: { sortOrder: 'ASC' },
    });
    return rows
      .map((row) => row.relatedArticle)
      .filter(
        (article) =>
          article.siteId === siteId &&
          !article.deletedAt &&
          (!publishedOnly ||
            (article.publicationState === PublicationState.PUBLISHED &&
              (!article.category ||
                article.category.publicationState ===
                  PublicationState.PUBLISHED) &&
              (!article.publishedAt || article.publishedAt <= new Date()))),
      );
  }

  async updateRelatedArticles(
    siteId: string,
    articleId: string,
    actor: ContentActor,
    dto: UpdateRelatedArticlesDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    if (new Set(dto.articleIds).size !== dto.articleIds.length)
      throw new BadRequestException(
        'Связанные материалы не должны повторяться',
      );
    if (dto.articleIds.includes(articleId))
      throw new BadRequestException('Статья не может ссылаться сама на себя');
    const source = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!source) throw new NotFoundException('Статья не найдена');
    if (dto.articleIds.length) {
      const targets = await this.articles.find({
        where: { id: In(dto.articleIds), siteId, deletedAt: IsNull() },
        select: { id: true },
      });
      if (targets.length !== dto.articleIds.length)
        throw new BadRequestException('Один из связанных материалов не найден');
    }
    const beforeRows = await this.relatedItems.find({
      where: { articleId },
      order: { sortOrder: 'ASC' },
    });
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ArticleRelatedItemEntity, { articleId });
      if (dto.articleIds.length)
        await manager.insert(
          ArticleRelatedItemEntity,
          dto.articleIds.map((relatedArticleId, sortOrder) => ({
            articleId,
            relatedArticleId,
            sortOrder,
          })),
        );
    });
    await this.recordEvent({
      siteId,
      entityType: ContentEntityType.ARTICLE,
      entityId: articleId,
      eventType: ContentEventType.RELATED_UPDATED,
      actorUserId: actor.userId,
      before: { articleIds: beforeRows.map((row) => row.relatedArticleId) },
      after: { articleIds: dto.articleIds },
    });
    return this.getRelatedArticles(siteId, articleId, actor);
  }

  async duplicateArticle(
    siteId: string,
    articleId: string,
    actor: ContentActor,
    dto: DuplicateContentDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const source = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!source) throw new NotFoundException('Статья не найдена');
    if (await this.articles.existsBy({ siteId, slug: dto.slug }))
      throw new ConflictException('Такой slug статьи уже используется');
    const duplicate = await this.articles.save(
      this.articles.create({
        ...this.articleSnapshot(source),
        id: undefined,
        siteId,
        title: dto.title?.trim() || `${source.title} — копия`,
        slug: dto.slug,
        status: ArticleStatus.DRAFT,
        publicationState: PublicationState.DRAFT,
        editorialState: EditorialState.DRAFT,
        publishedAt: null,
        revision: 0,
        deletedAt: null,
        deletedByUserId: null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      }),
    );
    const related = await this.relatedItems.find({ where: { articleId } });
    if (related.length)
      await this.relatedItems.insert(
        related.map((row) => ({
          articleId: duplicate.id,
          relatedArticleId: row.relatedArticleId,
          sortOrder: row.sortOrder,
        })),
      );
    await this.recordArticleChange(
      null,
      duplicate,
      actor.userId,
      ContentEventType.CREATED,
      `duplicated from ${source.id}`,
      true,
    );
    await this.recordEvent({
      siteId,
      entityType: ContentEntityType.ARTICLE,
      entityId: source.id,
      eventType: ContentEventType.DUPLICATED,
      actorUserId: actor.userId,
      after: { duplicateId: duplicate.id },
    });
    return duplicate;
  }

  async duplicateCategory(
    siteId: string,
    categoryId: string,
    actor: ContentActor,
    dto: DuplicateContentDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const source = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!source) throw new NotFoundException('Рубрика не найдена');
    if (await this.categories.existsBy({ siteId, slug: dto.slug }))
      throw new ConflictException('Такая рубрика уже существует');
    const duplicate = await this.categories.save(
      this.categories.create({
        ...this.categorySnapshot(source),
        id: undefined,
        siteId,
        name: dto.title?.trim() || `${source.name} — копия`,
        slug: dto.slug,
        status: CategoryStatus.DRAFT,
        publicationState: PublicationState.DRAFT,
        publishedAt: null,
        deletedAt: null,
        deletedByUserId: null,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      }),
    );
    await this.recordCategoryChange(
      null,
      duplicate,
      actor.userId,
      ContentEventType.CREATED,
      `duplicated from ${source.id}`,
    );
    return duplicate;
  }

  async softDeleteArticle(
    siteId: string,
    articleId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    const before = Object.assign(new ArticleEntity(), article);
    article.deletedAt = new Date();
    article.deletedByUserId = actor.userId;
    article.publicationState = PublicationState.DISABLED;
    article.status = ArticleStatus.DRAFT;
    const saved = await this.articles.save(article);
    await this.recordArticleChange(
      before,
      saved,
      actor.userId,
      ContentEventType.DELETED,
      'moved to trash',
      true,
    );
    return { id: articleId, deletedAt: saved.deletedAt };
  }

  async restoreArticle(siteId: string, articleId: string, actor: ContentActor) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const article = await this.articles.findOne({
      where: { id: articleId, siteId },
    });
    if (!article?.deletedAt)
      throw new NotFoundException('Удалённая статья не найдена');
    const before = Object.assign(new ArticleEntity(), article);
    article.deletedAt = null;
    article.deletedByUserId = null;
    article.publicationState = PublicationState.DRAFT;
    article.status = this.legacyArticleStatus(
      article.publicationState,
      article.editorialState,
    );
    article.updatedByUserId = actor.userId;
    const saved = await this.articles.save(article);
    await this.recordArticleChange(
      before,
      saved,
      actor.userId,
      ContentEventType.RESTORED,
      'restored from trash',
      true,
    );
    return saved;
  }

  async softDeleteCategory(
    siteId: string,
    categoryId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const root = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!root) throw new NotFoundException('Рубрика не найдена');
    const deletedAt = new Date();
    const groupId = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `WITH RECURSIVE branch AS (
          SELECT id FROM categories WHERE id = $1 AND site_id = $2
          UNION ALL
          SELECT child.id FROM categories child JOIN branch parent ON child.parent_id = parent.id
        ) SELECT id FROM branch`,
        [categoryId, siteId],
      );
      const ids = rows.map((row) => row.id);
      const articleRows = await manager.find(ArticleEntity, {
        where: { siteId, categoryId: In(ids), deletedAt: IsNull() },
        select: { id: true },
      });
      await manager.update(
        CategoryEntity,
        { id: In(ids), siteId, deletedAt: IsNull() },
        {
          deletedAt,
          deletedByUserId: actor.userId,
          publicationState: PublicationState.DISABLED,
          status: CategoryStatus.DRAFT,
        },
      );
      await manager.update(
        ArticleEntity,
        { siteId, categoryId: In(ids), deletedAt: IsNull() },
        {
          deletedAt,
          deletedByUserId: actor.userId,
          publicationState: PublicationState.DISABLED,
          status: ArticleStatus.DRAFT,
        },
      );
      await manager.insert(ContentEventEntity, [
        ...ids.map((id) => ({
          siteId,
          entityType: ContentEntityType.CATEGORY,
          entityId: id,
          eventType: ContentEventType.DELETED,
          actorKind: ContentActorKind.USER,
          actorUserId: actor.userId,
          reason: 'category branch moved to trash',
          before: null,
          after: { deletedAt: deletedAt.toISOString() },
          changes: null,
          versionId: null,
          groupId,
        })),
        ...articleRows.map((article) => ({
          siteId,
          entityType: ContentEntityType.ARTICLE,
          entityId: article.id,
          eventType: ContentEventType.DELETED,
          actorKind: ContentActorKind.USER,
          actorUserId: actor.userId,
          reason: 'deleted with category branch',
          before: null,
          after: { deletedAt: deletedAt.toISOString() },
          changes: null,
          versionId: null,
          groupId,
        })),
      ]);
    });
    return { id: categoryId, deletedAt };
  }

  async restoreCategory(
    siteId: string,
    categoryId: string,
    actor: ContentActor,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const root = await this.categories.findOne({
      where: { id: categoryId, siteId },
    });
    if (!root?.deletedAt)
      throw new NotFoundException('Удалённая рубрика не найдена');
    const deletedAt = root.deletedAt;
    const groupId = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `WITH RECURSIVE branch AS (
          SELECT id FROM categories WHERE id = $1 AND site_id = $2
          UNION ALL
          SELECT child.id FROM categories child JOIN branch parent ON child.parent_id = parent.id
        ) SELECT id FROM branch`,
        [categoryId, siteId],
      );
      const ids = rows.map((row) => row.id);
      const articleRows = await manager.find(ArticleEntity, {
        where: { siteId, categoryId: In(ids), deletedAt },
        select: { id: true },
      });
      await manager
        .createQueryBuilder()
        .update(CategoryEntity)
        .set({
          deletedAt: null,
          deletedByUserId: null,
          publicationState: PublicationState.DRAFT,
          status: CategoryStatus.DRAFT,
        })
        .where('id IN (:...ids)', { ids })
        .andWhere('site_id = :siteId', { siteId })
        .andWhere('deleted_at = :deletedAt', { deletedAt })
        .execute();
      await manager
        .createQueryBuilder()
        .update(ArticleEntity)
        .set({
          deletedAt: null,
          deletedByUserId: null,
          publicationState: PublicationState.DRAFT,
          status: ArticleStatus.DRAFT,
        })
        .where('category_id IN (:...ids)', { ids })
        .andWhere('site_id = :siteId', { siteId })
        .andWhere('deleted_at = :deletedAt', { deletedAt })
        .execute();
      await manager.insert(ContentEventEntity, [
        ...ids.map((id) => ({
          siteId,
          entityType: ContentEntityType.CATEGORY,
          entityId: id,
          eventType: ContentEventType.RESTORED,
          actorKind: ContentActorKind.USER,
          actorUserId: actor.userId,
          reason: 'category branch restored from trash',
          before: { deletedAt: deletedAt.toISOString() },
          after: { deletedAt: null },
          changes: null,
          versionId: null,
          groupId,
        })),
        ...articleRows.map((article) => ({
          siteId,
          entityType: ContentEntityType.ARTICLE,
          entityId: article.id,
          eventType: ContentEventType.RESTORED,
          actorKind: ContentActorKind.USER,
          actorUserId: actor.userId,
          reason: 'restored with category branch',
          before: { deletedAt: deletedAt.toISOString() },
          after: { deletedAt: null },
          changes: null,
          versionId: null,
          groupId,
        })),
      ] as never);
    });
    return this.categories.findOneByOrFail({ id: categoryId, siteId });
  }

  async listTemplates(siteId: string, actor: ContentActor) {
    await this.requireSite(siteId, actor);
    return this.templates.find({
      where: { siteId, isActive: true },
      order: { kind: 'ASC', name: 'ASC', version: 'DESC' },
    });
  }

  async assertTemplate(
    siteId: string,
    kind: ContentTemplateKind,
    key: string,
    version: string,
  ) {
    const exists = await this.templates.existsBy({
      siteId,
      kind,
      key,
      version,
      isActive: true,
    });
    if (!exists) throw new BadRequestException('Шаблон отображения не найден');
  }

  async getArticleSectionSettings(siteId: string, actor: ContentActor) {
    await this.requireSite(siteId, actor);
    return this.articleSectionSettings.findOne({ where: { siteId } });
  }

  async updateArticleSectionSettings(
    siteId: string,
    actor: ContentActor,
    dto: UpdateArticleSectionSettingsDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.MANAGE_SETTINGS);
    const template = await this.templates.findOne({
      where: {
        siteId,
        kind: ContentTemplateKind.ARTICLES_LIST,
        key: dto.templateKey,
        version: dto.templateVersion,
        isActive: true,
      },
    });
    if (!template)
      throw new BadRequestException('Шаблон списка статей не найден');
    await this.articleSectionSettings.upsert(
      {
        siteId,
        listTemplateKey: template.key,
        listTemplateVersion: template.version,
        listTemplateConfig: dto.config ?? {},
      } as never,
      ['siteId'],
    );
    return this.articleSectionSettings.findOneByOrFail({ siteId });
  }
}
