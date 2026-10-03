import { ForbiddenException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import {
  AuditService,
  describeMutation,
  sanitizeAuditChanges,
} from './audit.service';

describe('audit logging', () => {
  it('removes passwords, hashes and tokens from structured changes', () => {
    expect(
      sanitizeAuditChanges({
        title: 'Новый заголовок',
        password: 'temporary-secret',
        nested: { accessToken: 'token-value', enabled: true },
      }),
    ).toEqual({
      submittedValues: {
        title: 'Новый заголовок',
        nested: { enabled: true },
      },
      redactedFields: ['password', 'nested.accessToken'],
    });
  });

  it('describes nested workspace site creation as a site action', () => {
    expect(
      describeMutation('POST', '/api/platform/workspaces/workspace-id/sites', {
        workspaceId: 'workspace-id',
      }),
    ).toMatchObject({ entityType: 'site', action: 'create' });
  });

  it('stores actor, action and context without a password value', async () => {
    const auditLogs = {
      create: jest.fn((entry: Record<string, unknown>) => entry),
      save: jest.fn((entry: Record<string, unknown>) => Promise.resolve(entry)),
    };
    const users = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'actor-id', fullName: 'Иван Петров' }),
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        name: 'Сайт',
      }),
    };
    const service = new AuditService(
      auditLogs as never,
      users as never,
      sites as never,
      {} as never,
    );

    await service.recordMutation({
      actorUserId: 'actor-id',
      platformRole: PlatformRole.WISPO_ADMIN,
      method: 'PATCH',
      path: '/api/platform/users/user-id/password',
      params: { userId: 'user-id' },
      body: { password: 'never-store-me' },
    });

    expect(auditLogs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'actor-id',
        actorName: 'Иван Петров',
        entityType: 'user',
        action: 'password_reset',
        changes: { redactedFields: ['password'] },
      }),
    );
    expect(JSON.stringify(auditLogs.save.mock.calls)).not.toContain(
      'never-store-me',
    );
  });

  it('stores a safe system event without accepting token or manifest payloads', async () => {
    const auditLogs = {
      create: jest.fn((entry: Record<string, unknown>) => entry),
      save: jest.fn((entry: Record<string, unknown>) => Promise.resolve(entry)),
    };
    const service = new AuditService(
      auditLogs as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.recordSystemEvent({
      event: 'template_package_registered',
      entityId: 'version-id',
      packageId: 'skinova-media',
      packageVersion: '1',
      releaseDigest: 'a'.repeat(64),
      status: 'registered',
      reasons: [],
    });

    expect(auditLogs.save).toHaveBeenCalledTimes(1);
    const savedEvent = JSON.stringify(auditLogs.save.mock.calls[0][0]);
    expect(savedEvent).toContain('Release pipeline');
    expect(savedEvent).toContain('template_package_version');
    expect(savedEvent).toContain('template_package_registered');
    expect(savedEvent).toContain('skinova-media');
    expect(savedEvent).not.toMatch(/token|manifest|secret/i);
  });

  it('uses the transaction repository for an atomic system event', async () => {
    const injectedAuditLogs = {
      create: jest.fn((entry: Record<string, unknown>) => entry),
      save: jest.fn((entry: Record<string, unknown>) => Promise.resolve(entry)),
    };
    const transactionAuditLogs = {
      create: jest.fn((entry: Record<string, unknown>) => entry),
      save: jest.fn((entry: Record<string, unknown>) => Promise.resolve(entry)),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionAuditLogs),
    };
    const service = new AuditService(
      injectedAuditLogs as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.recordSystemEvent(
      {
        event: 'template_package_deployed',
        entityId: 'version-id',
        workspaceId: 'workspace-id',
        siteId: 'site-id',
        packageId: 'skinova-media',
        packageVersion: '1',
        releaseDigest: 'a'.repeat(64),
        status: 'ready',
        reasons: [],
      },
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalled();
    expect(transactionAuditLogs.save).toHaveBeenCalledTimes(1);
    expect(injectedAuditLogs.save).not.toHaveBeenCalled();
  });

  it('returns 403 for site history outside employee assignments', async () => {
    const service = new AuditService(
      {} as never,
      {} as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
      } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      service.listSite('site-id', {
        userId: 'employee-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose audit history for another site in an assigned workspace', async () => {
    const service = new AuditService(
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          role: 'site_owner',
          siteIds: ['other-site-id'],
        }),
      } as never,
    );
    await expect(
      service.listSite('site-id', {
        userId: 'owner-id',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
