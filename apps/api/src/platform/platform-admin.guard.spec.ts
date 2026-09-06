import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();

  function context(platformRole: PlatformRole) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ auth: { userId: 'user-id', platformRole } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows only the Wispo administrator into platform management', () => {
    expect(guard.canActivate(context(PlatformRole.WISPO_ADMIN))).toBe(true);
    expect(() =>
      guard.canActivate(context(PlatformRole.AGENCY_MEMBER)),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context(PlatformRole.MEMBER))).toThrow(
      ForbiddenException,
    );
  });
});
