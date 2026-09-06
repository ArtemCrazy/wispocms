import {
  ArticleStatus,
  PageKind,
  PageStatus,
  PlatformRole,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService item SEO', () => {
  const actor = {
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
    const articles = {
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) => ({ ...value })),
      save: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) =>
          Promise.resolve({ ...value }),
        ),
    };
    const articleActivities = {
      create: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) => ({ ...value })),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const pages = {
      existsBy: jest.fn().mockResolvedValue(false),
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) => ({ ...value })),
      save: jest
        .fn()
        .mockImplementation((value: Record<string, unknown>) =>
          Promise.resolve({ ...value }),
        ),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      articles as never,
      articleActivities as never,
      {} as never,
      pages as never,
      {} as never,
    );
    return { service, articles, pages };
  }

  it('normalizes SEO fields while creating an article', async () => {
    const { service, articles } = setup();

    await service.createArticle('site-id', actor, {
      title: 'Материал',
      slug: 'material',
      status: ArticleStatus.DRAFT,
      seoTitle: '  Заголовок для поиска  ',
      seoDescription: '  Описание для поиска  ',
      canonicalUrl: 'https://example.ru/material/',
      noIndex: true,
    });

    expect(articles.create).toHaveBeenCalledWith(
      expect.objectContaining({
        seoTitle: 'Заголовок для поиска',
        seoDescription: 'Описание для поиска',
        canonicalUrl: 'https://example.ru/material',
        noIndex: true,
      }),
    );
  });

  it('stores SEO fields on a new page', async () => {
    const { service, pages } = setup();

    await service.createPage('site-id', actor, {
      title: 'О компании',
      slug: 'about',
      kind: PageKind.PAGE,
      status: PageStatus.DRAFT,
      blocks: [],
      seoTitle: 'О компании — Wispo',
      seoDescription: '',
      canonicalUrl: '',
      noIndex: false,
    });

    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        seoTitle: 'О компании — Wispo',
        seoDescription: null,
        canonicalUrl: null,
        noIndex: false,
      }),
    );
  });

  it('routes a fixed privacy page through its dedicated module', async () => {
    const { service, pages } = setup();
    const systemPage = {
      id: 'privacy-id',
      siteId: 'site-id',
      title: 'Политика конфиденциальности',
      slug: 'privacy-policy',
      kind: PageKind.PAGE,
      status: PageStatus.DRAFT,
      blocks: [],
    };
    pages.findOne.mockResolvedValueOnce(systemPage);

    await expect(
      service.updatePage('site-id', 'privacy-id', actor, {
        title: 'Переименованная страница',
        slug: 'another-address',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.DRAFT,
        blocks: [{ id: 'policy-text', type: 'text', text: 'Новая редакция' }],
        seoTitle: '',
        seoDescription: '',
        canonicalUrl: '',
        noIndex: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pages.save).not.toHaveBeenCalled();
  });
});
import { BadRequestException } from '@nestjs/common';
