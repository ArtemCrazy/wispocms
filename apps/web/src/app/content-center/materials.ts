export const SOURCE_CATEGORIES = [
  {
    id: "site",
    label: "Сайты",
    hint: "Основной сайт, лендинги и другие сайты компании",
  },
  {
    id: "social",
    label: "Социальные сети",
    hint: "ВКонтакте, Telegram, YouTube, Instagram",
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
  mode?: "main-pages" | "single-page" | "provided" | "social-feed";
  sourceId: string;
  title: string;
  checkedAt: string;
  warnings: string[];
  coverage?: {
    state: "finished" | "partial";
    checkedPages: number;
    pendingPages: number;
    pendingSitemaps: number;
    reasons: string[];
    selected: number;
    read: number;
    unread: number;
    sections: Array<{
      title: string;
      found: number;
      read: number;
      unread: number;
    }>;
  };
  pages: Array<{
    url: string;
    title: string;
    status: "found" | "loaded" | "failed" | "duplicate" | "pending";
    content?: string;
    error?: string;
    reason?: string;
    duplicateOf?: string;
    transcript?: string;
    transcriptStatus?: "queued" | "processing" | "succeeded" | "failed";
    transcriptError?: string;
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
  collection_run?: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    error: string | null;
    progress?: { message: string } | null;
  } | null;
};
export const FILE_ACCEPT =
  ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md,.csv";

export function displayMaterialUrl(value: string | null | undefined): string {
  return (value ?? "").replace(/^https:\/\//i, "");
}

export function displaySourceChipUrl(
  value: string | null | undefined,
): string {
  try {
    const url = new URL(value ?? "");
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
        url.hostname,
      ) &&
      /^\/@[^/]+$/.test(path)
    )
      return path.slice(1);
  } catch {
    // Older or malformed values keep the regular compact representation.
  }
  return displayMaterialUrl(value);
}

/** HTTPS is implicit only when no explicit scheme was supplied. */
export function materialSourceUrl(value: string): string {
  const input = value.trim();
  const address = /^[a-z][a-z\d+.-]*:/i.test(input)
    ? input
    : `https://${input}`;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Введите адрес сайта, например example.ru.");
  }
  if (
    !input ||
    /[\s\\]/.test(input) ||
    input.startsWith("/") ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".")
  )
    throw new Error(
      "Укажите публичный HTTPS-адрес без логина, пароля и номера порта.",
    );
  return address;
}
export function isVkMaterial(
  material: Pick<ProjectMaterial, "kind" | "url_category" | "source_url">,
): boolean {
  if (material.kind !== "url" || material.url_category !== "social")
    return false;
  try {
    return [
      "vk.com",
      "www.vk.com",
      "m.vk.com",
      "vk.ru",
      "www.vk.ru",
      "m.vk.ru",
    ].includes(new URL(material.source_url ?? "").hostname);
  } catch {
    return false;
  }
}
export function fileSize(bytes: number | null) {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  return `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ${bytes < 1048576 ? "КБ" : "МБ"}`;
}

export function isTelegramMaterial(
  material: Pick<ProjectMaterial, "kind" | "url_category" | "source_url">,
): boolean {
  if (material.kind !== "url" || material.url_category !== "social")
    return false;
  try {
    return ["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(
      new URL(material.source_url ?? "").hostname,
    );
  } catch {
    return false;
  }
}

export function isSocialFeedMaterial(
  material: Pick<ProjectMaterial, "kind" | "url_category" | "source_url">,
): boolean {
  return (
    isVkMaterial(material) ||
    isTelegramMaterial(material) ||
    isApiSocialMaterial(material, "youtube") ||
    isApiSocialMaterial(material, "instagram")
  );
}

export function isApiSocialMaterial(
  material: Pick<ProjectMaterial, "kind" | "url_category" | "source_url">,
  network: "youtube" | "instagram",
): boolean {
  if (material.kind !== "url" || material.url_category !== "social")
    return false;
  try {
    const host = new URL(material.source_url ?? "").hostname;
    return (
      network === "instagram"
        ? ["instagram.com", "www.instagram.com"]
        : ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]
    ).includes(host);
  } catch {
    return false;
  }
}

export function socialIconNetwork(
  material: Pick<ProjectMaterial, "kind" | "url_category" | "source_url">,
): "vk" | "telegram" | "youtube" | "instagram" | null {
  if (isVkMaterial(material)) return "vk";
  if (isTelegramMaterial(material)) return "telegram";
  if (isApiSocialMaterial(material, "instagram")) return "instagram";
  if (material.kind !== "url" || material.url_category !== "social")
    return null;
  try {
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(new URL(material.source_url ?? "").hostname)
      ? "youtube"
      : null;
  } catch {
    return null;
  }
}
