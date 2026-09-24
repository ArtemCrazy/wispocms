import styles from "./content-center-view.module.css";
import { MarketplaceIcon } from "./social-icon";
import { materialSourceUrl } from "./materials";

export const MARKETPLACES = [
  {
    id: "ozon",
    label: "Ozon",
    placeholder: "ozon.ru/seller/nonton/",
  },
  {
    id: "wildberries",
    label: "Wildberries",
    placeholder: "wildberries.ru/seller/…",
  },
  {
    id: "yandex-market",
    label: "Яндекс Маркет",
    placeholder: "market.yandex.ru/business/…",
  },
] as const;

export type Marketplace = (typeof MARKETPLACES)[number]["id"] | "other";

export function marketplaceForUrl(value: string): Marketplace {
  try {
    const host = new URL(materialSourceUrl(value)).hostname.toLowerCase();
    if (host === "ozon.ru" || host === "www.ozon.ru") return "ozon";
    if (host === "wildberries.ru" || host === "www.wildberries.ru")
      return "wildberries";
    if (host === "market.yandex.ru") return "yandex-market";
  } catch {
    // Keep incomplete links in the draft until the user saves it.
  }
  return "other";
}

export function marketplaceSourceUrl(value: string, marketplace: Marketplace) {
  const address = materialSourceUrl(value);
  if (marketplace !== "other" && marketplaceForUrl(address) !== marketplace) {
    const label = MARKETPLACES.find((item) => item.id === marketplace)!.label;
    throw new Error(`Укажите ссылку ${label} или выберите другой маркетплейс.`);
  }
  return address;
}

export function MarketplaceMaterialFields({
  marketplace,
  sourceUrl,
  onMarketplaceChange,
  onChange,
}: {
  marketplace: Marketplace;
  sourceUrl: string;
  onMarketplaceChange: (marketplace: Marketplace) => void;
  onChange: (value: string) => void;
}) {
  const selected = MARKETPLACES.find((item) => item.id === marketplace);
  return (
    <>
      <div className={styles.sourceFilters} role="group" aria-label="Маркетплейс">
        {MARKETPLACES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={marketplace === item.id}
            onClick={() => onMarketplaceChange(item.id)}
          >
            <MarketplaceIcon marketplace={item.id} />
            {item.label}
          </button>
        ))}
        {marketplace === "other" && (
          <button type="button" aria-pressed>
            Другой маркетплейс
          </button>
        )}
      </div>
      <div className={styles.field}>
        <input
          autoFocus
          aria-label={`Ссылка ${selected?.label ?? "на маркетплейс"}`}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={2048}
          value={sourceUrl}
          placeholder={selected?.placeholder ?? "example.ru/seller"}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className={styles.muted}>
        Добавьте публичную страницу магазина или бренда. Сохраним ссылку и
        попробуем прочитать доступные данные без входа; если площадка ограничит
        доступ, ссылка останется в материалах с предупреждением.
      </p>
    </>
  );
}
