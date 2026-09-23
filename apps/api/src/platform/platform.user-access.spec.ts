import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { WorkspaceRole } from '../database/entities';
import { PlatformService } from './platform.service';

describe('PlatformService site-scoped user creation', () => {
  const siteA = '77bbc150-03f9-4ae4-9713-a7c8de79897d';
  const siteB = 'c9772fe5-9a26-4280-aefe-ac9d888d033d';

  function setup() {
    const savedUsers: Record<string, unknown>[] = [];
    const savedMemberships: Record<string, unknown>[] = [];
    const users = {
      existsBy: jest.fn().mockResolvedValue(false),
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn((row: Record<string, unknown>) => {
        const user = { id: 'new-user-id', ...row };
        savedUsers.push(user);
        return Promise.resolve(user);
      }),
    };
    const memberships = {
      findOne: jest.fn(),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn((rows: Record<string, unknown>[]) => {
        savedMemberships.push(...rows);
        return Promise.resolve(rows);
      }),
    };
    const sites = {
      find: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { id: { value: string[] } } }) =>
            Promise.resolve(
              [
                { id: siteA, workspaceId: 'workspace-a' },
                { id: siteB, workspaceId: 'workspace-b' },
              ].filter((site) => where.id.value.includes(site.id)),
            ),
        ),
    };
    const service = new PlatformService(
      users as never,
      {} as never,
      sites as never,
      {} as never,
      memberships as never,
    );
    return { service, savedUsers, savedMemberships, memberships };
  }

  it('assigns one Wispo manager account to sites in two workspaces', async () => {
    const { service, savedUsers, savedMemberships } = setup();
    await service.createUser({
      fullName: 'Иван Петров',
      email: 'IVAN@example.test',
      password: 'long-password',
      role: WorkspaceRole.WISPO_MANAGER,
      siteIds: [siteA, siteB],
    });

    expect(savedUsers[0]).toMatchObject({
      email: 'ivan@example.test',
      accountKind: 'wispo',
    });
    expect(savedMemberships).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-a',
        role: WorkspaceRole.WISPO_MANAGER,
        siteIds: [siteA],
      }),
      expect.objectContaining({
        workspaceId: 'workspace-b',
        role: WorkspaceRole.WISPO_MANAGER,
        siteIds: [siteB],
      }),
    ]);
  });

  it('rejects a site-local account spanning more than one site', async () => {
    const { service, savedUsers } = setup();
    await expect(
      service.createUser({
        fullName: 'Сотрудник сайта',
        email: 'local@example.test',
        password: 'long-password',
        role: WorkspaceRole.SITE_CONTENT_MANAGER,
        siteIds: [siteA, siteB],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedUsers).toHaveLength(0);
  });

  it('lets an owner create a content manager only on the owned site', async () => {
    const { service, memberships, savedUsers, savedMemberships } = setup();
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: [siteA],
    });
    await service.createSiteUser(
      siteA,
      { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE },
      {
        fullName: 'Редактор',
        email: 'editor@example.test',
        password: 'long-password',
        role: WorkspaceRole.SITE_CONTENT_MANAGER,
      },
    );
    expect(savedUsers[0]).toMatchObject({
      accountKind: 'site',
      homeSiteId: siteA,
    });
    expect(savedMemberships[0]).toMatchObject({
      role: WorkspaceRole.SITE_CONTENT_MANAGER,
      siteIds: [siteA],
    });
  });

  it('denies an owner creating a user for a neighboring site', async () => {
    const { service, memberships, savedUsers } = setup();
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: [siteA],
    });
    await expect(
      service.createSiteUser(
        siteB,
        { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE },
        {
          fullName: 'Редактор',
          email: 'editor@example.test',
          password: 'long-password',
          role: WorkspaceRole.SITE_DEVELOPER,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(savedUsers).toHaveLength(0);
  });

  it('denies an owner creating another owner', async () => {
    const { service, memberships, savedUsers } = setup();
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: [siteA],
    });
    await expect(
      service.createSiteUser(
        siteA,
        { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE },
        {
          fullName: 'Редактор',
          email: 'editor@example.test',
          password: 'long-password',
          role: WorkspaceRole.SITE_OWNER,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedUsers).toHaveLength(0);
  });

  it('rejects legacy workspace assignment for a site-local account', async () => {
    const { service } = setup();
    const users = (service as unknown as { users: { findOneBy: jest.Mock } })
      .users;
    users.findOneBy = jest.fn().mockResolvedValue({
      id: 'local-id',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'site',
      homeSiteId: siteA,
    });
    await expect(
      service.updateUserWorkspaces('local-id', ['workspace-b']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects adding a site-local account through the legacy member endpoint', async () => {
    const { service } = setup();
    const users = (service as unknown as { users: { findOneBy: jest.Mock } })
      .users;
    users.findOneBy = jest.fn().mockResolvedValue({
      id: 'local-id',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'site',
      homeSiteId: siteA,
    });
    await expect(
      service.setWorkspaceMember('workspace-b', 'local-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows only a Wispo staff account to replace its site assignments', async () => {
    const { service, memberships } = setup();
    const users = (service as unknown as { users: { findOneBy: jest.Mock } })
      .users;
    users.findOneBy = jest.fn().mockResolvedValue({
      id: 'staff-id',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'wispo',
    });
    const saved: Record<string, unknown>[] = [];
    const manager = {
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
      save: jest.fn((_entity: unknown, rows: Record<string, unknown>[]) => {
        saved.push(...rows);
        return Promise.resolve(rows);
      }),
    };
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.WISPO_DEVELOPER,
      siteIds: [siteA],
    });
    Object.assign(memberships, {
      manager: {
        transaction: jest.fn(
          async (work: (tx: typeof manager) => Promise<void>) => work(manager),
        ),
      },
    });
    await service.updateUserSites('staff-id', [siteA, siteB]);
    expect(saved).toEqual([
      expect.objectContaining({
        role: WorkspaceRole.WISPO_DEVELOPER,
        siteIds: [siteA],
      }),
      expect.objectContaining({
        role: WorkspaceRole.WISPO_DEVELOPER,
        siteIds: [siteB],
      }),
    ]);
  });

  it('does not expand the site scope of a site-local account', async () => {
    const { service, savedMemberships } = setup();
    const users = (service as unknown as { users: { findOneBy: jest.Mock } })
      .users;
    users.findOneBy = jest.fn().mockResolvedValue({
      id: 'local-id',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'site',
      homeSiteId: siteA,
    });
    await expect(
      service.updateUserSites('local-id', [siteB]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedMemberships).toHaveLength(0);
  });

  it('lists only site-local accounts for the owner site', async () => {
    const { service, memberships } = setup();
    const users = (service as unknown as { users: { find: jest.Mock } }).users;
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: [siteA],
    });
    users.find.mockResolvedValue([
      {
        id: 'editor-id',
        fullName: 'Редактор',
        email: 'editor@example.test',
        accountKind: 'site',
        homeSiteId: siteA,
        isActive: true,
        memberships: [
          { role: WorkspaceRole.SITE_CONTENT_MANAGER, siteIds: [siteA] },
        ],
      },
    ]);
    await expect(
      service.listSiteUsers(siteA, {
        userId: 'owner-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'editor-id',
        role: WorkspaceRole.SITE_CONTENT_MANAGER,
      }),
    ]);
    expect(users.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountKind: 'site', homeSiteId: siteA },
      }),
    );
  });

  it('denies an owner disabling a user from another site', async () => {
    const { service, memberships } = setup();
    const users = (
      service as unknown as { users: { findOneBy: jest.Mock; save: jest.Mock } }
    ).users;
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: [siteA],
    });
    users.findOneBy.mockResolvedValue({
      id: 'other-editor',
      accountKind: 'site',
      homeSiteId: siteB,
      isActive: true,
    });
    await expect(
      service.updateSiteUserStatus(
        siteA,
        'other-editor',
        { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE },
        { isActive: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.save).not.toHaveBeenCalled();
  });
});
