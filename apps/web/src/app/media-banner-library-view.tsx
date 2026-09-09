"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type MediaItem = { id: string; originalName: string };
type LinkItem = { id: string; title?: string; name?: string; slug: string };
export type MediaBanner = {
  id: string;
  name: string;
  title: string | null;
  subtitle: string | null;
  buttonText: string | null;
  linkUrl: string | null;
  mediaId: string | null;
  mobileMediaId: string | null;
  media: MediaItem | null;
  mobileMedia: MediaItem | null;
  isActive: boolean;
  updatedAt: string;
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

type Draft = Pick<
  MediaBanner,
  | "name"
  | "title"
  | "subtitle"
  | "buttonText"
  | "linkUrl"
  | "mediaId"
  | "mobileMediaId"
  | "isActive"
>;

export function MediaBannerLibraryView({
  siteId,
  siteName,
  canEdit = true,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
}) {
  const [items, setItems] = useState<MediaBanner[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [links, setLinks] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [banners, mediaRows, pages, articles, categories] = await Promise.all(
      [
        request<MediaBanner[]>(`/api/sites/${siteId}/content/banners`),
        request<MediaItem[]>(`/api/sites/${siteId}/content/media`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/pages`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/articles`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/categories`),
      ],
    );
    setItems(banners);
    setMedia(mediaRows);
    setLinks([
      ...pages.map((item) => ({
        value: `/preview/${item.slug}`,
        label: `Страница: ${item.title ?? item.name}`,
      })),
      ...articles.map((item) => ({
        value: `/articles/${item.slug}`,
        label: `Статья: ${item.title ?? item.name}`,
      })),
      ...categories.map((item) => ({
        value: `/articles/category/${item.slug}`,
        label: `Категория: ${item.title ?? item.name}`,
      })),
    ]);
    const active =
      banners.find((item) => item.id === selectedId) ?? banners[0] ?? null;
    if (active) {
      setSelectedId(active.id);
      setDraft({
        name: active.name,
        title: active.title,
        subtitle: active.subtitle,
        buttonText: active.buttonText,
        linkUrl: active.linkUrl,
        mediaId: active.mediaId,
        mobileMediaId: active.mobileMediaId,
        isActive: active.isActive,
      });
    }
    hydrated.current = true;
  }, [selectedId, siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
    // Selection is synchronized locally; reloading it must not restart the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    if (!siteId || !selectedId || !draft || !hydrated.current || !canEdit)
      return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        const updated = await request<MediaBanner>(
          `/api/sites/${siteId}/content/banners/${selectedId}`,
          { method: "PATCH", body: JSON.stringify(draft) },
        );
        setItems((current) =>
          current.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          ),
        );
        setMessage("Все изменения сохранены");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Не удалось сохранить баннер",
        );
      } finally {
        setSaving(false);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [canEdit, draft, selectedId, siteId]);

  function select(item: MediaBanner) {
    hydrated.current = false;
    setSelectedId(item.id);
    setDraft({
      name: item.name,
      title: item.title,
      subtitle: item.subtitle,
      buttonText: item.buttonText,
      linkUrl: item.linkUrl,
      mediaId: item.mediaId,
      mobileMediaId: item.mobileMediaId,
      isActive: item.isActive,
    });
    window.setTimeout(() => {
      hydrated.current = true;
    }, 0);
  }

  async function create() {
    if (!siteId || !canEdit) return;
    try {
      const item = await request<MediaBanner>(
        `/api/sites/${siteId}/content/banners`,
        {
          method: "POST",
          body: JSON.stringify({ name: "Новый баннер", isActive: true }),
        },
      );
      setItems((current) => [item, ...current]);
      select(item);
      setMessage("Баннер создан — изменения дальше сохраняются автоматически");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось создать баннер",
      );
    }
  }

  async function remove() {
    if (
      !siteId ||
      !selectedId ||
      !canEdit ||
      !window.confirm("Удалить этот баннер?")
    )
      return;
    try {
      await request(`/api/sites/${siteId}/content/banners/${selectedId}`, {
        method: "DELETE",
      });
      setSelectedId(null);
      setDraft(null);
      setMessage("Баннер удалён");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось удалить баннер",
      );
    }
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <section className="media-module-shell media-banner-library">
      <header className="media-module-heading">
        <div>
          <small>САЙТ</small>
          <h1>Баннеры</h1>
        </div>
        <p>
          Универсальная библиотека {siteName ? `сайта «${siteName}»` : "сайта"}.
          Место показа назначается на странице.
        </p>
      </header>
      <div className="media-list-toolbar">
        <span>{items.length} баннеров</span>
        {canEdit ? (
          <button type="button" onClick={() => void create()}>
            + Создать баннер
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="inline-message">{saving ? "Сохраняем…" : message}</p>
      ) : null}
      <div className="media-banner-workspace">
        <div className="media-banner-cards">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedId === item.id ? "active" : ""}
              onClick={() => select(item)}
            >
              {item.mediaId ? (
                <Image
                  src={`/api/sites/${siteId}/content/media/${item.mediaId}/file`}
                  width={360}
                  height={180}
                  alt=""
                />
              ) : (
                <span className="media-banner-placeholder">
                  Нет изображения
                </span>
              )}
              <strong>{item.name}</strong>
              <small>{new Date(item.updatedAt).toLocaleString("ru-RU")}</small>
            </button>
          ))}
          {!items.length ? (
            <div className="empty-media">
              <h2>Баннеров пока нет</h2>
              <p>Создайте баннер и затем назначьте его зоне страницы.</p>
            </div>
          ) : null}
        </div>
        {draft ? (
          <aside className="media-editor-card media-banner-editor">
            <div className="autosave-indicator">
              {saving ? "Сохраняем…" : "Автосохранение включено"}
            </div>
            <label>
              Внутреннее название
              <input
                value={draft.name}
                readOnly={!canEdit}
                onChange={(event) => field("name", event.target.value)}
              />
            </label>
            <label>
              Изображение для компьютера
              <select
                value={draft.mediaId ?? ""}
                disabled={!canEdit}
                onChange={(event) =>
                  field("mediaId", event.target.value || null)
                }
              >
                <option value="">Не выбрано</option>
                {media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Изображение для телефона
              <select
                value={draft.mobileMediaId ?? ""}
                disabled={!canEdit}
                onChange={(event) =>
                  field("mobileMediaId", event.target.value || null)
                }
              >
                <option value="">
                  Использовать изображение для компьютера
                </option>
                {media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ссылка
              <select
                value={
                  links.some((item) => item.value === draft.linkUrl)
                    ? (draft.linkUrl ?? "")
                    : "external"
                }
                disabled={!canEdit}
                onChange={(event) =>
                  field(
                    "linkUrl",
                    event.target.value === "external"
                      ? ""
                      : event.target.value || null,
                  )
                }
              >
                <option value="">Без ссылки</option>
                {links.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                <option value="external">Внешний адрес…</option>
              </select>
            </label>
            {!links.some((item) => item.value === draft.linkUrl) &&
            draft.linkUrl !== null ? (
              <label>
                Внешний адрес
                <input
                  type="url"
                  placeholder="https://example.ru"
                  value={draft.linkUrl ?? ""}
                  readOnly={!canEdit}
                  onChange={(event) => field("linkUrl", event.target.value)}
                />
              </label>
            ) : null}
            <label>
              Заголовок
              <input
                value={draft.title ?? ""}
                readOnly={!canEdit}
                onChange={(event) => field("title", event.target.value || null)}
              />
            </label>
            <label>
              Подзаголовок
              <textarea
                rows={3}
                value={draft.subtitle ?? ""}
                readOnly={!canEdit}
                onChange={(event) =>
                  field("subtitle", event.target.value || null)
                }
              />
            </label>
            <label>
              Текст кнопки
              <input
                value={draft.buttonText ?? ""}
                readOnly={!canEdit}
                onChange={(event) =>
                  field("buttonText", event.target.value || null)
                }
              />
            </label>
            <label className="item-seo-checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                disabled={!canEdit}
                onChange={(event) => field("isActive", event.target.checked)}
              />
              <span>Баннер активен</span>
            </label>
            {canEdit ? (
              <button
                type="button"
                className="danger"
                onClick={() => void remove()}
              >
                Удалить баннер
              </button>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
