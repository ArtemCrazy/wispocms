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

  it('does not authorize legacy workspace roles without explicit site assignments', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(
        hasSitePermission(PlatformRole.EMPLOYEE, role, SitePermission.READ),
      ).toBe(false);
    }
  });

  it('lets the owner manage predefined site structure without exposing code permissions', () => {
    const access: SiteAccessGrant = {
      role: 'site_owner',
      requiresApproval: false,
    };
    for (const permission of [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.APPROVE,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.MANAGE_SETTINGS,
      SitePermission.MANAGE_STRUCTURE,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        true,
      );
    }
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.MANAGE_USERS,
      ),
    ).toBe(false);
  });

  it('lets an independent content manager publish data but not alter structure', () => {
    const access: SiteAccessGrant = {
      role: 'content_manager',
      requiresApproval: false,
    };
    for (const permission of [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.PUBLISH_CONTENT,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        true,
      );
    }
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.MANAGE_SETTINGS,
      SitePermission.MANAGE_STRUCTURE,
      SitePermission.MANAGE_USERS,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
        false,
      );
    }
  });

  it('requires review for a content manager when approval is enabled', () => {
    const access: SiteAccessGrant = {
      role: 'content_manager',
      requiresApproval: true,
    };
    expect(
      hasSitePermission(
        PlatformRole.EMPLOYEE,
        access,
        SitePermission.EDIT_CONTENT,
      ),
    ).toBe(true);
    for (const permission of [
      SitePermission.APPROVE,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.MANAGE_STRUCTURE,
    ]) {
      expect(hasSitePermission(PlatformRole.EMPLOYEE, access, permission)).toBe(
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
