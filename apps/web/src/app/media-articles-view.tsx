"use client";

import { useEffect, useMemo, useState } from "react";
import { ContentView } from "./content-view";

type Section = "root" | "content";
type Template = {
  id: string;
  key: string;
  version: string;
  kind: "articles_list" | "article" | "category";
  name: string;
};
type ArticleSettings = {
  listTemplateKey: string;
  listTemplateVersion: string;
  listTemplateConfig: Record<string, unknown>;
};

function sectionFromUrl(): Section {
  if (typeof window === "undefined") return "root";
  return new URL(window.location.href).searchParams.get("subview") === "content"
    ? "content"
    : "root";
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message ?? "Ошибка запроса");
  }
  return response.json();
}

export function MediaArticlesView({
  siteId,
  siteName,
  siteSlug,
  canEdit,
  canApprove,
  canEditPublished,
  onCountChange,
  onDirtyChange,
  openArticleId,
  openCategoryId,
  openAuthorId,
  openRequestId,
}: {
  siteId: string;
  siteName: string;
  siteSlug: string;
  canEdit: boolean;
  canApprove: boolean;
  canEditPublished: boolean;
  onCountChange?: (count: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  openArticleId?: string;
  openCategoryId?: string;
  openAuthorId?: string;
  openRequestId?: number;
}) {
  const [section, setSection] = useState<Section>(() =>
    openArticleId || openCategoryId || openAuthorId
      ? "content"
      : sectionFromUrl(),
  );
  const [templates, setTemplates] = useState<Template[]>([]);
  const [settings, setSettings] = useState<ArticleSettings | null>(null);
  const [message, setMessage] = useState("");

  const listTemplates = useMemo(
    () => templates.filter((template) => template.kind === "articles_list"),
    [templates],
  );

  useEffect(() => {
    const restore = () => setSection(sectionFromUrl());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (section !== "root") return;
    Promise.all([
      request<Template[]>(`/api/sites/${siteId}/content/templates`),
      request<ArticleSettings | null>(
        `/api/sites/${siteId}/content/articles/settings`,
      ),
    ])
      .then(([templateRows, current]) => {
        setTemplates(templateRows);
        setSettings(current);
      })
      .catch((error) => setMessage((error as Error).message));
  }, [section, siteId]);

  function navigate(next: Section) {
    const url = new URL(window.location.href);
    if (next === "root") url.searchParams.delete("subview");
    else url.searchParams.set("subview", next);
    window.history.pushState({}, "", url);
    setSection(next);
  }

  async function saveTemplate(template: Template) {
    try {
      const saved = await request<ArticleSettings>(
        `/api/sites/${siteId}/content/articles/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            templateKey: template.key,
            templateVersion: template.version,
            config: settings?.listTemplateConfig ?? {},
          }),
        },
      );
      setSettings(saved);
      setMessage("Шаблон списка сохранён");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  if (section === "content")
    return (
      <section className="media-module-shell">
        <button
          className="media-back-button"
          type="button"
          onClick={() => navigate("root")}
        >
          ← Статьи
        </button>
        <ContentView
          siteId={siteId}
          siteName={siteName}
          siteSlug={siteSlug}
          canEdit={canEdit}
          canApprove={canApprove}
          canEditPublished={canEditPublished}
          onCountChange={onCountChange}
          onDirtyChange={onDirtyChange}
          openArticleId={openArticleId}
          openCategoryId={openCategoryId}
          openAuthorId={openAuthorId}
          openRequestId={openRequestId}
        />
      </section>
    );

  return (
    <section className="media-module-shell">
      <header className="media-module-heading">
        <div>
          <small>MEDIA</small>
          <h1>Статьи</h1>
        </div>
        <p>Шаблон списка и редакционный контент сайта.</p>
      </header>
      {message ? <p className="form-message">{message}</p> : null}
      <article className="media-template-summary">
        <iframe
          src={`/preview/${siteSlug}`}
          title={`Предпросмотр статей ${siteName}`}
        />
        <div>
          <span className="status status-published">Шаблон списка</span>
          <h2>Публичная лента статей</h2>
          <label>
            Шаблон
            <select
              value={`${settings?.listTemplateKey ?? "editorial-feed"}@${settings?.listTemplateVersion ?? "1"}`}
              disabled={!canEdit}
              onChange={(event) => {
                const template = listTemplates.find(
                  (item) =>
                    `${item.key}@${item.version}` === event.target.value,
                );
                if (template) void saveTemplate(template);
              }}
            >
              {listTemplates.map((template) => (
                <option
                  key={template.id}
                  value={`${template.key}@${template.version}`}
                >
                  {template.name} · v{template.version}
                </option>
              ))}
            </select>
          </label>
          <a href={`/preview/${siteSlug}`} target="_blank" rel="noreferrer">
            Открыть сайт ↗
          </a>
        </div>
      </article>
      <div className="media-entry-grid">
        <button type="button" onClick={() => navigate("content")}>
          <span className="media-entry-icon">≡</span>
          <strong>Контент</strong>
          <small>Дерево рубрик, материалы и редакционный процесс</small>
          <em>Открыть →</em>
        </button>
      </div>
    </section>
  );
}
