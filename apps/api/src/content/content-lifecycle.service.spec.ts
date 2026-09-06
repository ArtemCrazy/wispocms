/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ArticleStatus,
  ContentEntityType,
  ContentScheduleStatus,
  EditorialState,
  PlatformRole,
  PublicationState,
} from '../database/entities';
import { ContentLifecycleService } from './content-lifecycle.service';

describe('ContentLifecycleService', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup(article: Record<string, unknown>) {
    const versions = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ maximum: '0' }),
      })),
      create: jest.fn((value) => ({ id: 'version-id', ...value })),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
    };
    const articles = {
      findOne: jest.fn().mockResolvedValue(article),
      save: jest.fn(async (value) => value),
    };
    const events = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const memberships = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new ContentLifecycleService(
      {} as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
      } as never,
      memberships as never,
      articles as never,
      {} as never,
      {} as never,
      versions as never,
      events as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, articles, events, versions, memberships };
  }

  it('does not publish an article before its editorial version is approved', async () => {
    const { service, articles } = setup({
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
    expect(articles.save).not.toHaveBeenCalled();
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
    const { service, articles, events, versions } = setup({
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
    expect(articles.save).toHaveBeenCalledTimes(1);
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
      editorialState: EditorialState.DRAFT,
      status: ArticleStatus.DRAFT,
      revision: 5,
      deletedAt: null,
    };
    const { service, versions } = setup(article);
    versions.findOne.mockResolvedValue({
      id: 'old-version',
      articleId: 'article-id',
      versionNumber: 2,
      snapshot: { title: 'Historic', body: 'Historic body' },
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
    expect(versions.save).toHaveBeenCalledTimes(2);
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
    const manager = {
      createQueryBuilder: jest.fn(() => queryBuilder),
      findOne: jest.fn().mockResolvedValue(article),
      save: jest.fn(async (value) => value),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn(async (work) => work(manager)),
    };
    const { service } = setup(article);
    Object.defineProperty(service, 'dataSource', { value: dataSource });

    await service.processDueSchedules(new Date('2026-09-06T12:00:00Z'));
    await service.processDueSchedules(new Date('2026-09-06T12:01:00Z'));

    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(schedule.status).toBe(ContentScheduleStatus.COMPLETED);
    expect(schedule.attemptCount).toBe(1);
    expect(manager.insert).toHaveBeenCalledTimes(1);
  });
});
