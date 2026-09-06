import { ForbiddenException } from '@nestjs/common';
import { PlatformRole, SiteType, WorkspaceRole } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService workspace boundary', () => {
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

  it('allows full content access inside an assigned workspace', async () => {
    memberships.findOne.mockResolvedValue({ role: WorkspaceRole.EMPLOYEE });
    await expect(
      service.listArticles('site-id', {
        userId: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).resolves.toEqual([]);
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
