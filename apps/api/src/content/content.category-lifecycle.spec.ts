/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import {
  CategoryEntity,
  CategoryStatus,
  PlatformRole,
  PublicationState,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService category lifecycle', () => {
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
    const manager = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const categories = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      existsBy: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: { transaction: jest.fn(async (work) => work(manager)) },
    };
    const articles = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const redirects = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      existsBy: jest.fn().mockResolvedValue(false),
    };
    const categoryActivities = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const service = new ContentService(
      { findOne: jest.fn().mockResolvedValue(site) } as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      { existsBy: jest.fn().mockResolvedValue(true) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      undefined,
      undefined,
      redirects as never,
      categoryActivities as never,
    );
    return { service, categories, articles, redirects, manager };
  }

  it('rejects a slug owned by another category redirect before mutation', async () => {
    const { service, categories, redirects, manager } = setup();
    categories.findOne
      .mockResolvedValueOnce({
        id: 'category-id',
        siteId: 'site-id',
        name: 'Old',
        slug: 'old',
        status: CategoryStatus.ACTIVE,
        parentId: null,
        color: '#000000',
      })
      .mockResolvedValueOnce(null);
    redirects.findOne.mockResolvedValue({
      categoryId: 'foreign-category',
      fromSlug: 'new',
    });
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ categoryId: 'foreign-category' });

    await expect(
      service.updateCategory('site-id', 'category-id', actor, {
        name: 'New',
        slug: 'new',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.upsert).not.toHaveBeenCalled();
  });

  it('moves children and articles explicitly before deleting a category', async () => {
    const { service, categories, articles, manager } = setup();
    categories.findOne.mockResolvedValue({
      id: 'category-id',
      siteId: 'site-id',
      name: 'Category',
      parentId: null,
    });
    categories.count.mockResolvedValue(2);
    articles.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    await service.deleteCategory('site-id', 'category-id', actor, {
      moveToCategoryId: null,
    });

    expect(manager.update).toHaveBeenCalledWith(
      CategoryEntity,
      { siteId: 'site-id', parentId: 'category-id' },
      expect.objectContaining({ parentId: null }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { siteId: 'site-id', categoryId: 'category-id' },
      expect.objectContaining({ categoryId: null }),
    );
    expect(manager.delete).toHaveBeenCalledWith(CategoryEntity, {
      id: 'category-id',
      siteId: 'site-id',
    });
  });

  it('keeps hidden categories reachable by their direct public URL', async () => {
    const { service, categories, redirects } = setup();
    categories.findOne.mockResolvedValue({
      id: 'category-id',
      siteId: 'site-id',
      slug: 'hidden',
      status: CategoryStatus.HIDDEN,
      publicationState: PublicationState.HIDDEN,
      deletedAt: null,
      publishedAt: null,
    });
    redirects.findOne.mockResolvedValue(null);
    await expect(service.getPublicCategory('media', 'hidden')).resolves.toEqual(
      expect.objectContaining({
        category: expect.objectContaining({ id: 'category-id' }),
      }),
    );
  });
});
