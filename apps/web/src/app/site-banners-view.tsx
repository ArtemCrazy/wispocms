"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";

type MediaItem = { id: string; originalName: string; altText: string | null };
type Banner = {
  id: string;
  name: string;
  placement: "homepage_top" | "homepage_middle" | "article_sidebar";
  title: string | null;
  linkUrl: string | null;
  mediaId: string | null;
  sortOrder: number;
  isActive: boolean;
  media: MediaItem | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  }
  return response.json();
}

const placementNames = {
  homepage_top: "Верх главной",
  homepage_middle: "Середина главной",
  article_sidebar: "Сайдбар статьи",
};

type BannerScope = "all" | "homepage" | "articles";

const placementsByScope: Record<BannerScope, Banner["placement"][]> = {
  all: ["homepage_top", "homepage_middle", "article_sidebar"],
  homepage: ["homepage_top", "homepage_middle"],
  articles: ["article_sidebar"],
};

export function SiteBannersView({
  siteId,
  siteName,
  canEdit = true,
  scope = "all",
  embedded = false,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
  scope?: BannerScope;
  embedded?: boolean;
}) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [placementFilter, setPlacementFilter] = useState<
    "all" | Banner["placement"]
  >("all");
  const allowedPlacements = placementsByScope[scope];

  const load = useCallback(async () => {
    if (!siteId) return;
    const [bannerRows, mediaRows] = await Promise.all([
      api<Banner[]>(`/api/sites/${siteId}/content/banners`),
      api<MediaItem[]>(`/api/sites/${siteId}/content/media`),
    ]);
    setBanners(bannerRows);
    setMedia(mediaRows);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>, banner?: Banner) {
    event.preventDefault();
    if (!siteId) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(data.get(name) ?? "").trim() || null;
    setBusy(true);
    setMessage("");
    try {
      await api(
        banner
          ? `/api/sites/${siteId}/content/banners/${banner.id}`
          : `/api/sites/${siteId}/content/banners`,
        {
          method: banner ? "PATCH" : "POST",
          body: JSON.stringify({
            name: data.get("name"),
            placement: data.get("placement"),
            title: optional("title"),
            linkUrl: optional("linkUrl"),
            mediaId: optional("mediaId"),
            sortOrder: Number(data.get("sortOrder") ?? 0),
            isActive: data.get("isActive") === "on",
          }),
        },
      );
      setCreating(false);
      setEditingId(null);
      setMessage(banner ? "Баннер обновлён" : "Баннер добавлен");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить баннер",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle(banner: Banner) {
    if (!siteId) return;
    setActionBusyId(banner.id);
    try {
      await api(`/api/sites/${siteId}/content/banners/${banner.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !banner.isActive }),
      });
      setMessage(banner.isActive ? "Баннер выключен" : "Баннер включён");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось изменить баннер",
      );
    } finally {
      setActionBusyId(null);
    }
  }

  async function remove(banner: Banner) {
    if (!siteId || banner.isActive) return;
    if (!window.confirm(`Удалить баннер «${banner.name}»?`)) return;
    setActionBusyId(banner.id);
    try {
      await api(`/api/sites/${siteId}/content/banners/${banner.id}`, {
        method: "DELETE",
      });
      setMessage("Баннер удалён");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось удалить баннер",
      );
    } finally {
      setActionBusyId(null);
    }
  }

  function closeForm() {
    setCreating(false);
    setEditingId(null);
  }

  const scopedBanners = banners.filter((banner) =>
    allowedPlacements.includes(banner.placement),
  );
  const activePlacementFilter =
    placementFilter === "all" || allowedPlacements.includes(placementFilter)
      ? placementFilter
      : "all";
  const visibleBanners = scopedBanners.filter(
    (banner) =>
      (statusFilter === "all" ||
        (statusFilter === "active" ? banner.isActive : !banner.isActive)) &&
      (activePlacementFilter === "all" ||
        banner.placement === activePlacementFilter),
  );
  const activeCount = scopedBanners.filter((banner) => banner.isActive).length;
  const heading =
    scope === "homepage"
      ? "Баннеры главной"
      : scope === "articles"
        ? "Баннеры статей"
        : "Баннеры";
  const description =
    scope === "homepage"
      ? `Баннеры, размещённые на главной странице ${siteName ?? "сайта"}`
      : scope === "articles"
        ? `Баннеры, размещённые рядом со статьями ${siteName ?? "сайта"}`
        : `Рекламные и редакционные баннеры сайта ${siteName ?? ""}`;

  const bannerForm = (banner?: Banner) => (
    <form className="banner-form" onSubmit={(event) => save(event, banner)}>
      <div className="banner-form-head">
        <div>
          <strong>{banner ? "Редактирование баннера" : "Новый баннер"}</strong>
          <small>Выберите место показа и содержимое</small>
        </div>
        <button type="button" aria-label="Закрыть" onClick={closeForm}>
          ×
        </button>
      </div>
      <div className="banner-fields">
        <label>
          <span>Рабочее название</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={160}
            placeholder="Например: подписка на рассылку"
            defaultValue={banner?.name}
          />
        </label>
        <label>
          <span>Место показа</span>
          <select
            name="placement"
            defaultValue={banner?.placement ?? allowedPlacements[0]}
          >
            {allowedPlacements.map((placement) => (
              <option key={placement} value={placement}>
                {placementNames[placement]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Заголовок на баннере</span>
          <input
            name="title"
            maxLength={200}
            placeholder="Читайте главное за неделю"
            defaultValue={banner?.title ?? ""}
          />
        </label>
        <label>
          <span>Ссылка</span>
          <input
            name="linkUrl"
            maxLength={500}
            placeholder="/subscribe или https://…"
            defaultValue={banner?.linkUrl ?? ""}
          />
        </label>
        <label>
          <span>Изображение</span>
          <select name="mediaId" defaultValue={banner?.mediaId ?? ""}>
            <option value="">Без изображения</option>
            {media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.altText || item.originalName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Порядок</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={banner?.sortOrder ?? 0}
          />
        </label>
        <label className="banner-check">
          <input
            name="isActive"
            type="checkbox"
            defaultChecked={banner?.isActive ?? true}
          />
          <span>Показывать баннер на сайте</span>
        </label>
      </div>
      <footer>
        <button type="button" className="secondary" onClick={closeForm}>
          Отмена
        </button>
        <button disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить баннер"}
        </button>
      </footer>
    </form>
  );

  return (
    <section
      className={`directory-section banners-section${embedded ? " embedded" : ""}`}
    >
      <div className="section-heading">
        <div>
          {embedded ? <h2>{heading}</h2> : <h1>{heading}</h1>}
          <p>{description}</p>
        </div>
        {canEdit ? (
          <button
            className="primary-button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
          >
            <span>＋</span>Добавить баннер
          </button>
        ) : null}
      </div>
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      {creating ? bannerForm() : null}

      {scopedBanners.length ? (
        <>
          <div className="banner-toolbar">
            <div className="banner-status-tabs">
              <button
                className={statusFilter === "all" ? "active" : ""}
                onClick={() => setStatusFilter("all")}
              >
                Все <span>{scopedBanners.length}</span>
              </button>
              <button
                className={statusFilter === "active" ? "active" : ""}
                onClick={() => setStatusFilter("active")}
              >
                Активные <span>{activeCount}</span>
              </button>
              <button
                className={statusFilter === "inactive" ? "active" : ""}
                onClick={() => setStatusFilter("inactive")}
              >
                Выключенные <span>{scopedBanners.length - activeCount}</span>
              </button>
            </div>
            <select
              aria-label="Фильтр по месту показа"
              value={activePlacementFilter}
              onChange={(event) =>
                setPlacementFilter(
                  event.target.value as "all" | Banner["placement"],
                )
              }
            >
              <option value="all">Все места показа</option>
              {allowedPlacements.map((placement) => (
                <option key={placement} value={placement}>
                  {placementNames[placement]}
                </option>
              ))}
            </select>
          </div>
          {visibleBanners.length ? (
            <div className="banner-list">
          {visibleBanners.map((banner) =>
            editingId === banner.id ? (
              <div className="banner-edit-row" key={banner.id}>
                {bannerForm(banner)}
              </div>
            ) : (
              <article
                key={banner.id}
                className={banner.isActive ? "" : "disabled"}
              >
                <div className="banner-preview">
                  {banner.media ? (
                    <Image
                      unoptimized
                      width={320}
                      height={180}
                      src={`/api/sites/${siteId}/content/media/${banner.media.id}/file`}
                      alt={banner.media.altText ?? banner.name}
                    />
                  ) : (
                    <span>▭</span>
                  )}
                </div>
                <div className="banner-info">
                  <div>
                    <strong>{banner.name}</strong>
                    <em>{banner.isActive ? "Активен" : "Выключен"}</em>
                  </div>
                  <p>{banner.title || "Без текста на баннере"}</p>
                  <small>
                    {placementNames[banner.placement]} · порядок{" "}
                    {banner.sortOrder}
                    {banner.linkUrl ? ` · ${banner.linkUrl}` : ""}
                  </small>
                </div>
                {canEdit ? (
                  <div className="banner-actions">
                    <button
                      className="banner-edit"
                      disabled={actionBusyId === banner.id}
                      onClick={() => {
                        setEditingId(banner.id);
                        setCreating(false);
                      }}
                    >
                      Редактировать
                    </button>
                    <button
                      className="banner-toggle"
                      disabled={actionBusyId === banner.id}
                      onClick={() => void toggle(banner)}
                    >
                      {actionBusyId === banner.id
                        ? "Сохраняем…"
                        : banner.isActive
                          ? "Выключить"
                          : "Включить"}
                    </button>
                    <button
                      className="banner-delete"
                      disabled={banner.isActive || actionBusyId === banner.id}
                      title={
                        banner.isActive
                          ? "Сначала выключите баннер"
                          : "Удалить баннер"
                      }
                      onClick={() => void remove(banner)}
                    >
                      Удалить
                    </button>
                  </div>
                ) : null}
              </article>
            ),
          )}
            </div>
          ) : (
            <div className="site-placeholder compact">
              <span>⌕</span>
              <h2>Баннеры не найдены</h2>
              <p>Измените состояние или место показа в фильтрах.</p>
            </div>
          )}
        </>
      ) : (
        <div className="site-placeholder">
          <span>▭</span>
          <h2>Баннеров пока нет</h2>
          <p>
            Добавьте первый баннер и выберите, где он должен отображаться на
            сайте.
          </p>
        </div>
      )}
    </section>
  );
}
