import {
  EVENT_TYPE,
  RUN_STATUS,
  type Cluster,
  type CreationLocation,
  type History,
  type HistoryEvent,
  type Run,
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

export type HistoryFilters = {
  search: string;
  from: string;
  to: string;
  actor: string;
  type: string;
};
export type HistoryRow = {
  id: string;
  title: string;
  type: string;
  actor_name: string;
  created_at: string;
  run: Run | null;
  event: HistoryEvent | null;
};

export function historyRows(
  data: History,
  tab: CreationLocation["historyTab"],
  clusterContext: string | null,
): HistoryRow[] {
  return tab === "runs"
    ? data.runs.map((run) => ({
        id: run.id,
        title: `Запуск № ${run.number}`,
        type: run.status,
        actor_name: run.actor_name,
        created_at: run.created_at,
        run,
        event: null,
      }))
    : data.events
        .filter(
          (event) =>
            event.kind === (tab === "clusters" ? "cluster" : "article") &&
            (!clusterContext ||
              event.cluster_id === clusterContext ||
              (event.kind === "cluster" &&
                event.related_ids.includes(clusterContext))),
        )
        .map((event) => ({
          id: event.id,
          title: event.title,
          type: event.type,
          actor_name: event.actor_name,
          created_at: event.created_at,
          run: null,
          event,
        }));
}

export function historyPage(
  rows: HistoryRow[],
  labels: Record<string, string>,
  filters: HistoryFilters,
  requestedPage: number,
  size: number,
  ascending: boolean,
) {
  const invalidRange = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const needle = filters.search.trim().toLocaleLowerCase();
  const start = filters.from
    ? new Date(`${filters.from}T00:00:00`).getTime()
    : -Infinity;
  const end = filters.to
    ? new Date(`${filters.to}T23:59:59.999`).getTime()
    : Infinity;
  const filtered = invalidRange
    ? []
    : rows
        .filter((row) => {
          const date = new Date(row.created_at).getTime();
          return (
            (!needle ||
              `${row.title} ${row.actor_name} ${labels[row.type] ?? row.type}`
                .toLocaleLowerCase()
                .includes(needle)) &&
            (!filters.actor || row.actor_name === filters.actor) &&
            (!filters.type || row.type === filters.type) &&
            date >= start &&
            date <= end
          );
        })
        .sort((a, b) => {
          const diff =
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          return (ascending ? 1 : -1) * (diff || a.id.localeCompare(b.id));
        });
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.max(1, Math.min(requestedPage, pages));
  const offset = (page - 1) * size;
  return {
    rows: filtered.slice(offset, offset + size),
    total: filtered.length,
    pages,
    page,
    offset,
    invalidRange,
  };
}

export function historyTone(type: string) {
  if (["succeeded", "formed", "published"].includes(type)) return "success";
  if (["failed", "unpublished"].includes(type)) return "danger";
  if (["partial", "split"].includes(type)) return "warning";
  if (["version", "created", "processing", "changed", "merge"].includes(type))
    return "accent";
  return "neutral";
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
