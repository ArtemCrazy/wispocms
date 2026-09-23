"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type SiteVariable = {
  id: string;
  name: string;
  identifier: string;
  value: string;
  usageCount: number;
  updatedAt?: string;
};

type VariablesDraft = {
  items: SiteVariable[];
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

function identifierFromName(value: string) {
  const source = value
    .toLocaleLowerCase("ru")
    .replace(/[а-яё]/g, (letter) => {
      const from = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
      const to = [
        "a",
        "b",
        "v",
        "g",
        "d",
        "e",
        "e",
        "zh",
        "z",
        "i",
        "y",
        "k",
        "l",
        "m",
        "n",
        "o",
        "p",
        "r",
        "s",
        "t",
        "u",
        "f",
        "h",
        "c",
        "ch",
        "sh",
        "sch",
        "",
        "y",
        "",
        "e",
        "yu",
        "ya",
      ];
      return to[from.indexOf(letter)] ?? letter;
    })
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return source || "variable";
}

export function SiteVariablesView({
  siteId,
  siteName,
  canEdit = true,
  canApprove = false,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
  canApprove?: boolean;
}) {
  const [items, setItems] = useState<SiteVariable[]>([]);
  const [draftRevisionId, setDraftRevisionId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SiteVariable | null>(null);
  const [creating, setCreating] = useState(false);
  const [generatedIdentifier, setGeneratedIdentifier] = useState("");
  const [identifierEdited, setIdentifierEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const draft = await request<VariablesDraft>(
      `/api/sites/${siteId}/content/versioned/variables`,
    );
    setItems(
      draft.items.map((item) => ({ ...item, usageCount: item.usageCount ?? 0 })),
    );
    setDraftRevisionId(draft.draftRevisionId);
  }, [siteId]);

  async function persist(nextItems: SiteVariable[]) {
    if (!siteId) return;
    const result = await request<VariablesDraft>(
      `/api/sites/${siteId}/content/versioned/variables`,
      {
        method: "PUT",
        body: JSON.stringify({
          expectedDraftRevisionId: draftRevisionId,
          snapshot: {
            items: nextItems.map(({ id, name, identifier, value }) => ({
              id,
              name,
              identifier,
              value,
            })),
          },
        }),
      },
    );
    setItems(
      result.items.map((item) => ({ ...item, usageCount: item.usageCount ?? 0 })),
    );
    setDraftRevisionId(result.draftRevisionId);
  }

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !canEdit) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const next: SiteVariable = {
        id: editing?.id ?? crypto.randomUUID(),
        name: String(data.get("name") ?? ""),
        identifier: String(data.get("identifier") ?? ""),
        value: String(data.get("value") ?? ""),
        usageCount: editing?.usageCount ?? 0,
      };
      await persist(
        editing
          ? items.map((item) => (item.id === editing.id ? next : item))
          : [...items, next],
      );
      setCreating(false);
      setEditing(null);
      setMessage(
        editing
          ? "Изменение переменной сохранено в черновик"
          : "Переменная добавлена в черновик",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: SiteVariable) {
    if (!siteId || !canEdit) return;
    const warning = item.usageCount
      ? `Переменная используется в ${item.usageCount} элементах и не может быть удалена.`
      : `Удалить переменную «${item.name}»?`;
    if (item.usageCount) {
      setMessage(warning);
      return;
    }
    if (!window.confirm(warning)) return;
    try {
      await persist(items.filter((candidate) => candidate.id !== item.id));
      setMessage("Удаление переменной сохранено в черновик");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка запроса");
    }
  }

  const formItem = editing;
  return (
    <section className="media-module-shell media-variables-view">
      <header className="media-module-heading">
        <div>
          <small>САЙТ</small>
          <h1>Переменные</h1>
        </div>
        <p>
          Значения для шаблонов и контента{" "}
          {siteName ? `сайта «${siteName}»` : "сайта"}. Вставляйте их как{" "}
          {"{{identifier}}"}.
        </p>
      </header>
      <div className="media-list-toolbar">
        <span>{items.length} переменных</span>
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditing(null);
              setGeneratedIdentifier("");
              setIdentifierEdited(false);
            }}
          >
            + Создать переменную
          </button>
        ) : null}
      </div>
      {message ? <p className="inline-message">{message}</p> : null}
      {creating || editing ? (
        <form className="media-editor-card" onSubmit={save}>
          <label>
            Название
            <input
              name="name"
              required
              defaultValue={formItem?.name ?? ""}
              onChange={(event) => {
                if (!editing && !identifierEdited)
                  setGeneratedIdentifier(
                    identifierFromName(event.target.value),
                  );
              }}
            />
          </label>
          <label>
            Идентификатор
            <input
              name="identifier"
              required
              pattern="[a-z][a-z0-9_]*"
              value={editing?.identifier ?? generatedIdentifier}
              onChange={(event) => {
                if (editing)
                  setEditing({ ...editing, identifier: event.target.value });
                else {
                  setIdentifierEdited(true);
                  setGeneratedIdentifier(event.target.value);
                }
              }}
            />
            <small>
              Латиница, цифры и подчёркивание; первый символ — буква.
            </small>
          </label>
          <label>
            Значение
            <textarea
              name="value"
              rows={5}
              required
              defaultValue={formItem?.value ?? ""}
            />
          </label>
          <div className="media-editor-actions">
            <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      <div className="media-variable-list">
        {items.map((item) => (
          <article key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <code>{`{{${item.identifier}}}`}</code>
              <p>{item.value}</p>
              <small>
                {item.updatedAt
                  ? `Обновлено ${new Date(item.updatedAt).toLocaleString("ru-RU")} · `
                  : ""}
                Использований: {item.usageCount}
              </small>
            </div>
            {canEdit ? (
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditing(item);
                    setCreating(false);
                  }}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void remove(item)}
                >
                  Удалить
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {!items.length ? (
          <div className="empty-media">
            <h2>Переменных пока нет</h2>
            <p>Создайте первое значение для повторного использования.</p>
          </div>
        ) : null}
      </div>
      {siteId ? (
        <SiteSettingsRevisionPanel
          siteId={siteId}
          resource="variables"
          label="Переменные"
          canEdit={canEdit}
          canApprove={canApprove}
          dirty={false}
          refreshToken={draftRevisionId}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}
