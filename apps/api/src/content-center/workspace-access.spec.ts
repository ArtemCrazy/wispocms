import { PlatformRole, SiteRole } from '../database/entities';
import { canAccessContentCenter } from './workspace-access';

describe('content center workspace scope', () => {
  const employee = PlatformRole.EMPLOYEE;
  it('allows the platform administrator without assignments or sites', () => {
    expect(canAccessContentCenter(PlatformRole.WISPO_ADMIN, [], [])).toBe(true);
  });
  it.each([SiteRole.OWNER, SiteRole.CONTENT_MANAGER])(
    'allows %s only for the entire shared material scope',
    (role) => {
      const grant = (siteId: string) => ({
        siteId,
        role,
        requiresApproval: false,
      });
      expect(canAccessContentCenter(employee, [grant('a')], ['a'])).toBe(true);
      expect(canAccessContentCenter(employee, [grant('a')], ['a', 'b'])).toBe(
        false,
      );
      expect(canAccessContentCenter(employee, [grant('b')], ['a'])).toBe(false);
      expect(
        canAccessContentCenter(employee, [grant('a'), grant('b')], ['a', 'b']),
      ).toBe(true);
    },
  );
  it('keeps access when site approval rules differ', () => {
    expect(
      canAccessContentCenter(
        employee,
        [
          {
            siteId: 'a',
            role: SiteRole.CONTENT_MANAGER,
            requiresApproval: true,
          },
          {
            siteId: 'b',
            role: SiteRole.CONTENT_MANAGER,
            requiresApproval: false,
          },
        ],
        ['a', 'b'],
      ),
    ).toBe(true);
  });
  it('fails closed for missing, empty and revoked grants', () => {
    expect(canAccessContentCenter(employee, [], ['a'])).toBe(false);
    expect(canAccessContentCenter(employee, [], [])).toBe(false);
  });
});
