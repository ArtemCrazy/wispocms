import { UnauthorizedException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const jwt = { verifyAsync: jest.fn() };
  const authService = { getActiveIdentity: jest.fn() };
  const guard = new JwtAuthGuard(jwt as never, authService as never);

  function context(request: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  }

  beforeEach(() => jest.clearAllMocks());

  it('uses the current active user and current platform role', async () => {
    const request = { cookies: { wispo_session: 'valid-token' } };
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-id',
      role: PlatformRole.WISPO_ADMIN,
    });
    authService.getActiveIdentity.mockResolvedValue({
      id: 'user-id',
      platformRole: PlatformRole.MEMBER,
    });

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toEqual(
      expect.objectContaining({
        auth: { userId: 'user-id', platformRole: PlatformRole.MEMBER },
      }),
    );
  });

  it('revokes an existing token when the user is disabled', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'disabled-user',
      role: PlatformRole.MEMBER,
    });
    authService.getActiveIdentity.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        context({ cookies: { wispo_session: 'old-valid-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
