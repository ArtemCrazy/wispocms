import {
  ArticleStatus,
  PlatformRole,
  WorkspaceRole,
} from '../database/entities';
import {
  hasSitePermission,
  permissionForArticleTransition,
  type SiteAccessGrant,
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

  it('keeps code editing and user administration closed while allowing the owner to publish an approved code revision', () => {
    const access: SiteAccessGrant = {
      role: 'site_owner',
      canEditCode: false,
      requiresApproval: false,
    };
    for (const permission of [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      SitePermission.PUBLISH_CODE,
      SitePermission.VIEW_CODE,
      'publish_content',
    ] as SitePermission[]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        true,
      );
    }
    for (const permission of [
      SitePermission.EDIT_CODE,
      SitePermission.MANAGE_USERS,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        false,
      );
    }
  });

  it('grants code editing to an owner only through the explicit flag', () => {
    const access: SiteAccessGrant = {
      role: 'site_owner',
      canEditCode: true,
      requiresApproval: false,
    };
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.EDIT_CODE,
      ),
    ).toBe(true);
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.PUBLISH_CODE,
      ),
    ).toBe(true);
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.MANAGE_USERS,
      ),
    ).toBe(false);
  });

  it('lets a content manager publish directly when approval is disabled', () => {
    const access: SiteAccessGrant = {
      role: 'content_manager',
      canEditCode: false,
      requiresApproval: false,
    };
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.EDIT_CONTENT,
      ),
    ).toBe(true);
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.PUBLISH_CONTENT,
      ),
    ).toBe(true);
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      SitePermission.EDIT_CODE,
      SitePermission.MANAGE_USERS,
      SitePermission.PUBLISH_CODE,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        false,
      );
    }
  });

  it('requires review for a content manager when approval is enabled', () => {
    const access: SiteAccessGrant = {
      role: 'content_manager',
      canEditCode: true,
      requiresApproval: true,
    };
    for (const permission of [
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_CODE,
      SitePermission.VIEW_CODE,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        true,
      );
    }
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      SitePermission.MANAGE_USERS,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.PUBLISH_CODE,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        false,
      );
    }
  });

  it('keeps code hidden from a manager without the explicit code flag', () => {
    const access: SiteAccessGrant = {
      role: 'content_manager',
      canEditCode: false,
      requiresApproval: false,
    };
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.VIEW_CODE,
      ),
    ).toBe(false);
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
