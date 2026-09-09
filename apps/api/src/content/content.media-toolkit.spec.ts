import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformRole, SiteType } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService Media site toolkit', () => {
  const actor = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup(usageCount = '0', activityRows: unknown[] = []) {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
      }),
    };
    const pages = { existsBy: jest.fn().mockResolvedValue(true) };
    const banners = { existsBy: jest.fn().mockResolvedValue(true) };
    const assignments = {
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const variables = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'variable-id',
        siteId: 'site-id',
        identifier: 'phone',
      }),
      manager: {
        query: jest.fn().mockResolvedValue([{ count: usageCount }]),
      },
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const pageActivities = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue(activityRows),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pages as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignments as never,
      variables as never,
      undefined,
      pageActivities as never,
    );
    return { service, assignments, variables, pageActivities };
  }

  it('upserts one banner per page zone and records page history', async () => {
    const { service, assignments, pageActivities } = setup();
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_top',
        bannerId: 'banner-id',
      }),
    ).resolves.toEqual([]);
    expect(assignments.upsert).toHaveBeenCalledWith(
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_top',
      },
      ['pageId', 'zone'],
    );
    expect(pageActivities.save).toHaveBeenCalled();
  });

  it('protects variables used in SEO, structured data, or template config by scanning complete rows', async () => {
    const { service, variables } = setup('2');
    await expect(
      service.deleteSiteVariable('site-id', 'variable-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(variables.remove).not.toHaveBeenCalled();
    const calls = variables.manager.query.mock.calls as Array<
      [string, unknown[]]
    >;
    const [sql, parameters] = calls[0];
    expect(sql).toContain('to_jsonb(entry)::text');
    expect(sql).toContain('"site_content_templates"');
    expect(sql).toContain('"article_section_settings"');
    expect(sql).toContain('FROM "pages" entry');
    expect(parameters).toEqual(['site-id', '%{{phone}}%']);
  });

  it('escapes wildcard characters in variable usage lookup', async () => {
    const { service, variables } = setup('1');
    variables.findOneBy.mockResolvedValue({
      id: 'variable-id',
      siteId: 'site-id',
      identifier: 'support_phone',
    });
    await expect(
      service.deleteSiteVariable('site-id', 'variable-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    const calls = variables.manager.query.mock.calls as Array<
      [string, unknown[]]
    >;
    expect(calls[0][1]).toEqual(['site-id', '%{{support\\_phone}}%']);
  });

  it('returns page history without sensitive user fields', async () => {
    const activity = {
      id: 'activity-id',
      action: 'seo_updated',
      description: 'SEO updated',
      changes: { seoTitle: 'New' },
      createdAt: new Date('2026-09-09T12:00:00Z'),
      user: {
        id: 'user-id',
        fullName: 'Editor',
        email: 'secret@example.ru',
        passwordHash: 'never-expose',
        platformRole: 'wispo_admin',
        isActive: true,
      },
    };
    const { service } = setup('0', [activity]);
    const result = await service.listPageActivity('site-id', 'page-id', actor);
    expect(result).toEqual([
      {
        id: activity.id,
        action: activity.action,
        description: activity.description,
        changes: activity.changes,
        createdAt: activity.createdAt,
        user: { id: 'user-id', fullName: 'Editor' },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /passwordHash|platformRole|email/,
    );
  });

  it('does not publish an unassigned universal banner image', async () => {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        slug: 'media',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
        seoImageMediaId: null,
      }),
    };
    const banners = { exists: jest.fn() };
    const assignments = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'media-id',
          workspaceId: 'workspace-id',
          storageNamespace: 'files',
          storedName: 'banner.webp',
          mimeType: 'image/webp',
        }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignments as never,
    );

    await expect(
      service.getPublicMedia('media', 'media-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assignments.find).toHaveBeenCalled();
    expect(banners.exists).not.toHaveBeenCalled();
  });
});
