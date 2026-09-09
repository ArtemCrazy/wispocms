import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformRole, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site layout', () => {
  const actor = { userId: 'member-id', platformRole: PlatformRole.MEMBER };

  function setup(role: WorkspaceRole | null, logoExists = true) {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      layoutSettings: { showPages: true, footerDescription: 'О проекте' },
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue(role ? { role } : null),
    };
    const emptyRepository = {};
    const media = { existsBy: jest.fn().mockResolvedValue(logoExists) };
    const service = new ContentService(
      sites as never,
      memberships as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      media as never,
      emptyRepository as never,
      emptyRepository as never,
    );
    return { service, site, sites, media };
  }

  it('updates header settings without losing footer settings', async () => {
    const { service, site, sites } = setup(WorkspaceRole.CONTENT_MANAGER);

    await expect(
      service.updateSiteLayout('site-id', actor, {
        logoText: '  Wispo Journal  ',
        showPages: false,
        ctaLabel: ' Связаться ',
        ctaUrl: '#contact',
      }),
    ).resolves.toMatchObject({
      logoText: 'Wispo Journal',
      showPages: false,
      ctaLabel: 'Связаться',
      footerDescription: 'О проекте',
    });
    expect(site.layoutSettings.footerDescription).toBe('О проекте');
    expect(sites.save).toHaveBeenCalledWith(site);
  });

  it('uses read permission for viewing layout settings', async () => {
    const { service } = setup(WorkspaceRole.CLIENT_APPROVER);

    await expect(
      service.getSiteLayout('site-id', actor),
    ).resolves.toMatchObject({
      siteId: 'site-id',
      showPages: true,
    });
  });

  it('allows an assigned approver to change layout settings', async () => {
    const { service, sites } = setup(WorkspaceRole.CLIENT_APPROVER);

    await expect(
      service.updateSiteLayout('site-id', actor, { showPages: false }),
    ).resolves.toMatchObject({ showPages: false });
    expect(sites.save).toHaveBeenCalled();
  });

  it('binds a workspace media item as the shared logo', async () => {
    const { service, media } = setup(WorkspaceRole.CONTENT_MANAGER);

    await expect(
      service.updateSiteLayout('site-id', actor, {
        logoMediaId: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toMatchObject({
      logoMediaId: '11111111-1111-4111-8111-111111111111',
    });
    expect(media.existsBy).toHaveBeenCalledWith({
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: 'workspace-id',
    });
  });

  it('rejects a logo outside the workspace media library', async () => {
    const { service } = setup(WorkspaceRole.CONTENT_MANAGER, false);

    await expect(
      service.updateSiteLayout('site-id', actor, {
        logoMediaId: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not allow an unassigned member to change layout settings', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteLayout('site-id', actor, { showPages: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
