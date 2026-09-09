import {
  PageKind,
  PageStatus,
  PublicationState,
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
  function setup(searchableSections?: string[]) {
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
    const categoryBuilder = queryBuilder([
      {
        id: 'category-id',
        name: 'Insights',
        slug: 'insights',
        description: 'Expert materials',
        updatedAt: new Date('2026-08-24T12:00:00Z'),
      },
    ]);
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const articles = { createQueryBuilder: jest.fn(() => articleBuilder) };
    const categories = { createQueryBuilder: jest.fn(() => categoryBuilder) };
    const pages = { createQueryBuilder: jest.fn(() => pageBuilder) };
    const searchSettings = searchableSections
      ? {
          findOneBy: jest.fn().mockResolvedValue({ searchableSections }),
        }
      : undefined;
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      {} as never,
      pages as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      searchSettings as never,
    );
    return { service, sites, articleBuilder, pageBuilder, categoryBuilder };
  }

  it('defaults Media search scope to published articles', async () => {
    const { service, sites, articleBuilder, pageBuilder } = setup();

    await expect(
      service.searchPublicContent(' WISPO-MEDIA ', ' service ', '127.0.0.1'),
    ).resolves.toEqual({
      query: 'service',
      results: [
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
      'article.publicationState = :publicationState',
      { publicationState: PublicationState.PUBLISHED },
    );
    expect(articleBuilder.andWhere).toHaveBeenCalledWith(
      'article.deletedAt IS NULL',
    );
    const articleFilters = articleBuilder.andWhere.mock.calls as Array<
      [string, { now?: unknown }?]
    >;
    const scheduledFilter = articleFilters.find(([statement]) =>
      statement.includes('article.publishedAt'),
    );
    expect(scheduledFilter?.[1]?.now).toBeInstanceOf(Date);
    expect(articleBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('category.publicationState'),
      { categoryPublicationState: PublicationState.PUBLISHED },
    );
    expect(pageBuilder.where).not.toHaveBeenCalled();
  });

  it('honors persisted page search scope', async () => {
    const { service, pageBuilder } = setup(['pages']);
    const result = await service.searchPublicContent(
      'wispo-media',
      'service',
      '127.0.0.3',
    );
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'page-id', type: 'page' }),
    ]);
    expect(pageBuilder.andWhere).toHaveBeenCalledWith(
      'page.status = :pageStatus',
      { pageStatus: PageStatus.PUBLISHED },
    );
  });

  it('honors persisted category search scope', async () => {
    const { service, categoryBuilder } = setup(['categories']);
    const result = await service.searchPublicContent(
      'wispo-media',
      'insights',
      '127.0.0.4',
    );
    expect(result.results).toEqual([
      expect.objectContaining({ id: 'category-id', type: 'category' }),
    ]);
    expect(categoryBuilder.andWhere).toHaveBeenCalledWith(
      'category.publicationState = :publicationState',
      expect.any(Object),
    );
  });

  it('escapes wildcard characters before building the ILIKE pattern', async () => {
    const { service, articleBuilder, pageBuilder } = setup([
      'articles',
      'pages',
    ]);

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
