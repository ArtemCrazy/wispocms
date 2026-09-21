import styles from "./content-center-view.module.css";
import { isYandexMapsMaterial, materialSourceUrl } from "./materials";
import { MapIcon } from "./social-icon";

export const MAP_PROVIDERS = [
  {
    id: "yandex",
    label: "Яндекс Карты",
    placeholder: "yandex.ru/profile/84036619207",
    hint: "Публичная карточка без входа и API: обзор, отзывы, товары и услуги, график и особенности.",
  },
  {
    id: "2gis",
    label: "2ГИС",
    placeholder: "2gis.ru/moscow/firm/…",
    hint: "Публичная ссылка на карточку организации 2ГИС. Доступный текст страницы будет собран без входа.",
  },
  {
    id: "google",
    label: "Google Maps",
    placeholder: "google.com/maps/place/…",
    hint: "Публичная ссылка на карточку организации Google Maps. Доступный текст страницы будет собран без входа.",
  },
] as const;

export type MapProvider = (typeof MAP_PROVIDERS)[number]["id"] | "other";

const YANDEX_HOSTS = new Set([
  "yandex.ru",
  "www.yandex.ru",
  "yandex.com",
  "www.yandex.com",
  "yandex.com.tr",
  "www.yandex.com.tr",
  "maps.yandex.ru",
]);
const TWO_GIS_HOST = /(?:^|\.)2gis\.(?:ru|com|kz|uz|ge|ae|by)$/i;
const GOOGLE_HOST = /(?:^|\.)google\.[a-z.]{2,}$/i;

function isGoogleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return (
    host === "maps.app.goo.gl" ||
    (host === "goo.gl" && /^\/maps(?:\/|$)/i.test(url.pathname)) ||
    (GOOGLE_HOST.test(host) &&
      (host.startsWith("maps.") || /^\/maps(?:\/|$)/i.test(url.pathname)))
  );
}

export function mapProviderForUrl(value: string): MapProvider {
  try {
    const url = new URL(materialSourceUrl(value));
    if (
      YANDEX_HOSTS.has(url.hostname.toLowerCase()) &&
      isYandexMapsMaterial({
        url_category: "maps",
        source_url: url.href,
      })
    )
      return "yandex";
    if (TWO_GIS_HOST.test(url.hostname)) return "2gis";
    if (isGoogleMapsUrl(url)) return "google";
  } catch {
    /* Incomplete address stays in the draft until submission. */
  }
  return "other";
}

export function mapSourceUrl(value: string, provider: MapProvider): string {
  const address = materialSourceUrl(value);
  const url = new URL(address);
  if (provider !== "other" && mapProviderForUrl(address) !== provider) {
    const label = MAP_PROVIDERS.find((item) => item.id === provider)!.label;
    throw new Error(`Укажите ссылку ${label} или выберите другую карту.`);
  }
  if (provider === "yandex" && url.search) {
    // Tracking parameters are harmless, but preserve the original public card URL.
    return address;
  }
  return address;
}

export function MapMaterialFields({
  provider,
  sourceUrl,
  onProviderChange,
  onChange,
}: {
  provider: MapProvider;
  sourceUrl: string;
  onProviderChange: (provider: MapProvider) => void;
  onChange: (value: string) => void;
}) {
  const selected = MAP_PROVIDERS.find((item) => item.id === provider);
  return (
    <>
      <div
        className={styles.sourceFilters}
        role="group"
        aria-label="Карточка на карте"
      >
        {MAP_PROVIDERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={provider === item.id}
            onClick={() => onProviderChange(item.id)}
          >
            <MapIcon provider={item.id} />
            {item.label}
          </button>
        ))}
        {provider === "other" && (
          <button type="button" aria-pressed>
            Другая карта
          </button>
        )}
      </div>
      <div className={styles.field}>
        <input
          autoFocus
          aria-label={`Ссылка ${selected?.label ?? "на карту"}`}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={2048}
          value={sourceUrl}
          placeholder={selected?.placeholder ?? "example.ru/organization"}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className={styles.muted}>
        {selected?.hint ??
          "Сохранённая публичная ссылка. Текст можно добавить отдельно."}
      </p>
    </>
  );
}
