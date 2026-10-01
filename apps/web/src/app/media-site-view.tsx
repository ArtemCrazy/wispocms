"use client";

type MediaSiteTarget =
  | "templates"
  | "homepage"
  | "articles"
  | "layout"
  | "404"
  | "privacy-policy"
  | "banners"
  | "variables"
  | "media";

export function MediaSiteView({
  siteName,
  onOpen,
  showBanners = true,
  showTemplates = true,
}: {
  siteName?: string;
  onOpen: (target: MediaSiteTarget) => void;
  showBanners?: boolean;
  showTemplates?: boolean;
}) {
  const cards = (
    [
      {
        id: "templates",
        icon: "template",
        title: "Шаблоны и чанки",
        description: "Страницы, общие области и системные шаблоны сайта.",
      },
      {
        id: "variables",
        icon: "company-data",
        title: "Переменные",
        description: "Повторно используемые значения для шаблонов и контента.",
      },
      {
        id: "banners",
        icon: "banners",
        title: "Баннеры",
        description: "Единая библиотека баннеров без привязки к месту показа.",
      },
      {
        id: "media",
        icon: "content-center",
        title: "Медиатека",
        description: "Изображения и файлы, используемые на страницах сайта.",
      },
    ] satisfies Array<{
      id: "templates" | "banners" | "variables" | "media";
      icon: "template" | "banners" | "company-data" | "content-center";
      title: string;
      description: string;
    }>
  ).filter(
    (card) =>
      (card.id !== "banners" || showBanners) &&
      (card.id !== "templates" || showTemplates),
  );

  const templates: Array<[MediaSiteTarget, string, string]> = [
    ["homepage", "Главная", "Баннеры, SEO и история страницы"],
    ["articles", "Статьи", "Материалы, категории и авторы"],
    ["layout", "Шапка и подвал", "Общие области и настройки поиска"],
    ["404", "404", "Системная страница и её SEO"],
    ["privacy-policy", "Политика", "Юридический текст сайта"],
  ];

  return (
    <section className="media-module-shell media-site-root">
      <header className="media-module-heading">
        <div>
          <small>MEDIA</small>
          <h1>Сайт</h1>
        </div>
        <p>
          {siteName
            ? `Структура и общие ресурсы сайта «${siteName}».`
            : "Структура и общие ресурсы сайта."}
        </p>
      </header>

      <div className="media-site-cards">
        {cards.map((card) => (
          <button
            aria-label={`Открыть раздел «${card.title}»`}
            className="media-site-card"
            key={card.id}
            type="button"
            onClick={() => onOpen(card.id)}
          >
            <span className="media-site-card-icon" aria-hidden="true">
              <i className={`site-system-icon ${card.icon}`} />
            </span>
            <span className="media-site-card-copy">
              <strong>{card.title}</strong>
              <span>{card.description}</span>
            </span>
            {card.id === "templates" ? (
              <span className="media-template-summary">
                {templates.map(([, label]) => label).join(" · ")}
              </span>
            ) : null}
            <span className="media-site-card-action">
              Открыть
              <i className="weeek-icon weeek-icon-chevron" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
