export type SiteAccess = {
  role: "site_owner" | "content_manager";
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
      canManageStructure: true,
      canManageSettings: true,
      canManageUsers: true,
    };

  const isOwner = access?.role === "site_owner";
  const isManager = access?.role === "content_manager";
  const canPublishDirectly = isOwner || (isManager && !access.requiresApproval);
  return {
    canRead: Boolean(access),
    canEditContent: Boolean(access),
    canApprove: isOwner,
    canPublishDirectly,
    canManageStructure: isOwner,
    canManageSettings: isOwner,
    canManageUsers: false,
  };
}
