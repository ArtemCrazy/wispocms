import { PlatformRole, SiteRole } from '../database/entities';
import { AuthService } from './auth.service';

describe('AuthService site access session', () => {
  const workspace = { id: 'workspace-id', name: 'Client', slug: 'client' };
  const sites = [
    {
      id: 'site-a',
      workspaceId: workspace.id,
      name: 'First',
      slug: 'first',
      siteType: 'corporate',
    },
    {
      id: 'site-b',
      workspaceId: workspace.id,
      name: 'Second',
      slug: 'second',
      siteType: 'media',
    },
  ];

  function setup(
    platformRole: PlatformRole,
    ownAccesses: Record<string, unknown>[],
  ) {
    const users = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-id',
        email: 'user@example.test',
        fullName: 'User',
        platformRole,
        isActive: true,
      }),
    };
    const workspaces = {
      find: jest.fn().mockResolvedValue([workspace]),
    };
    const siteRepository = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(sites),
      })),
    };
    const siteAccesses = {
      find: jest
        .fn()
        .mockResolvedValueOnce(ownAccesses)
        .mockResolvedValue(
          ownAccesses.map((access) => ({
            ...access,
            user: {
              id: 'user-id',
              email: 'user@example.test',
              fullName: 'User',
              isActive: true,
            },
          })),
        ),
    };
    return {
      service: new AuthService(
        users as never,
        workspaces as never,
        siteRepository as never,
        siteAccesses as never,
        {} as never,
      ),
      workspaces,
      siteRepository,
    };
  }

  it('puts the owner role and approval policy on the assigned site', async () => {
    const { service } = setup(PlatformRole.EMPLOYEE, [
      {
        siteId: 'site-a',
        role: SiteRole.OWNER,
        requiresApproval: false,
        site: { ...sites[0], workspace },
      },
    ]);

    const session = await service.getSession('user-id');
    expect(session.workspaces).toHaveLength(1);
    expect(session.workspaces[0].sites).toEqual([
      expect.objectContaining({
        id: 'site-a',
        access: {
          role: SiteRole.OWNER,
          requiresApproval: false,
        },
      }),
    ]);
    expect(session.workspaces[0]).not.toHaveProperty('role');
    expect(session.workspaces[0].canUseContentCenter).toBe(false);
  });

  it('keeps different approval policies on two sites in one workspace', async () => {
    const { service } = setup(PlatformRole.EMPLOYEE, [
      {
        siteId: 'site-a',
        role: SiteRole.CONTENT_MANAGER,
        requiresApproval: true,
        site: { ...sites[0], workspace },
      },
      {
        siteId: 'site-b',
        role: SiteRole.CONTENT_MANAGER,
        requiresApproval: false,
        site: { ...sites[1], workspace },
      },
    ]);

    const session = await service.getSession('user-id');
    expect(
      session.workspaces[0].sites.map((site) => [site.id, site.access]),
    ).toEqual([
      [
        'site-a',
        {
          role: SiteRole.CONTENT_MANAGER,
          requiresApproval: true,
        },
      ],
      [
        'site-b',
        {
          role: SiteRole.CONTENT_MANAGER,
          requiresApproval: false,
        },
      ],
    ]);
    expect(session.workspaces[0].canUseContentCenter).toBe(true);
  });

  it('returns no workspaces to an employee without site assignments', async () => {
    const { service, workspaces, siteRepository } = setup(
      PlatformRole.EMPLOYEE,
      [],
    );
    await expect(service.getSession('user-id')).resolves.toMatchObject({
      workspaces: [],
    });
    expect(workspaces.find).not.toHaveBeenCalled();
    expect(siteRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns every workspace and site to the Wispo administrator', async () => {
    const { service } = setup(PlatformRole.WISPO_ADMIN, []);
    const session = await service.getSession('user-id');
    expect(session.workspaces[0].sites).toHaveLength(2);
    expect(session.workspaces[0].sites[0].access).toBeNull();
    expect(session.workspaces[0].canUseContentCenter).toBe(true);
  });
});
