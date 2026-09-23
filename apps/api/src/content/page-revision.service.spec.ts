import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PageKind,
  PageStatus,
  PlatformRole,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ordinary page revision adapter', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };
  const publishedPage = {
    id: 'page-id',
    siteId: 'site-id',
    title: 'Published title',
    slug: 'about',
    kind: PageKind.PAGE,
    status: PageStatus.PUBLISHED,
    blocks: [],
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    noIndex: false,
    ogTitle: null,
    ogDescription: null,
    ogImageMediaId: null,
    structuredData: null,
    redirects: [],
    systemTemplateKey: null,
    systemTemplateVersion: null,
  };
  const homepage = {
    ...publishedPage,
    id: 'homepage-id',
    title: 'Published homepage',
    slug: '',
    kind: PageKind.HOMEPAGE,
    blocks: [{ id: 'hero', type: 'hero', title: 'Published homepage' }],
    systemTemplateKey: 'armaturex-home',
    systemTemplateVersion: '1',
  };

  function setup(page = publishedPage) {
    const draft = {
      id: 'draft-id',
      versionNumber: 2,
      snapshot: { ...page, title: 'Draft title' },
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
      }),
    };
    const pages = {
      find: jest.fn().mockResolvedValue([{ ...page }]),
      findOne: jest.fn().mockResolvedValue({ ...page }),
      save: jest
        .fn()
        .mockImplementation((page: unknown) => Promise.resolve(page)),
    };
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft,
        approvedRevisionId: null,
        publishedRevisionId: 'baseline-id',
        reviewState: 'draft',
      }),
      importPublishedBaseline: jest.fn(),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'next-id', versionNumber: 3 }),
      publish: jest.fn(),
      getVersion: jest.fn().mockResolvedValue(draft),
    };
    const categories = { find: jest.fn().mockResolvedValue([]) };
    const articles = { find: jest.fn().mockResolvedValue([]) };
    const banners = { find: jest.fn().mockResolvedValue([]) };
    const media = { existsBy: jest.fn().mockResolvedValue(false) };
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      media as never,
      pages as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, pages, revisions, media };
  }

  it('lists draft fields without changing the public status', async () => {
    const { service } = setup();
    const [page] = await service.listPages('site-id', actor);
    expect(page).toEqual(
      expect.objectContaining({
        title: 'Draft title',
        status: PageStatus.PUBLISHED,
        draftRevisionId: 'draft-id',
      }),
    );
  });

  it('saves a published page edit only as a new revision', async () => {
    const { service, pages, revisions } = setup();
    const result = await service.updatePage('site-id', 'page-id', actor, {
      ...publishedPage,
      title: 'Next title',
      expectedDraftRevisionId: 'draft-id',
    });
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Next title',
        status: PageStatus.PUBLISHED,
        draftRevisionId: 'next-id',
      }),
    );
    expect(pages.save).not.toHaveBeenCalled();
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'page',
        entityId: 'page-id',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        snapshot: expect.objectContaining({ title: 'Next title' }),
        expectedDraftRevisionId: 'draft-id',
      }),
    );
  });

  it('rejects a stale page edit before saving a revision', async () => {
    const { service, revisions } = setup();
    await expect(
      service.updatePage('site-id', 'page-id', actor, {
        ...publishedPage,
        title: 'Stale edit',
        expectedDraftRevisionId: 'old-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('blocks the legacy direct status path for ordinary pages', async () => {
    const { service, pages } = setup();
    pages.findOne.mockResolvedValue({
      ...publishedPage,
      status: PageStatus.DRAFT,
    });
    await expect(
      service.changePageStatus('site-id', 'page-id', actor, {
        status: PageStatus.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates the first revision of an existing unpublished page without publishing it', async () => {
    const { service, pages, revisions } = setup();
    revisions.current.mockResolvedValue(null);
    pages.findOne.mockResolvedValue({
      ...publishedPage,
      status: PageStatus.DRAFT,
    });
    const result = await service.updatePage('site-id', 'page-id', actor, {
      ...publishedPage,
      status: PageStatus.DRAFT,
      title: 'First draft',
      expectedDraftRevisionId: null,
    });
    expect(result).toEqual(
      expect.objectContaining({
        title: 'First draft',
        status: PageStatus.DRAFT,
        draftRevisionId: 'next-id',
      }),
    );
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDraftRevisionId: null,
      }),
    );
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('previews an exact old revision rather than a newer current draft', async () => {
    const { service, revisions } = setup();
    revisions.getVersion.mockResolvedValue({
      id: 'old-id',
      versionNumber: 1,
      snapshot: { ...publishedPage, title: 'Old preview' },
    });
    const result = await service.getPageRevisionPreview(
      'site-id',
      'page-id',
      'old-id',
      actor,
    );
    expect(result.page).toEqual(
      expect.objectContaining({ title: 'Old preview' }),
    );
    expect(result.site.noIndex).toBe(true);
  });

  it('fails closed when exact preview cannot load the revision ledger', async () => {
    const { service } = setup();
    Object.defineProperty(service, 'revisions', { value: undefined });
    await expect(
      service.getPageRevisionPreview('site-id', 'page-id', 'old-id', actor),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('publishes the approved snapshot through the ledger transaction', async () => {
    const { service, pages, revisions } = setup();
    const manager = {
      findOne: jest.fn().mockResolvedValue({ ...publishedPage }),
      find: jest.fn().mockResolvedValue([]),
      save: jest
        .fn()
        .mockImplementation((page: unknown) => Promise.resolve(page)),
      delete: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
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
          ...publishedPage,
          title: 'Approved title',
          blocks: [{ id: 'intro', type: 'text', text: 'Approved body' }],
        }),
    );
    const result = await service.publishPageRevision(
      'site-id',
      'page-id',
      'approved-id',
      actor,
    );
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Approved title',
        status: PageStatus.PUBLISHED,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Approved title',
        status: PageStatus.PUBLISHED,
      }),
    );
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('keeps the public page unchanged when the approved snapshot is empty', async () => {
    const { service, pages, revisions } = setup();
    const manager = {
      findOne: jest.fn().mockResolvedValue({ ...publishedPage }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
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
      ) => activate(manager, { ...publishedPage, blocks: [] }),
    );
    await expect(
      service.publishPageRevision('site-id', 'page-id', 'approved-id', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('rejects a snapshot whose referenced media no longer exists', async () => {
    const { service, revisions } = setup();
    const manager = {
      findOne: jest.fn().mockResolvedValue({ ...publishedPage }),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
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
          ...publishedPage,
          blocks: [{ id: 'hero', type: 'image', mediaId: 'missing-id' }],
        }),
    );
    await expect(
      service.publishPageRevision('site-id', 'page-id', 'approved-id', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('lists homepage draft fields without changing the public homepage', async () => {
    const { service } = setup(homepage);
    const [page] = await service.listPages('site-id', actor);
    expect(page).toEqual(
      expect.objectContaining({
        id: 'homepage-id',
        title: 'Draft title',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.PUBLISHED,
        draftRevisionId: 'draft-id',
      }),
    );
  });

  it('saves homepage content only as a revision', async () => {
    const { service, pages, revisions } = setup(homepage);
    const result = await service.updatePage('site-id', 'homepage-id', actor, {
      ...homepage,
      title: 'Next homepage',
      blocks: [{ id: 'hero', type: 'hero', title: 'Next homepage' }],
      expectedDraftRevisionId: 'draft-id',
    });
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Next homepage',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.PUBLISHED,
        draftRevisionId: 'next-id',
      }),
    );
    expect(pages.save).not.toHaveBeenCalled();
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'page',
        entityId: 'homepage-id',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        snapshot: expect.objectContaining({
          title: 'Next homepage',
          kind: PageKind.HOMEPAGE,
          slug: '',
        }),
        expectedDraftRevisionId: 'draft-id',
      }),
    );
  });

  it('blocks the legacy direct status path for the homepage', async () => {
    const { service, pages } = setup(homepage);
    pages.findOne.mockResolvedValue({ ...homepage, status: PageStatus.DRAFT });
    await expect(
      service.changePageStatus('site-id', 'homepage-id', actor, {
        status: PageStatus.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('previews an exact homepage revision', async () => {
    const { service, revisions } = setup(homepage);
    revisions.getVersion.mockResolvedValue({
      id: 'old-home-id',
      versionNumber: 1,
      snapshot: { ...homepage, title: 'Old homepage preview' },
    });
    const result = await service.getPageRevisionPreview(
      'site-id',
      'homepage-id',
      'old-home-id',
      actor,
    );
    expect(result.page).toEqual(
      expect.objectContaining({
        title: 'Old homepage preview',
        kind: PageKind.HOMEPAGE,
      }),
    );
  });

  it('publishes an approved homepage snapshot without changing its identity', async () => {
    const { service, pages, revisions } = setup(homepage);
    const manager = {
      findOne: jest.fn().mockResolvedValue({ ...homepage }),
      find: jest.fn().mockResolvedValue([]),
      save: jest
        .fn()
        .mockImplementation((page: unknown) => Promise.resolve(page)),
      delete: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
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
          ...homepage,
          title: 'Approved homepage',
          blocks: [{ id: 'hero', type: 'hero', title: 'Approved homepage' }],
        }),
    );
    const result = await service.publishPageRevision(
      'site-id',
      'homepage-id',
      'approved-home-id',
      actor,
    );
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Approved homepage',
        slug: '',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.PUBLISHED,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'homepage-id',
        siteId: 'site-id',
        slug: '',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.PUBLISHED,
      }),
    );
    expect(pages.save).not.toHaveBeenCalled();
  });
});
