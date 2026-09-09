import { BadRequestException } from '@nestjs/common';
import { PlatformRole, SiteType } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site type boundaries', () => {
  const actor = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup(siteType: SiteType) {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType,
      }),
    };
    const categories = { find: jest.fn().mockResolvedValue([]) };
    const authors = { find: jest.fn().mockResolvedValue([]) };
    const articles = { find: jest.fn().mockResolvedValue([]) };
    const pages = { find: jest.fn().mockResolvedValue([]) };
    const banners = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      authors as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      banners as never,
    );
    return { service, categories, authors, articles, pages, banners };
  }

  it('rejects article and banner API calls for landing pages', async () => {
    const { service, articles, banners } = setup(SiteType.LANDING);

    await expect(service.listArticles('site-id', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listBanners('site-id', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(articles.find).not.toHaveBeenCalled();
    expect(banners.find).not.toHaveBeenCalled();
  });

  it('allows landing pages to use their page structure', async () => {
    const { service, pages } = setup(SiteType.LANDING);

    await expect(service.listPages('site-id', actor)).resolves.toEqual([]);
    expect(pages.find).toHaveBeenCalled();
  });

  it('allows a corporate blog but rejects media-only directories', async () => {
    const { service, articles, categories, authors } = setup(
      SiteType.CORPORATE,
    );

    await expect(service.listArticles('site-id', actor)).resolves.toEqual([]);
    await expect(
      service.listCategories('site-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listAuthors('site-id', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(articles.find).toHaveBeenCalled();
    expect(categories.find).not.toHaveBeenCalled();
    expect(authors.find).not.toHaveBeenCalled();
  });

  it('keeps ecommerce on the corporate content baseline', async () => {
    const { service, articles, categories, authors, pages, banners } = setup(
      SiteType.ECOMMERCE,
    );

    await expect(service.listArticles('site-id', actor)).resolves.toEqual([]);
    await expect(service.listPages('site-id', actor)).resolves.toEqual([]);
    await expect(service.listBanners('site-id', actor)).resolves.toEqual([]);
    await expect(
      service.listCategories('site-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listAuthors('site-id', actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(articles.find).toHaveBeenCalled();
    expect(pages.find).toHaveBeenCalled();
    expect(banners.find).toHaveBeenCalled();
    expect(categories.find).not.toHaveBeenCalled();
    expect(authors.find).not.toHaveBeenCalled();
  });
});
