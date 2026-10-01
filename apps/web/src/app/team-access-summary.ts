export type ManagedUserRole =
  | "wispo_admin"
  | "site_owner"
  | "content_manager";

type RoleSource = {
  platformRole: string;
  siteAccesses: Array<{ role: "site_owner" | "content_manager" }>;
};

function siteCountLabel(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return "сайтов";
  if (lastDigit === 1) return "сайт";
  if (lastDigit >= 2 && lastDigit <= 4) return "сайта";
  return "сайтов";
}

export function formatSiteSummary(
  siteNames: string[],
  administrator: boolean,
) {
  if (administrator) return "Все сайты";
  if (siteNames.length === 0) return "Не назначены";
  if (siteNames.length <= 3) return siteNames.join(" / ");
  return `${siteNames.length} ${siteCountLabel(siteNames.length)}`;
}

export function capabilityLabels({
  administrator,
  canEditCode,
  requiresApproval,
}: {
  administrator: boolean;
  canEditCode: boolean;
  requiresApproval: boolean;
}) {
  if (administrator) return ["Полный доступ"];
  return [
    ...(canEditCode ? ["Доступ к коду"] : []),
    ...(requiresApproval ? ["Согласование"] : []),
  ];
}

export function managedUserRole(user: RoleSource): ManagedUserRole {
  if (user.platformRole === "wispo_admin") return "wispo_admin";
  if (user.siteAccesses.some((access) => access.role === "site_owner"))
    return "site_owner";
  return "content_manager";
}
