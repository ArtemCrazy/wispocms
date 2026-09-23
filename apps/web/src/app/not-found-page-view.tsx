"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NotFoundTemplate,
  type NotFoundTemplateData,
} from "./not-found-template";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type NotFoundState = {
  site: { id: string; name: string; slug: string };
  page: {
    id: string;
    name: string;
    status: "draft" | "published";
    updatedAt: string;
    seoTitle: string | null;
    seoDescription: string | null;
    noIndex: true;
  };
  template: NotFoundTemplateData;
  publishedTemplate: NotFoundTemplateData | null;
  hasPendingTemplateChanges: boolean;
  templates: NotFoundTemplateData[];
  draftRevisionId: string | null;
};

type NotFoundDraft = {
  status: "draft" | "published";
  seoTitle: string | null;
  seoDescription: string | null;
  templateKey: string;
  templateVersion: string;
  draftRevisionId: string | null;
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

export function NotFoundPageView({
  siteId,
  canEdit = true,
  canEditCode = true,
  canApprove = true,
}: {
  siteId?: string;
  canEdit?: boolean;
  canEditCode?: boolean;
  canApprove?: boolean;
}) {
  const [state, setState] = useState<NotFoundState | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  const load = useCallback(async () => {
    if (!siteId) return;
    const [catalog, draft] = await Promise.all([
      request<NotFoundState>(`/api/sites/${siteId}/content/not-found`),
      request<NotFoundDraft>(
        `/api/sites/${siteId}/content/versioned/not-found`,
      ),
    ]);
    const template =
      catalog.templates.find(
        (candidate) =>
          candidate.key === draft.templateKey &&
          candidate.version === draft.templateVersion,
      ) ?? catalog.template;
    const next: NotFoundState = {
      ...catalog,
      page: {
        ...catalog.page,
        status: draft.status,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
      },
      template,
      hasPendingTemplateChanges:
        template.key !== catalog.publishedTemplate?.key ||
        template.version !== catalog.publishedTemplate?.version,
      draftRevisionId: draft.draftRevisionId,
    };
    setState(next);
    setSelectedKey(next.template.key);
    setSeoTitle(next.page.seoTitle ?? "");
    setSeoDescription(next.page.seoDescription ?? "");
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveDraft(patch: Partial<NotFoundDraft>) {
    if (!siteId || !state) return;
    setBusy(true);
    setMessage("");
    try {
      await request<NotFoundDraft>(
        `/api/sites/${siteId}/content/versioned/not-found`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedDraftRevisionId: state.draftRevisionId,
            snapshot: {
              status: patch.status ?? state.page.status,
              seoTitle: patch.seoTitle ?? state.page.seoTitle,
              seoDescription:
                patch.seoDescription ?? state.page.seoDescription,
              templateKey: patch.templateKey ?? state.template.key,
              templateVersion:
                patch.templateVersion ?? state.template.version,
            },
          }),
        },
      );
      await load();
      setMessage("Изменения сохранены как новая версия черновика");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  if (!siteId)
    return <section className="not-found-admin-state">Выберите сайт.</section>;
  if (!state)
    return (
      <section className="not-found-admin-state">
        {message || "Загружаем страницу 404…"}
      </section>
    );

  const dirty = selectedKey !== state.template.key;
  const previewTemplate = state.template;

  return (
    <section className="not-found-admin">
      <header className="not-found-admin-header">
        <div>
          <small>ТЕХНИЧЕСКАЯ СТРАНИЦА</small>
          <h1>{state.page.name}</h1>
          <p>
            Показывается автоматически, когда посетитель открывает
            несуществующий адрес.
          </p>
        </div>
        <span className={`not-found-status ${state.page.status}`}>
          {state.page.status === "published" ? "Активна" : "Не активна"}
        </span>
      </header>

      <div className="not-found-admin-grid">
        <div className="not-found-admin-settings">
          <div className="not-found-admin-summary">
            <span>Подключённый шаблон</span>
            <strong>{state.template.name}</strong>
            <small>Версия {state.template.version}</small>
          </div>

          <fieldset disabled={!canEditCode || busy}>
            <legend>Сменить шаблон</legend>
            {state.templates.map((template) => (
              <label
                className={`not-found-template-choice ${selectedKey === template.key ? "selected" : ""}`}
                key={template.key}
              >
                <input
                  type="radio"
                  name="not-found-template"
                  checked={selectedKey === template.key}
                  onChange={() => setSelectedKey(template.key)}
                />
                <span>
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="not-found-admin-actions">
            {dirty ? (
              <button
                type="button"
                disabled={!canEditCode || busy}
                onClick={() =>
                  void saveDraft({
                    templateKey: selectedKey,
                    templateVersion:
                      state.templates.find(
                        (template) => template.key === selectedKey,
                      )?.version ?? "1",
                  })
                }
              >
                Подключить шаблон
              </button>
            ) : null}
            {state.page.status === "published" ? (
              <button
                type="button"
                className="secondary"
                disabled={!canApprove || busy}
                onClick={() =>
                  void saveDraft({ status: "draft" })
                }
              >
                Отключить
              </button>
            ) : null}
            {state.page.status !== "published" ||
            state.hasPendingTemplateChanges ? (
              <button
                type="button"
                disabled={!canApprove || busy || dirty}
                onClick={() =>
                  void saveDraft({ status: "published" })
                }
              >
                Активировать
              </button>
            ) : null}
          </div>
          {state.hasPendingTemplateChanges ? (
            <p className="not-found-admin-notice">
              Новый шаблон сохранён. Активируйте его, чтобы обновить публичную
              404.
            </p>
          ) : null}
          {message ? (
            <p className="not-found-admin-message">{message}</p>
          ) : null}
          <form
            className="not-found-seo"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDraft({ seoTitle, seoDescription });
            }}
          >
            <div>
              <span>SEO страницы 404</span>
              <small>
                Ответ всегда остаётся HTTP 404 с автоматическим noindex.
              </small>
            </div>
            <label>
              SEO-заголовок
              <input
                value={seoTitle}
                maxLength={240}
                readOnly={!canEdit}
                onChange={(event) => setSeoTitle(event.target.value)}
              />
            </label>
            <label>
              SEO-описание
              <textarea
                value={seoDescription}
                rows={4}
                maxLength={500}
                readOnly={!canEdit}
                onChange={(event) => setSeoDescription(event.target.value)}
              />
            </label>
            {canEdit ? <button disabled={busy}>Сохранить SEO</button> : null}
          </form>
        </div>

        <div className="not-found-admin-preview">
          <div>
            <span>Предпросмотр</span>
            <small>{previewTemplate.name}</small>
          </div>
          <div className="not-found-preview-wrap">
            <NotFoundTemplate
              key={`${previewTemplate.key}-${previewTemplate.version}`}
              template={previewTemplate}
              siteName={state.site.name}
              homeHref={`/preview/${state.site.slug}?cmsSiteId=${siteId}`}
              preview
            />
          </div>
        </div>
      </div>
      <SiteSettingsRevisionPanel
        siteId={siteId}
        resource="not-found"
        label="Страница 404"
        canEdit={canEdit || canEditCode}
        canApprove={canApprove}
        dirty={dirty}
        refreshToken={state.draftRevisionId}
        onChanged={load}
      />
    </section>
  );
}
