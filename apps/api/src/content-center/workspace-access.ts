import { PlatformRole } from '../database/entities';
import {
  hasSitePermission,
  type SiteAccessGrant,
  SitePermission,
} from '../content/content.permissions';

// Materials and AI history are shared by the workspace, not tagged by site.
// A partial site grant must never reveal that shared pool through a direct URL.
export function canAccessContentCenter(
  platformRole: PlatformRole,
  assignments: Array<SiteAccessGrant & { siteId: string }>,
  workspaceSiteIds: string[],
): boolean {
  if (platformRole === PlatformRole.WISPO_ADMIN) return true;
  return (
    workspaceSiteIds.length > 0 &&
    workspaceSiteIds.every((siteId) => {
      const assignment = assignments.find((access) => access.siteId === siteId);
      return (
        assignment &&
        hasSitePermission(platformRole, assignment, SitePermission.EDIT_CONTENT)
      );
    })
  );
}
