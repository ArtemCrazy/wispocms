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
      findOne: jest
        .fn()
        .mockResolvedValue(role ? { role, siteIds: ['site-id'] } : null),
    };
    const emptyRepository = {};
    const media = { existsBy: jest.fn().mockResolvedValue(logoExists) };
    const lifecycle = {
      assertTemplate: jest.fn().mockResolvedValue(undefined),
    };
    const revisions = {
      current: jest
        .fn()
        .mockImplementation((_siteId: string, resourceType: string) =>
          Promise.resolve({
            draft: {
              id: `${resourceType}-draft-id`,
              versionNumber: 2,
              snapshot:
                resourceType === 'site_footer'
                  ? {
                      footerDescription: 'О проекте',
                      showContacts: true,
                      showSocials: true,
                    }
                  : {
                      logoText: 'Wispo',
                      showPages: true,
                      showArticles: true,
                    },
            },
            approvedRevisionId: null,
            publishedRevisionId: `${resourceType}-published-id`,
            reviewState: 'draft',
          }),
        ),
      saveDraft: jest.fn().mockResolvedValue({
        id: 'layout-next-id',
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
      media as never,
      emptyRepository as never,
      emptyRepository as never,
      undefined,
      undefined,
      undefined,
      undefined,
      lifecycle as never,
      undefined,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, site, sites, media, lifecycle, revisions };
  }

  it('updates header settings without losing footer settings', async () => {
    const { service, site, sites } = setup(WorkspaceRole.SITE_CONTENT_MANAGER);

    await expect(
      service.updateSiteLayoutSection('site-id', 'header', actor, {
        logoText: '  Wispo Journal  ',
        showPages: false,
        ctaLabel: ' Связаться ',
        ctaUrl: '#contact',
        expectedDraftRevisionId: 'site_header-draft-id',
      }),
    ).resolves.toMatchObject({
      logoText: 'Wispo Journal',
      showPages: false,
      ctaLabel: 'Связаться',
    });
    expect(site.layoutSettings.footerDescription).toBe('О проекте');
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('uses read permission for viewing layout settings', async () => {
    const { service } = setup(WorkspaceRole.SITE_OWNER);

    await expect(
      service.getSiteLayout('site-id', actor),
    ).resolves.toMatchObject({
      siteId: 'site-id',
      showPages: true,
    });
  });

  it('allows an assigned approver to change layout settings', async () => {
    const { service, sites } = setup(WorkspaceRole.SITE_OWNER);

    await expect(
      service.updateSiteLayoutSection('site-id', 'header', actor, {
        showPages: false,
        expectedDraftRevisionId: 'site_header-draft-id',
      }),
    ).resolves.toMatchObject({ showPages: false });
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('binds a workspace media item as the shared logo', async () => {
    const { service, media } = setup(WorkspaceRole.SITE_CONTENT_MANAGER);

    await expect(
      service.updateSiteLayoutSection('site-id', 'header', actor, {
        logoMediaId: '11111111-1111-4111-8111-111111111111',
        expectedDraftRevisionId: 'site_header-draft-id',
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
    const { service } = setup(WorkspaceRole.SITE_CONTENT_MANAGER, false);

    await expect(
      service.updateSiteLayoutSection('site-id', 'header', actor, {
        logoMediaId: '11111111-1111-4111-8111-111111111111',
        expectedDraftRevisionId: 'site_header-draft-id',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates and persists selected Media header and footer templates', async () => {
    const { service, site, lifecycle } = setup(WorkspaceRole.SITE_DEVELOPER);

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

  it('does not allow a content manager to change template bindings', async () => {
    const { service, sites } = setup(WorkspaceRole.SITE_CONTENT_MANAGER);
    await expect(
      service.updateSiteLayout('site-id', actor, {
        headerTemplateKey: 'compact-header',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('does not allow an unassigned member to change layout settings', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteLayoutSection('site-id', 'header', actor, {
        showPages: false,
        expectedDraftRevisionId: 'site_header-draft-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
