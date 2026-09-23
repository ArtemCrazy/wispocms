import { ConflictException } from '@nestjs/common';
import { PageBannerAssignmentEntity, PageEntity } from '../database/entities';
import {
  PageKind,
  PageStatus,
  PlatformRole,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('page banner assignment revisions', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };
  const page = {
    id: 'page-id',
    siteId: 'site-id',
    title: 'Homepage',
    slug: '',
    kind: PageKind.HOMEPAGE,
    status: PageStatus.PUBLISHED,
    blocks: [{ id: 'hero', type: 'hero', title: 'Homepage' }],
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    noIndex: false,
    ogTitle: null,
    ogDescription: null,
    ogImageMediaId: null,
    structuredData: null,
    redirects: [],
    systemTemplateKey: 'skinova-home',
    systemTemplateVersion: '1',
  };
  const oldBanner = {
    id: 'old-banner-id',
    siteId: 'site-id',
    name: 'Old banner',
    placement: null,
    mediaId: null,
    mobileMediaId: null,
    title: 'Old offer',
    subtitle: null,
    buttonText: null,
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
  };
  const newBanner = {
    ...oldBanner,
    id: 'new-banner-id',
    name: 'New banner',
    title: 'New offer',
  };

  function setup() {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
        name: 'Skinova',
        slug: 'skinova',
        domain: null,
        globalData: {},
        layoutSettings: {},
      }),
    };
    const pages = {
      existsBy: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ ...page }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const banners = {
      find: jest.fn().mockResolvedValue([newBanner]),
      findOne: jest.fn().mockResolvedValue(newBanner),
    };
    const assignments = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'public-assignment-id',
          siteId: 'site-id',
          pageId: 'page-id',
          zone: 'homepage_top',
          bannerId: oldBanner.id,
          banner: oldBanner,
        },
      ]),
      upsert: jest.fn(),
      delete: jest.fn(),
    };
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft: {
          id: 'draft-id',
          versionNumber: 2,
          snapshot: {
            ...page,
            bannerAssignments: [
              { zone: 'homepage_top', bannerId: oldBanner.id },
            ],
          },
        },
        approvedRevisionId: null,
        publishedRevisionId: 'baseline-id',
        reviewState: 'draft',
      }),
      importPublishedBaseline: jest.fn(),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'next-draft-id', versionNumber: 3 }),
      getVersion: jest.fn().mockResolvedValue({
        id: 'exact-id',
        versionNumber: 3,
        snapshot: {
          ...page,
          bannerAssignments: [{ zone: 'homepage_top', bannerId: newBanner.id }],
        },
      }),
      publish: jest.fn(),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { existsBy: jest.fn().mockResolvedValue(false) } as never,
      pages as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignments as never,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, pages, banners, assignments, revisions };
  }

  it('stages an assignment in the page draft without changing public assignments', async () => {
    const { service, assignments, revisions } = setup();

    await service.assignPageBanner('site-id', 'page-id', actor, {
      zone: 'homepage_top',
      bannerId: newBanner.id,
      expectedDraftRevisionId: 'draft-id',
    });

    expect(assignments.upsert).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      bannerAssignments: [{ zone: 'homepage_top', bannerId: newBanner.id }],
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-id',
        resourceType: 'page',
        entityId: 'page-id',
        expectedDraftRevisionId: 'draft-id',
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('keeps staged banner assignments when page content creates the next draft', async () => {
    const { service, revisions } = setup();

    await service.updatePage('site-id', 'page-id', actor, {
      ...page,
      title: 'Updated homepage',
      expectedDraftRevisionId: 'draft-id',
    });

    const snapshotMatcher: unknown = expect.objectContaining({
      title: 'Updated homepage',
      bannerAssignments: [{ zone: 'homepage_top', bannerId: oldBanner.id }],
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('rejects an assignment saved from a stale page draft', async () => {
    const { service, assignments, revisions } = setup();

    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_top',
        bannerId: newBanner.id,
        expectedDraftRevisionId: 'older-draft-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(revisions.saveDraft).not.toHaveBeenCalled();
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('stages removing an assignment without deleting the public row', async () => {
    const { service, assignments, revisions } = setup();

    await service.unassignPageBanner(
      'site-id',
      'page-id',
      'homepage_top',
      actor,
      { expectedDraftRevisionId: 'draft-id' },
    );

    expect(assignments.delete).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      bannerAssignments: [],
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('uses the exact revision assignments in page preview', async () => {
    const { service } = setup();

    const result = await service.getPageRevisionPreview(
      'site-id',
      'page-id',
      'exact-id',
      actor,
    );

    expect(result.banners).toEqual([
      expect.objectContaining({
        id: newBanner.id,
        placement: 'homepage_top',
      }),
    ]);
  });

  it('publishes the exact assignment set in the page transaction', async () => {
    const { service, revisions } = setup();
    const manager = {
      findOne: jest
        .fn()
        .mockImplementation((entity: unknown) =>
          Promise.resolve(entity === PageEntity ? { ...page } : newBanner),
        ),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
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
          ...page,
          bannerAssignments: [{ zone: 'homepage_top', bannerId: newBanner.id }],
        }),
    );

    await service.publishPageRevision(
      'site-id',
      'page-id',
      'approved-id',
      actor,
    );

    expect(manager.delete).toHaveBeenCalledWith(PageBannerAssignmentEntity, {
      siteId: 'site-id',
      pageId: 'page-id',
    });
    expect(manager.upsert).toHaveBeenCalledWith(
      PageBannerAssignmentEntity,
      [
        {
          siteId: 'site-id',
          pageId: 'page-id',
          zone: 'homepage_top',
          bannerId: newBanner.id,
        },
      ],
      ['pageId', 'zone'],
    );
  });
});
