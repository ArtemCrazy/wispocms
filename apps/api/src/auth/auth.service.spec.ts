import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PlatformRole } from '../database/entities';
import { AuthService } from './auth.service';

describe('AuthService password change', () => {
  const users = {
    findOne: jest.fn(),
    save: jest.fn((user) => Promise.resolve(user)),
  };
  const service = new AuthService(
    users as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('verifies the current password and stores a new hash', async () => {
    const user = {
      id: 'user-id',
      isActive: true,
      passwordHash: await hash('current-password', 4),
    };
    users.findOne.mockResolvedValue(user);

    await expect(
      service.changePassword(
        'user-id',
        'current-password',
        'new-secure-password',
      ),
    ).resolves.toEqual({ ok: true });
    expect(users.save).toHaveBeenCalledWith(user);
    await expect(
      compare('new-secure-password', user.passwordHash),
    ).resolves.toBe(true);
    await expect(compare('current-password', user.passwordHash)).resolves.toBe(
      false,
    );
  });

  it('rejects an invalid current password', async () => {
    users.findOne.mockResolvedValue({
      id: 'user-id',
      isActive: true,
      passwordHash: await hash('current-password', 4),
    });

    await expect(
      service.changePassword(
        'user-id',
        'wrong-password',
        'new-secure-password',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('rejects password changes for an unavailable account', async () => {
    users.findOne.mockResolvedValue(null);
    await expect(
      service.changePassword(
        'missing-id',
        'current-password',
        'new-secure-password',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService login protection', () => {
  const users = { findOne: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      users as never,
      {} as never,
      {} as never,
      {} as never,
      jwt as never,
    );
    jest.spyOn(service, 'getSession').mockResolvedValue({} as never);
  });

  it('limits repeated invalid logins for one address and email', async () => {
    users.findOne.mockResolvedValue(null);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.login('user@example.ru', 'wrong-password', '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const blocked = service.login(
      'user@example.ru',
      'wrong-password',
      '127.0.0.1',
    );
    await expect(blocked).rejects.toBeInstanceOf(HttpException);
    await expect(blocked).rejects.toMatchObject({ status: 429 });
  });

  it('clears failed attempts after a successful login', async () => {
    const user = {
      id: 'user-id',
      isActive: true,
      platformRole: 'member',
      passwordHash: await hash('correct-password', 4),
    };
    users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);

    await expect(
      service.login('user@example.ru', 'wrong-password', '127.0.0.2'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login('user@example.ru', 'correct-password', '127.0.0.2'),
    ).resolves.toEqual({ token: 'signed-token', session: {} });
  });
});

describe('AuthService workspace access', () => {
  it('shows a site owner only the assigned site, not its workspace neighbors', async () => {
    const workspace = { id: 'workspace-id', name: 'Client', slug: 'client' };
    const ownerMembership = {
      workspaceId: workspace.id,
      workspace,
      role: 'site_owner',
      siteIds: ['site-a'],
    };
    const memberships = {
      find: jest
        .fn()
        .mockResolvedValueOnce([ownerMembership])
        .mockResolvedValueOnce([]),
    };
    const sites = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { id: 'site-a', workspaceId: workspace.id, name: 'Own site' },
          { id: 'site-b', workspaceId: workspace.id, name: 'Other site' },
        ]),
      })),
    };
    const service = new AuthService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'owner-id',
          email: 'owner@example.test',
          fullName: 'Owner',
          platformRole: PlatformRole.EMPLOYEE,
          isActive: true,
        }),
      } as never,
      { find: jest.fn() } as never,
      sites as never,
      memberships as never,
      {} as never,
    );

    const session = await service.getSession('owner-id');
    expect(session.workspaces).toHaveLength(1);
    expect(session.workspaces[0].role).toBe('site_owner');
    expect(session.workspaces[0].sites.map((site) => site.id)).toEqual([
      'site-a',
    ]);
  });

  it('returns no projects to a legacy agency member without memberships', async () => {
    const workspace = { id: 'workspace-id', name: 'Client', slug: 'client' };
    const site = {
      id: 'site-id',
      workspaceId: workspace.id,
      name: 'Client site',
      slug: 'client-site',
      domain: null,
      siteType: 'corporate',
    };
    const users = {
      findOne: jest.fn().mockResolvedValue({
        id: 'agency-id',
        email: 'agency@wispo.ru',
        fullName: 'Agency manager',
        isActive: true,
        platformRole: PlatformRole.AGENCY_MEMBER,
      }),
    };
    const workspaces = { find: jest.fn().mockResolvedValue([workspace]) };
    const sites = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([site]),
      })),
    };
    const memberships = { find: jest.fn().mockResolvedValue([]) };
    const service = new AuthService(
      users as never,
      workspaces as never,
      sites as never,
      memberships as never,
      {} as never,
    );

    await expect(service.getSession('agency-id')).resolves.toMatchObject({
      user: { platformRole: PlatformRole.EMPLOYEE },
      workspaces: [],
    });
    expect(workspaces.find).not.toHaveBeenCalled();
    expect(sites.createQueryBuilder).not.toHaveBeenCalled();
    expect(memberships.find).toHaveBeenCalledTimes(1);
  });

  it('returns every workspace to the Wispo administrator', async () => {
    const workspaces = {
      find: jest.fn().mockResolvedValue([
        { id: 'workspace-a', name: 'A', slug: 'a' },
        { id: 'workspace-b', name: 'B', slug: 'b' },
      ]),
    };
    const memberships = {
      find: jest.fn().mockResolvedValue([]),
    };
    const sites = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    const service = new AuthService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'admin-id',
          email: 'admin@wispo.ru',
          fullName: 'Admin',
          isActive: true,
          platformRole: PlatformRole.WISPO_ADMIN,
        }),
      } as never,
      workspaces as never,
      sites as never,
      memberships as never,
      {} as never,
    );

    const session = await service.getSession('admin-id');
    expect(session.workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-a',
      'workspace-b',
    ]);
  });

  it('returns exactly the workspaces containing assigned sites for a Wispo manager', async () => {
    const assigned = [
      {
        workspaceId: 'workspace-a',
        workspace: { id: 'workspace-a', name: 'A', slug: 'a' },
        role: 'wispo_manager',
        siteIds: ['site-a'],
      },
      {
        workspaceId: 'workspace-c',
        workspace: { id: 'workspace-c', name: 'C', slug: 'c' },
        role: 'wispo_manager',
        siteIds: ['site-c'],
      },
    ];
    const memberships = {
      find: jest.fn().mockResolvedValueOnce(assigned).mockResolvedValueOnce([]),
    };
    const sites = {
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    const service = new AuthService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'employee-id',
          email: 'employee@wispo.ru',
          fullName: 'Employee',
          isActive: true,
          platformRole: PlatformRole.EMPLOYEE,
        }),
      } as never,
      { find: jest.fn() } as never,
      sites as never,
      memberships as never,
      {} as never,
    );

    const session = await service.getSession('employee-id');
    expect(session.workspaces.map((workspace) => workspace.id)).toEqual([
      'workspace-a',
      'workspace-c',
    ]);
  });
});
