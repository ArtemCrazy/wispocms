import { PlatformRole, WorkspaceRole } from '../database/entities';
import {
  hasSitePermission,
  SitePermission,
} from '../content/content.permissions';

// Materials and AI history are shared by the workspace, not tagged by site.
// A partial site grant must never reveal that shared pool through a direct URL.
export function canAccessContentCenter(
  platformRole: PlatformRole,
  membership: { role: WorkspaceRole; siteIds: string[] } | null | undefined,
  workspaceSiteIds: string[],
): boolean {
  if (platformRole === PlatformRole.WISPO_ADMIN) return true;
  return Boolean(
    membership?.siteIds?.length &&
    workspaceSiteIds.length &&
    hasSitePermission(
      platformRole,
      membership.role,
      SitePermission.EDIT_CONTENT,
    ) &&
    workspaceSiteIds.every((id) => membership.siteIds.includes(id)),
  );
}
