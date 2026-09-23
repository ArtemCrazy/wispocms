"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type SiteSeo = {
  siteId: string;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  seoImageMediaId: string | null;
  noIndex: boolean;
  draftRevisionId: string | null;
};

type MediaItem = { id: string; originalName: string; altText: string | null };
type SeoDraft = {
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  seoImageMediaId: string;
  noIndex: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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

export function SiteSeoView({
  siteId,
  siteName,
  siteSlug,
  canEdit = true,
  canApprove = false,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  canEdit?: boolean;
  canApprove?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [seo, setSeo] = useState<SiteSeo | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<SeoDraft>({
    seoTitle: "",
    seoDescription: "",
    canonicalUrl: "",
    seoImageMediaId: "",
    noIndex: false,
  });

  const load = useCallback(async () => {
    if (!siteId) return;
    const [seoData, mediaData] = await Promise.all([
      request<SiteSeo>(`/api/sites/${siteId}/content/versioned/seo`),
      request<MediaItem[]>(`/api/sites/${siteId}/content/media`),
    ]);
    setSeo(seoData);
    setMedia(mediaData);
    setDraft({
      seoTitle: seoData.seoTitle ?? "",
      seoDescription: seoData.seoDescription ?? "",
      canonicalUrl: seoData.canonicalUrl ?? "",
      seoImageMediaId: seoData.seoImageMediaId ?? "",
      noIndex: seoData.noIndex,
    });
    setDirty(false);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  function updateDraft<K extends keyof SeoDraft>(key: K, value: SeoDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !canEdit || !seo) return;
    if (!event.currentTarget.reportValidity()) return;
    const nullable = (value: string) => value.trim() || null;
    setSaving(true);
    setMessage("");
    try {
      const updated = await request<SiteSeo>(
        `/api/sites/${siteId}/content/versioned/seo`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedDraftRevisionId: seo.draftRevisionId,
            snapshot: {
              seoTitle: nullable(draft.seoTitle),
              seoDescription: nullable(draft.seoDescription),
              canonicalUrl: nullable(draft.canonicalUrl),
              seoImageMediaId: nullable(draft.seoImageMediaId),
              noIndex: draft.noIndex,
            },
          }),
        },
      );
      setSeo(updated);
      setDraft({
        seoTitle: updated.seoTitle ?? "",
        seoDescription: updated.seoDescription ?? "",
        canonicalUrl: updated.canonicalUrl ?? "",
        seoImageMediaId: updated.seoImageMediaId ?? "",
        noIndex: updated.noIndex,
      });
      setDirty(false);
      setMessage("SEO сохранено как новая версия черновика");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить SEO",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!seo)
    return (
      <section className="directory-section">
        <div className="section-heading">
          <div>
            <h1>SEO</h1>
            <p>{siteName}</p>
          </div>
        </div>
        <div className="settings-loading">Загружаем SEO…</div>
      </section>
    );

  const previewTitle = draft.seoTitle || siteName || "Название сайта";
  const previewDescription =
    draft.seoDescription ||
    "Добавьте описание — оно появится в поисковой выдаче и социальных сетях.";
  const previewUrl =
    draft.canonicalUrl || `https://${siteSlug || "site"}.ru`;

  return (
    <section className="directory-section seo-section">
      <div className="section-heading">
        <div>
          <h1>SEO</h1>
          <p>Поисковое отображение, индексация и карта сайта</p>
        </div>
      </div>
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      <form className="settings-form" onSubmit={save}>
        <div className="settings-card">
          <div className="settings-card-head">
            <span>⌕</span>
            <div>
              <h2>Основные метаданные</h2>
              <p>Используются по умолчанию на публичном сайте</p>
            </div>
          </div>
          <div className="settings-fields">
            <label>
              <span className="seo-label-row">
                <span>Заголовок сайта</span>
                <small className={draft.seoTitle.length > 60 ? "warning" : ""}>
                  {draft.seoTitle.length}/60
                </small>
              </span>
              <input
                name="seoTitle"
                maxLength={200}
                value={draft.seoTitle}
                onChange={(event) =>
                  updateDraft("seoTitle", event.target.value)
                }
                placeholder="Название проекта — краткое описание"
                readOnly={!canEdit}
              />
              <small>Рекомендуемая длина для поисковой выдачи — до 60 символов.</small>
            </label>
            <label>
              <span className="seo-label-row">
                <span>Описание</span>
                <small
                  className={draft.seoDescription.length > 160 ? "warning" : ""}
                >
                  {draft.seoDescription.length}/160
                </small>
              </span>
              <textarea
                name="seoDescription"
                maxLength={500}
                rows={4}
                value={draft.seoDescription}
                onChange={(event) =>
                  updateDraft("seoDescription", event.target.value)
                }
                placeholder="Краткое описание для поисковой выдачи"
                readOnly={!canEdit}
              />
              <small>Старайтесь уложить основную мысль в 160 символов.</small>
            </label>
            <label>
              <span>Основной адрес (canonical)</span>
              <input
                name="canonicalUrl"
                type="url"
                maxLength={500}
                value={draft.canonicalUrl}
                onChange={(event) =>
                  updateDraft("canonicalUrl", event.target.value)
                }
                placeholder="https://example.ru"
                readOnly={!canEdit}
              />
              <small>
                Нужен полный адрес с https://, без завершающего слеша.
              </small>
            </label>
            <label>
              <span>Изображение для соцсетей</span>
              <select
                name="seoImageMediaId"
                value={draft.seoImageMediaId}
                onChange={(event) =>
                  updateDraft("seoImageMediaId", event.target.value)
                }
                disabled={!canEdit}
              >
                <option value="">Без общего изображения</option>
                {media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.altText || item.originalName}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-check seo-noindex">
              <input
                name="noIndex"
                type="checkbox"
                checked={draft.noIndex}
                onChange={(event) =>
                  updateDraft("noIndex", event.target.checked)
                }
                disabled={!canEdit}
              />
              <span>
                <b>Запретить индексацию сайта</b>
                <small>Добавляет noindex и закрывает сайт в robots.txt.</small>
              </span>
            </label>
          </div>
        </div>
        <div className="seo-preview">
          <small>ПРЕДПРОСМОТР В ПОИСКЕ</small>
          <span>{previewUrl}</span>
          <strong>{previewTitle}</strong>
          <p>{previewDescription}</p>
        </div>
        <div className="seo-files">
          <a
            href={`/preview/${siteSlug}/robots.txt`}
            target="_blank"
            rel="noreferrer"
          >
            <b>robots.txt</b>
            <span>Правила индексации ↗</span>
          </a>
          <a
            href={`/preview/${siteSlug}/sitemap.xml`}
            target="_blank"
            rel="noreferrer"
          >
            <b>sitemap.xml</b>
            <span>Опубликованные URL ↗</span>
          </a>
        </div>
        {canEdit ? (
          <div className="settings-actions">
            <span className={dirty ? "unsaved-indicator" : ""}>
              {dirty
                ? "● Есть несохранённые SEO-изменения"
                : "Черновики в sitemap не включаются"}
            </span>
            <button disabled={saving || !dirty}>
              {saving ? "Сохраняем…" : "Сохранить SEO"}
            </button>
          </div>
        ) : null}
      </form>
      {siteId ? (
        <SiteSettingsRevisionPanel
          siteId={siteId}
          resource="seo"
          label="SEO"
          canEdit={canEdit}
          canApprove={canApprove}
          dirty={dirty}
          refreshToken={seo.draftRevisionId}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}
