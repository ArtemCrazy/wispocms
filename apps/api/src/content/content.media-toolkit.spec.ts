import { ConflictException } from '@nestjs/common';
import { PlatformRole, SiteType } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService Media site toolkit', () => {
  const actor = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup(usageCount = '0') {
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

  it('protects a variable that is still referenced by content', async () => {
    const { service, variables } = setup('2');
    await expect(
      service.deleteSiteVariable('site-id', 'variable-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(variables.remove).not.toHaveBeenCalled();
  });
});
