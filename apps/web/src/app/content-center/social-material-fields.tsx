import styles from "./content-center-view.module.css";
import { SocialIcon } from "./social-icon";
import { materialSourceUrl } from "./materials";

export const SOCIAL_NETWORKS = [
  {
    id: "vk",
    label: "ВКонтакте",
    placeholder: "vk.com/community",
    hint: "Для сбора нужно общее подключение VK в настройках CMS — ключ заказчика не нужен.",
  },
  {
    id: "telegram",
    label: "Telegram",
    placeholder: "t.me/channel",
    hint: "Публичный канал: до 100 последних доступных публикаций без ограничения по давности. Без бота и ключей.",
  },
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "youtube.com/@channel",
    hint: "До 100 последних видео: названия, описания и даты. Без просмотра видео и субтитров. Используется общий ключ CMS.",
  },
  {
    id: "instagram",
    label: "Instagram",
    placeholder: "instagram.com/profile",
    hint: "Подписи к 100 последним публикациям. После сохранения подключите профессиональный аккаунт владельца через Instagram.",
  },
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["id"] | "other";

export function socialNetworkForUrl(value: string): SocialNetwork {
  try {
    const host = new URL(materialSourceUrl(value)).hostname;
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
    if (["instagram.com", "www.instagram.com"].includes(host))
      return "instagram";
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
  const address = materialSourceUrl(value);
  let url: URL;
  try {
    url = new URL(address);
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
  if (
    network === "telegram" &&
    (!/^\/(?:s\/)?[a-zA-Z][a-zA-Z0-9_]{3,31}\/?$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      /^\/(?:s\/)?(joinchat|share|proxy|socks|addstickers|addemoji|login|iv|boost|contact)\/?$/i.test(
        url.pathname,
      ))
  )
    throw new Error(
      "Укажите ссылку на публичный Telegram-канал, не на отдельный пост или приглашение.",
    );
  if (
    network === "instagram" &&
    (url.search ||
      url.hash ||
      !/^\/[a-zA-Z0-9_.]{1,30}\/?$/.test(url.pathname) ||
      /^\/(p|reel|reels|stories|explore|accounts|direct|about|developer|developers|legal|web)\/?$/i.test(
        url.pathname,
      ))
  )
    throw new Error("Укажите профиль Instagram, а не отдельную публикацию.");
  if (
    network === "youtube" &&
    (url.hostname === "youtu.be" ||
      url.search ||
      url.hash ||
      !/^\/(?:@[^/\s?#]{3,100}|channel\/UC[\w-]{22}|user\/[a-zA-Z0-9_.-]{1,100})\/?$/u.test(
        decodeURIComponent(url.pathname),
      ))
  )
    throw new Error(
      "Укажите канал YouTube: youtube.com/@имя или youtube.com/channel/UC….",
    );
  return address;
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
            <SocialIcon network={item.id} />
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
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={2048}
          value={sourceUrl}
          placeholder={selected?.placeholder ?? "example.ru/profile"}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className={styles.muted}>
        {selected?.hint ?? "Сохранённая ссылка. Текст можно добавить отдельно."}
      </p>
    </>
  );
}
