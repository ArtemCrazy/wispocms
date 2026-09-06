"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchView =
  | "homepage"
  | "articles"
  | "pages"
  | "categories"
  | "authors";
export type SearchTarget = { id: string; view: SearchView };
export type GlobalSearchTarget = SearchTarget & {
  workspaceId: string;
  siteId: string;
};
export type GlobalSearchWorkspace = {
  id: string;
  name: string;
  sites: Array<{
    id: string;
    name: string;
    siteType: "media" | "corporate" | "landing";
  }>;
};

type SearchGroup = "content" | "pages" | "directories";
type SearchItem = GlobalSearchTarget & {
  group: SearchGroup;
  icon: string;
  title: string;
  description: string;
  searchText: string;
  workspaceName: string;
  siteName: string;
};
type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  status: string;
};
type PageItem = {
  id: string;
  title: string;
  slug: string;
  kind: "homepage" | "page";
  status: string;
  blocks: Array<{ title?: string; text?: string }>;
};
type Category = { id: string; name: string; slug: string };
type Author = {
  id: string;
  fullName: string;
  email: string | null;
  bio: string | null;
};

type SearchTab = "all" | SearchGroup;

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Не удалось загрузить данные для поиска");
  return response.json();
}

const viewNames: Record<SearchView, string> = {
  homepage: "Главная",
  articles: "Статья",
  pages: "Страница",
  categories: "Рубрика",
  authors: "Автор",
};

const tabs: Array<{ id: SearchTab; label: string }> = [
  { id: "all", label: "Всё" },
  { id: "content", label: "Материалы" },
  { id: "pages", label: "Страницы" },
  { id: "directories", label: "Справочники" },
];

function normalize(value: string) {
  return value.toLocaleLowerCase("ru").replace(/ё/g, "е");
}

export function GlobalSearchView({
  workspaces,
  onNavigate,
}: {
  workspaces: GlobalSearchWorkspace[];
  onNavigate: (target: GlobalSearchTarget) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("all");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    const sites = workspaces.flatMap((workspace) =>
      workspace.sites.map((site) => ({
        ...site,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      })),
    );

    if (!sites.length) {
      const emptyTimer = window.setTimeout(() => {
        if (!active) return;
        setItems([]);
        setLoading(false);
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(emptyTimer);
      };
    }

    Promise.allSettled(
      sites.map(async (site) => {
        const base = `/api/sites/${site.id}/content`;
        const [articles, pages, categories, authors] = await Promise.all([
          api<Article[]>(`${base}/articles`),
          api<PageItem[]>(`${base}/pages`),
          api<Category[]>(`${base}/categories`),
          api<Author[]>(`${base}/authors`),
        ]);
        const source = {
          workspaceId: site.workspaceId,
          workspaceName: site.workspaceName,
          siteId: site.id,
          siteName: site.name,
        };
        return [
          ...articles.map((item): SearchItem => ({
            ...source,
            id: item.id,
            view: "articles",
            group: "content",
            icon: "▤",
            title: item.title,
            description: `/${item.slug} · ${item.status}`,
            searchText: `${item.title} ${item.slug} ${item.excerpt ?? ""} ${item.body}`,
          })),
          ...pages
            .filter(
              (item) =>
                site.siteType !== "media" ||
                item.kind === "homepage" ||
                item.slug === "privacy-policy" ||
                item.slug === "404",
            )
            .map((item): SearchItem => ({
              ...source,
              id: item.id,
              view: item.kind === "homepage" ? "homepage" : "pages",
              group: "pages",
              icon: item.kind === "homepage" ? "⌂" : "□",
              title: item.title,
              description:
                item.kind === "homepage"
                  ? "Главная страница"
                  : `/${item.slug} · ${item.status}`,
              searchText: `${item.title} ${item.slug} ${item.blocks
                .map((block) => `${block.title ?? ""} ${block.text ?? ""}`)
                .join(" ")}`,
            })),
          ...categories.map((item): SearchItem => ({
            ...source,
            id: item.id,
            view: "categories",
            group: "directories",
            icon: "⌗",
            title: item.name,
            description: `/${item.slug}`,
            searchText: `${item.name} ${item.slug}`,
          })),
          ...authors.map((item): SearchItem => ({
            ...source,
            id: item.id,
            view: "authors",
            group: "directories",
            icon: "♧",
            title: item.fullName,
            description: item.email ?? "Автор",
            searchText: `${item.fullName} ${item.email ?? ""} ${item.bio ?? ""}`,
          })),
        ];
      }),
    )
      .then((responses) => {
        if (!active) return;
        const successful = responses.filter(
          (response): response is PromiseFulfilledResult<SearchItem[]> =>
            response.status === "fulfilled",
        );
        setItems(successful.flatMap((response) => response.value));
        if (!successful.length)
          setMessage("Не удалось загрузить доступные данные для поиска");
        else if (successful.length < responses.length)
          setMessage("Часть сайтов временно недоступна — показаны остальные результаты");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaces]);

  const results = useMemo(() => {
    const normalized = normalize(query.trim());
    if (!normalized) return [];
    return items
      .filter((item) => activeTab === "all" || item.group === activeTab)
      .filter((item) => normalize(item.searchText).includes(normalized))
      .slice(0, 100);
  }, [activeTab, items, query]);

  const counts = useMemo(
    () => ({
      all: items.length,
      content: items.filter((item) => item.group === "content").length,
      pages: items.filter((item) => item.group === "pages").length,
      directories: items.filter((item) => item.group === "directories").length,
    }),
    [items],
  );

  return (
    <section className="global-search-page" aria-label="Глобальный поиск">
      <div className="global-search-shell">
        <label className="global-search-input">
          <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по всем проектам и сайтам"
            aria-label="Поисковый запрос"
          />
          {query ? (
            <button
              type="button"
              aria-label="Очистить поиск"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : null}
        </label>

        <div className="global-search-hints" aria-label="Области поиска">
          <span>{results.length} результатов</span>
          <span><b>название:</b> заголовки</span>
          <span><b>текст:</b> содержимое</span>
          <span><b>slug:</b> адреса</span>
        </div>

        <div className="global-search-tabs" role="tablist" aria-label="Типы данных">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <small>{counts[tab.id]}</small>
            </button>
          ))}
        </div>

        {message ? <p className="global-search-message">{message}</p> : null}

        <div className="global-search-content" aria-live="polite">
          {loading ? (
            <div className="global-search-empty">
              <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
              <strong>Готовим глобальный поиск</strong>
              <small>Собираем доступные материалы и страницы</small>
            </div>
          ) : !query.trim() ? (
            <div className="global-search-empty">
              <strong>Строка поиска пуста</strong>
              <small>Введите запрос, чтобы увидеть результаты по всем доступным сайтам</small>
            </div>
          ) : results.length ? (
            <div className="global-search-results">
              <p>Найдено: {results.length}</p>
              {results.map((item) => (
                <button
                  key={`${item.siteId}-${item.view}-${item.id}`}
                  type="button"
                  onClick={() =>
                    onNavigate({
                      workspaceId: item.workspaceId,
                      siteId: item.siteId,
                      view: item.view,
                      id: item.id,
                    })
                  }
                >
                  <i aria-hidden="true">{item.icon}</i>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <em>{item.workspaceName} / {item.siteName}</em>
                  <b>{viewNames[item.view]}</b>
                  <span className="global-search-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="global-search-empty">
              <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
              <strong>Ничего не найдено</strong>
              <small>Измените запрос или выберите другой тип данных</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
