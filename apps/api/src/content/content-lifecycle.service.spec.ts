/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ArticleEntity,
  ArticleRedirectEntity,
  ArticleStatus,
  ArticleVersionEntity,
  CategoryEntity,
  ContentEntityType,
  ContentEventEntity,
  ContentScheduleStatus,
  EditorialState,
  PlatformRole,
  PublicationState,
} from '../database/entities';
import { ContentLifecycleService } from './content-lifecycle.service';

describe('ContentLifecycleService', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup(article: Record<string, unknown>) {
    const versionQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maximum: '0' }),
    };
    const versions = {
      createQueryBuilder: jest.fn(() => versionQueryBuilder),
      create: jest.fn((value) => ({ id: 'version-id', ...value })),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
    };
    const articles = {
      findOne: jest.fn().mockResolvedValue(article),
      save: jest.fn(async (value) => value),
    };
    const categories = {
      findOne: jest.fn(),
      findOneByOrFail: jest.fn(async () => article),
    };
    const events = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const memberships = { findOne: jest.fn().mockResolvedValue(null) };
    const manager = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(async (entity) => {
        if (entity === ArticleEntity) return article;
        if (entity === ArticleVersionEntity) return versions.findOne();
        if (entity === ArticleRedirectEntity) return null;
        return null;
      }),
      findOneOrFail: jest.fn().mockResolvedValue(article),
      findOneByOrFail: jest.fn().mockResolvedValue(article),
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
      query: jest.fn().mockResolvedValue([]),
      create: jest.fn((entity, value) => Object.assign(new entity(), value)),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
      insert: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn((entity) => {
        if (entity === ArticleVersionEntity) return versions;
        if (entity === ContentEventEntity) return events;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    };
    const service = new ContentLifecycleService(
      dataSource as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
      } as never,
      memberships as never,
      articles as never,
      categories as never,
      {} as never,
      versions as never,
      events as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return {
      service,
      articles,
      categories,
      dataSource,
      events,
      manager,
      memberships,
      versions,
      versionQueryBuilder,
    };
  }

  it('does not publish an article before its editorial version is approved', async () => {
    const { service, manager } = setup({
      id: 'article-id',
      siteId: 'site-id',
      title: 'Draft',
      body: 'Text',
      bodyDocument: null,
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.REVIEW,
    });

    await expect(
      service.setArticlePublicationState('site-id', 'article-id', actor, {
        state: PublicationState.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects lifecycle mutations without a site membership', async () => {
    const { service } = setup({ id: 'article-id', siteId: 'site-id' });

    await expect(
      service.setArticlePublicationState(
        'site-id',
        'article-id',
        { userId: 'outsider-id', platformRole: PlatformRole.EMPLOYEE },
        { state: PublicationState.DRAFT },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('publishes an approved article and records an immutable versioned event', async () => {
    const { service, events, manager, versions } = setup({
      id: 'article-id',
      siteId: 'site-id',
      title: 'Approved',
      slug: 'approved',
      body: 'Text',
      bodyDocument: null,
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.DRAFT,
      revision: 1,
    });

    const result = await service.setArticlePublicationState(
      'site-id',
      'article-id',
      actor,
      { state: PublicationState.PUBLISHED },
    );

    expect(result.publicationState).toBe(PublicationState.PUBLISHED);
    expect(manager.save).toHaveBeenCalledTimes(1);
    expect(versions.save).toHaveBeenCalledTimes(1);
    expect(events.save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: ContentEntityType.ARTICLE,
        actorUserId: actor.userId,
        versionId: 'version-id',
      }),
    );
  });

  it('soft-deletes and restores an article as a non-public draft', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Published',
      slug: 'published',
      body: 'Text',
      bodyDocument: null,
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.PUBLISHED,
      revision: 3,
      deletedAt: null,
      deletedByUserId: null,
    };
    const { service, events } = setup(article);

    await service.softDeleteArticle('site-id', 'article-id', actor);
    expect(article.publicationState).toBe(PublicationState.DISABLED);
    expect(article.deletedAt).toBeInstanceOf(Date);

    const restored = await service.restoreArticle(
      'site-id',
      'article-id',
      actor,
    );
    expect(restored.publicationState).toBe(PublicationState.DRAFT);
    expect(restored.deletedAt).toBeNull();
    expect(events.save).toHaveBeenCalledTimes(2);
  });

  it('restores an old snapshot as a new revision without overwriting history', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Current',
      slug: 'current',
      body: 'Current body',
      bodyDocument: null,
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.CHANGES,
      status: ArticleStatus.DRAFT,
      revision: 5,
      deletedAt: null,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
    };
    const { manager, service, versions } = setup(article);
    versions.findOne.mockResolvedValue({
      id: 'old-version',
      articleId: 'article-id',
      versionNumber: 2,
      snapshot: {
        title: 'Historic',
        slug: 'historic',
        body: 'Historic body',
        publicationState: PublicationState.PUBLISHED,
        editorialState: EditorialState.APPROVED,
      },
    });

    const restored = await service.restoreArticleVersion(
      'site-id',
      'article-id',
      'old-version',
      actor,
      5,
    );

    expect(restored.title).toBe('Historic');
    expect(restored.body).toBe('Historic body');
    expect(restored.revision).toBe(6);
    expect(restored.publicationState).toBe(PublicationState.DRAFT);
    expect(restored.editorialState).toBe(EditorialState.CHANGES);
    expect(manager.upsert).toHaveBeenCalledWith(
      ArticleRedirectEntity,
      expect.objectContaining({ fromSlug: 'current' }),
      ['siteId', 'fromSlug'],
    );
    expect(versions.save).toHaveBeenCalledTimes(2);
  });

  it('rejects a restored slug owned by another article or redirect', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Current',
      slug: 'current',
      body: 'Current body',
      bodyDocument: null,
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.DRAFT,
      status: ArticleStatus.DRAFT,
      revision: 5,
      deletedAt: null,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
    };
    const { manager, service, versions } = setup(article);
    const version = {
      id: 'old-version',
      articleId: 'article-id',
      versionNumber: 2,
      snapshot: { slug: 'occupied', body: 'Historic body' },
    };
    versions.findOne.mockResolvedValue(version);
    manager.findOne.mockImplementation(async (entity, options) => {
      if (entity === ArticleVersionEntity) return version;
      if (entity === ArticleEntity && options.where.id) return article;
      if (entity === ArticleEntity && options.where.slug)
        return { id: 'other-article' };
      return null;
    });

    await expect(
      service.restoreArticleVersion(
        'site-id',
        'article-id',
        'old-version',
        actor,
        5,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(versions.save).not.toHaveBeenCalled();
  });

  it('locks the article row before allocating the next version number', async () => {
    const article = { id: 'article-id', siteId: 'site-id' };
    const { manager, service, versionQueryBuilder } = setup(article);

    await service.createVersion(
      article as ArticleEntity,
      actor.userId,
      'save',
      manager as never,
    );

    expect(manager.findOneOrFail).toHaveBeenCalledWith(
      ArticleEntity,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(manager.findOneOrFail.mock.invocationCallOrder[0]).toBeLessThan(
      versionQueryBuilder.getRawOne.mock.invocationCallOrder[0],
    );
  });

  it('executes one due schedule once under a row lock', async () => {
    const schedule = {
      id: 'schedule-id',
      siteId: 'site-id',
      entityType: ContentEntityType.ARTICLE,
      entityId: 'article-id',
      targetPublicationState: PublicationState.PUBLISHED,
      status: ContentScheduleStatus.PENDING,
      attemptCount: 0,
    };
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      body: 'Text',
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.DRAFT,
      publishedAt: null,
    };
    const getMany = jest
      .fn()
      .mockResolvedValueOnce([schedule])
      .mockResolvedValueOnce([]);
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany,
    };
    const { manager, service } = setup(article);
    manager.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.processDueSchedules(new Date('2026-09-06T12:00:00Z'));
    await service.processDueSchedules(new Date('2026-09-06T12:01:00Z'));

    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(schedule.status).toBe(ContentScheduleStatus.COMPLETED);
    expect(schedule.attemptCount).toBe(1);
    expect(manager.insert).toHaveBeenCalledTimes(1);
  });

  it('fails a scheduled publish for an approved article with empty content', async () => {
    const schedule = {
      id: 'schedule-id',
      siteId: 'site-id',
      entityType: ContentEntityType.ARTICLE,
      entityId: 'article-id',
      targetPublicationState: PublicationState.PUBLISHED,
      status: ContentScheduleStatus.PENDING,
      attemptCount: 0,
    };
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      body: '',
      bodyDocument: { version: 1, blocks: [] },
      publicationState: PublicationState.DRAFT,
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.DRAFT,
      publishedAt: null,
    };
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([schedule]),
    };
    const { manager, service, versions } = setup(article);
    manager.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.processDueSchedules(new Date('2026-09-06T12:00:00Z'));

    expect(schedule.status).toBe(ContentScheduleStatus.FAILED);
    expect(schedule.lastError).toBe('article_body_empty');
    expect(article.publicationState).toBe(PublicationState.DRAFT);
    expect(versions.save).not.toHaveBeenCalled();
    expect(manager.insert).toHaveBeenCalledWith(
      ContentEventEntity,
      expect.objectContaining({ reason: 'article_body_empty' }),
    );
  });

  it('audits only category descendants changed by branch delete and restore', async () => {
    const deletedAt = new Date('2026-09-06T10:00:00Z');
    const root = {
      id: 'root-id',
      siteId: 'site-id',
      deletedAt: null as Date | null,
    };
    const { categories, manager, service } = setup({});
    categories.findOne.mockResolvedValue(root);
    manager.query.mockResolvedValue([{ id: 'root-id' }, { id: 'child-id' }]);
    manager.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    });
    manager.find.mockImplementation(async (entity) =>
      entity === CategoryEntity ? [{ id: 'root-id' }] : [],
    );

    await service.softDeleteCategory('site-id', 'root-id', actor);
    root.deletedAt = deletedAt;
    await service.restoreCategory('site-id', 'root-id', actor);

    for (const [entity, events] of manager.insert.mock.calls) {
      if (entity !== ContentEventEntity || !Array.isArray(events)) continue;
      const categoryIds = events
        .filter((event) => event.entityType === ContentEntityType.CATEGORY)
        .map((event) => event.entityId);
      expect(categoryIds).toEqual(['root-id']);
      expect(categoryIds).not.toContain('child-id');
    }
  });
});
