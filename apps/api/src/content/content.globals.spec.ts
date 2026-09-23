import { ForbiddenException } from '@nestjs/common';
import { PlatformRole, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site globals', () => {
  const actor = { userId: 'member-id', platformRole: PlatformRole.MEMBER };

  function setup(role: WorkspaceRole | null) {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      globalData: { phone: '+7 900 000-00-00' },
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const memberships = {
      findOne: jest
        .fn()
        .mockResolvedValue(role ? { role, siteIds: ['site-id'] } : null),
    };
    const emptyRepository = {};
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft: {
          id: 'globals-draft-id',
          versionNumber: 2,
          snapshot: { phone: '+7 900 000-00-00' },
        },
        approvedRevisionId: null,
        publishedRevisionId: 'globals-published-id',
        reviewState: 'draft',
      }),
      saveDraft: jest.fn().mockResolvedValue({
        id: 'globals-next-id',
        versionNumber: 3,
      }),
      importPublishedBaseline: jest.fn(),
    };
    const service = new ContentService(
      sites as never,
      memberships as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
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
    return { service, site, sites, revisions };
  }

  it('allows a content manager to update shared site data', async () => {
    const { service, site, sites } = setup(WorkspaceRole.SITE_CONTENT_MANAGER);

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        companyName: '  Wispo Media  ',
        phone: ' +7 999 111-22-33 ',
        email: ' INFO@WISPO.RU ',
        address: '',
        expectedDraftRevisionId: 'globals-draft-id',
      }),
    ).resolves.toMatchObject({
      companyName: 'Wispo Media',
      phone: '+7 999 111-22-33',
      email: 'info@wispo.ru',
    });
    expect(site.globalData).toEqual({ phone: '+7 900 000-00-00' });
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('allows the site owner to read shared site data', async () => {
    const { service } = setup(WorkspaceRole.SITE_OWNER);

    await expect(service.getSiteGlobals('site-id', actor)).resolves.toEqual(
      expect.objectContaining({
        siteId: 'site-id',
        phone: '+7 900 000-00-00',
        draftRevisionId: 'globals-draft-id',
      }),
    );
  });

  it('allows the site owner to edit shared site data', async () => {
    const { service, sites } = setup(WorkspaceRole.SITE_OWNER);

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '+7 999 111-22-33',
        expectedDraftRevisionId: 'globals-draft-id',
      }),
    ).resolves.toMatchObject({ phone: '+7 999 111-22-33' });
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('does not allow an unassigned member to edit shared site data', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '+7 999 111-22-33',
        expectedDraftRevisionId: 'globals-draft-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
