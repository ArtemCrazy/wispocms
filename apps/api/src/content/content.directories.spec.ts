import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PlatformRole, SiteType, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService directories', () => {
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
    const categories = {
      findOne: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((value: unknown) => value),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const categoryManager = {
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((entity: unknown, value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(categories, {
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof categoryManager) => Promise<unknown>) =>
            work(categoryManager),
        ),
      },
    });
    const authors = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const articles = { count: jest.fn() };
    const media = { existsBy: jest.fn().mockResolvedValue(true) };
    const emptyRepository = {};
    const service = new ContentService(
      sites as never,
      memberships as never,
      categories as never,
      authors as never,
      articles as never,
      emptyRepository as never,
      media as never,
      emptyRepository as never,
      emptyRepository as never,
    );
    return {
      service,
      sites,
      memberships,
      categories,
      authors,
      articles,
      media,
      categoryManager,
    };
  }

  it('normalizes and updates a category', async () => {
    const { service, categories, categoryManager } = setup();
    const category = {
      id: 'category-id',
      siteId: 'site-id',
      name: 'Новости',
      slug: 'news',
      color: '#9f91ef',
    };
    categories.findOne
      .mockResolvedValueOnce(category)
      .mockResolvedValueOnce(null);
    categoryManager.findOne
      .mockResolvedValueOnce(category)
      .mockResolvedValue(null);

    await expect(
      service.updateCategory('site-id', 'category-id', admin, {
        name: '  Кейсы  ',
        slug: '  cases  ',
        color: '#112233',
      }),
    ).resolves.toMatchObject({
      name: 'Кейсы',
      slug: 'cases',
      color: '#112233',
    });
  });

  it('does not allow a duplicate category slug', async () => {
    const { service, categories } = setup();
    categories.findOne
      .mockResolvedValueOnce({ id: 'category-id', siteId: 'site-id' })
      .mockResolvedValueOnce({ id: 'another-category', siteId: 'site-id' });

    await expect(
      service.updateCategory('site-id', 'category-id', admin, {
        name: 'Новости',
        slug: 'news',
        color: '#112233',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a nested category with media and SEO settings', async () => {
    const { service, categories, media } = setup();
    categories.findOne.mockResolvedValueOnce({
      id: 'parent-id',
      siteId: 'site-id',
      parentId: null,
    });

    await expect(
      service.createCategory('site-id', admin, {
        name: '  Новости компании  ',
        slug: '  company-news  ',
        color: '#112233',
        parentId: 'parent-id',
        icon: '📰',
        imageMediaId: 'media-id',
        seoTitle: '  Новости Crazy Studio  ',
        seoDescription: '  Главные новости  ',
        canonicalUrl: 'https://example.ru/articles/company-news/',
        noIndex: true,
      }),
    ).resolves.toMatchObject({
      name: 'Новости компании',
      slug: 'company-news',
      parentId: 'parent-id',
      imageMediaId: 'media-id',
      seoTitle: 'Новости Crazy Studio',
      seoDescription: 'Главные новости',
      canonicalUrl: 'https://example.ru/articles/company-news',
      noIndex: true,
    });
    expect(media.existsBy).toHaveBeenCalledWith({
      id: 'media-id',
      workspaceId: 'workspace-id',
    });
  });

  it('does not allow moving a category inside its descendant', async () => {
    const { service, categories } = setup();
    categories.findOne
      .mockResolvedValueOnce({
        id: 'category-id',
        siteId: 'site-id',
        parentId: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'child-id',
        siteId: 'site-id',
        parentId: 'category-id',
      });

    await expect(
      service.updateCategory('site-id', 'category-id', admin, {
        name: 'Новости',
        slug: 'news',
        parentId: 'child-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not accept a parent category from another site', async () => {
    const { service, categories } = setup();
    categories.findOne.mockResolvedValueOnce(null);

    await expect(
      service.createCategory('site-id', admin, {
        name: 'Новости',
        slug: 'news',
        parentId: 'foreign-category-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protects a category used by articles from deletion', async () => {
    const { service, categories, articles } = setup();
    categories.findOne.mockResolvedValue({
      id: 'category-id',
      siteId: 'site-id',
    });
    articles.count.mockResolvedValue(3);

    await expect(
      service.deleteCategory('site-id', 'category-id', admin),
    ).rejects.toThrow('привязано материалов — 3');
    expect(categories.remove).not.toHaveBeenCalled();
  });

  it('protects a category that contains child categories', async () => {
    const { service, categories, articles } = setup();
    categories.findOne.mockResolvedValue({
      id: 'category-id',
      siteId: 'site-id',
    });
    articles.count.mockResolvedValue(0);
    categories.count.mockResolvedValue(2);

    await expect(
      service.deleteCategory('site-id', 'category-id', admin),
    ).rejects.toThrow('дочерние рубрики — 2');
    expect(categories.remove).not.toHaveBeenCalled();
  });

  it('updates an author and clears optional fields', async () => {
    const { service, authors } = setup();
    const author = {
      id: 'author-id',
      siteId: 'site-id',
      fullName: 'Автор',
      email: 'old@example.ru',
      bio: 'Описание',
    };
    authors.findOne.mockResolvedValue(author);

    await expect(
      service.updateAuthor('site-id', 'author-id', admin, {
        fullName: '  Анна Соколова  ',
        email: null,
        bio: null,
      }),
    ).resolves.toMatchObject({
      fullName: 'Анна Соколова',
      email: null,
      bio: null,
    });
  });

  it('allows deleting only an unused author', async () => {
    const { service, authors, articles } = setup();
    const author = { id: 'author-id', siteId: 'site-id' };
    authors.findOne.mockResolvedValue(author);
    articles.count.mockResolvedValue(0);

    await expect(
      service.deleteAuthor('site-id', 'author-id', admin),
    ).resolves.toEqual({ id: 'author-id' });
    expect(authors.remove).toHaveBeenCalledWith(author);
  });

  it('lets an assigned approver edit directories', async () => {
    const { service, memberships, authors } = setup();
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.CLIENT_APPROVER,
    });
    const author = {
      id: 'author-id',
      siteId: 'site-id',
      fullName: 'Старое имя',
      email: null,
      bio: null,
    };
    authors.findOne.mockResolvedValue(author);

    await expect(
      service.updateAuthor(
        'site-id',
        'author-id',
        { userId: 'member-id', platformRole: PlatformRole.MEMBER },
        { fullName: 'Анна Соколова', email: null, bio: null },
      ),
    ).resolves.toMatchObject({ fullName: 'Анна Соколова' });
    expect(authors.save).toHaveBeenCalledWith(author);
  });

  it('does not let an unassigned member edit directories', async () => {
    const { service, memberships, authors } = setup();
    memberships.findOne.mockResolvedValue(null);

    await expect(
      service.updateAuthor(
        'site-id',
        'author-id',
        { userId: 'member-id', platformRole: PlatformRole.MEMBER },
        { fullName: 'Анна Соколова', email: null, bio: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authors.findOne).not.toHaveBeenCalled();
  });
});
