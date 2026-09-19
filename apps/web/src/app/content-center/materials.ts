export const SOURCE_CATEGORIES = [
  {
    id: "site",
    label: "Сайты",
    hint: "Основной сайт, лендинги и другие сайты компании",
  },
  {
    id: "social",
    label: "Социальные сети",
    hint: "ВКонтакте, Telegram, YouTube и другие",
  },
  {
    id: "maps",
    label: "Карты и отзывы",
    hint: "Яндекс Карты, 2ГИС, Google Maps",
  },
  {
    id: "marketplace",
    label: "Маркетплейсы",
    hint: "Ozon, Wildberries, Яндекс Маркет",
  },
  {
    id: "advertising",
    label: "Рекламные площадки",
    hint: "Публичные страницы рекламных площадок",
  },
  {
    id: "other",
    label: "Другие источники",
    hint: "Другие публичные онлайн-ресурсы проекта",
  },
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number]["id"];
export type SourceSnapshot = {
  sourceId: string;
  title: string;
  checkedAt: string;
  warnings: string[];
  pages: Array<{
    url: string;
    title: string;
    status: "found" | "loaded" | "failed" | "duplicate";
    content?: string;
    error?: string;
    reason?: string;
    duplicateOf?: string;
  }>;
};
export type ProjectMaterial = {
  id: string;
  title: string;
  kind: "text" | "file" | "url";
  source_url: string | null;
  file_name: string | null;
  content?: string;
  revision: number;
  characters: number;
  updated_at: string;
  created_at: string;
  url_category: SourceCategory;
  file_size: number | null;
  media_type: string | null;
  has_original: boolean;
  source_error: string | null;
  site_checked_at?: string | null;
  site_pages?: SourceSnapshot | null;
};
export const FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md,.csv";
export function fileSize(bytes: number | null) {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ${bytes < 1048576 ? "КБ" : "МБ"}`;
}
