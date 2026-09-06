import {
  ArticleStatus,
  PageKind,
  PageStatus,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

function queryBuilder(rows: unknown[]) {
  const builder = {
    where: jest.fn(),
    leftJoin: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  builder.where.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

describe('ContentService public search', () => {
  function setup() {
    const site = {
      id: 'site-id',
      slug: 'wispo-media',
      isActive: true,
      siteType: SiteType.MEDIA,
    };
    const articleBuilder = queryBuilder([
      {
        id: 'article-id',
        title: 'Published article',
        slug: 'published-article',
        excerpt: 'Useful result',
        body: '',
        updatedAt: new Date('2026-08-24T10:00:00Z'),
      },
    ]);
    const pageBuilder = queryBuilder([
      {
        id: 'page-id',
        title: 'Services',
        slug: 'services',
        kind: PageKind.PAGE,
        blocks: [{ id: 'text', type: 'text', text: 'Service description' }],
        updatedAt: new Date('2026-08-24T11:00:00Z'),
      },
    ]);
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const articles = { createQueryBuilder: jest.fn(() => articleBuilder) };
    const pages = { createQueryBuilder: jest.fn(() => pageBuilder) };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      {} as never,
    );
    return { service, sites, articleBuilder, pageBuilder };
  }

  it('returns only rows selected as published for the requested site', async () => {
    const { service, sites, articleBuilder, pageBuilder } = setup();

    await expect(
      service.searchPublicContent(' WISPO-MEDIA ', ' service ', '127.0.0.1'),
    ).resolves.toEqual({
      query: 'service',
      results: [
        {
          id: 'page-id',
          type: 'page',
          title: 'Services',
          slug: 'services',
          excerpt: 'Service description',
          path: '/pages/services',
        },
        {
          id: 'article-id',
          type: 'article',
          title: 'Published article',
          slug: 'published-article',
          excerpt: 'Useful result',
          path: '/articles/published-article',
        },
      ],
    });
    expect(sites.findOne).toHaveBeenCalledWith({
      where: { slug: 'wispo-media', isActive: true },
    });
    expect(articleBuilder.where).toHaveBeenCalledWith(
      'article.siteId = :siteId',
      { siteId: 'site-id' },
    );
    expect(articleBuilder.andWhere).toHaveBeenCalledWith(
      'article.status = :articleStatus',
      { articleStatus: ArticleStatus.PUBLISHED },
    );
    expect(pageBuilder.andWhere).toHaveBeenCalledWith(
      'page.status = :pageStatus',
      { pageStatus: PageStatus.PUBLISHED },
    );
  });

  it('escapes wildcard characters before building the ILIKE pattern', async () => {
    const { service, articleBuilder, pageBuilder } = setup();

    await service.searchPublicContent('wispo-media', '100%_safe', '127.0.0.2');

    expect(articleBuilder.andWhere).toHaveBeenLastCalledWith(
      expect.any(String),
      { pattern: '%100\\%\\_safe%' },
    );
    expect(pageBuilder.andWhere).toHaveBeenLastCalledWith(expect.any(String), {
      pattern: '%100\\%\\_safe%',
    });
  });
});
