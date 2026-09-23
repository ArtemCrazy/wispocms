import { PlatformRole, WorkspaceRole } from '../database/entities';
import { canAccessContentCenter } from './workspace-access';

describe('content center workspace scope', () => {
  const employee = PlatformRole.EMPLOYEE;
  it('allows the platform administrator without membership or sites', () => {
    expect(canAccessContentCenter(PlatformRole.WISPO_ADMIN, null, [])).toBe(
      true,
    );
  });
  it.each([
    WorkspaceRole.SITE_OWNER,
    WorkspaceRole.WISPO_MANAGER,
    WorkspaceRole.WISPO_DEVELOPER,
    WorkspaceRole.SITE_CONTENT_MANAGER,
    WorkspaceRole.SITE_DEVELOPER,
  ])('allows %s only for the entire shared material scope', (role) => {
    expect(
      canAccessContentCenter(employee, { role, siteIds: ['a'] }, ['a']),
    ).toBe(true);
    expect(
      canAccessContentCenter(employee, { role, siteIds: ['a'] }, ['a', 'b']),
    ).toBe(false);
    expect(
      canAccessContentCenter(employee, { role, siteIds: ['b'] }, ['a']),
    ).toBe(false);
    expect(
      canAccessContentCenter(employee, { role, siteIds: ['a', 'b'] }, [
        'a',
        'b',
      ]),
    ).toBe(true);
  });
  it('fails closed for legacy, missing, empty and revoked grants', () => {
    expect(canAccessContentCenter(employee, null, ['a'])).toBe(false);
    expect(
      canAccessContentCenter(
        employee,
        { role: WorkspaceRole.EMPLOYEE, siteIds: ['a'] },
        ['a'],
      ),
    ).toBe(false);
    expect(
      canAccessContentCenter(
        employee,
        { role: WorkspaceRole.SITE_OWNER, siteIds: [] },
        ['a'],
      ),
    ).toBe(false);
    expect(
      canAccessContentCenter(
        employee,
        { role: WorkspaceRole.SITE_OWNER, siteIds: ['a'] },
        [],
      ),
    ).toBe(false);
  });
});
