import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
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
      platformRole: 'member',
      sessionVersion: 2,
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
    expect(user.sessionVersion).toBe(3);
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
      platformRole: 'member',
      sessionVersion: 0,
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

  it('lets Wispo administrators change a known password while email is unavailable', async () => {
    const admin = {
      id: 'admin-id',
      isActive: true,
      platformRole: 'wispo_admin',
      sessionVersion: 0,
      passwordHash: await hash('current-password', 4),
    };
    users.findOne.mockResolvedValue(admin);

    await expect(
      service.changePassword(
        'admin-id',
        'current-password',
        'new-secure-password',
      ),
    ).resolves.toEqual({ ok: true });
    expect(users.save).toHaveBeenCalledWith(admin);
    expect(admin.sessionVersion).toBe(1);
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
      sessionVersion: 0,
      passwordHash: await hash('correct-password', 4),
    };
    users.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);

    await expect(
      service.login('user@example.ru', 'wrong-password', '127.0.0.2'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.login('user@example.ru', 'correct-password', '127.0.0.2'),
    ).resolves.toEqual({ token: 'signed-token', session: {} });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sessionVersion: 0 }),
    );
  });
});
