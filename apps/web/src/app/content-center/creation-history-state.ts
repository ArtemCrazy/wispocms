import {
  EVENT_TYPE,
  RUN_STATUS,
  type Cluster,
  type CreationLocation,
} from "./creation-state";

export function historyLabels(
  tab: CreationLocation["historyTab"],
): Record<string, string> {
  if (tab === "runs") return RUN_STATUS;
  const keys =
    tab === "clusters"
      ? (["formed", "changed", "split", "merge"] as const)
      : (["created", "version", "published", "unpublished"] as const);
  return Object.fromEntries(keys.map((key) => [key, EVENT_TYPE[key]]));
}

export function clusterSnapshots(value: unknown): Cluster[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (item): item is Cluster =>
      item !== null &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.number === "number" &&
      typeof item.title === "string" &&
      Array.isArray(item.queries),
  );
}

export function publicationDetails(value: unknown) {
  const item =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const url = typeof item.url === "string" ? item.url : "";
  // Publication links are CMS-relative or HTTP(S), never executable schemes.
  let href: string | null = null;
  try {
    const parsed = new URL(url, "https://cms.invalid");
    if (
      !/[\s\\]/.test(url) &&
      !url.startsWith("//") &&
      (url.startsWith("/") || /^https?:\/\//i.test(url)) &&
      ["https:", "http:"].includes(parsed.protocol)
    ) {
      href = url;
    }
  } catch {
    // An old or incomplete event still displays its platform/version.
  }
  return {
    version:
      typeof item.version === "number" && Number.isInteger(item.version)
        ? item.version
        : null,
    siteName: typeof item.siteName === "string" ? item.siteName : "Не указана",
    href,
  };
}
