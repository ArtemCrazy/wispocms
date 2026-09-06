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
  MANAGE_SETTINGS = 'manage_settings',
}

export function hasSitePermission(
  platformRole: PlatformRole,
  workspaceRole: WorkspaceRole | null,
  permission: SitePermission,
) {
  void permission;
  if (platformRole === PlatformRole.WISPO_ADMIN) return true;
  return workspaceRole !== null;
}

export function permissionForArticleTransition(target: ArticleStatus) {
  return target === ArticleStatus.REVIEW
    ? SitePermission.EDIT_CONTENT
    : SitePermission.APPROVE;
}
