import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  ArticleStatus,
  PublicationState,
  PageStatus,
  PlatformRole,
  SiteType,
  WorkspaceRole,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService safe deletion', () => {
  const admin = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup() {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
      }),
    };
    const memberships = {
      findOne: jest
        .fn()
        .mockResolvedValue({ role: WorkspaceRole.CONTENT_MANAGER }),
    };
    const categories = {};
    const authors = {};
    const articles = {
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const activity = {};
    const media = {};
    const pages = {
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const banners = {
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ContentService(
      sites as never,
      memberships as never,
      categories as never,
      authors as never,
      articles as never,
      activity as never,
      media as never,
      pages as never,
      banners as never,
    );
    return { service, memberships, articles, pages, banners };
  }

  it('deletes an unpublished article with its database relations', async () => {
    const { service, articles } = setup();
    const article = {
      id: 'article-id',
      siteId: 'site-id',
      status: ArticleStatus.DRAFT,
    };
    articles.findOne.mockResolvedValue(article);

    await expect(
      service.deleteArticle('site-id', 'article-id', admin),
    ).resolves.toEqual({ id: 'article-id' });
    expect(articles.remove).toHaveBeenCalledWith(article);
  });

  it('does not delete a published article', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      status: ArticleStatus.PUBLISHED,
    });

    await expect(
      service.deleteArticle('site-id', 'article-id', admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(articles.remove).not.toHaveBeenCalled();
  });

  it('does not hard-delete a hidden article that remains publicly reachable', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      status: ArticleStatus.HIDDEN,
      publicationState: PublicationState.HIDDEN,
    });

    await expect(
      service.deleteArticle('site-id', 'article-id', admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(articles.remove).not.toHaveBeenCalled();
  });

  it('does not hard-delete a revision-managed draft article', async () => {
    const { service, articles } = setup();
    articles.findOne.mockResolvedValue({
      id: 'article-id',
      siteId: 'site-id',
      status: ArticleStatus.DRAFT,
      publicationState: PublicationState.DRAFT,
    });
    Object.assign(service, {
      revisions: {
        current: jest.fn().mockResolvedValue({
          draft: { id: 'revision-id' },
          approvedRevisionId: null,
          publishedRevisionId: null,
          reviewState: 'draft',
        }),
      },
    });

    await expect(
      service.deleteArticle('site-id', 'article-id', admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(articles.remove).not.toHaveBeenCalled();
  });

  it('deletes a draft page', async () => {
    const { service, pages } = setup();
    const page = {
      id: 'page-id',
      siteId: 'site-id',
      status: PageStatus.DRAFT,
    };
    pages.findOne.mockResolvedValue(page);

    await expect(
      service.deletePage('site-id', 'page-id', admin),
    ).resolves.toEqual({ id: 'page-id' });
    expect(pages.remove).toHaveBeenCalledWith(page);
  });

  it('does not delete a published page', async () => {
    const { service, pages } = setup();
    pages.findOne.mockResolvedValue({
      id: 'page-id',
      siteId: 'site-id',
      status: PageStatus.PUBLISHED,
    });

    await expect(
      service.deletePage('site-id', 'page-id', admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pages.remove).not.toHaveBeenCalled();
  });

  it('deletes a banner', async () => {
    const { service, banners } = setup();
    const banner = { id: 'banner-id', siteId: 'site-id' };
    banners.findOne.mockResolvedValue(banner);

    await expect(
      service.deleteBanner('site-id', 'banner-id', admin),
    ).resolves.toEqual({ id: 'banner-id' });
    expect(banners.remove).toHaveBeenCalledWith(banner);
  });

  it('does not let an unassigned member delete content', async () => {
    const { service, memberships, articles } = setup();
    memberships.findOne.mockResolvedValue(null);

    await expect(
      service.deleteArticle('site-id', 'article-id', {
        userId: 'member-id',
        platformRole: PlatformRole.MEMBER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(articles.findOne).not.toHaveBeenCalled();
  });
});
