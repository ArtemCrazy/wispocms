import styles from "./content-center-view.module.css";

export const SOCIAL_NETWORKS = [
  {
    id: "vk",
    label: "ВКонтакте",
    placeholder: "https://vk.com/community",
    hint: "После сохранения подключите сообщество ключом администратора VK.",
  },
  {
    id: "telegram",
    label: "Telegram",
    placeholder: "https://t.me/channel",
    hint: "Автоматический сбор Telegram пока не подключён. Можно сохранить ссылку и добавить текст отдельно.",
  },
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "https://www.youtube.com/@channel",
    hint: "Автоматический сбор YouTube пока не подключён. Можно сохранить ссылку и добавить текст отдельно.",
  },
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["id"] | "other";

export function socialNetworkForUrl(value: string): SocialNetwork {
  try {
    const host = new URL(value.trim()).hostname;
    if (
      [
        "vk.com",
        "www.vk.com",
        "m.vk.com",
        "vk.ru",
        "www.vk.ru",
        "m.vk.ru",
      ].includes(host)
    )
      return "vk";
    if (["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(host))
      return "telegram";
    if (
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        host,
      )
    )
      return "youtube";
  } catch {
    /* Incomplete address stays in the draft until submission. */
  }
  return "other";
}

export function socialSourceUrl(value: string, network: SocialNetwork): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Введите HTTPS-ссылку на выбранную социальную сеть.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Введите HTTPS-ссылку без логина, пароля и номера порта.");
  if (network !== "other" && socialNetworkForUrl(value) !== network) {
    const label = SOCIAL_NETWORKS.find((item) => item.id === network)!.label;
    throw new Error(
      `Укажите ссылку ${label} или выберите другую социальную сеть.`,
    );
  }
  return value.trim();
}

export function SocialMaterialFields({
  network,
  sourceUrl,
  onNetworkChange,
  onChange,
}: {
  network: SocialNetwork;
  sourceUrl: string;
  onNetworkChange: (network: SocialNetwork) => void;
  onChange: (value: string) => void;
}) {
  const selected = SOCIAL_NETWORKS.find((item) => item.id === network);
  return (
    <>
      <div
        className={styles.sourceFilters}
        role="group"
        aria-label="Социальная сеть"
      >
        {SOCIAL_NETWORKS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={network === item.id}
            onClick={() => onNetworkChange(item.id)}
          >
            {item.label}
          </button>
        ))}
        {network === "other" && (
          <button type="button" aria-pressed>
            Другая сеть
          </button>
        )}
      </div>
      <div className={styles.field}>
        <input
          autoFocus
          aria-label={`Ссылка ${selected?.label ?? "на социальную сеть"}`}
          type="url"
          required
          maxLength={2048}
          value={sourceUrl}
          placeholder={selected?.placeholder ?? "https://example.ru/profile"}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className={styles.muted}>
        {selected?.hint ?? "Сохранённая ссылка. Текст можно добавить отдельно."}
      </p>
    </>
  );
}
