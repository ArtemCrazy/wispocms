"use client";

import { useCallback, useEffect, useState } from "react";

type TemplateTarget =
  "homepage-template" | "articles" | "layout" | "404" | "privacy-policy";
type Page = {
  kind: "homepage" | "page";
  systemTemplateKey: string | null;
  systemTemplateVersion: string | null;
};
type ArticleSettings = {
  listTemplateKey: string;
  listTemplateVersion: string;
} | null;
type NotFoundState = { template: { name: string; version: string } };
type PrivacyState = {
  displayTemplate: { title: string; key: string; version: string };
};

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  return payload as T;
}

export function MediaTemplatesView({
  siteId,
  onOpen,
}: {
  siteId: string;
  onOpen: (target: TemplateTarget) => void;
}) {
  const [rows, setRows] = useState<
    Array<{ id: TemplateTarget; name: string; current: string; hint: string }>
  >([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [pages, articles, notFound, privacy] = await Promise.all([
      request<Page[]>(`/api/sites/${siteId}/content/pages`),
      request<ArticleSettings>(
        `/api/sites/${siteId}/content/articles/settings`,
      ),
      request<NotFoundState>(`/api/sites/${siteId}/content/not-found`),
      request<PrivacyState>(`/api/sites/${siteId}/content/privacy`),
    ]);
    const homepage = pages.find((page) => page.kind === "homepage");
    setRows([
      {
        id: "homepage-template",
        name: "Главная",
        current: homepage?.systemTemplateKey
          ? `${homepage.systemTemplateKey} · ${homepage.systemTemplateVersion}`
          : "Базовый шаблон Media",
        hint: "Структура и визуальное представление главной страницы",
      },
      {
        id: "articles",
        name: "Статьи",
        current: articles
          ? `${articles.listTemplateKey} · ${articles.listTemplateVersion}`
          : "Шаблон списка не подключён",
        hint: "Список материалов и шаблоны статьи/категории",
      },
      {
        id: "layout",
        name: "Шапка и подвал",
        current: "Общий шаблон сайта",
        hint: "Единые области, используемые всеми страницами",
      },
      {
        id: "404",
        name: "404",
        current: `${notFound.template.name} · ${notFound.template.version}`,
        hint: "Общая библиотека системных шаблонов",
      },
      {
        id: "privacy-policy",
        name: "Политика конфиденциальности",
        current: `${privacy.displayTemplate.title} · ${privacy.displayTemplate.version}`,
        hint: "Юридический документ и шаблон его отображения",
      },
    ]);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="media-module-shell media-templates-view">
      <header className="media-module-heading">
        <div>
          <small>САЙТ</small>
          <h1>Шаблоны</h1>
        </div>
        <p>Текущие шаблоны всех поддерживаемых поверхностей Media.</p>
      </header>
      {message ? <p className="inline-message">{message}</p> : null}
      <div className="media-template-manager">
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <small>{row.hint}</small>
              <h2>{row.name}</h2>
              <p>
                Текущий: <strong>{row.current}</strong>
              </p>
            </div>
            <button type="button" onClick={() => onOpen(row.id)}>
              Открыть и изменить
            </button>
          </article>
        ))}
        {!rows.length && !message ? <p>Загружаем шаблоны…</p> : null}
      </div>
    </section>
  );
}
