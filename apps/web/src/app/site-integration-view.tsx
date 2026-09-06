"use client";

import { useState } from "react";

type SiteType = "media" | "corporate" | "landing";

const typeDescriptions: Record<SiteType, string> = {
  media: "статьи, рубрики, авторы, страницы, баннеры и общие данные",
  corporate: "страницы, услуги, блог, баннеры и общие данные компании",
  landing: "структура посадочной страницы, медиа, контакты и SEO",
};

export function SiteIntegrationView({
  siteName,
  siteSlug,
  siteType,
}: {
  siteName?: string;
  siteSlug?: string;
  siteType?: SiteType;
}) {
  const [copied, setCopied] = useState("");
  if (!siteSlug || !siteType) return null;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const publicBase = `${origin}/api/public/sites/${siteSlug}`;
  const endpoints = [
    {
      label: "Интеграционный манифест",
      method: "GET",
      path: `${publicBase}/manifest`,
      description: "Версия контракта, доступные модули, поля и маршруты сайта.",
    },
    {
      label: "Данные сайта",
      method: "GET",
      path: publicBase,
      description: "Настройки, страницы, статьи и баннеры одним ответом.",
    },
    {
      label: "Отдельная статья",
      method: "GET",
      path: `${publicBase}/articles/{articleSlug}`,
      description: "Материал, SEO-данные и связанные публикации.",
    },
    {
      label: "Отдельная страница",
      method: "GET",
      path: `${publicBase}/pages/{pageSlug}`,
      description: "Опубликованные блоки выбранной страницы.",
    },
    {
      label: "Поиск по сайту",
      method: "GET",
      path: `${publicBase}/search?q={query}`,
      description: "Поиск по опубликованным страницам и статьям сайта.",
    },
    {
      label: "Изображение",
      method: "GET",
      path: `${publicBase}/media/{mediaId}`,
      description: "Опубликованный файл из медиатеки сайта.",
    },
    {
      label: "Форма заявки",
      method: "POST",
      path: `${publicBase}/contact`,
      description: "Отправка базовой формы на почту из настроек сайта.",
    },
  ];
  const example = `const response = await fetch("${publicBase}", {
  cache: "no-store",
});

if (!response.ok) throw new Error("CMS unavailable");

const { site, pages, articles, banners } = await response.json();`;

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("error");
    }
  }

  return (
    <section className="integration-view">
      <header className="integration-head">
        <div>
          <small>ДЛЯ РАЗРАБОТЧИКА</small>
          <h1>Подключение шаблона</h1>
          <p>Контракт между CMS и версткой сайта «{siteName ?? siteSlug}».</p>
        </div>
        <a href={`/preview/${siteSlug}`} target="_blank" rel="noreferrer">
          Открыть встроенный пример ↗
        </a>
      </header>

      <div className="integration-principle">
        <article>
          <b>1</b>
          <span>
            <strong>Верстка живёт отдельно</strong>
            <small>HTML, React или Vue остаются в проекте самого сайта.</small>
          </span>
        </article>
        <article>
          <b>2</b>
          <span>
            <strong>CMS хранит данные</strong>
            <small>Для этого типа доступны {typeDescriptions[siteType]}.</small>
          </span>
        </article>
        <article>
          <b>3</b>
          <span>
            <strong>Шаблон получает JSON</strong>
            <small>
              Сайт запрашивает опубликованные данные при SSR-рендеринге.
            </small>
          </span>
        </article>
      </div>

      <div className="integration-grid">
        <section className="integration-panel">
          <header>
            <div>
              <small>ПУБЛИЧНЫЙ API</small>
              <h2>Готовые адреса</h2>
            </div>
            <button onClick={() => void copy(publicBase, "base")}>
              {copied === "base" ? "Скопировано ✓" : "Скопировать основной"}
            </button>
          </header>
          <div className="integration-endpoints">
            {endpoints.map((endpoint) => (
              <article key={endpoint.label}>
                <span
                  className={`integration-method ${endpoint.method.toLowerCase()}`}
                >
                  {endpoint.method}
                </span>
                <div>
                  <strong>{endpoint.label}</strong>
                  <code>{endpoint.path}</code>
                  <small>{endpoint.description}</small>
                </div>
                <button
                  aria-label={`Скопировать ${endpoint.label}`}
                  title="Скопировать адрес"
                  onClick={() => void copy(endpoint.path, endpoint.label)}
                >
                  {copied === endpoint.label ? "✓" : "⧉"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="integration-panel integration-code-panel">
          <header>
            <div>
              <small>ПРИМЕР SSR</small>
              <h2>Получение данных</h2>
            </div>
            <button onClick={() => void copy(example, "code")}>
              {copied === "code" ? "Скопировано ✓" : "Копировать код"}
            </button>
          </header>
          <pre>
            <code>{example}</code>
          </pre>
          <div className="integration-note">
            <strong>Контракт версии 1.0</strong>
            <p>
              В CMS не вставляется произвольный HTML или JavaScript. Разработчик
              сначала получает манифест, связывает поля шаблона с доступными
              модулями API, а контент-менеджер затем меняет только понятные
              данные и блоки.
            </p>
          </div>
        </section>
      </div>

      {copied === "error" ? (
        <div className="inline-message" role="status">
          Не удалось скопировать автоматически — выделите адрес вручную.
        </div>
      ) : null}
    </section>
  );
}
