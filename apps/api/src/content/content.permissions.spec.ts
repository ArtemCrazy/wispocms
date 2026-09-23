import {
  ArticleStatus,
  PlatformRole,
  WorkspaceRole,
} from '../database/entities';
import {
  hasSitePermission,
  permissionForArticleTransition,
  SitePermission,
} from './content.permissions';

describe('content permissions', () => {
  it('allows Wispo administrators every site action', () => {
    for (const permission of Object.values(SitePermission)) {
      expect(
        hasSitePermission(PlatformRole.WISPO_ADMIN, null, permission),
      ).toBe(true);
    }
  });

  it('does not give a legacy agency member global access', () => {
    for (const permission of Object.values(SitePermission)) {
      expect(
        hasSitePermission(PlatformRole.AGENCY_MEMBER, null, permission),
      ).toBe(false);
    }
  });

  it('does not turn a legacy workspace membership into full site access', () => {
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        WorkspaceRole.EMPLOYEE,
        SitePermission.APPROVE,
      ),
    ).toBe(false);
  });

  it('does not authorize legacy workspace roles without explicit site assignments', () => {
    for (const role of [
      WorkspaceRole.WORKSPACE_ADMIN,
      WorkspaceRole.DEVELOPER,
      WorkspaceRole.CONTENT_MANAGER,
      WorkspaceRole.CLIENT_APPROVER,
    ]) {
      expect(
        hasSitePermission(PlatformRole.EMPLOYEE, role, SitePermission.READ),
      ).toBe(false);
    }
  });

  it('allows the site owner to manage and publish everything on the assigned site', () => {
    const role = 'site_owner' as WorkspaceRole;
    for (const permission of [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      'edit_code',
      'publish_content',
      'publish_code',
      'manage_users',
    ] as SitePermission[]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, role, permission)).toBe(
        true,
      );
    }
  });

  it('allows a Wispo manager to edit and publish content but not code or approvals', () => {
    const role = 'wispo_manager' as WorkspaceRole;
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        role,
        SitePermission.EDIT_CONTENT,
      ),
    ).toBe(true);
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        role,
        'publish_content' as SitePermission,
      ),
    ).toBe(true);
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      'edit_code',
      'manage_users',
      'publish_code',
    ] as SitePermission[]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, role, permission)).toBe(
        false,
      );
    }
  });

  it('allows a developer to edit and publish code without granting approval or user management', () => {
    const role = 'wispo_developer' as WorkspaceRole;
    for (const permission of [
      SitePermission.EDIT_CONTENT,
      'edit_code',
      'publish_content',
      'publish_code',
    ] as SitePermission[]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, role, permission)).toBe(
        true,
      );
    }
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      'manage_users',
    ] as SitePermission[]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, role, permission)).toBe(
        false,
      );
    }
  });

  it('requires editors to request review and approvers for other transitions', () => {
    expect(permissionForArticleTransition(ArticleStatus.REVIEW)).toBe(
      SitePermission.EDIT_CONTENT,
    );
    expect(permissionForArticleTransition(ArticleStatus.PUBLISHED)).toBe(
      SitePermission.APPROVE,
    );
    expect(permissionForArticleTransition(ArticleStatus.CHANGES)).toBe(
      SitePermission.APPROVE,
    );
    expect(permissionForArticleTransition(ArticleStatus.DRAFT)).toBe(
      SitePermission.APPROVE,
    );
  });
});
