export type SiteAccess = {
  role: "site_owner" | "content_manager";
  canEditCode: boolean;
  requiresApproval: boolean;
};

export function siteCapabilities(
  isWispoAdmin: boolean,
  access: SiteAccess | null | undefined,
) {
  if (isWispoAdmin)
    return {
      canRead: true,
      canEditContent: true,
      canApprove: true,
      canPublishDirectly: true,
      canViewCode: true,
      canPublishCodeDirectly: true,
      canEditCode: true,
      canManageSettings: true,
      canManageUsers: true,
    };

  const isOwner = access?.role === "site_owner";
  const isManager = access?.role === "content_manager";
  const canEditCode = Boolean(access?.canEditCode);
  const canPublishDirectly = isOwner || (isManager && !access.requiresApproval);
  return {
    canRead: Boolean(access),
    canEditContent: Boolean(access),
    canApprove: isOwner,
    canPublishDirectly,
    canViewCode: isOwner || canEditCode,
    canPublishCodeDirectly: canEditCode && canPublishDirectly,
    canEditCode,
    canManageSettings: isOwner,
    canManageUsers: false,
  };
}
