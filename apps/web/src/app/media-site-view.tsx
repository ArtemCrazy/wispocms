"use client";

type MediaSiteTarget =
  | "templates"
  | "homepage"
  | "articles"
  | "layout"
  | "404"
  | "privacy-policy"
  | "banners"
  | "variables";

export function MediaSiteView({
  siteName,
  onOpen,
}: {
  siteName?: string;
  onOpen: (target: MediaSiteTarget) => void;
}) {
  const cards: Array<{
    id: "templates" | "banners" | "variables";
    icon: "template" | "banners" | "company-data";
    title: string;
    description: string;
  }> = [
    {
      id: "templates",
      icon: "template",
      title: "Шаблоны",
      description: "Страницы, общие области и системные шаблоны сайта.",
    },
    {
      id: "banners",
      icon: "banners",
      title: "Библиотека баннеров",
      description: "Единая библиотека баннеров без привязки к месту показа.",
    },
    {
      id: "variables",
      icon: "company-data",
      title: "Библиотека переменных",
      description: "Повторно используемые значения для шаблонов и контента.",
    },
  ];

  const templates: Array<[MediaSiteTarget, string, string]> = [
    ["homepage", "Главная", "Баннеры, SEO и история страницы"],
    ["articles", "Статьи", "Материалы, категории и авторы"],
    ["layout", "Шапка и подвал", "Общие области и настройки поиска"],
    ["404", "404", "Системная страница и её SEO"],
    ["privacy-policy", "ПК", "Юридический текст сайта"],
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
