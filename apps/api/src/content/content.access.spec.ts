import { ForbiddenException } from '@nestjs/common';
import { PlatformRole, SiteType, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService site boundary', () => {
  const articles = { find: jest.fn().mockResolvedValue([]) };
  const sites = {
    findOne: jest.fn().mockResolvedValue({
      id: 'site-id',
      workspaceId: 'workspace-id',
      siteType: SiteType.MEDIA,
    }),
  };
  const memberships = { findOne: jest.fn() };
  const service = new ContentService(
    sites as never,
    memberships as never,
    {} as never,
    {} as never,
    articles as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('allows reading a site explicitly assigned to a content manager', async () => {
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_CONTENT_MANAGER,
      siteIds: ['site-id'],
    });
    await expect(
      service.listArticles('site-id', {
        userId: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).resolves.toEqual([]);
  });

  it('denies a different site in the same workspace', async () => {
    sites.findOne.mockResolvedValueOnce({
      id: 'other-site-id',
      workspaceId: 'workspace-id',
      siteType: SiteType.MEDIA,
    });
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_CONTENT_MANAGER,
      siteIds: ['site-id'],
    });
    await expect(
      service.listArticles('other-site-id', {
        userId: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 403 outside employee assignments', async () => {
    memberships.findOne.mockResolvedValue(null);
    await expect(
      service.listArticles('site-id', {
        userId: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat legacy agency_member as a global bypass', async () => {
    memberships.findOne.mockResolvedValue(null);
    await expect(
      service.listArticles('site-id', {
        userId: 'legacy-id',
        platformRole: PlatformRole.AGENCY_MEMBER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
