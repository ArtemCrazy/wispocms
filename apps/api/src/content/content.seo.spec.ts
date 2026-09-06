import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlatformRole, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site SEO', () => {
  const actor = { userId: 'member-id', platformRole: PlatformRole.MEMBER };

  function setup(role: WorkspaceRole | null, mediaExists = true) {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      seoImageMediaId: null,
      noIndex: false,
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue(role ? { role } : null),
    };
    const media = { existsBy: jest.fn().mockResolvedValue(mediaExists) };
    const emptyRepository = {};
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
    return { service, site, sites };
  }

  it('normalizes and saves site SEO settings', async () => {
    const { service, site, sites } = setup(WorkspaceRole.CONTENT_MANAGER);

    await expect(
      service.updateSiteSeo('site-id', actor, {
        seoTitle: '  Wispo Journal  ',
        seoDescription: ' Описание ',
        canonicalUrl: 'https://example.ru/',
        seoImageMediaId: '7f4b98a0-d38a-4a4f-a275-4c84156b7d1a',
        noIndex: true,
      }),
    ).resolves.toMatchObject({
      seoTitle: 'Wispo Journal',
      canonicalUrl: 'https://example.ru',
      noIndex: true,
    });
    expect(site.seoDescription).toBe('Описание');
    expect(sites.save).toHaveBeenCalledWith(site);
  });

  it('rejects an image from outside the site media library', async () => {
    const { service } = setup(WorkspaceRole.CONTENT_MANAGER, false);

    await expect(
      service.updateSiteSeo('site-id', actor, {
        seoImageMediaId: '7f4b98a0-d38a-4a4f-a275-4c84156b7d1a',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows an approver to read SEO settings', async () => {
    const { service } = setup(WorkspaceRole.CLIENT_APPROVER);
    await expect(service.getSiteSeo('site-id', actor)).resolves.toMatchObject({
      siteId: 'site-id',
      noIndex: false,
    });
  });

  it('allows an assigned approver to edit SEO settings', async () => {
    const { service, sites } = setup(WorkspaceRole.CLIENT_APPROVER);
    await expect(
      service.updateSiteSeo('site-id', actor, { noIndex: true }),
    ).resolves.toMatchObject({ noIndex: true });
    expect(sites.save).toHaveBeenCalled();
  });

  it('does not allow an unassigned member to edit SEO settings', async () => {
    const { service } = setup(null);
    await expect(
      service.updateSiteSeo('site-id', actor, { noIndex: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
