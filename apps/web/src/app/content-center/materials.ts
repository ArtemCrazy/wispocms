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
    label: "Материалы проекта",
    hint: "Файлы, тексты и дополнительные ссылки · до 10 МБ на файл",
  },
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number]["id"];
export type YandexMapCard = {
  provider: "yandex";
  organizationId: string | null;
  title: string;
  address: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  phone: string | null;
  website: string | null;
  image: string | null;
  rating: number | null;
  reviewCount: number | null;
  ratingCount: number | null;
  categories: string[];
  openingHours: string[];
  reviews: Array<{
    author: string;
    rating: number | null;
    date: string | null;
    text: string;
    url: string | null;
  }>;
  products: Array<{
    title: string;
    description: string;
    price: string | null;
    volume: string | null;
  }>;
  features: string[];
  sourceUrl: string;
};
export type TwoGisMapCard = Omit<YandexMapCard, "provider" | "reviews"> & {
  provider: "2gis";
  reviews: Array<YandexMapCard["reviews"][number] & { officialAnswer?: string | null }>;
};
export type GoogleMapCard = Omit<YandexMapCard, "provider"> & {
  provider: "google";
};
export type MapCard = YandexMapCard | TwoGisMapCard | GoogleMapCard;
export type SourceSnapshot = {
  mode?:
    | "main-pages"
    | "single-page"
    | "provided"
    | "social-feed"
    | "map-card";
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
  map?: MapCard;
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

/** Compact format tiles use the same labels and colors as Crazy CRM materials. */
export function materialFileBadge(
  fileName: string | null,
  kind: "file" | "text",
  mediaType?: string | null,
) {
  const extension = fileName?.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? "";
  const mime = mediaType?.toLowerCase() ?? "";
  if (kind === "text") return { label: "TXT", color: "#64748B" };
  if (["doc", "docx", "odt", "rtf"].includes(extension) || /wordprocessingml|msword/.test(mime)) {
    return { label: "DOC", color: "#2B579A" };
  }
  if (["xls", "xlsx", "ods", "csv"].includes(extension) || /spreadsheetml|ms-excel|text\/csv/.test(mime)) {
    return { label: "XLS", color: "#1D6F42" };
  }
  if (["ppt", "pptx", "odp"].includes(extension) || /presentationml|ms-powerpoint/.test(mime)) {
    return { label: "PPT", color: "#D24726" };
  }
  if (extension === "pdf" || mime === "application/pdf") {
    return { label: "PDF", color: "#D93832" };
  }
  if (["png", "jpg", "jpeg"].includes(extension) || mime.startsWith("image/")) {
    return { label: "IMG", color: "#7C5BD7" };
  }
  if (extension === "md") return { label: "MD", color: "#595F8E" };
  if (extension === "txt" || mime === "text/plain") return { label: "TXT", color: "#64748B" };
  return { label: "FILE", color: "#737373" };
}

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

/**
 * Map cards are identified by their public numeric organization ID. Keep the
 * full URL in the material and use this compact label only in the source chip.
 * Google Maps links without a numeric `cid` keep their compact URL because
 * place URLs do not always expose a stable numeric identifier.
 */
export function displayMapSourceId(
  value: string | null | undefined,
): string {
  try {
    const url = new URL(materialSourceUrl(value ?? ""));
    const path = decodeURIComponent(url.pathname);
    const host = url.hostname.toLowerCase();

    if (
      [
        "yandex.ru",
        "www.yandex.ru",
        "yandex.com",
        "www.yandex.com",
        "yandex.com.tr",
        "www.yandex.com.tr",
        "maps.yandex.ru",
      ].includes(host)
    ) {
      const match = path.match(
        /^\/(?:profile\/(?:org\/[^/]+\/)?|(?:maps\/)?org\/[^/]+\/)(\d+)(?:\/|$)/i,
      );
      if (match) return match[1];
    }

    if (/(?:^|\.)2gis\.(?:ru|com|kz|uz|ge|ae|by)$/i.test(host)) {
      const match = path.match(/\/firm\/(\d+)(?:\/|$)/i);
      if (match) return match[1];
    }

    if (/(?:^|\.)google\.[a-z.]{2,}$/i.test(host)) {
      const cid = url.searchParams.get("cid");
      if (cid && /^\d+$/.test(cid)) return cid;
    }
  } catch {
    // Older or malformed values keep the regular compact representation.
  }
  return displayMaterialUrl(value);
}

export function isYandexMapsMaterial(material: {
  url_category: string;
  source_url: string | null | undefined;
}) {
  if (material.url_category !== "maps") return false;
  try {
    const url = new URL(material.source_url ?? "");
    return (
      url.protocol === "https:" &&
      [
        "yandex.ru",
        "www.yandex.ru",
        "yandex.com",
        "www.yandex.com",
        "yandex.com.tr",
        "www.yandex.com.tr",
        "maps.yandex.ru",
      ].includes(url.hostname.toLowerCase()) &&
      (/^\/profile\/\d+\/?$/i.test(url.pathname) ||
        /^\/profile\/org\/[^/]+\/\d+(?:\/[^/]*)*\/?$/i.test(url.pathname) ||
        /^\/(?:maps\/)?org\/[^/]+\/\d+(?:\/[^/]*)*\/?$/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

export function isTwoGisMapsMaterial(material: {
  url_category: string;
  source_url: string | null | undefined;
}) {
  if (material.url_category !== "maps") return false;
  try {
    const url = new URL(material.source_url ?? "");
    return (
      url.protocol === "https:" &&
      [
        "2gis.ru",
        "www.2gis.ru",
        "2gis.com",
        "www.2gis.com",
        "2gis.kz",
        "www.2gis.kz",
        "2gis.uz",
        "www.2gis.uz",
        "2gis.ge",
        "www.2gis.ge",
        "2gis.ae",
        "www.2gis.ae",
        "2gis.by",
        "www.2gis.by",
      ].includes(url.hostname.toLowerCase()) &&
      /^\/[^/]+\/firm\/\d+(?:\/tab\/(?:info|reviews|prices|questions))?\/?$/i.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

export function isGoogleMapsMaterial(material: {
  url_category: string;
  source_url: string | null | undefined;
}) {
  if (material.url_category !== "maps") return false;
  try {
    const url = new URL(material.source_url ?? "");
    const host = url.hostname.toLowerCase();
    const googleHost =
      [
        "google.com",
        "www.google.com",
        "maps.google.com",
        "google.ru",
        "www.google.ru",
        "maps.google.ru",
        "maps.app.goo.gl",
        "goo.gl",
      ].includes(host) ||
      /^(?:www\.|maps\.)?google\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(host);
    return (
      url.protocol === "https:" &&
      googleHost &&
      (/^\/maps\/(?:place|search)(?:\/|$)/i.test(url.pathname) ||
        (/^\/maps\/?$/i.test(url.pathname) && url.searchParams.has("cid")))
    );
  } catch {
    return false;
  }
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
