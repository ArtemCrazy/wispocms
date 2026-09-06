/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ArticleStatus,
  PlatformRole,
  PublicationState,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService media article lifecycle', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup() {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Media',
      slug: 'media',
      siteType: SiteType.MEDIA,
      isActive: true,
    };
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const articles = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findOneByOrFail: jest.fn().mockResolvedValue({ revision: 8 }),
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: { transaction: jest.fn() },
    };
    const activities = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const media = { existsBy: jest.fn().mockResolvedValue(true) };
    const pages = { find: jest.fn().mockResolvedValue([]) };
    const banners = { find: jest.fn().mockResolvedValue([]) };
    const redirects = { findOne: jest.fn() };
    const service = new ContentService(
      sites as never,
      {} as never,
      {
        existsBy: jest.fn().mockResolvedValue(true),
        find: jest.fn().mockResolvedValue([]),
      } as never,
      { existsBy: jest.fn().mockResolvedValue(true) } as never,
      articles as never,
      activities as never,
      media as never,
      pages as never,
      banners as never,
      undefined,
      redirects as never,
    );
    return { service, articles, media, redirects };
  }

  it('uses scheduled visibility and deterministic public ordering', async () => {
    const { service, articles } = setup();
    await service.getPublicSite('media');

    expect(articles.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: 'site-id',
          publicationState: PublicationState.PUBLISHED,
          publishedAt: expect.anything(),
        }),
        order: {
          sortOrder: 'ASC',
          publishedAt: 'DESC',
          updatedAt: 'DESC',
        },
      }),
    );
  });

  it('resolves an old slug only to the current live article', async () => {
    const { service, articles, redirects } = setup();
    const current = {
      id: 'article-id',
      siteId: 'site-id',
      slug: 'new-slug',
      status: ArticleStatus.PUBLISHED,
      publicationState: PublicationState.PUBLISHED,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
      category: null,
    };
    articles.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(current);
    redirects.findOne.mockResolvedValue({ articleId: 'article-id' });

    const result = await service.getPublicArticle('media', 'old-slug');

    expect(result.redirectTo).toBe('new-slug');
    expect(articles.findOne.mock.calls[1][0].where).toEqual(
      expect.objectContaining({
        id: 'article-id',
      }),
    );
  });

  it.each([PublicationState.DISABLED, PublicationState.ARCHIVE])(
    'returns 404 for a directly requested %s article',
    async (publicationState) => {
      const { service, articles, redirects } = setup();
      articles.findOne.mockResolvedValue({
        id: 'article-id',
        siteId: 'site-id',
        slug: 'closed',
        publicationState,
        deletedAt: null,
        category: null,
      });
      redirects.findOne.mockResolvedValue(null);

      await expect(
        service.getPublicArticle('media', 'closed'),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('keeps a hidden article reachable by its direct URL', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      slug: 'hidden',
      publicationState: PublicationState.HIDDEN,
      deletedAt: null,
      category: null,
    });

    await expect(service.getPublicArticle('media', 'hidden')).resolves.toEqual(
      expect.objectContaining({
        article: expect.objectContaining({ id: 'article-id' }),
      }),
    );
  });

  it('updates a changed slug and its redirect in one transaction', async () => {
    const { service, articles } = setup();
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Story',
      slug: 'old-slug',
      body: 'Body',
      status: ArticleStatus.DRAFT,
      sortOrder: 0,
      publishedAt: null,
    };
    articles.findOne.mockResolvedValueOnce(article).mockResolvedValueOnce(null);
    const manager = {
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    articles.manager.transaction.mockImplementation(async (work) =>
      work(manager),
    );

    await service.updateArticle('site-id', 'article-id', actor, {
      title: 'Story',
      slug: 'new-slug',
      body: 'Body',
    });

    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'article-id', siteId: 'site-id' },
      expect.objectContaining({ slug: 'new-slug' }),
    );
    expect(manager.update.mock.calls[0][2]).not.toHaveProperty('body');
    expect(manager.upsert).toHaveBeenCalledWith(
      expect.anything(),
      { siteId: 'site-id', articleId: 'article-id', fromSlug: 'old-slug' },
      ['siteId', 'fromSlug'],
    );
    expect(articles.save).not.toHaveBeenCalled();
  });

  it('does not let create or rename steal another article redirect', async () => {
    const { service, articles, redirects } = setup();
    redirects.findOne.mockResolvedValueOnce({
      siteId: 'site-id',
      articleId: 'foreign-id',
      fromSlug: 'legacy-slug',
    });
    await expect(
      service.createArticle('site-id', actor, {
        title: 'Story',
        slug: 'legacy-slug',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(redirects.findOne).toHaveBeenCalledWith({
      where: { siteId: 'site-id', fromSlug: 'legacy-slug' },
    });

    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Story',
      slug: 'current-slug',
      body: 'Body',
      status: ArticleStatus.DRAFT,
      sortOrder: 0,
      publishedAt: null,
    };
    articles.findOne.mockResolvedValueOnce(article);
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ articleId: 'foreign-id' }),
      delete: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    };
    articles.manager.transaction.mockImplementation(async (work) =>
      work(manager),
    );

    await expect(
      service.updateArticle('site-id', 'article-id', actor, {
        title: 'Story',
        slug: 'legacy-slug',
        body: 'Body',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('allows reversing onto its own redirect without leaving a loop', async () => {
    const { service, articles } = setup();
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Story',
      slug: 'new-slug',
      body: 'Body',
      status: ArticleStatus.DRAFT,
      sortOrder: 0,
      publishedAt: null,
    };
    articles.findOne.mockResolvedValueOnce(article);
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ articleId: 'article-id' })
        .mockResolvedValueOnce(null),
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    articles.manager.transaction.mockImplementation(async (work) =>
      work(manager),
    );

    await service.updateArticle('site-id', 'article-id', actor, {
      title: 'Story',
      slug: 'old-slug',
      body: 'Body',
    });

    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), {
      siteId: 'site-id',
      fromSlug: 'old-slug',
    });
    expect(manager.upsert).toHaveBeenCalledWith(
      expect.anything(),
      { siteId: 'site-id', articleId: 'article-id', fromSlug: 'new-slug' },
      ['siteId', 'fromSlug'],
    );
  });

  it('rejects a stale body autosave without changing the article', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      status: ArticleStatus.DRAFT,
    });
    articles.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.updateArticleBody('site-id', 'article-id', actor, {
        body: 'stale body',
        expectedRevision: 4,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(articles.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'article-id',
        siteId: 'site-id',
        revision: 4,
      }),
      expect.objectContaining({ body: 'stale body', revision: 5 }),
    );
    expect(articles.save).not.toHaveBeenCalled();
  });

  it('autosaves a validated structured document under the same revision guard', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      body: 'legacy',
      status: ArticleStatus.DRAFT,
    });
    const bodyDocument = {
      version: 1 as const,
      blocks: [
        { id: 'heading', type: 'heading', level: 2, text: 'Заголовок' },
        {
          id: 'paragraph',
          type: 'paragraph',
          text: '<script>alert(1)</script>',
        },
      ],
    };

    const saved = await service.updateArticleBody(
      'site-id',
      'article-id',
      actor,
      { bodyDocument, expectedRevision: 7 },
    );

    expect(articles.update).toHaveBeenCalledWith(
      { id: 'article-id', siteId: 'site-id', revision: 7 },
      expect.objectContaining({
        bodyDocument: expect.objectContaining({
          version: 1,
          blocks: expect.arrayContaining([
            expect.objectContaining({ id: 'heading', type: 'heading' }),
            expect.objectContaining({
              id: 'paragraph',
              type: 'paragraph',
              href: null,
            }),
          ]),
        }),
        revision: 8,
        body: 'Заголовок\n\n<script>alert(1)</script>',
      }),
    );
    expect(saved.revision).toBe(8);
  });

  it('rejects reserved slugs and cross-site preview images', async () => {
    const { service, articles, media } = setup();
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      slug: 'story',
      status: ArticleStatus.DRAFT,
    };
    articles.findOne.mockResolvedValue(article);
    await expect(
      service.updateArticle('site-id', 'article-id', actor, {
        title: 'Story',
        slug: '404',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    media.existsBy.mockResolvedValue(false);
    await expect(
      service.createArticle('site-id', actor, {
        title: 'Story',
        slug: 'story',
        previewMediaId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
