"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageBannerAssignmentsView } from "./page-banner-assignments-view";
import type { BannerSlotDefinition } from "./banner-slot";

type HomeTab = "banners" | "seo" | "history";
type HomePage = {
  id: string;
  title: string;
  kind: "homepage";
  status: "draft" | "published";
  blocks: Array<Record<string, unknown>>;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  redirects: Array<{ fromPath: string; statusCode: 301 | 302 }>;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageMediaId: string | null;
  structuredData: Record<string, unknown> | null;
  updatedAt: string;
};
type MediaItem = { id: string; originalName: string };
type Activity = {
  id: string;
  description: string;
  createdAt: string;
  user?: { fullName?: string; email?: string };
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

function useHomepage(siteId: string) {
  const [page, setPage] = useState<HomePage | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const pages = await api<HomePage[]>(`/api/sites/${siteId}/content/pages`);
      setPage(pages.find((item) => item.kind === "homepage") ?? null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось загрузить главную",
      );
    }
  }, [siteId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return { page, message, load };
}

function HomepageSeo({
  siteId,
  canEdit,
}: {
  siteId: string;
  canEdit: boolean;
}) {
  const { page, message: loadMessage, load } = useHomepage(siteId);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void api<MediaItem[]>(`/api/sites/${siteId}/content/media`)
          .then(setMedia)
          .catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [siteId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!page || !canEdit) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(data.get(name) ?? "").trim() || null;
    let structuredData: Record<string, unknown> | null;
    let redirects: HomePage["redirects"];
    try {
      const schemaSource = String(data.get("structuredData") ?? "").trim();
      const redirectsSource = String(data.get("redirects") ?? "").trim();
      structuredData = schemaSource ? JSON.parse(schemaSource) : null;
      redirects = redirectsSource ? JSON.parse(redirectsSource) : [];
    } catch {
      setMessage(
        "Проверьте JSON в структурированных данных или перенаправлениях",
      );
      return;
    }
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
          seoTitle: optional("seoTitle"),
          seoDescription: optional("seoDescription"),
          canonicalUrl: optional("canonicalUrl"),
          noIndex: data.get("noIndex") === "on",
          redirects,
          ogTitle: optional("ogTitle"),
          ogDescription: optional("ogDescription"),
          ogImageMediaId: optional("ogImageMediaId"),
          structuredData,
        }),
      });
      setMessage("SEO главной сохранено");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить SEO",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!page)
    return (
      <div className="empty-media">
        <h2>Главная ещё не настроена</h2>
        <p>{loadMessage || "Сначала создайте главную страницу."}</p>
      </div>
    );
  return (
    <section className="media-seo-card">
      <header>
        <div>
          <small>ГЛАВНАЯ СТРАНИЦА</small>
          <h2>SEO</h2>
        </div>
        <p>Поиск, соцсети, индексация и технические правила.</p>
      </header>
      {message ? <div className="inline-message">{message}</div> : null}
      <form key={page.updatedAt} onSubmit={save}>
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
        <div className="media-seo-divider">
          <h3>Open Graph</h3>
          <p>Карточка главной при публикации в соцсетях.</p>
        </div>
        <label>
          OG-заголовок
          <input
            name="ogTitle"
            maxLength={240}
            readOnly={!canEdit}
            defaultValue={page.ogTitle ?? ""}
          />
        </label>
        <label>
          OG-описание
          <textarea
            name="ogDescription"
            rows={3}
            maxLength={500}
            readOnly={!canEdit}
            defaultValue={page.ogDescription ?? ""}
          />
        </label>
        <label>
          OG-изображение
          <select
            name="ogImageMediaId"
            disabled={!canEdit}
            defaultValue={page.ogImageMediaId ?? ""}
          >
            <option value="">Не выбрано</option>
            {media.map((item) => (
              <option value={item.id} key={item.id}>
                {item.originalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Структурированные данные (JSON)
          <textarea
            name="structuredData"
            rows={7}
            readOnly={!canEdit}
            defaultValue={
              page.structuredData
                ? JSON.stringify(page.structuredData, null, 2)
                : ""
            }
            placeholder={'{"@context":"https://schema.org"}'}
          />
        </label>
        <label>
          Перенаправления (JSON)
          <textarea
            name="redirects"
            rows={6}
            readOnly={!canEdit}
            defaultValue={JSON.stringify(page.redirects ?? [], null, 2)}
            placeholder={'[{"fromPath":"/old-page","statusCode":301}]'}
          />
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

function PageHistory({ siteId }: { siteId: string }) {
  const { page, message } = useHomepage(siteId);
  const [items, setItems] = useState<Activity[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!page) return;
    const timer = window.setTimeout(
      () =>
        void api<Activity[]>(
          `/api/sites/${siteId}/content/pages/${page.id}/history`,
        )
          .then(setItems)
          .catch((reason) => setError(reason.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [page, siteId]);
  if (!page)
    return (
      <div className="empty-media">
        <h2>История главной</h2>
        <p>{message || "Главная ещё не создана."}</p>
      </div>
    );
  return (
    <section className="page-activity">
      <header>
        <small>ГЛАВНАЯ СТРАНИЦА</small>
        <h2>История</h2>
        <p>Только изменения этой страницы.</p>
      </header>
      {error ? <p className="inline-message">{error}</p> : null}
      <div>
        {items.map((item) => (
          <article key={item.id}>
            <strong>{item.description}</strong>
            <span>
              {item.user?.fullName ?? item.user?.email ?? "Пользователь"}
            </span>
            <time>{new Date(item.createdAt).toLocaleString("ru-RU")}</time>
          </article>
        ))}
        {!items.length ? (
          <div className="empty-media">
            <h2>История пока пуста</h2>
            <p>
              Здесь появятся изменения SEO, шаблона, статуса и баннеров главной.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function MediaHomeView({
  siteId,
  canEdit,
  onOpenBanners,
  hasBannerSlots = true,
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
      bannerSlots?: BannerSlotDefinition[];
    }>,
  ) => void;
  onOpenBanners?: (options?: { create?: boolean }) => void;
  hasBannerSlots?: boolean;
}) {
  const [tab, setTab] = useState<HomeTab>(hasBannerSlots ? "banners" : "seo");
  return (
    <section className="media-module-shell media-home-module-shell">
      <header className="media-module-heading">
        <div>
          <small>MEDIA</small>
          <h1>Главная</h1>
        </div>
        <p>Назначения баннеров, поисковое представление и история главной.</p>
      </header>
      <nav className="media-module-tabs" aria-label="Настройки главной">
        {(
          [
            ["banners", "Баннеры"],
            ["seo", "SEO"],
            ["history", "История"],
          ] as const
        )
          .filter(([id]) => id !== "banners" || hasBannerSlots)
          .map(([id, label]) => (
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
      {tab === "banners" && hasBannerSlots ? (
        <PageBannerAssignmentsView
          siteId={siteId}
          canEdit={canEdit}
          onOpenLibrary={onOpenBanners}
        />
      ) : null}
      {tab === "seo" ? <HomepageSeo siteId={siteId} canEdit={canEdit} /> : null}
      {tab === "history" ? <PageHistory siteId={siteId} /> : null}
    </section>
  );
}
