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

  it('gives an assigned employee every site permission', () => {
    for (const permission of Object.values(SitePermission)) {
      expect(
        hasSitePermission(
          PlatformRole.EMPLOYEE,
          WorkspaceRole.EMPLOYEE,
          permission,
        ),
      ).toBe(true);
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
