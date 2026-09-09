import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ContentTemplateKind,
  PlatformRole,
  SiteType,
  WorkspaceRole,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site layout', () => {
  const actor = { userId: 'member-id', platformRole: PlatformRole.MEMBER };

  function setup(role: WorkspaceRole | null, logoExists = true) {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      siteType: SiteType.MEDIA,
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
    const lifecycle = {
      assertTemplate: jest.fn().mockResolvedValue(undefined),
    };
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
      undefined,
      undefined,
      undefined,
      undefined,
      lifecycle as never,
    );
    return { service, site, sites, media, lifecycle };
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

  it('validates and persists selected Media header and footer templates', async () => {
    const { service, site, lifecycle } = setup(WorkspaceRole.CONTENT_MANAGER);

    await expect(
      service.updateSiteLayout('site-id', actor, {
        headerTemplateKey: 'compact-header',
        headerTemplateVersion: '2',
        headerTemplateConfig: { sticky: true },
        footerTemplateKey: 'legal-footer',
        footerTemplateVersion: '3',
        footerTemplateConfig: { columns: 4 },
      }),
    ).resolves.toMatchObject({
      headerTemplateKey: 'compact-header',
      headerTemplateVersion: '2',
      headerTemplateConfig: { sticky: true },
      footerTemplateKey: 'legal-footer',
      footerTemplateVersion: '3',
      footerTemplateConfig: { columns: 4 },
    });
    expect(lifecycle.assertTemplate).toHaveBeenNthCalledWith(
      1,
      'site-id',
      ContentTemplateKind.HEADER,
      'compact-header',
      '2',
    );
    expect(lifecycle.assertTemplate).toHaveBeenNthCalledWith(
      2,
      'site-id',
      ContentTemplateKind.FOOTER,
      'legal-footer',
      '3',
    );
    expect(site.layoutSettings).toMatchObject({
      headerTemplateKey: 'compact-header',
      footerTemplateKey: 'legal-footer',
    });
  });

  it('does not allow an unassigned member to change layout settings', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteLayout('site-id', actor, { showPages: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
