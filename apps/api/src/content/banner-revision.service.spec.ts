import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  BannerEntity,
  PlatformRole,
  SiteType,
  WorkspaceRole,
} from '../database/entities';
import { ContentService } from './content.service';

describe('banner revision adapter', () => {
  const admin = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const publishedBanner = Object.assign(new BannerEntity(), {
    id: 'banner-id',
    siteId: 'site-id',
    name: 'Published banner',
    placement: null,
    title: 'Published title',
    subtitle: null,
    buttonText: null,
    linkUrl: null,
    mediaId: null,
    mobileMediaId: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });

  function setup(banner = publishedBanner) {
    const draft = {
      id: 'draft-id',
      versionNumber: 2,
      snapshot: {
        name: 'Draft banner',
        placement: null,
        title: 'Draft title',
        subtitle: 'Draft subtitle',
        buttonText: 'Open',
        linkUrl: '/articles/example',
        mediaId: null,
        mobileMediaId: null,
        sortOrder: 10,
        isActive: true,
      },
    };
    const manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const banners = {
      find: jest.fn().mockResolvedValue([{ ...banner }]),
      findOne: jest.fn().mockResolvedValue({ ...banner }),
      create: jest.fn((value: object) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      remove: jest.fn().mockResolvedValue(undefined),
      manager: {
        transaction: jest.fn((work: (db: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      },
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
      saveDraftUsingManager: jest
        .fn()
        .mockResolvedValue({ id: 'created-draft-id', versionNumber: 1 }),
      publish: jest.fn(),
      getVersion: jest.fn().mockResolvedValue(draft),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue({
        role: WorkspaceRole.SITE_CONTENT_MANAGER,
        siteIds: ['site-id'],
      }),
    };
    const service = new ContentService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'site-id',
          workspaceId: 'workspace-id',
          name: 'Media',
          slug: 'media',
          siteType: SiteType.MEDIA,
        }),
      } as never,
      memberships as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        existsBy: jest.fn().mockResolvedValue(false),
        find: jest.fn().mockResolvedValue([]),
      } as never,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, banners, manager, revisions, memberships };
  }

  it('lists draft banner fields without changing the public row', async () => {
    const { service, banners } = setup();
    const [banner] = await service.listBanners('site-id', admin);
    expect(banner).toEqual(
      expect.objectContaining({
        name: 'Draft banner',
        title: 'Draft title',
        draftRevisionId: 'draft-id',
      }),
    );
    expect(banners.save).not.toHaveBeenCalled();
  });

  it('creates a banner and its first draft revision atomically', async () => {
    const { service, manager, revisions } = setup();
    manager.save.mockImplementation((value: BannerEntity) =>
      Promise.resolve(Object.assign(value, { id: 'created-banner-id' })),
    );
    const result = await service.createBanner('site-id', admin, {
      name: 'New banner',
      title: 'New title',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'created-banner-id',
        draftRevisionId: 'created-draft-id',
      }),
    );
    expect(revisions.saveDraftUsingManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        resourceType: 'banner',
        entityId: 'created-banner-id',
        expectedDraftRevisionId: null,
      }),
    );
  });

  it('saves an edit only as a new revision', async () => {
    const { service, banners, revisions } = setup();
    const result = await service.updateBanner('site-id', 'banner-id', admin, {
      title: 'Next title',
      expectedDraftRevisionId: 'draft-id',
    });
    expect(result).toEqual(
      expect.objectContaining({
        title: 'Next title',
        draftRevisionId: 'next-id',
      }),
    );
    expect(banners.save).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      name: 'Draft banner',
      title: 'Next title',
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'banner',
        entityId: 'banner-id',
        snapshot: snapshotMatcher,
        expectedDraftRevisionId: 'draft-id',
      }),
    );
  });

  it('rejects a stale edit before saving a revision', async () => {
    const { service, revisions } = setup();
    await expect(
      service.updateBanner('site-id', 'banner-id', admin, {
        title: 'Stale title',
        expectedDraftRevisionId: 'old-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('previews one exact banner revision', async () => {
    const { service, revisions } = setup();
    revisions.getVersion.mockResolvedValue({
      id: 'old-id',
      versionNumber: 1,
      snapshot: {
        id: 'foreign-banner-id',
        siteId: 'foreign-site-id',
        name: 'Old banner',
        placement: null,
        title: 'Old title',
        subtitle: null,
        buttonText: null,
        linkUrl: null,
        mediaId: null,
        mobileMediaId: null,
        sortOrder: 0,
        isActive: true,
      },
    });
    await expect(
      service.getBannerRevisionPreview('site-id', 'banner-id', 'old-id', admin),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'banner-id',
        siteId: 'site-id',
        name: 'Old banner',
        revisionId: 'old-id',
        versionNumber: 1,
      }),
    );
  });

  it('publishes the exact approved snapshot', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne.mockResolvedValue({ ...publishedBanner });
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
          name: 'Approved banner',
          placement: null,
          title: 'Approved title',
          subtitle: null,
          buttonText: null,
          linkUrl: null,
          mediaId: null,
          mobileMediaId: null,
          sortOrder: 0,
          isActive: true,
        }),
    );
    await expect(
      service.publishBannerRevision(
        'site-id',
        'banner-id',
        'approved-id',
        admin,
      ),
    ).resolves.toEqual(expect.objectContaining({ name: 'Approved banner' }));
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'banner-id',
        siteId: 'site-id',
        name: 'Approved banner',
      }),
    );
  });

  it('keeps the public banner unchanged when a snapshot is invalid', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne.mockResolvedValue({ ...publishedBanner });
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
      ) => activate(manager, { name: '', isActive: true }),
    );
    await expect(
      service.publishBannerRevision(
        'site-id',
        'banner-id',
        'approved-id',
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('allows only an approver to delete an unused banner', async () => {
    const { service, memberships, banners } = setup();
    await expect(
      service.deleteBanner('site-id', 'banner-id', {
        userId: 'manager-id',
        platformRole: PlatformRole.MEMBER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(banners.remove).not.toHaveBeenCalled();

    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: ['site-id'],
    });
    await expect(
      service.deleteBanner('site-id', 'banner-id', {
        userId: 'owner-id',
        platformRole: PlatformRole.MEMBER,
      }),
    ).resolves.toEqual({ id: 'banner-id' });
  });
});
