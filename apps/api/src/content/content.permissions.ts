import {
  ArticleStatus,
  PlatformRole,
  WorkspaceRole,
} from '../database/entities';

export enum SitePermission {
  READ = 'read',
  EDIT_CONTENT = 'edit_content',
  EDIT_PUBLISHED = 'edit_published',
  APPROVE = 'approve',
  PUBLISH_CONTENT = 'publish_content',
  MANAGE_STRUCTURE = 'manage_structure',
  MANAGE_SETTINGS = 'manage_settings',
  MANAGE_USERS = 'manage_users',
}

export type SiteAccessGrant = {
  role: 'site_owner' | 'content_manager';
  requiresApproval: boolean;
};

function normalizeLegacyAccess(
  access:
    | SiteAccessGrant
    | WorkspaceRole
    | {
        role: WorkspaceRole;
        requiresApproval?: boolean;
      }
    | null,
): SiteAccessGrant | null {
  if (!access) return null;
  if (typeof access === 'object') {
    const role = String(access.role);
    if (role === 'site_owner')
      return {
        role: 'site_owner',
        requiresApproval: false,
      };
    if (role === 'content_manager')
      return {
        role: 'content_manager',
        requiresApproval: access.requiresApproval ?? false,
      };
    return null;
  }
  return null;
}

export function hasSitePermission(
  platformRole: PlatformRole,
  grantOrLegacyRole:
    | SiteAccessGrant
    | WorkspaceRole
    | {
        role: WorkspaceRole;
        requiresApproval?: boolean;
      }
    | null,
  permission: SitePermission,
) {
  if (platformRole === PlatformRole.WISPO_ADMIN) return true;
  const access = normalizeLegacyAccess(grantOrLegacyRole);
  if (!access) return false;
  if (permission === SitePermission.MANAGE_USERS) return false;
  if (access.role === 'site_owner') {
    return [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.APPROVE,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.MANAGE_STRUCTURE,
      SitePermission.MANAGE_SETTINGS,
    ].includes(permission);
  }
  if (permission === SitePermission.PUBLISH_CONTENT)
    return !access.requiresApproval;
  return [
    SitePermission.READ,
    SitePermission.EDIT_CONTENT,
    SitePermission.EDIT_PUBLISHED,
  ].includes(permission);
}

export function accessCoversSite(
  access: { siteId: string } | { siteIds: string[] } | null | undefined,
  siteId: string,
) {
  if (!access) return false;
  if ('siteIds' in access) return access.siteIds.includes(siteId);
  return access.siteId === siteId;
}

export function permissionForArticleTransition(target: ArticleStatus) {
  return target === ArticleStatus.REVIEW
    ? SitePermission.EDIT_CONTENT
    : SitePermission.APPROVE;
}
