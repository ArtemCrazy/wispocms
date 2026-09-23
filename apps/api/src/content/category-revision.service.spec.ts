import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CategoryEntity,
  CategoryStatus,
  PlatformRole,
  PublicationState,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('category revision adapter', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };
  const publishedCategory = Object.assign(new CategoryEntity(), {
    id: 'category-id',
    siteId: 'site-id',
    name: 'Published category',
    slug: 'published-category',
    description: 'Published description',
    status: CategoryStatus.ACTIVE,
    publicationState: PublicationState.PUBLISHED,
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    sortOrder: 0,
    color: '#9f91ef',
    parentId: null,
    icon: null,
    imageMediaId: null,
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    noIndex: false,
    ogTitle: null,
    ogDescription: null,
    ogImageMediaId: null,
    structuredData: null,
    displayTemplateKey: 'standard-category',
    displayTemplateVersion: '1',
    displayTemplateConfig: {},
    deletedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });

  function setup(category = publishedCategory) {
    const draft = {
      id: 'draft-id',
      versionNumber: 2,
      snapshot: { ...category, name: 'Draft category', slug: 'draft-category' },
    };
    const manager = {
      findOne: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const categories = {
      find: jest.fn().mockResolvedValue([{ ...category }]),
      findOne: jest.fn().mockResolvedValue({ ...category }),
      existsBy: jest.fn().mockResolvedValue(false),
      count: jest.fn().mockResolvedValue(0),
      manager: {
        transaction: jest.fn((work: (db: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      },
    };
    const articles = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const saveDraft = jest.fn(
      (input: {
        resourceType: string;
        entityId: string;
        snapshot: Record<string, unknown>;
        expectedDraftRevisionId: string | null;
      }) => {
        void input;
        return Promise.resolve({ id: 'next-id', versionNumber: 3 });
      },
    );
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft,
        approvedRevisionId: null,
        publishedRevisionId: 'baseline-id',
        reviewState: 'draft',
      }),
      importPublishedBaseline: jest.fn(),
      saveDraft,
      saveDraftUsingManager: jest
        .fn()
        .mockResolvedValue({ id: 'created-draft-id', versionNumber: 1 }),
      publish: jest.fn(),
      getVersion: jest.fn().mockResolvedValue(draft),
    };
    const lifecycle = {
      assertTemplate: jest.fn().mockResolvedValue(undefined),
      recordCategoryChange: jest.fn().mockResolvedValue(undefined),
      recordEvent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ContentService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'site-id',
          workspaceId: 'workspace-id',
          name: 'Media',
          slug: 'media',
          siteType: SiteType.MEDIA,
          globalData: {},
          layoutSettings: {},
        }),
      } as never,
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
      {
        existsBy: jest.fn().mockResolvedValue(false),
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      lifecycle as never,
      undefined,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, categories, manager, revisions };
  }

  it('lists draft fields without changing the public category state', async () => {
    const { service } = setup();
    const [category] = await service.listCategories('site-id', actor);
    expect(category).toEqual(
      expect.objectContaining({
        name: 'Draft category',
        slug: 'draft-category',
        publicationState: PublicationState.PUBLISHED,
        status: CategoryStatus.ACTIVE,
        draftRevisionId: 'draft-id',
      }),
    );
  });

  it('creates a category and its first draft revision atomically', async () => {
    const { service, manager, revisions } = setup();
    manager.save.mockImplementation((value: CategoryEntity) =>
      Promise.resolve(
        value.slug
          ? Object.assign(value, { id: 'created-category-id' })
          : value,
      ),
    );
    const result = await service.createCategory('site-id', actor, {
      name: 'New category',
      slug: 'new-category',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'created-category-id',
        publicationState: PublicationState.DRAFT,
        draftRevisionId: 'created-draft-id',
      }),
    );
    expect(revisions.saveDraftUsingManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        resourceType: 'category',
        entityId: 'created-category-id',
        expectedDraftRevisionId: null,
      }),
    );
  });

  it('saves a published category edit only as a new revision', async () => {
    const { service, manager, revisions } = setup();
    const result = await service.updateCategory(
      'site-id',
      'category-id',
      actor,
      {
        name: 'Next category',
        slug: 'next-category',
        expectedDraftRevisionId: 'draft-id',
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        name: 'Next category',
        publicationState: PublicationState.PUBLISHED,
        draftRevisionId: 'next-id',
      }),
    );
    expect(manager.update).not.toHaveBeenCalled();
    const savedDraft = revisions.saveDraft.mock.calls[0]?.[0];
    expect(savedDraft).toBeDefined();
    if (!savedDraft) throw new Error('Draft call is missing');
    expect(savedDraft.resourceType).toBe('category');
    expect(savedDraft.entityId).toBe('category-id');
    expect(savedDraft.snapshot).toMatchObject({
      name: 'Next category',
      slug: 'next-category',
    });
    expect(savedDraft.expectedDraftRevisionId).toBe('draft-id');
  });

  it('rejects a stale category edit before saving a revision', async () => {
    const { service, revisions } = setup();
    await expect(
      service.updateCategory('site-id', 'category-id', actor, {
        name: 'Stale category',
        slug: 'stale-category',
        expectedDraftRevisionId: 'old-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('previews an exact old revision rather than the current draft', async () => {
    const { service, revisions } = setup();
    revisions.getVersion.mockResolvedValue({
      id: 'old-id',
      versionNumber: 1,
      snapshot: {
        ...publishedCategory,
        name: 'Old preview',
        slug: 'old-preview',
      },
    });
    const result = await service.getCategoryRevisionPreview(
      'site-id',
      'category-id',
      'old-id',
      actor,
    );
    expect(result.category).toEqual(
      expect.objectContaining({ name: 'Old preview', slug: 'old-preview' }),
    );
    expect(result.site.noIndex).toBe(true);
  });

  it('publishes the exact approved snapshot and creates the old slug redirect', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne
      .mockResolvedValueOnce({ ...publishedCategory })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) =>
        activate(manager, {
          ...publishedCategory,
          name: 'Approved category',
          slug: 'approved-category',
        }),
    );
    const result = await service.publishCategoryRevision(
      'site-id',
      'category-id',
      'approved-id',
      actor,
    );
    expect(result).toEqual(
      expect.objectContaining({
        name: 'Approved category',
        slug: 'approved-category',
        publicationState: PublicationState.PUBLISHED,
        status: CategoryStatus.ACTIVE,
      }),
    );
    expect(manager.upsert).toHaveBeenCalledWith(
      expect.anything(),
      {
        siteId: 'site-id',
        categoryId: 'category-id',
        fromSlug: 'published-category',
      },
      ['siteId', 'fromSlug'],
    );
  });

  it('keeps the public category unchanged when an approved snapshot is invalid', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne.mockResolvedValueOnce({ ...publishedCategory });
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) => activate(manager, { ...publishedCategory, name: '', slug: 'bad' }),
    );
    await expect(
      service.publishCategoryRevision(
        'site-id',
        'category-id',
        'approved-id',
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
