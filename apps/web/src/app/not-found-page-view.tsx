"use client";

import { useCallback, useEffect, useState } from "react";
import type { NotFoundTemplateData } from "./not-found-template";

type NotFoundState = {
  site: { id: string; name: string; slug: string };
  page: {
    id: string;
    name: string;
    status: "draft" | "published";
    updatedAt: string;
  };
  template: NotFoundTemplateData;
  publishedTemplate: NotFoundTemplateData | null;
  hasPendingTemplateChanges: boolean;
  templates: NotFoundTemplateData[];
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
  canApprove = true,
}: {
  siteId?: string;
  canEdit?: boolean;
  canApprove?: boolean;
}) {
  const [state, setState] = useState<NotFoundState | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!siteId) return;
    const next = await request<NotFoundState>(
      `/api/sites/${siteId}/content/not-found`,
    );
    setState(next);
    setSelectedKey(next.template.key);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function perform(url: string, init?: RequestInit) {
    if (!siteId) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await request<NotFoundState>(url, init);
      setState(next);
      setSelectedKey(next.template.key);
      setMessage("Изменения сохранены");
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
            Показывается автоматически, когда посетитель открывает несуществующий адрес.
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

          <fieldset disabled={!canEdit || busy}>
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
                disabled={!canEdit || busy}
                onClick={() =>
                  void perform(`/api/sites/${siteId}/content/not-found/template`, {
                    method: "PATCH",
                    body: JSON.stringify({ templateKey: selectedKey }),
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
                  void perform(`/api/sites/${siteId}/content/not-found/deactivate`, {
                    method: "POST",
                  })
                }
              >
                Отключить
              </button>
            ) : null}
            {state.page.status !== "published" || state.hasPendingTemplateChanges ? (
              <button
                type="button"
                disabled={!canApprove || busy || dirty}
                onClick={() =>
                  void perform(`/api/sites/${siteId}/content/not-found/activate`, {
                    method: "POST",
                  })
                }
              >
                Активировать
              </button>
            ) : null}
          </div>
          {state.hasPendingTemplateChanges ? (
            <p className="not-found-admin-notice">
              Новый шаблон сохранён. Активируйте его, чтобы обновить публичную 404.
            </p>
          ) : null}
          {message ? <p className="not-found-admin-message">{message}</p> : null}
        </div>

        <div className="not-found-admin-preview">
          <div>
            <span>Предпросмотр</span>
            <small>{previewTemplate.name}</small>
          </div>
          <iframe
            key={`${state.template.key}-${state.template.version}`}
            title={`Предпросмотр шаблона ${previewTemplate.name}`}
            src={`/preview/${state.site.slug}/pages/404?cmsSiteId=${siteId}&cmsPageId=${state.page.id}`}
          />
        </div>
      </div>
    </section>
  );
}
