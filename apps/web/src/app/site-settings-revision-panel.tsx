"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArticleRevisionCurrent,
  revisionActions,
} from "./article-revision-actions";

type RevisionRow = {
  id: string;
  versionNumber: number;
  createdAt?: string;
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
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

const stateLabels: Record<ArticleRevisionCurrent["reviewState"], string> = {
  draft: "Черновик",
  in_review: "На проверке",
  changes_requested: "Нужны исправления",
  approved: "Одобрено",
};

export function SiteSettingsRevisionPanel({
  siteId,
  siteSlug,
  resource,
  basePath,
  label,
  canEdit,
  canApprove,
  dirty,
  refreshToken,
  onChanged,
}: {
  siteId: string;
  siteSlug?: string;
  resource?:
    | "globals"
    | "header"
    | "footer"
    | "variables"
    | "seo"
    | "search"
    | "not-found"
    | "privacy";
  basePath?: string;
  label: string;
  canEdit: boolean;
  canApprove: boolean;
  dirty: boolean;
  refreshToken?: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const [current, setCurrent] = useState<ArticleRevisionCurrent | null>(null);
  const [history, setHistory] = useState<RevisionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base =
    basePath ??
    (resource === "globals"
      ? "globals"
      : resource === "header" || resource === "footer"
        ? `layout/${resource}`
        : `versioned/${resource}`);

  const load = useCallback(async () => {
    const currentState = await request<ArticleRevisionCurrent | null>(
      `/api/sites/${siteId}/content/${base}/revisions/current`,
    );
    setCurrent(currentState);
    if (!currentState) {
      setHistory([]);
      return;
    }
    const rows = await request<RevisionRow[]>(
      `/api/sites/${siteId}/content/${base}/revisions`,
    );
    setHistory(rows);
  }, [base, siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load, refreshToken]);

  const available = current
    ? revisionActions(current, { canEdit, canApprove })
    : null;

  async function changeState(
    action: "submit" | "approve" | "request-changes" | "publish",
  ) {
    if (!current?.draft || dirty) return;
    let reason: string | undefined;
    if (action === "request-changes") {
      reason = window.prompt("Что нужно исправить в этой версии?")?.trim();
      if (!reason) return;
    }
    if (
      action === "publish" &&
      !window.confirm(`Опубликовать одобренную версию раздела «${label}»?`)
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const openedRevisionId = current.draft.id;
      const latest = await request<ArticleRevisionCurrent | null>(
        `/api/sites/${siteId}/content/${base}/revisions/current`,
      );
      if (!latest?.draft || latest.draft.id !== openedRevisionId) {
        setMessage(
          "Версия изменилась после открытия. Проверьте новую версию перед действием.",
        );
        await load();
        return;
      }
      const latestActions = revisionActions(latest, { canEdit, canApprove });
      const permission =
        action === "request-changes" ? "requestChanges" : action;
      if (!latestActions[permission]) {
        setMessage("Состояние версии изменилось. Обновите раздел.");
        await load();
        return;
      }
      await request(
        `/api/sites/${siteId}/content/${base}/revisions/${encodeURIComponent(openedRevisionId)}/${action}`,
        {
          method: "POST",
          ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        },
      );
      await onChanged();
      await load();
      setMessage(
        action === "submit"
          ? "Версия отправлена владельцу на проверку"
          : action === "approve"
            ? "Версия одобрена"
            : action === "request-changes"
              ? "Версия возвращена на доработку"
              : "Одобренная версия опубликована",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить состояние версии",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore(revision: RevisionRow) {
    if (!canEdit || !current?.draft || dirty) return;
    if (
      !window.confirm(
        `Восстановить версию №${revision.versionNumber} как новый черновик?`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      await request(
        `/api/sites/${siteId}/content/${base}/revisions/${encodeURIComponent(revision.id)}/restore`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedDraftRevisionId: current.draft.id,
          }),
        },
      );
      await onChanged();
      await load();
      setMessage(`Версия №${revision.versionNumber} восстановлена как новый черновик`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось восстановить версию",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workflow-panel" aria-label={`Публикация: ${label}`}>
      <header>
        <span>ПУБЛИКАЦИЯ</span>
        <em className={current?.reviewState === "approved" ? "status-published" : "status-draft"}>
          {current ? stateLabels[current.reviewState] : "Нет версии"}
        </em>
      </header>
      <p className="publication-hint">
        {current?.draft
          ? `Черновик №${current.draft.versionNumber}. Публичный сайт не меняется до публикации одобренной версии.`
          : `Сохраните раздел «${label}», чтобы создать первую версию.`}
      </p>
      {message ? <div className="inline-message" role="status">{message}</div> : null}
      <div className="workflow-actions">
        {available?.submit ? (
          <button type="button" disabled={busy || dirty} onClick={() => void changeState("submit")}>
            Отправить владельцу на проверку
          </button>
        ) : null}
        {available?.requestChanges ? (
          <button type="button" className="changes" disabled={busy || dirty} onClick={() => void changeState("request-changes")}>
            Вернуть на доработку
          </button>
        ) : null}
        {available?.approve ? (
          <button type="button" className="publish" disabled={busy || dirty} onClick={() => void changeState("approve")}>
            Одобрить версию
          </button>
        ) : null}
        {available?.publish ? (
          <button type="button" className="publish" disabled={busy || dirty} onClick={() => void changeState("publish")}>
            Опубликовать одобренную версию
          </button>
        ) : null}
      </div>
      {dirty ? <p className="publication-hint">Сначала сохраните изменения.</p> : null}
      {current?.draft && siteSlug && ["globals", "header", "footer"].includes(resource ?? "") ? (
        <div className="cms-preview-action">
          <span>Предпросмотр открывает именно текущую версию</span>
          <a
            href={`/preview/${encodeURIComponent(siteSlug)}?cmsSiteId=${encodeURIComponent(siteId)}&cmsSiteSettings=${resource}&cmsRevisionId=${encodeURIComponent(current.draft.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            Открыть предпросмотр ↗
          </a>
        </div>
      ) : null}
      {history.length ? (
        <details className="item-seo-editor">
          <summary>История версий ({history.length})</summary>
          {history.map((revision) => (
            <div className="publication-meta" key={revision.id}>
              <span>
                Версия №{revision.versionNumber}
                {revision.id === current?.publishedRevisionId ? " · опубликована" : ""}
              </span>
              {canEdit && revision.id !== current?.draft?.id ? (
                <button type="button" disabled={busy || dirty} onClick={() => void restore(revision)}>
                  Восстановить как новый черновик
                </button>
              ) : null}
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
