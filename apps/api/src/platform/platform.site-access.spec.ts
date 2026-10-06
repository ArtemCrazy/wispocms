import { BadRequestException } from '@nestjs/common';
import {
  PlatformRole,
  SiteAccessEntity,
  SiteRole,
  UserEntity,
  WorkspaceMembershipEntity,
  WorkspaceRole,
} from '../database/entities';
import { PlatformService } from './platform.service';
import { ManagedUserRole } from './platform.dto';

describe('PlatformService site access assignments', () => {
  const siteA = '77bbc150-03f9-4ae4-9713-a7c8de79897d';
  const siteB = 'c9772fe5-9a26-4280-aefe-ac9d888d033d';

  function setup() {
    const savedUsers: Record<string, unknown>[] = [];
    const savedMemberships: Record<string, unknown>[] = [];
    const savedAccesses: Record<string, unknown>[] = [];
    const transactionManager = {
      create: jest.fn((_entity: unknown, row: Record<string, unknown>) => row),
      save: jest.fn(
        (
          entity:
            | typeof UserEntity
            | typeof SiteAccessEntity
            | typeof WorkspaceMembershipEntity,
          rows: Record<string, unknown> | Record<string, unknown>[],
        ) => {
          if (entity === UserEntity) {
            const saved = {
              id: 'user-id',
              ...(rows as Record<string, unknown>),
            };
            savedUsers.push(saved);
            return Promise.resolve(saved);
          }
          const values = Array.isArray(rows) ? rows : [rows];
          if (entity === SiteAccessEntity) savedAccesses.push(...values);
          if (entity === WorkspaceMembershipEntity)
            savedMemberships.push(...values);
          return Promise.resolve(rows);
        },
      ),
      delete: jest.fn().mockResolvedValue({}),
    };
    const users = {
      existsBy: jest.fn().mockResolvedValue(false),
      findOneBy: jest.fn(),
      find: jest.fn(),
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn((row: Record<string, unknown>) => {
        const saved = { id: 'user-id', ...row };
        savedUsers.push(saved);
        return Promise.resolve(saved);
      }),
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof transactionManager) => Promise<unknown>) =>
            work(transactionManager),
        ),
      },
    };
    const sites = {
      find: jest.fn(({ where }: { where: { id: { value: string[] } } }) =>
        Promise.resolve(
          [
            { id: siteA, workspaceId: 'workspace-a' },
            { id: siteB, workspaceId: 'workspace-b' },
          ].filter((site) => where.id.value.includes(site.id)),
        ),
      ),
    };
    const memberships = {
      create: jest.fn((row: Record<string, unknown>) => row),
      delete: jest.fn().mockResolvedValue({}),
      save: jest.fn((rows: Record<string, unknown>[]) => {
        savedMemberships.push(...rows);
        return Promise.resolve(rows);
      }),
    };
    const siteAccesses = {
      create: jest.fn((row: Record<string, unknown>) => row),
      delete: jest.fn().mockResolvedValue({}),
      save: jest.fn((rows: Record<string, unknown>[]) => {
        savedAccesses.push(...rows);
        return Promise.resolve(rows);
      }),
    };
    const service = new PlatformService(
      users as never,
      {} as never,
      sites as never,
      {} as never,
      memberships as never,
      siteAccesses as never,
    );
    return {
      service,
      users,
      memberships,
      siteAccesses,
      transactionManager,
      savedUsers,
      savedMemberships,
      savedAccesses,
    };
  }

  it('creates one content manager with different approval rules on multiple sites', async () => {
    const { service, users, savedUsers, savedMemberships, savedAccesses } =
      setup();
    await service.createUser({
      fullName: 'Иван Петров',
      email: 'IVAN@example.test',
      password: 'long-password',
      siteAccesses: [
        {
          siteId: siteA,
          role: SiteRole.CONTENT_MANAGER,
          requiresApproval: true,
        },
        {
          siteId: siteB,
          role: SiteRole.CONTENT_MANAGER,
          requiresApproval: false,
        },
      ],
    });

    expect(savedUsers[0]).toMatchObject({
      email: 'ivan@example.test',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'wispo',
      homeSiteId: null,
    });
    expect(savedAccesses).toEqual([
      expect.objectContaining({
        siteId: siteA,
        role: SiteRole.CONTENT_MANAGER,
        requiresApproval: true,
      }),
      expect.objectContaining({
        siteId: siteB,
        role: SiteRole.CONTENT_MANAGER,
        requiresApproval: false,
      }),
    ]);
    expect(savedMemberships).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-a',
        role: WorkspaceRole.EMPLOYEE,
        siteIds: [siteA],
      }),
      expect.objectContaining({
        workspaceId: 'workspace-b',
        role: WorkspaceRole.EMPLOYEE,
        siteIds: [siteB],
      }),
    ]);
    expect(users.manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('creates a site owner for one site and does not require self-approval', async () => {
    const { service, savedUsers, savedAccesses } = setup();
    await service.createUser({
      fullName: 'Владелец',
      email: 'owner@example.test',
      password: 'long-password',
      siteAccesses: [
        {
          siteId: siteA,
          role: SiteRole.OWNER,
          requiresApproval: true,
        },
      ],
    });

    expect(savedUsers[0]).toMatchObject({
      accountKind: 'site',
      homeSiteId: siteA,
    });
    expect(savedAccesses[0]).toMatchObject({
      role: SiteRole.OWNER,
      requiresApproval: false,
    });
  });

  it('rejects an owner account assigned to more than one site', async () => {
    const { service, savedUsers } = setup();
    await expect(
      service.createUser({
        fullName: 'Владелец',
        email: 'owner@example.test',
        password: 'long-password',
        siteAccesses: [
          { siteId: siteA, role: SiteRole.OWNER },
          { siteId: siteB, role: SiteRole.OWNER },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedUsers).toHaveLength(0);
  });

  it('replaces all per-site assignments only through the platform service', async () => {
    const { service, users, transactionManager, savedAccesses } = setup();
    users.findOneBy.mockResolvedValue({
      id: 'manager-id',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'wispo',
      homeSiteId: null,
    });

    await service.updateUserSiteAccesses('manager-id', [
      {
        siteId: siteA,
        role: SiteRole.CONTENT_MANAGER,
        requiresApproval: false,
      },
    ]);

    expect(transactionManager.delete).toHaveBeenCalledWith(SiteAccessEntity, {
      userId: 'manager-id',
    });
    expect(transactionManager.delete).toHaveBeenCalledWith(
      WorkspaceMembershipEntity,
      { userId: 'manager-id' },
    );
    expect(savedAccesses).toEqual([
      expect.objectContaining({
        userId: 'manager-id',
        siteId: siteA,
        requiresApproval: false,
      }),
    ]);
  });

  it('lists site assignments with their site and workspace labels', async () => {
    const { service, users } = setup();
    users.find.mockResolvedValue([
      {
        id: 'manager-id',
        email: 'manager@example.test',
        fullName: 'Менеджер',
        platformRole: PlatformRole.EMPLOYEE,
        isActive: true,
        accountKind: 'wispo',
        homeSiteId: null,
        memberships: [],
        siteAccesses: [
          {
            siteId: siteA,
            role: SiteRole.CONTENT_MANAGER,
            requiresApproval: true,
            site: {
              id: siteA,
              name: 'Luminova',
              workspaceId: 'workspace-a',
              workspace: { id: 'workspace-a', name: 'Wispo' },
            },
          },
        ],
      },
    ]);

    await expect(service.listUsers()).resolves.toEqual([
      expect.objectContaining({
        id: 'manager-id',
        siteAccesses: [
          {
            siteId: siteA,
            siteName: 'Luminova',
            workspaceId: 'workspace-a',
            workspaceName: 'Wispo',
            role: SiteRole.CONTENT_MANAGER,
            requiresApproval: true,
          },
        ],
      }),
    ]);
  });

  it('promotes an employee to Wispo administrator and clears scoped access', async () => {
    const { service, users, transactionManager, savedUsers, savedAccesses } =
      setup();
    users.findOneBy.mockResolvedValue({
      id: 'manager-id',
      fullName: 'Old name',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'wispo',
      homeSiteId: null,
      isActive: true,
    });

    await expect(
      service.updateManagedUser('manager-id', 'actor-id', {
        fullName: ' New administrator ',
        role: ManagedUserRole.WISPO_ADMIN,
        siteIds: [],
        requiresApproval: false,
        isActive: true,
      }),
    ).resolves.toMatchObject({
      id: 'manager-id',
      fullName: 'New administrator',
      platformRole: PlatformRole.WISPO_ADMIN,
      siteAccesses: [],
    });

    expect(transactionManager.delete).toHaveBeenCalledWith(SiteAccessEntity, {
      userId: 'manager-id',
    });
    expect(transactionManager.delete).toHaveBeenCalledWith(
      WorkspaceMembershipEntity,
      { userId: 'manager-id' },
    );
    expect(savedUsers.at(-1)).toMatchObject({
      id: 'manager-id',
      fullName: 'New administrator',
      platformRole: PlatformRole.WISPO_ADMIN,
      accountKind: 'wispo',
      homeSiteId: null,
    });
    expect(savedAccesses).toHaveLength(0);
  });

  it('turns a member into a one-site owner without self-approval', async () => {
    const { service, users, savedUsers, savedAccesses } = setup();
    users.findOneBy.mockResolvedValue({
      id: 'manager-id',
      fullName: 'Manager',
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'wispo',
      homeSiteId: null,
      isActive: true,
    });

    await service.updateManagedUser('manager-id', 'actor-id', {
      fullName: 'Site owner',
      role: ManagedUserRole.SITE_OWNER,
      siteIds: [siteA],
      requiresApproval: true,
      isActive: true,
    });

    expect(savedUsers.at(-1)).toMatchObject({
      platformRole: PlatformRole.EMPLOYEE,
      accountKind: 'site',
      homeSiteId: siteA,
    });
    expect(savedAccesses).toEqual([
      expect.objectContaining({
        siteId: siteA,
        role: SiteRole.OWNER,
        requiresApproval: false,
      }),
    ]);
  });

  it('does not let the active administrator remove their own platform access', async () => {
    const { service, users } = setup();
    users.findOneBy.mockResolvedValue({
      id: 'actor-id',
      fullName: 'Administrator',
      platformRole: PlatformRole.WISPO_ADMIN,
      accountKind: 'wispo',
      homeSiteId: null,
      isActive: true,
    });

    await expect(
      service.updateManagedUser('actor-id', 'actor-id', {
        fullName: 'Administrator',
        role: ManagedUserRole.CONTENT_MANAGER,
        siteIds: [siteA],
        requiresApproval: false,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
