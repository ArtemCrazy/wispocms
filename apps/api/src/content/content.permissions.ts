import {
  ArticleStatus,
  PlatformRole,
  WorkspaceRole,
} from '../database/entities';

export enum SitePermission {
  READ = 'read',
  EDIT_CONTENT = 'edit_content',
  EDIT_PUBLISHED = 'edit_published',
  EDIT_CODE = 'edit_code',
  APPROVE = 'approve',
  PUBLISH_CONTENT = 'publish_content',
  PUBLISH_CODE = 'publish_code',
  MANAGE_SETTINGS = 'manage_settings',
  MANAGE_USERS = 'manage_users',
}

export function hasSitePermission(
  platformRole: PlatformRole,
  workspaceRole: WorkspaceRole | null,
  permission: SitePermission,
) {
  if (platformRole === PlatformRole.WISPO_ADMIN) return true;
  if (workspaceRole === WorkspaceRole.SITE_OWNER) return true;
  if (
    workspaceRole === WorkspaceRole.WISPO_DEVELOPER ||
    workspaceRole === WorkspaceRole.SITE_DEVELOPER
  )
    return [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.EDIT_CODE,
      SitePermission.PUBLISH_CONTENT,
      SitePermission.PUBLISH_CODE,
    ].includes(permission);
  if (
    workspaceRole === WorkspaceRole.WISPO_MANAGER ||
    workspaceRole === WorkspaceRole.SITE_CONTENT_MANAGER
  )
    return [
      SitePermission.READ,
      SitePermission.EDIT_CONTENT,
      SitePermission.EDIT_PUBLISHED,
      SitePermission.PUBLISH_CONTENT,
    ].includes(permission);
  return false;
}

export function permissionForArticleTransition(target: ArticleStatus) {
  return target === ArticleStatus.REVIEW
    ? SitePermission.EDIT_CONTENT
    : SitePermission.APPROVE;
}
