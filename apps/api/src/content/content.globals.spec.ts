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
      findOne: jest.fn().mockResolvedValue(role ? { role } : null),
    };
    const emptyRepository = {};
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
    );
    return { service, site, sites };
  }

  it('allows a content manager to update shared site data', async () => {
    const { service, site, sites } = setup(WorkspaceRole.CONTENT_MANAGER);

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        companyName: '  Wispo Media  ',
        phone: ' +7 999 111-22-33 ',
        email: ' INFO@WISPO.RU ',
        address: '',
      }),
    ).resolves.toMatchObject({
      companyName: 'Wispo Media',
      phone: '+7 999 111-22-33',
      email: 'info@wispo.ru',
    });
    expect(site.globalData).toEqual({
      companyName: 'Wispo Media',
      phone: '+7 999 111-22-33',
      email: 'info@wispo.ru',
      address: undefined,
      telegramUrl: undefined,
      vkUrl: undefined,
    });
    expect(sites.save).toHaveBeenCalledWith(site);
  });

  it('allows an approver to read shared site data', async () => {
    const { service } = setup(WorkspaceRole.CLIENT_APPROVER);

    await expect(service.getSiteGlobals('site-id', actor)).resolves.toEqual({
      siteId: 'site-id',
      phone: '+7 900 000-00-00',
    });
  });

  it('allows an assigned approver to edit shared site data', async () => {
    const { service, sites } = setup(WorkspaceRole.CLIENT_APPROVER);

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '+7 999 111-22-33',
      }),
    ).resolves.toMatchObject({ phone: '+7 999 111-22-33' });
    expect(sites.save).toHaveBeenCalled();
  });

  it('does not allow an unassigned member to edit shared site data', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '+7 999 111-22-33',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
