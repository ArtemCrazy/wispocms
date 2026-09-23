"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type Kind = "template" | "chunk";
type Parameter = {
  key: string;
  label: string;
  type: "text" | "image" | "icon" | "html";
};
type CodeResource = {
  id: string;
  kind: Kind;
  name: string;
  key: string;
  html: string;
  parameters: Parameter[];
  draftRevisionId: string;
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

const emptyResource = (kind: Kind): CodeResource => ({
  id: "",
  kind,
  name: "",
  key: "",
  html: kind === "chunk" ? "<section>\n  <h2>{{title}}</h2>\n</section>" : "<main>\n  {{content}}\n</main>",
  parameters:
    kind === "chunk"
      ? [{ key: "title", label: "Заголовок", type: "text" }]
      : [{ key: "content", label: "Содержимое", type: "html" }],
  draftRevisionId: "",
});

export function CodeResourcesEditor({
  siteId,
  canEdit,
  canApprove,
}: {
  siteId: string;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const [kind, setKind] = useState<Kind>("chunk");
  const [items, setItems] = useState<CodeResource[]>([]);
  const [draft, setDraft] = useState<CodeResource>(() => emptyResource("chunk"));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const rows = await request<CodeResource[]>(
      `/api/sites/${siteId}/content/code-resources/${kind}`,
    );
    setItems(rows);
    setDraft((current) => {
      if (!current.id) return emptyResource(kind);
      return rows.find((row) => row.id === current.id) ?? emptyResource(kind);
    });
    setDirty(false);
  }, [kind, siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  function update(next: Partial<CodeResource>) {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await request<CodeResource>(
        `/api/sites/${siteId}/content/code-resources/${kind}${draft.id ? `/${draft.id}` : ""}`,
        {
          method: draft.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: draft.name,
            key: draft.key,
            html: draft.html,
            parameters: draft.parameters,
            ...(draft.id
              ? { expectedDraftRevisionId: draft.draftRevisionId }
              : {}),
          }),
        },
      );
      setDraft(saved);
      setDirty(false);
      setMessage("HTML сохранён как новая версия черновика");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="media-editor-card">
      <div className="media-card-title">
        <div>
          <h2>HTML-шаблоны и чанки</h2>
          <p>Редактируется только HTML. JavaScript, CSS и обработчики событий запрещены.</p>
        </div>
        <div className="media-editor-actions">
          {(["chunk", "template"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? "active" : "secondary"}
              onClick={() => {
                setKind(value);
                setDraft(emptyResource(value));
              }}
            >
              {value === "chunk" ? "Чанки" : "Шаблоны"}
            </button>
          ))}
        </div>
      </div>
      {message ? <p className="inline-message">{message}</p> : null}
      <div className="media-template-manager">
        {items.map((item) => (
          <button
            type="button"
            className="secondary"
            key={item.id}
            onClick={() => {
              setDraft(item);
              setDirty(false);
            }}
          >
            {item.name} · {item.key}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setDraft(emptyResource(kind));
            setDirty(false);
          }}
        >
          Создать {kind === "chunk" ? "чанг" : "шаблон"}
        </button>
      </div>
      <form className="settings-form" onSubmit={save}>
        <label>
          Название
          <input
            required
            maxLength={160}
            value={draft.name}
            readOnly={!canEdit}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label>
          Ключ
          <input
            required
            pattern="[a-z][a-z0-9_-]*"
            maxLength={100}
            value={draft.key}
            readOnly={!canEdit}
            onChange={(event) => update({ key: event.target.value })}
          />
        </label>
        <div className="media-editor-card">
          <div className="media-card-title">
            <h3>Параметры</h3>
            {canEdit ? (
              <button
                type="button"
                onClick={() =>
                  update({
                    parameters: [
                      ...draft.parameters,
                      { key: "parameter", label: "Параметр", type: "text" },
                    ],
                  })
                }
              >
                Добавить параметр
              </button>
            ) : null}
          </div>
          {draft.parameters.map((parameter, index) => (
            <div className="media-editor-actions" key={`${parameter.key}-${index}`}>
              <input
                aria-label="Ключ параметра"
                value={parameter.key}
                readOnly={!canEdit}
                onChange={(event) =>
                  update({
                    parameters: draft.parameters.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, key: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                aria-label="Название параметра"
                value={parameter.label}
                readOnly={!canEdit}
                onChange={(event) =>
                  update({
                    parameters: draft.parameters.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
              <select
                aria-label="Тип параметра"
                value={parameter.type}
                disabled={!canEdit}
                onChange={(event) =>
                  update({
                    parameters: draft.parameters.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, type: event.target.value as Parameter["type"] }
                        : item,
                    ),
                  })
                }
              >
                <option value="text">Текст</option>
                <option value="image">Изображение</option>
                <option value="icon">Иконка</option>
                <option value="html">HTML</option>
              </select>
            </div>
          ))}
        </div>
        <label>
          HTML-код
          <textarea
            required
            rows={16}
            value={draft.html}
            readOnly={!canEdit}
            spellCheck={false}
            onChange={(event) => update({ html: event.target.value })}
          />
        </label>
        <div className="media-editor-actions">
          <button disabled={!canEdit || busy || !dirty}>
            {busy ? "Сохраняем…" : "Сохранить версию"}
          </button>
        </div>
      </form>
      <iframe
        title="Предпросмотр HTML"
        sandbox=""
        srcDoc={draft.html}
        className="code-resource-preview"
      />
      {draft.id ? (
        <SiteSettingsRevisionPanel
          siteId={siteId}
          basePath={`code-resources/${kind}/${draft.id}`}
          label={`${kind === "chunk" ? "Чанг" : "Шаблон"} «${draft.name}»`}
          canEdit={canEdit}
          canApprove={canApprove}
          dirty={dirty}
          refreshToken={draft.draftRevisionId}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}
