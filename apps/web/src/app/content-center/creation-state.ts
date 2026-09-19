import type { ArticleDocument } from "../structured-article-editor";
export type Snapshot = {
  title: string;
  excerpt: string;
  document: ArticleDocument;
};
export type Query = {
  text: string;
  general: number;
  exact: number;
  primary: boolean;
};
export type Cluster = {
  id: string;
  number: number;
  title: string;
  direction: string;
  queries: Query[];
  archived: boolean;
  revision: number;
};
export type CreatedArticle = {
  cover_media_id?: string | null;
  id: string;
  cluster_id: string;
  site_id: string;
  title: string;
  status: "created" | "published" | "unpublished";
  recommendation: "keep" | "update" | "unpublish";
  rationale: string;
  purpose: string;
  task: string;
  need: string;
  content_rationale: string;
  current_number: number;
  published_number: number | null;
  revision: number;
  publication_url: string | null;
  category_id: string | null;
  cms_article_id: string | null;
  created_at: string;
  updated_at: string;
};
export type Proposal = {
  id: string;
  target: string;
  before: unknown;
  after: unknown;
  reason: string;
  decision: "pending" | "accepted" | "rejected";
};
export type Version = {
  id: string;
  number: number;
  snapshot: Snapshot;
  changes: Proposal[];
  reason: string;
  actor_name: string;
  created_at: string;
};
export type Settings = {
  revision: number;
  rules: string;
  platforms: { siteId: string; rules: string }[];
};
export type Operation = {
  clusterId: string;
  clusterTitle: string;
  siteId: string;
  siteName: string;
  articleId: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "skipped";
  message: string;
};
export type Run = {
  id: string;
  number: number;
  kind: "production" | "correction";
  status: "queued" | "processing" | "succeeded" | "partial" | "failed";
  cluster_count: number;
  actor_name: string;
  created_at: string;
  operations: Operation[];
};
export type Overview = {
  settings: Settings;
  sites: { id: string; name: string }[];
  clusters: Cluster[];
  articles: CreatedArticle[];
  run: Run | null;
  ai: { connected: boolean; supportsFiles: boolean };
};
export type ArticleDetails = {
  article: CreatedArticle;
  version: Version;
  versions: Omit<Version, "snapshot" | "changes">[];
  correction: { id: string; proposals: Proposal[] } | null;
  sites: { id: string; name: string; slug: string }[];
  categories: { id: string; name: string }[];
  templates: { key: string; version: string; name: string }[];
  media: { id: string; alt_text: string }[];
};
export type HistoryEvent = {
  id: string;
  kind: "cluster" | "article";
  type: string;
  cluster_id: string;
  article_id: string | null;
  title: string;
  before: unknown;
  after: unknown;
  related_ids: string[];
  actor_name: string;
  created_at: string;
};
export type History = { runs: Run[]; events: HistoryEvent[] };
export const ARTICLE_STATUS = {
  missing: "Не создана",
  created: "Создана",
  published: "Опубликована",
  unpublished: "Снята с публикации",
};
export const AI_RECOMMENDATION = {
  create: "Создать",
  keep: "Оставить без изменений",
  update: "Обновить",
  unpublish: "Снять с публикации",
};
export const RUN_STATUS = {
  queued: "В очереди",
  processing: "Выполняется",
  succeeded: "Завершён",
  partial: "Завершён с ошибками",
  failed: "Ошибка",
};
export const EVENT_TYPE = {
  formed: "Формирование",
  changed: "Изменение",
  split: "Разделение",
  merge: "Объединение",
  created: "Создание статьи",
  version: "Новая версия",
  published: "Публикация",
  unpublished: "Снятие с публикации",
};
export type CreationLocation = {
  screen: "table" | "cluster" | "article" | "versions" | "history" | "settings";
  id: string | null;
  historyTab: "runs" | "clusters" | "articles";
  version: number | null;
  clusterContext: string | null;
};
export function creationLocation(params: URLSearchParams): CreationLocation {
  const screen = params.get("creation"),
    tab = params.get("contentHistory");
  return {
    screen:
      screen &&
      [
        "table",
        "cluster",
        "article",
        "versions",
        "history",
        "settings",
      ].includes(screen)
        ? (screen as CreationLocation["screen"])
        : "table",
    id: params.get("contentId"),
    historyTab: tab === "clusters" || tab === "articles" ? tab : "runs",
    version: Number(params.get("contentVersion")) || null,
    clusterContext: params.get("clusterContext"),
  };
}
export function platformRows(
  cluster: Cluster,
  data: Pick<Overview, "settings" | "articles" | "sites">,
) {
  const ids = [
    ...new Set([
      ...data.settings.platforms.map((p) => p.siteId),
      ...data.articles
        .filter((a) => a.cluster_id === cluster.id)
        .map((a) => a.site_id),
    ]),
  ];
  return ids.map((siteId) => ({
    siteId,
    name:
      data.sites.find((s) => s.id === siteId)?.name ?? "Отключённая площадка",
    article:
      data.articles.find(
        (a) => a.cluster_id === cluster.id && a.site_id === siteId,
      ) ?? null,
  }));
}
export function filterClusters(
  data: Overview,
  search: string,
  direction: string,
  status: string,
  recommendation: string,
) {
  const needle = search.trim().toLocaleLowerCase();
  return data.clusters.filter((c) => {
    const rows = platformRows(c, data);
    const text = [
      c.number,
      c.title,
      c.direction,
      ...c.queries.map((q) => q.text),
      ...rows.flatMap((r) => [
        r.name,
        r.article?.title ?? "",
        r.article?.rationale ?? "",
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return (
      (!needle || text.includes(needle)) &&
      (!direction || c.direction === direction) &&
      ((!status && !recommendation) ||
        rows.some(
          (r) =>
            (!status || (r.article?.status ?? "missing") === status) &&
            (!recommendation ||
              (r.article?.recommendation ?? "create") === recommendation),
        ))
    );
  });
}
export function launchClusters(clusters: Cluster[], selected: string[]) {
  return clusters.filter(
    (c) => !c.archived && (!selected.length || selected.includes(c.id)),
  );
}
export function unpublishedChanges(
  article: Pick<
    CreatedArticle,
    "status" | "current_number" | "published_number"
  >,
) {
  return (
    article.status === "published" &&
    article.current_number !== article.published_number
  );
}
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(valueText).join("\n");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.blocks) return valueText(o.blocks);
    if (o.type === "image")
      return `Изображение: ${o.alt ?? o.mediaId}\n${o.caption ?? ""}`;
    if (o.text !== undefined) return String(o.text);
    if (o.items) return valueText(o.items);
    return Object.entries(o)
      .map(([key, val]) => `${key}: ${valueText(val)}`)
      .join("\n");
  }
  return String(value);
}
