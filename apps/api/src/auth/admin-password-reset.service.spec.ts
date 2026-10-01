/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { PlatformRole } from '../database/entities';
import { AdminPasswordResetService } from './admin-password-reset.service';

describe('AdminPasswordResetService', () => {
  const users = {
    findOne: jest.fn(),
  };
  const resets = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const transactionManager = {
    save: jest.fn((_, value) => Promise.resolve(value)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    transaction: jest.fn((callback) => callback(transactionManager)),
  };
  const mailer = {
    sendAdminPasswordReset: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminPasswordResetService(
    users as never,
    resets as never,
    dataSource as never,
    mailer as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_APP_URL = 'http://localhost:3300';
  });

  it('creates an expiring hashed token and emails the raw link', async () => {
    users.findOne.mockResolvedValue({
      id: 'admin-id',
      fullName: 'Wispo Admin',
      email: 'admin@example.test',
      isActive: true,
      platformRole: PlatformRole.WISPO_ADMIN,
    });

    await expect(service.request('admin-id')).resolves.toEqual({ ok: true });

    expect(resets.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-id',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
    );
    const sentLink = mailer.sendAdminPasswordReset.mock.calls[0][0].url;
    expect(sentLink).toMatch(
      /^http:\/\/localhost:3300\/reset-admin-password\?token=[A-Za-z0-9_-]+$/,
    );
    expect(sentLink).not.toContain(resets.save.mock.calls[0][0].tokenHash);
  });

  it('rejects email-confirmed reset requests for non-admin accounts', async () => {
    users.findOne.mockResolvedValue({
      id: 'manager-id',
      isActive: true,
      platformRole: PlatformRole.EMPLOYEE,
    });

    await expect(service.request('manager-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mailer.sendAdminPasswordReset).not.toHaveBeenCalled();
  });

  it('consumes a valid token, changes the password and revokes old sessions', async () => {
    const user = {
      id: 'admin-id',
      platformRole: PlatformRole.WISPO_ADMIN,
      isActive: true,
      sessionVersion: 4,
      passwordHash: await hash('old-password', 4),
    };
    users.findOne.mockResolvedValue(user);
    resets.findOne.mockResolvedValue({
      id: 'reset-id',
      userId: user.id,
      tokenHash: 'stored-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });

    await expect(
      service.complete('raw-token', 'new-secure-password'),
    ).resolves.toEqual({ ok: true });

    expect(user.sessionVersion).toBe(5);
    await expect(
      compare('new-secure-password', user.passwordHash),
    ).resolves.toBe(true);
    expect(transactionManager.update).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ userId: user.id }),
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
  });

  it('rejects an expired or already used token', async () => {
    resets.findOne.mockResolvedValue(null);

    await expect(
      service.complete('invalid-token', 'new-secure-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
