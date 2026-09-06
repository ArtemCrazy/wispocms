"use client";

import { useEffect, useState } from "react";
import { ContentView } from "./content-view";

type Section = "root" | "template" | "content";

function sectionFromUrl(): Section {
  if (typeof window === "undefined") return "root";
  const value = new URL(window.location.href).searchParams.get("subview");
  return value === "template" || value === "content" ? value : "root";
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

  useEffect(() => {
    const restore = () => setSection(sectionFromUrl());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function navigate(next: Section) {
    const url = new URL(window.location.href);
    if (next === "root") url.searchParams.delete("subview");
    else url.searchParams.set("subview", next);
    window.history.pushState({}, "", url);
    setSection(next);
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

  if (section === "template")
    return (
      <section className="media-module-shell">
        <button
          className="media-back-button"
          type="button"
          onClick={() => navigate("root")}
        >
          ← Статьи
        </button>
        <header className="media-module-heading">
          <div>
            <small>ШАБЛОН СТАТЕЙ</small>
            <h1>Редакционная лента v1</h1>
          </div>
          <p>Текущий публичный шаблон списка и материала.</p>
        </header>
        <article className="media-template-summary">
          <iframe
            src={`/preview/${siteSlug}`}
            title={`Предпросмотр статей ${siteName}`}
          />
          <div>
            <span className="status status-published">Активен</span>
            <h2>Редакционная лента</h2>
            <p>
              Шаблон использует опубликованные материалы и рубрики
              автоматически. Детальная настройка шаблона будет добавлена
              отдельной спецификацией.
            </p>
            <a href={`/preview/${siteSlug}`} target="_blank" rel="noreferrer">
              Открыть сайт ↗
            </a>
          </div>
        </article>
      </section>
    );

  return (
    <section className="media-module-shell">
      <header className="media-module-heading">
        <div>
          <small>MEDIA</small>
          <h1>Статьи</h1>
        </div>
        <p>
          Публичное представление и редакционный контент — отдельные уровни.
        </p>
      </header>
      <div className="media-entry-grid">
        <button type="button" onClick={() => navigate("template")}>
          <span className="media-entry-icon">◇</span>
          <strong>Шаблон</strong>
          <small>Вид списка и страницы статьи</small>
          <em>Открыть →</em>
        </button>
        <button type="button" onClick={() => navigate("content")}>
          <span className="media-entry-icon">≡</span>
          <strong>Контент</strong>
          <small>Материалы, рубрики и редакционный процесс</small>
          <em>Открыть →</em>
        </button>
      </div>
    </section>
  );
}
