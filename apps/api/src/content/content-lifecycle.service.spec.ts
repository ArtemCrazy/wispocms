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
  CmsRevisionResourceEntity,
  CmsRevisionEntity,
  CategoryEntity,
  ContentEntityType,
  ContentEventEntity,
  ContentScheduleStatus,
  EditorialState,
  PlatformRole,
  PublicationState,
  SiteEntity,
} from '../database/entities';
import { ContentLifecycleService } from './content-lifecycle.service';

describe('ContentLifecycleService', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  it('captures all editable SEO and social fields in an article revision', () => {
    const { service } = setup({ id: 'article-id', siteId: 'site-id' });
    const snapshot = service.articleSnapshot({
      title: 'Title',
      slug: 'title',
      ogTitle: 'Social headline',
      ogDescription: 'Social summary',
      ogImageMediaId: 'image-id',
      structuredData: { '@type': 'Article' },
    } as ArticleEntity);
    expect(snapshot).toEqual(
      expect.objectContaining({
        ogTitle: 'Social headline',
        ogDescription: 'Social summary',
        ogImageMediaId: 'image-id',
        structuredData: { '@type': 'Article' },
      }),
    );
  });

  it('captures the article publication time in a revision snapshot', () => {
    const { service } = setup({ id: 'article-id', siteId: 'site-id' });
    const publishedAt = new Date('2026-09-18T12:00:00.000Z');
    expect(
      service.articleSnapshot({
        title: 'Live',
        publishedAt,
      } as ArticleEntity),
    ).toEqual(expect.objectContaining({ publishedAt }));
  });

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
      existsBy: jest.fn().mockResolvedValue(true),
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
        if (entity === SiteEntity)
          return { id: 'site-id', workspaceId: 'workspace-id' };
        if (entity === ArticleVersionEntity) return versions.findOne();
        if (entity === ArticleRedirectEntity) return null;
        return null;
      }),
      findOneOrFail: jest.fn().mockResolvedValue(article),
      findOneByOrFail: jest.fn().mockResolvedValue(article),
      exists: jest.fn(async (entity) => entity !== CmsRevisionResourceEntity),
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

  it('rejects legacy publication when the article has a revision ledger', async () => {
    const { service, manager } = setup({
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live',
      body: 'Text',
      bodyDocument: null,
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
    });
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.setArticlePublicationState('site-id', 'article-id', actor, {
        state: PublicationState.HIDDEN,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects legacy editorial changes when the article has a revision ledger', async () => {
    const { service, manager } = setup({
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live',
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
    });
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.setArticleEditorialState('site-id', 'article-id', actor, {
        state: EditorialState.DRAFT,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects legacy category publication when the category has a revision ledger', async () => {
    const category = Object.assign(new CategoryEntity(), {
      id: 'category-id',
      siteId: 'site-id',
      name: 'Live category',
      publicationState: PublicationState.PUBLISHED,
      status: 'active',
      deletedAt: null,
    });
    const { service, manager } = setup(category);
    manager.findOne.mockImplementation(async (entity) => {
      if (entity === CategoryEntity) return category;
      if (entity === SiteEntity)
        return { id: 'site-id', workspaceId: 'workspace-id' };
      return null;
    });
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.setCategoryPublicationState('site-id', 'category-id', actor, {
        state: PublicationState.HIDDEN,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('activates the exact approved article snapshot while preserving its publication state', async () => {
    const article = Object.assign(new ArticleEntity(), {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live title',
      slug: 'live-title',
      excerpt: null,
      body: 'Live body',
      bodyDocument: null,
      documentVersion: 1,
      categoryId: null,
      authorId: null,
      coverMediaId: null,
      previewMediaId: null,
      sortOrder: 0,
      publicationState: PublicationState.PUBLISHED,
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.PUBLISHED,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
      displayTemplateConfig: {},
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      noIndex: false,
      ogTitle: null,
      ogDescription: null,
      ogImageMediaId: null,
      structuredData: null,
      revision: 3,
      deletedAt: null,
    });
    const { service, manager } = setup(article);
    const baseline = service.articleSnapshot(article);
    const approved = {
      ...baseline,
      title: 'Approved title',
      slug: 'approved-title',
      body: 'Approved body',
      ogTitle: 'Approved social title',
      publishedAt: '2026-09-19T12:00:00.000Z',
      revision: 4,
    };

    const saved = await (
      service as unknown as {
        activateArticleRevision: (
          db: typeof manager,
          siteId: string,
          articleId: string,
          userId: string,
          snapshot: Record<string, unknown>,
          publishedSnapshot: Record<string, unknown>,
        ) => Promise<ArticleEntity>;
      }
    ).activateArticleRevision(
      manager,
      'site-id',
      'article-id',
      actor.userId,
      approved,
      baseline,
    );

    expect(saved.title).toBe('Approved title');
    expect(saved.slug).toBe('approved-title');
    expect(saved.body).toBe('Approved body');
    expect(saved.ogTitle).toBe('Approved social title');
    expect(saved.revision).toBe(4);
    expect(saved.publicationState).toBe(PublicationState.PUBLISHED);
    expect(saved.publishedAt).toEqual(new Date('2026-09-19T12:00:00.000Z'));
    expect(manager.upsert).toHaveBeenCalledWith(
      ArticleRedirectEntity,
      { siteId: 'site-id', articleId: 'article-id', fromSlug: 'live-title' },
      ['siteId', 'fromSlug'],
    );
  });

  it('does not publish an article with an author that has no published revision', async () => {
    const article = Object.assign(new ArticleEntity(), {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live title',
      slug: 'live-title',
      excerpt: null,
      body: 'Live body',
      bodyDocument: null,
      documentVersion: 1,
      categoryId: null,
      authorId: null,
      coverMediaId: null,
      previewMediaId: null,
      sortOrder: 0,
      publicationState: PublicationState.PUBLISHED,
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.PUBLISHED,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
      displayTemplateConfig: {},
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      noIndex: false,
      ogTitle: null,
      ogDescription: null,
      ogImageMediaId: null,
      structuredData: null,
      revision: 3,
      deletedAt: null,
    });
    const { service, manager } = setup(article);
    manager.exists.mockResolvedValue(true);
    manager.findOne.mockImplementation(async (entity) => {
      if (entity === ArticleEntity) return article;
      if (entity === SiteEntity)
        return { id: 'site-id', workspaceId: 'workspace-id' };
      if (entity === ArticleRedirectEntity) return null;
      if (entity === CmsRevisionResourceEntity)
        return { id: 'author-resource-id', publishedRevisionId: null };
      return null;
    });
    const baseline = service.articleSnapshot(article);

    await expect(
      service.activateArticleRevision(
        manager,
        'site-id',
        'article-id',
        actor.userId,
        { ...baseline, authorId: 'draft-author-id', revision: 4 },
        baseline,
      ),
    ).rejects.toThrow('Сначала опубликуйте выбранного автора');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('keeps the old public article when it changed after the draft baseline', async () => {
    const article = Object.assign(new ArticleEntity(), {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live title',
      slug: 'live-title',
      body: 'Live body',
      bodyDocument: null,
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
      revision: 3,
      deletedAt: null,
    });
    const { service, manager } = setup(article);
    const baseline = service.articleSnapshot(article);
    article.title = 'Changed elsewhere';

    await expect(
      service.activateArticleRevision(
        manager,
        'site-id',
        'article-id',
        actor.userId,
        { ...baseline, title: 'Proposed', revision: 4 },
        baseline,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(article.title).toBe('Changed elsewhere');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('accepts an older baseline that predates the publishedAt snapshot field', async () => {
    const article = Object.assign(new ArticleEntity(), {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live title',
      slug: 'live-title',
      body: 'Live body',
      bodyDocument: null,
      publicationState: PublicationState.PUBLISHED,
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      editorialState: EditorialState.APPROVED,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
      revision: 3,
      deletedAt: null,
    });
    const { service, manager } = setup(article);
    const baseline = service.articleSnapshot(article);
    delete baseline.publishedAt;

    const saved = await service.activateArticleRevision(
      manager,
      'site-id',
      'article-id',
      actor.userId,
      { ...baseline, title: 'Approved title', revision: 4 },
      baseline,
    );

    expect(saved.title).toBe('Approved title');
    expect(saved.publishedAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('publishes an approved revision through the article activation callback', async () => {
    const article = Object.assign(new ArticleEntity(), {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live title',
      slug: 'live-title',
      body: 'Live body',
      bodyDocument: null,
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
      status: ArticleStatus.PUBLISHED,
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
      revision: 3,
      deletedAt: null,
    });
    const { service, manager } = setup(article);
    const baseline = JSON.parse(
      JSON.stringify(service.articleSnapshot(article)),
    ) as Record<string, unknown>;
    const approved = {
      ...baseline,
      title: 'Approved title',
      revision: 4,
    };
    manager.findOne.mockImplementation(async (entity) => {
      if (entity === SiteEntity)
        return { id: 'site-id', workspaceId: 'workspace-id' };
      if (entity === ArticleEntity) return article;
      if (entity === CmsRevisionResourceEntity)
        return { id: 'resource-id', publishedRevisionId: 'baseline-id' };
      if (entity === CmsRevisionEntity)
        return { id: 'baseline-id', snapshot: baseline };
      return null;
    });
    const cmsRevisions = {
      publish: jest.fn(async (...args: unknown[]) => {
        const activate = args[5] as (
          manager: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>;
        await activate(manager, approved);
      }),
    };
    Object.assign(service, { cmsRevisions });

    const saved = await (
      service as unknown as {
        publishArticleRevision: (
          siteId: string,
          articleId: string,
          revisionId: string,
          actor: typeof actor,
        ) => Promise<ArticleEntity>;
      }
    ).publishArticleRevision('site-id', 'article-id', 'approved-id', actor);

    expect(saved.title).toBe('Approved title');
    expect(saved.revision).toBe(4);
    expect(article.title).toBe('Approved title');
  });

  it('rejects legacy version restore after article enters the revision workflow', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live',
      slug: 'live',
      body: 'Live body',
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
      revision: 3,
      deletedAt: null,
    };
    const { service, manager, versions } = setup(article);
    versions.findOne.mockResolvedValue({
      id: 'legacy-version-id',
      articleId: 'article-id',
      snapshot: { title: 'Old title', slug: 'live', body: 'Old body' },
      versionNumber: 1,
    });
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.restoreArticleVersion(
        'site-id',
        'article-id',
        'legacy-version-id',
        actor,
        3,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects legacy article scheduling after a revision ledger exists', async () => {
    const { service, manager } = setup({
      id: 'article-id',
      siteId: 'site-id',
      publicationState: PublicationState.PUBLISHED,
    });
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.schedulePublication(
        'site-id',
        ContentEntityType.ARTICLE,
        'article-id',
        actor,
        {
          state: PublicationState.HIDDEN,
          executeAt: '2030-01-01T00:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects lifecycle mutations on another site in the same workspace', async () => {
    const { service, memberships } = setup({
      id: 'article-id',
      siteId: 'site-id',
    });
    memberships.findOne.mockResolvedValue({
      role: 'wispo_manager',
      siteIds: ['other-site-id'],
    });

    await expect(
      service.setArticlePublicationState(
        'site-id',
        'article-id',
        { userId: 'manager-id', platformRole: PlatformRole.EMPLOYEE },
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

  it('does not silently remove a revision-managed article from the public site', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Live',
      slug: 'live',
      publicationState: PublicationState.PUBLISHED,
      editorialState: EditorialState.APPROVED,
      deletedAt: null,
    };
    const { service, manager } = setup(article);
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.softDeleteArticle('site-id', 'article-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(article.deletedAt).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not restore a previously deleted revision-managed article by the old route', async () => {
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Deleted',
      deletedAt: new Date('2026-09-01T00:00:00.000Z'),
      publicationState: PublicationState.DISABLED,
      editorialState: EditorialState.APPROVED,
    };
    const { service, manager } = setup(article);
    manager.exists.mockResolvedValueOnce(true);

    await expect(
      service.restoreArticle('site-id', 'article-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not execute an older scheduled article change after revisions take over', async () => {
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
      body: 'Ready',
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
    const { manager, service } = setup(article);
    manager.createQueryBuilder.mockReturnValue(queryBuilder);
    manager.exists.mockResolvedValueOnce(true);

    await service.processDueSchedules(new Date('2026-09-06T12:00:00Z'));

    expect(schedule.status).toBe(ContentScheduleStatus.FAILED);
    expect(schedule.lastError).toBe('revision_workflow_required');
    expect(article.publicationState).toBe(PublicationState.DRAFT);
    expect(manager.insert).toHaveBeenCalledWith(
      ContentEventEntity,
      expect.objectContaining({ reason: 'revision_workflow_required' }),
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
