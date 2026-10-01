import {
  ArticleStatus,
  PlatformRole,
  WorkspaceRole,
} from '../database/entities';

export enum SitePermission {
  READ = 'read',
  EDIT_CONTENT = 'edit_content',
  EDIT_PUBLISHED = 'edit_published',
  VIEW_CODE = 'view_code',
  EDIT_CODE = 'edit_code',
  APPROVE = 'approve',
  PUBLISH_CONTENT = 'publish_content',
  PUBLISH_CODE = 'publish_code',
  MANAGE_SETTINGS = 'manage_settings',
  MANAGE_USERS = 'manage_users',
}

export type SiteAccessGrant = {
  role: 'site_owner' | 'content_manager';
  canEditCode: boolean;
  requiresApproval: boolean;
};

function normalizeLegacyAccess(
  access:
    | SiteAccessGrant
    | WorkspaceRole
    | {
        role: WorkspaceRole;
        canEditCode?: boolean;
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
        canEditCode: access.canEditCode ?? false,
        requiresApproval: false,
      };
    if (role === 'content_manager')
      return {
        role: 'content_manager',
        canEditCode: access.canEditCode ?? false,
        requiresApproval: access.requiresApproval ?? false,
      };
    return normalizeLegacyAccess(access.role as WorkspaceRole);
  }
  if (access === WorkspaceRole.SITE_OWNER)
    return {
      role: 'site_owner',
      canEditCode: false,
      requiresApproval: false,
    };
  if (
    access === WorkspaceRole.WISPO_DEVELOPER ||
    access === WorkspaceRole.SITE_DEVELOPER
  )
    return {
      role: 'content_manager',
      canEditCode: true,
      requiresApproval: false,
    };
  if (
    access === WorkspaceRole.WISPO_MANAGER ||
    access === WorkspaceRole.SITE_CONTENT_MANAGER
  )
    return {
      role: 'content_manager',
      canEditCode: false,
      requiresApproval: false,
    };
  return null;
}

export function hasSitePermission(
  platformRole: PlatformRole,
  grantOrLegacyRole:
    | SiteAccessGrant
    | WorkspaceRole
    | {
        role: WorkspaceRole;
        canEditCode?: boolean;
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
    if (permission === SitePermission.VIEW_CODE) return true;
    if (permission === SitePermission.EDIT_CODE) return access.canEditCode;
    return [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.APPROVE,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.PUBLISH_CODE,
      SitePermission.MANAGE_SETTINGS,
    ].includes(permission);
  }
  if (permission === SitePermission.VIEW_CODE) return access.canEditCode;
  if (permission === SitePermission.EDIT_CODE) return access.canEditCode;
  if (permission === SitePermission.PUBLISH_CODE)
    return access.canEditCode && !access.requiresApproval;
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
