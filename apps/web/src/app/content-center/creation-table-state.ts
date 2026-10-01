import type { Cluster, Overview } from "./creation-state";

export function tablePlatforms(data: Overview) {
  const connected = new Set(data.settings.platforms.map((p) => p.siteId));
  return [
    ...new Set([...connected, ...data.articles.map((a) => a.site_id)]),
  ].map((id) => ({
    id,
    name: data.sites.find((s) => s.id === id)?.name ?? "Отключённая площадка",
    connected: connected.has(id),
  }));
}

export function clusterPage(
  clusters: Cluster[],
  requestedPage: number,
  size: number,
) {
  const ordered = [
    ...clusters.filter((c) => !c.archived),
    ...clusters.filter((c) => c.archived),
  ];
  const pages = Math.max(1, Math.ceil(ordered.length / size));
  const page = Math.max(1, Math.min(requestedPage, pages));
  const start = (page - 1) * size;
  return { page, pages, start, rows: ordered.slice(start, start + size) };
}

export function selectPageClusters(
  selected: string[],
  rows: Cluster[],
  checked: boolean,
) {
  const ids = rows.filter((c) => !c.archived).map((c) => c.id);
  return checked
    ? [...new Set([...selected, ...ids])]
    : selected.filter((id) => !ids.includes(id));
}
