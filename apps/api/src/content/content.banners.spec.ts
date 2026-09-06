import {
  ArticleStatus,
  BannerPlacement,
  PageKind,
  PageStatus,
  PublicationState,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService public article banners', () => {
  it('returns only active article sidebar banners in display order', async () => {
    const site = {
      id: 'site-id',
      name: 'Wispo Media',
      slug: 'wispo-media',
      siteType: SiteType.MEDIA,
    };
    const article = {
      id: 'article-id',
      siteId: site.id,
      slug: 'story',
      status: ArticleStatus.PUBLISHED,
      publicationState: PublicationState.PUBLISHED,
    };
    const sidebarBanners = [
      {
        id: 'banner-id',
        placement: BannerPlacement.ARTICLE_SIDEBAR,
        isActive: true,
        sortOrder: 10,
      },
    ];
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const articles = {
      findOne: jest.fn().mockResolvedValue(article),
      find: jest.fn().mockResolvedValue([article]),
    };
    const pages = { find: jest.fn().mockResolvedValue([]) };
    const banners = { find: jest.fn().mockResolvedValue(sidebarBanners) };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      banners as never,
    );

    const result = await service.getPublicArticle('WISPO-MEDIA', 'STORY');

    expect(result.banners).toEqual(sidebarBanners);
    expect(banners.find).toHaveBeenCalledWith({
      where: {
        siteId: site.id,
        isActive: true,
        placement: BannerPlacement.ARTICLE_SIDEBAR,
      },
      relations: { media: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    expect(pages.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId: site.id,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
      }),
    );
  });
});
