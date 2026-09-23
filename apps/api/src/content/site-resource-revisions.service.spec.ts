import { ConflictException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { SitePermission } from './content.permissions';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';

describe('SiteResourceRevisionsService', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup(current: Record<string, unknown> | null = null) {
    const revisions = {
      current: jest.fn().mockResolvedValue(current),
      getVersion: jest.fn().mockResolvedValue({
        id: 'version-id',
        versionNumber: 3,
        snapshot: { seoTitle: 'Exact version' },
      }),
      importPublishedBaseline: jest
        .fn()
        .mockResolvedValue({ id: 'baseline-id', versionNumber: 1 }),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'draft-next', versionNumber: 2 }),
      publish: jest
        .fn()
        .mockImplementation(
          async (
            _siteId: string,
            _resourceType: string,
            _entityId: string,
            _revisionId: string,
            _actor: unknown,
            activate: (
              manager: unknown,
              snapshot: Record<string, unknown>,
            ) => Promise<void>,
          ) => activate({ transaction: true }, { seoTitle: 'Published next' }),
        ),
      assertSitePermission: jest.fn().mockResolvedValue(undefined),
    };
    const adapters = {
      publishedSnapshot: jest
        .fn()
        .mockResolvedValue({ seoTitle: 'Published now' }),
      normalizeSnapshot: jest
        .fn()
        .mockImplementation(
          (
            _siteId: string,
            _type: string,
            snapshot: Record<string, unknown>,
          ) => ({
            ...snapshot,
            seoTitle:
              typeof snapshot.seoTitle === 'string'
                ? snapshot.seoTitle.trim()
                : '',
          }),
        ),
      activate: jest.fn().mockResolvedValue(undefined),
    };
    return {
      revisions,
      adapters,
      service: new SiteResourceRevisionsService(revisions as never, adapters),
    };
  }

  it('shows a staged snapshot while preserving the separately loaded public snapshot', async () => {
    const { service, adapters } = setup({
      draft: {
        id: 'draft-id',
        versionNumber: 2,
        snapshot: { seoTitle: 'Draft title' },
      },
      approvedRevisionId: null,
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });

    await expect(
      service.get('site-id', 'site_seo', actor),
    ).resolves.toMatchObject({
      seoTitle: 'Draft title',
      draftRevisionId: 'draft-id',
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });
    expect(adapters.publishedSnapshot).not.toHaveBeenCalled();
  });

  it('imports the live value once and saves only a new immutable draft', async () => {
    const { service, revisions } = setup();

    await expect(
      service.save('site-id', 'site_seo', actor, {
        snapshot: { seoTitle: '  New title  ' },
        expectedDraftRevisionId: null,
      }),
    ).resolves.toMatchObject({
      seoTitle: 'New title',
      draftRevisionId: 'draft-next',
      publishedRevisionId: 'baseline-id',
    });
    expect(revisions.importPublishedBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-id',
        resourceType: 'site_seo',
        entityId: 'site-id',
        snapshot: { seoTitle: 'Published now' },
      }),
    );
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDraftRevisionId: 'baseline-id',
        snapshot: { seoTitle: 'New title' },
      }),
    );
  });

  it('rejects a stale editor before creating another draft', async () => {
    const { service, revisions } = setup({
      draft: { id: 'draft-current', versionNumber: 2, snapshot: {} },
      approvedRevisionId: null,
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });

    await expect(
      service.save('site-id', 'site_search', actor, {
        snapshot: {},
        expectedDraftRevisionId: 'stale-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('requires code-edit permission when the 404 template changes', async () => {
    const { service, revisions } = setup({
      draft: {
        id: 'draft-current',
        versionNumber: 2,
        snapshot: {
          templateKey: 'signal',
          templateVersion: '1',
          seoTitle: '404',
        },
      },
      approvedRevisionId: null,
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });

    await service.save('site-id', 'site_not_found', actor, {
      snapshot: {
        templateKey: 'editorial',
        templateVersion: '1',
        seoTitle: '404',
      },
      expectedDraftRevisionId: 'draft-current',
    });

    expect(revisions.assertSitePermission).toHaveBeenCalledWith(
      'site-id',
      actor,
      SitePermission.EDIT_CODE,
    );
  });

  it('imports the public privacy baseline before a legacy draft command mutates state', async () => {
    const { service, revisions, adapters } = setup();

    await expect(
      service.prepareMutation('site-id', 'site_privacy', actor, null),
    ).resolves.toBe('baseline-id');
    expect(adapters.publishedSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      revisions.importPublishedBaseline.mock.invocationCallOrder[0],
    );
  });

  it('publishes the approved snapshot through the matching adapter in one transaction', async () => {
    const { service, revisions, adapters } = setup();

    await service.publish('site-id', 'site_seo', 'approved-id', actor);

    expect(revisions.publish).toHaveBeenCalledWith(
      'site-id',
      'site_seo',
      'site-id',
      'approved-id',
      actor,
      expect.any(Function),
    );
    expect(adapters.activate).toHaveBeenCalledWith(
      { transaction: true },
      'site-id',
      'site_seo',
      { seoTitle: 'Published next' },
    );
  });

  it('returns an exact immutable version for preview', async () => {
    const { service } = setup();

    await expect(
      service.preview('site-id', 'site_seo', 'version-id', actor),
    ).resolves.toEqual({
      id: 'version-id',
      versionNumber: 3,
      snapshot: { seoTitle: 'Exact version' },
    });
  });
});
