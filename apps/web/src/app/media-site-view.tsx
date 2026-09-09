"use client";

type MediaSiteTarget =
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
    title: string;
    description: string;
  }> = [
    {
      id: "templates",
      title: "Шаблоны",
      description: "Страницы, общие области и системные шаблоны сайта.",
    },
    {
      id: "banners",
      title: "Баннеры",
      description: "Единая библиотека баннеров без привязки к месту показа.",
    },
    {
      id: "variables",
      title: "Переменные",
      description: "Повторно используемые значения для шаблонов и контента.",
    },
  ];

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
          <article className="media-site-card" key={card.id}>
            <div>
              <small>
                {card.id === "templates" ? "СТРУКТУРА" : "БИБЛИОТЕКА"}
              </small>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
            {card.id === "templates" ? (
              <div className="media-template-links">
                {templates.map(([target, label, hint]) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => onOpen(target)}
                  >
                    <span>{label}</span>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            ) : (
              <button
                className="media-card-open"
                type="button"
                onClick={() =>
                  onOpen(card.id === "banners" ? "banners" : "variables")
                }
              >
                Открыть
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
