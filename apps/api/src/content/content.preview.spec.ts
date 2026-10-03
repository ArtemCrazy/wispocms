/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  ArticleStatus,
  PageKind,
  PageStatus,
  PlatformRole,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService authenticated preview', () => {
  const actor = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup() {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Wispo Media',
      slug: 'wispo-media',
      siteType: SiteType.MEDIA,
      templatePackageId: 'package-id',
      currentTemplatePackageVersionId: 'version-id',
    };
    const identityQuery = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        packageId: 'skinova-media',
        packageVersion: '1',
      }),
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      createQueryBuilder: jest.fn().mockReturnValue(identityQuery),
    };
    const articles = { findOne: jest.fn(), find: jest.fn() };
    const categories = { find: jest.fn().mockResolvedValue([]) };
    const pages = { findOne: jest.fn(), find: jest.fn() };
    const banners = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      banners as never,
    );
    return { service, articles, pages, site, sites, identityQuery };
  }

  it('returns a draft article only through the authenticated preview', async () => {
    const { service, articles, pages, sites, identityQuery } = setup();
    const draft = {
      id: 'article-id',
      siteId: 'site-id',
      title: 'Draft story',
      status: ArticleStatus.DRAFT,
    };
    articles.findOne.mockResolvedValue(draft);
    articles.find.mockResolvedValue([]);
    pages.find.mockResolvedValue([]);

    const result = await service.getArticlePreview(
      'site-id',
      'article-id',
      actor,
    );

    expect(result.article).toBe(draft);
    expect(result.site.noIndex).toBe(true);
    expect(result.site.templatePackage).toEqual({
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(sites.findOne).toHaveBeenCalledWith({ where: { id: 'site-id' } });
    expect(identityQuery.select).toHaveBeenCalledWith(
      'templatePackage.packageId',
      'packageId',
    );
    expect(identityQuery.addSelect).toHaveBeenCalledWith(
      'currentVersion.packageVersion',
      'packageVersion',
    );
    expect(JSON.stringify(identityQuery.select.mock.calls)).not.toContain(
      'manifest',
    );
    expect(result.categories).toEqual([]);
    expect(articles.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'article-id', siteId: 'site-id' }),
      }),
    );
  });

  it('substitutes a draft homepage into a full-site preview', async () => {
    const { service, articles, pages } = setup();
    const homepage = {
      id: 'page-id',
      siteId: 'site-id',
      title: 'Draft homepage',
      kind: PageKind.HOMEPAGE,
      status: PageStatus.DRAFT,
      blocks: [],
    };
    const navigationPage = {
      id: 'about-id',
      kind: PageKind.PAGE,
      status: PageStatus.PUBLISHED,
    };
    pages.findOne.mockResolvedValue(homepage);
    pages.find.mockResolvedValue([navigationPage]);
    articles.find.mockResolvedValue([]);

    const result = await service.getPagePreview('site-id', 'page-id', actor);

    expect(result.pages).toEqual([homepage, navigationPage]);
    expect(result.site.noIndex).toBe(true);
    expect(result.site.templatePackage).toEqual({
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(result.categories).toEqual([]);
    expect(pages.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          siteId: 'site-id',
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
      }),
    );
  });
});
