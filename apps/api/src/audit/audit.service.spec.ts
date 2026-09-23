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
