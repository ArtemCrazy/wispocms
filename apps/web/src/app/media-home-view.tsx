"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PagesView } from "./pages-view";
import { SiteBannersView } from "./site-banners-view";

type HomeTab = "template" | "banners" | "seo";
type HomePage = {
  id: string;
  title: string;
  slug: string;
  kind: "homepage";
  status: "draft" | "published";
  blocks: Array<Record<string, unknown>>;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
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

function HomepageSeo({
  siteId,
  canEdit,
}: {
  siteId: string;
  canEdit: boolean;
}) {
  const [page, setPage] = useState<HomePage | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const pages = await api<HomePage[]>(`/api/sites/${siteId}/content/pages`);
      setPage(pages.find((item) => item.kind === "homepage") ?? null);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось загрузить SEO",
      );
    }
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!page || !canEdit) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/api/sites/${siteId}/content/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: page.title,
          slug: "",
          kind: "homepage",
          status: page.status,
          blocks: page.blocks,
          seoTitle: data.get("seoTitle"),
          seoDescription: data.get("seoDescription"),
          canonicalUrl: data.get("canonicalUrl"),
          noIndex: data.get("noIndex") === "on",
        }),
      });
      setMessage("SEO главной сохранено");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить SEO",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!page)
    return (
      <div className="empty-media">
        <h2>Главная ещё не настроена</h2>
        <p>{message || "Сначала подключите шаблон главной страницы."}</p>
      </div>
    );

  return (
    <section className="media-seo-card">
      <header>
        <div>
          <small>ГЛАВНАЯ СТРАНИЦА</small>
          <h2>SEO</h2>
        </div>
        <p>Метаданные относятся только к главной странице.</p>
      </header>
      {message ? <div className="inline-message">{message}</div> : null}
      <form onSubmit={save}>
        <label>
          Заголовок в поиске
          <input
            name="seoTitle"
            maxLength={240}
            readOnly={!canEdit}
            defaultValue={page.seoTitle ?? ""}
          />
        </label>
        <label>
          Описание в поиске
          <textarea
            name="seoDescription"
            rows={4}
            maxLength={500}
            readOnly={!canEdit}
            defaultValue={page.seoDescription ?? ""}
          />
        </label>
        <label>
          Канонический адрес
          <input
            name="canonicalUrl"
            maxLength={500}
            readOnly={!canEdit}
            defaultValue={page.canonicalUrl ?? ""}
            placeholder="https://example.ru"
          />
        </label>
        <label className="item-seo-checkbox">
          <input
            name="noIndex"
            type="checkbox"
            disabled={!canEdit}
            defaultChecked={page.noIndex}
          />
          <span>
            Скрыть главную от поисковых систем
            <small>Добавляет noindex, nofollow</small>
          </span>
        </label>
        {canEdit ? (
          <footer>
            <button disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить SEO"}
            </button>
          </footer>
        ) : null}
      </form>
    </section>
  );
}

export function MediaHomeView({
  siteId,
  siteName,
  siteSlug,
  canEdit,
  canApprove,
  canEditPublished,
  onDirtyChange,
  onPagesChange,
}: {
  siteId: string;
  siteName: string;
  siteSlug: string;
  canEdit: boolean;
  canApprove: boolean;
  canEditPublished: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onPagesChange?: (
    pages: Array<{
      id: string;
      title: string;
      slug: string;
      kind: "homepage" | "page";
      status: "draft" | "published";
    }>,
  ) => void;
}) {
  const [tab, setTab] = useState<HomeTab>("template");
  return (
    <section className="media-module-shell media-home-module-shell">
      <header className="media-module-heading">
        <div>
          <small>MEDIA</small>
          <h1>Главная</h1>
        </div>
        <p>Шаблон, баннеры и поисковое представление главной.</p>
      </header>
      <nav className="media-module-tabs" aria-label="Настройки главной">
        {(
          [
            ["template", "Шаблон"],
            ["banners", "Баннеры"],
            ["seo", "SEO"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "template" ? (
        <PagesView
          siteId={siteId}
          siteName={siteName}
          siteSlug={siteSlug}
          siteType="media"
          mode="homepage"
          canEdit={canEdit}
          canApprove={canApprove}
          canEditPublished={canEditPublished}
          onDirtyChange={onDirtyChange}
          onPagesChange={onPagesChange}
          hideSeo
        />
      ) : null}
      {tab === "banners" ? (
        <SiteBannersView
          siteId={siteId}
          siteName={siteName}
          canEdit={canEdit}
          scope="homepage"
          embedded
        />
      ) : null}
      {tab === "seo" ? <HomepageSeo siteId={siteId} canEdit={canEdit} /> : null}
    </section>
  );
}
