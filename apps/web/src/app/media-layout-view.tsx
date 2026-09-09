"use client";

import { useCallback, useEffect, useState } from "react";
import { SiteLayoutView } from "./site-layout-view";

type SearchSettings = {
  searchableSections: string[];
  popularQueries: Array<{ id: string; query: string }>;
  recommendedQueries: Array<{ id: string; query: string }>;
  analyticsAvailable: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  return payload as T;
}

function SearchSettingsView({
  siteId,
  siteSlug,
  canEdit,
}: {
  siteId: string;
  siteSlug: string;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState<SearchSettings | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setSettings(await request(`/api/sites/${siteId}/content/search-settings`));
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function persist(next: SearchSettings) {
    if (!canEdit) return;
    try {
      setSettings(
        await request(`/api/sites/${siteId}/content/search-settings`, {
          method: "PATCH",
          body: JSON.stringify({
            searchableSections: next.searchableSections,
            popularQueries: next.popularQueries,
          }),
        }),
      );
      setMessage("Настройки поиска сохранены");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить настройки",
      );
    }
  }

  if (!settings)
    return (
      <div className="empty-media">
        <h2>Настройки поиска</h2>
        <p>{message || "Загружаем…"}</p>
      </div>
    );
  return (
    <section className="media-search-settings">
      <header>
        <div>
          <small>ПОИСК</small>
          <h2>Страница поиска</h2>
        </div>
        <a
          href={`/preview/${siteSlug}/search`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть поиск ↗
        </a>
      </header>
      {message ? <p className="inline-message">{message}</p> : null}
      <article className="media-editor-card">
        <h3>Область поиска</h3>
        {(
          [
            ["articles", "Статьи", "Раздел включён для Media по умолчанию"],
            ["pages", "Страницы", "Обычные опубликованные страницы"],
            ["categories", "Категории", "Опубликованные рубрики статей"],
          ] as const
        ).map(([section, label, hint]) => (
          <label className="item-seo-checkbox" key={section}>
            <input
              type="checkbox"
              checked={settings.searchableSections.includes(section)}
              disabled={!canEdit}
              onChange={(event) =>
                void persist({
                  ...settings,
                  searchableSections: event.target.checked
                    ? [...settings.searchableSections, section]
                    : settings.searchableSections.filter(
                        (item) => item !== section,
                      ),
                })
              }
            />
            <span>
              {label}
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </article>
      <article className="media-editor-card">
        <div className="media-card-title">
          <div>
            <h3>Популярные запросы</h3>
            <p>Ручной список и порядок подсказок.</p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() =>
                void persist({
                  ...settings,
                  popularQueries: [
                    ...settings.popularQueries,
                    { id: crypto.randomUUID(), query: "Новый запрос" },
                  ],
                })
              }
            >
              + Добавить
            </button>
          ) : null}
        </div>
        <div className="popular-query-list">
          {settings.popularQueries.map((item, index) => (
            <div key={item.id}>
              <input
                value={item.query}
                readOnly={!canEdit}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    popularQueries: settings.popularQueries.map((row) =>
                      row.id === item.id
                        ? { ...row, query: event.target.value }
                        : row,
                    ),
                  })
                }
                onBlur={() => void persist(settings)}
              />
              <button
                type="button"
                className="secondary"
                disabled={!canEdit || index === 0}
                onClick={() => {
                  const next = [...settings.popularQueries];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  void persist({ ...settings, popularQueries: next });
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  !canEdit || index === settings.popularQueries.length - 1
                }
                onClick={() => {
                  const next = [...settings.popularQueries];
                  [next[index + 1], next[index]] = [
                    next[index],
                    next[index + 1],
                  ];
                  void persist({ ...settings, popularQueries: next });
                }}
              >
                ↓
              </button>
              <button
                type="button"
                className="danger"
                disabled={!canEdit}
                onClick={() =>
                  void persist({
                    ...settings,
                    popularQueries: settings.popularQueries.filter(
                      (row) => row.id !== item.id,
                    ),
                  })
                }
              >
                Удалить
              </button>
            </div>
          ))}
          {!settings.popularQueries.length ? (
            <p>Ручных запросов пока нет.</p>
          ) : null}
        </div>
      </article>
      <article className="media-editor-card">
        <h3>Рекомендации из аналитики</h3>
        {!settings.analyticsAvailable ? (
          <p>
            Источник аналитики пока не подключён. Рекомендации появятся здесь
            после подключения; они сохраняются отдельно и добавляются в
            популярные только после подтверждения.
          </p>
        ) : null}
        {settings.recommendedQueries.map((item) => (
          <div key={item.id} className="media-card-title">
            <span>{item.query}</span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={async () => {
                setSettings(
                  await request(
                    `/api/sites/${siteId}/content/search-settings/recommendations/confirm`,
                    {
                      method: "POST",
                      body: JSON.stringify({ recommendationId: item.id }),
                    },
                  ),
                );
              }}
            >
              Добавить
            </button>
          </div>
        ))}
      </article>
      <article className="media-editor-card">
        <h3>История запросов</h3>
        <p>
          История станет доступна после подключения источника аналитики. CMS не
          имитирует данные посетителей и пока показывает честное пустое
          состояние.
        </p>
      </article>
    </section>
  );
}

export function MediaLayoutView({
  siteId,
  siteName,
  siteSlug,
  canEdit,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  canEdit: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<"header" | "footer" | "search">("header");
  if (!siteId) return <div className="empty-media">Выберите сайт.</div>;
  return (
    <section className="media-module-shell media-layout-shell">
      <header className="media-module-heading">
        <div>
          <small>ШАБЛОНЫ</small>
          <h1>Шапка и подвал</h1>
        </div>
        <p>Общие области сайта и настройки страницы поиска.</p>
      </header>
      <nav className="media-module-tabs" aria-label="Общие области">
        {(
          [
            ["header", "Шапка"],
            ["footer", "Подвал"],
            ["search", "Поиск"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "header" || tab === "footer" ? (
        <SiteLayoutView
          siteId={siteId}
          siteName={siteName}
          mode={tab}
          canEdit={canEdit}
          onDirtyChange={onDirtyChange}
        />
      ) : null}
      {tab === "search" && siteSlug ? (
        <SearchSettingsView
          siteId={siteId}
          siteSlug={siteSlug}
          canEdit={canEdit}
        />
      ) : null}
    </section>
  );
}
