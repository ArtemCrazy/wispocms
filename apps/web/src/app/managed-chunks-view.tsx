"use client";

import Image from "next/image";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  initialManagedChunkData,
  managedChunkActions,
  managedChunkDraftDirty,
  managedChunkWorkflowEnabled,
  normalizeManagedChunkDraft,
  siteManagedChunkImages,
  type ManagedChunkCatalog,
  type ManagedChunkCatalogDefinition,
  type ManagedChunkField,
  type ManagedChunkImageValue,
  type ManagedChunkInstanceDetail,
  type ManagedChunkInstanceSummary,
  type ManagedChunkMediaItem,
  type ManagedChunkReviewState,
} from "./managed-chunks-model";


type EditorState = {
  mode: "create" | "edit";
  definition: ManagedChunkCatalogDefinition;
  detail: ManagedChunkInstanceDetail | null;
  displayName: string;
  baselineDisplayName: string;
  values: Record<string, unknown>;
  baselineValues: Record<string, unknown>;
};

type WorkflowAction =
  | "submit"
  | "approve"
  | "request-changes"
  | "publish"
  | "restore";

const reviewLabels: Record<ManagedChunkReviewState, string> = {
  draft: "Черновик",
  in_review: "На согласовании",
  changes_requested: "На доработке",
  approved: "Одобрено",
};

function safeApiMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === "string" && message.trim()) return message.slice(0, 500);
  if (Array.isArray(message)) {
    const lines = message.filter((item): item is string => typeof item === "string");
    if (lines.length) return lines.join(", ").slice(0, 500);
  }
  return fallback;
}

async function request<T>(
  url: string,
  init?: RequestInit,
  fallback = "Не удалось выполнить запрос",
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(safeApiMessage(payload, fallback));
  }
  return response.json() as Promise<T>;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Дата не указана"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function ImageField({
  field,
  value,
  media,
  siteId,
  disabled,
  onChange,
}: {
  field: Extract<ManagedChunkField, { widget: "image" }>;
  value: unknown;
  media: ManagedChunkMediaItem[];
  siteId: string;
  disabled: boolean;
  onChange: (value: ManagedChunkImageValue | null) => void;
}) {
  const image = value && typeof value === "object" ? (value as ManagedChunkImageValue) : null;
  const selected = media.find((item) => item.id === image?.mediaId) ?? null;

  return (
    <fieldset className="managed-chunks-image-field">
      <legend>{field.label}</legend>
      <label className="managed-chunks-field">
        <span>Файл</span>
        <select
          value={image?.mediaId ?? ""}
          required={Boolean(field.required && !field.nullable)}
          disabled={disabled}
          onChange={(event) => {
            const item = media.find((candidate) => candidate.id === event.target.value);
            onChange(
              item
                ? {
                    mediaId: item.id,
                    alt: item.altText ?? "",
                    decorative: false,
                  }
                : null,
            );
          }}
        >
          <option value="">Не выбрано</option>
          {media.map((item) => (
            <option value={item.id} key={item.id}>
              {item.originalName}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <div className="managed-chunks-image-preview">
          <Image
            unoptimized
            width={180}
            height={110}
            src={`/api/sites/${encodeURIComponent(siteId)}/content/media/${encodeURIComponent(selected.id)}/file`}
            alt=""
          />
          <span>{selected.originalName}</span>
        </div>
      ) : null}
      {image ? (
        <>
          <label className="managed-chunks-field">
            <span>Альтернативный текст</span>
            <input
              value={image.alt}
              maxLength={500}
              disabled={disabled || image.decorative}
              required={!image.decorative}
              onChange={(event) => onChange({ ...image, alt: event.target.value })}
            />
          </label>
          <label className="managed-chunks-switch">
            <input
              type="checkbox"
              checked={image.decorative}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...image,
                  decorative: event.target.checked,
                  alt: event.target.checked ? "" : image.alt,
                })
              }
            />
            <span>Декоративное изображение</span>
          </label>
        </>
      ) : null}
      {field.help ? <small>{field.help}</small> : null}
    </fieldset>
  );
}

export function ManagedChunksView({
  siteId,
  siteName,
  canEdit,
  onDirtyChange,
}: {
  siteId: string;
  siteName?: string;
  canEdit: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<ManagedChunkCatalog | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [instances, setInstances] = useState<ManagedChunkInstanceSummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [media, setMedia] = useState<ManagedChunkMediaItem[]>([]);
  const [editorError, setEditorError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const base = `/api/sites/${encodeURIComponent(siteId)}/content/chunks`;

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setMessage("");
    try {
      const result = await request<ManagedChunkCatalog>(
        `${base}/catalog`,
        undefined,
        "Не удалось загрузить каталог чанков",
      );
      setCatalog(result);
      setActiveCategory((current) =>
        result.categories.some((category) => category.key === current)
          ? current
          : (result.categories[0]?.key ?? ""),
      );
    } catch (error) {
      setCatalog(null);
      setActiveCategory("");
      setMessage(
        error instanceof Error ? error.message : "Не удалось загрузить каталог чанков",
      );
    } finally {
      setCatalogLoading(false);
    }
  }, [base]);

  const loadInstances = useCallback(async () => {
    if (!activeCategory) {
      setInstances([]);
      setListError("");
      return;
    }
    setListLoading(true);
    setListError("");
    try {
      setInstances(
        await request<ManagedChunkInstanceSummary[]>(
          `${base}/instances?categoryKey=${encodeURIComponent(activeCategory)}`,
          undefined,
          "Не удалось загрузить чанки",
        ),
      );
    } catch (error) {
      setInstances([]);
      setListError(error instanceof Error ? error.message : "Не удалось загрузить чанки");
    } finally {
      setListLoading(false);
    }
  }, [activeCategory, base]);

  const loadMedia = useCallback(async () => {
    const rows = await request<ManagedChunkMediaItem[]>(
      `/api/sites/${encodeURIComponent(siteId)}/content/media`,
      undefined,
      "Не удалось загрузить медиатеку",
    );
    setMedia(siteManagedChunkImages(rows, siteId));
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadInstances(), 0);
    return () => window.clearTimeout(timer);
  }, [loadInstances]);


  const activeCategoryData = catalog?.categories.find(
    (category) => category.key === activeCategory,
  );
  const definitionTitles = useMemo(
    () =>
      new Map(
        (catalog?.categories ?? []).flatMap((category) =>
          category.definitions.map((definition) => [
            `${definition.key}:${definition.schemaVersion}`,
            definition.title,
          ] as const),
        ),
      ),
    [catalog],
  );
  const editorDirty = editor
    ? managedChunkDraftDirty(
        editor.definition.fields,
        editor.baselineValues,
        editor.values,
        editor.baselineDisplayName,
        editor.displayName,
      )
    : false;
  const editorActions = editor?.detail
    ? managedChunkActions(editor.detail)
    : null;
  const editorOpen = editor !== null;

  useEffect(() => {
    if (!editorDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [editorDirty]);

  useEffect(() => {
    onDirtyChange?.(editorDirty);
    return () => onDirtyChange?.(false);
  }, [editorDirty, onDirtyChange]);

  useEffect(() => {
    if (!editorOpen) return;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const previousAriaHidden = shell?.getAttribute("aria-hidden") ?? null;
    const previousInert = shell?.inert ?? false;
    dialogRef.current
      ?.querySelector<HTMLElement>("#managed-chunks-dialog-title")
      ?.focus();
    if (shell) {
      shell.inert = true;
      shell.setAttribute("aria-hidden", "true");
    }
    return () => {
      if (shell) {
        shell.inert = previousInert;
        if (previousAriaHidden === null) shell.removeAttribute("aria-hidden");
        else shell.setAttribute("aria-hidden", previousAriaHidden);
      }
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [editorOpen]);

  function rememberEditorOpener() {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function requestCloseEditor(): boolean {
    if (!editor || busy) return false;
    if (
      editorDirty &&
      !window.confirm("Закрыть редактор? Несохранённые изменения потеряются.")
    )
      return false;
    setEditor(null);
    return true;
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestCloseEditor();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && currentIndex <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      first.focus();
    }
  }

  async function openCreate(definition?: ManagedChunkCatalogDefinition) {
    const selected = definition ?? activeCategoryData?.definitions[0];
    if (!selected) return;
    rememberEditorOpener();
    setEditorError("");
    setEditor({
      mode: "create",
      definition: selected,
      detail: null,
      displayName: "",
      baselineDisplayName: "",
      values: initialManagedChunkData(selected.fields),
      baselineValues: initialManagedChunkData(selected.fields),
    });
    try {
      await loadMedia();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось загрузить медиатеку");
    }
  }

  async function openEdit(instanceId: string) {
    rememberEditorOpener();
    setOpeningId(instanceId);
    setMessage("");
    try {
      const [detail] = await Promise.all([
        request<ManagedChunkInstanceDetail>(
          `${base}/instances/${encodeURIComponent(instanceId)}`,
          undefined,
          "Не удалось открыть чанк",
        ),
        loadMedia(),
      ]);
      const definition = activeCategoryData?.definitions.find(
        (item) =>
          item.key === detail.definitionKey && item.schemaVersion === detail.schemaVersion,
      );
      if (!definition) throw new Error("Определение чанка недоступно в каталоге сайта");
      setEditorError("");
      setEditor({
        mode: "edit",
        definition: { ...definition, fields: detail.fields },
        detail,
        displayName: detail.displayName,
        baselineDisplayName: detail.displayName,
        values: {
          ...initialManagedChunkData(detail.fields),
          ...(detail.draft?.data ?? detail.published?.data ?? {}),
        },
        baselineValues: {
          ...initialManagedChunkData(detail.fields),
          ...(detail.draft?.data ?? detail.published?.data ?? {}),
        },
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось открыть чанк");
    } finally {
      setOpeningId(null);
    }
  }

  function updateValue(key: string, value: unknown) {
    setEditor((current) =>
      current ? { ...current, values: { ...current.values, [key]: value } } : current,
    );
  }

  async function reloadOpenEditor(instanceId: string) {
    const detail = await request<ManagedChunkInstanceDetail>(
      `${base}/instances/${encodeURIComponent(instanceId)}`,
      undefined,
      "Не удалось обновить состояние чанка",
    );
    setEditor((current) =>
      current
        ? {
            ...current,
            detail,
            definition: { ...current.definition, fields: detail.fields },
            displayName: detail.displayName,
            baselineDisplayName: detail.displayName,
            values: {
              ...initialManagedChunkData(detail.fields),
              ...(detail.draft?.data ?? detail.published?.data ?? {}),
            },
            baselineValues: {
              ...initialManagedChunkData(detail.fields),
              ...(detail.draft?.data ?? detail.published?.data ?? {}),
            },
          }
        : current,
    );
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setEditorError("");
    try {
      const data = normalizeManagedChunkDraft(editor.definition.fields, editor.values);
      const displayName = editor.displayName.trim();
      if (!displayName) throw new Error("Укажите название чанка");
      let successMessage = "";
      if (editor.mode === "create") {
        await request(
          `${base}/instances`,
          {
            method: "POST",
            body: JSON.stringify({
              displayName,
              contractId: editor.definition.contractId,
              data,
            }),
          },
          "Не удалось создать черновик",
        );
        setEditor(null);
        successMessage = "Черновик чанка создан. Публичная версия сайта не изменилась";
      } else if (editor.detail) {
        await request(
          `${base}/instances/${encodeURIComponent(editor.detail.id)}/draft`,
          {
            method: "PUT",
            body: JSON.stringify({
              data,
              expectedDraftRevisionId: editor.detail.draft?.id ?? null,
            }),
          },
          "Не удалось сохранить черновик",
        );
        await reloadOpenEditor(editor.detail.id);
        successMessage = "Черновик сохранён. Публичная версия сайта не изменилась";
      }
      await loadInstances();
      setMessage(successMessage);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сохранить черновик");
    } finally {
      setBusy(false);
    }
  }

  async function runWorkflow(action: WorkflowAction) {
    if (!editor?.detail || busy) return;
    const detail = editor.detail;
    const modelAction =
      action === "request-changes" ? "requestChanges" : action;
    if (!managedChunkWorkflowEnabled(detail, modelAction, editorDirty)) {
      setEditorError(
        editorDirty
          ? "Сначала сохраните черновик"
          : "Действие больше недоступно. Обновите карточку чанка",
      );
      return;
    }
    let reason: string | null = null;
    if (action === "request-changes") {
      reason = window.prompt("Что нужно исправить в этой версии?")?.trim() ?? null;
      if (!reason) return;
    }
    if (
      action === "publish" &&
      !window.confirm("Опубликовать текущую версию чанка?")
    )
      return;
    if (
      action === "restore" &&
      !window.confirm("Восстановить опубликованную версию как новый черновик?")
    )
      return;

    const revisionId =
      action === "restore" ? detail.published?.id : detail.draft?.id;
    if (!revisionId) {
      setEditorError("Версия для этого действия недоступна");
      return;
    }
    setBusy(true);
    setEditorError("");
    try {
      await request(
        `${base}/instances/${encodeURIComponent(detail.id)}/revisions/${encodeURIComponent(revisionId)}/${action}`,
        {
          method: "POST",
          ...(action === "request-changes"
            ? { body: JSON.stringify({ reason }) }
            : action === "restore"
              ? {
                  body: JSON.stringify({
                    expectedDraftRevisionId: detail.draft?.id ?? null,
                  }),
                }
              : {}),
        },
        "Не удалось изменить состояние чанка",
      );
      await Promise.all([reloadOpenEditor(detail.id), loadInstances()]);
      const success: Record<WorkflowAction, string> = {
        submit: "Чанк отправлен на согласование",
        approve: "Чанк одобрен",
        "request-changes": "Чанк возвращён на доработку",
        publish: "Чанк опубликован",
        restore: "Опубликованная версия восстановлена как новый черновик",
      };
      setMessage(success[action]);
    } catch (error) {
      setEditorError(
        error instanceof Error ? error.message : "Не удалось изменить состояние чанка",
      );
    } finally {
      setBusy(false);
    }
  }

  if (catalogLoading) {
    return <div className="managed-chunks-state">Загружаем каталог чанков…</div>;
  }

  if (!catalog) {
    return (
      <section className="managed-chunks-shell">
        <header className="managed-chunks-heading">
          <div><small>САЙТ</small><h1>Чанки</h1></div>
        </header>
        <div className="managed-chunks-state managed-chunks-state--error" role="alert">
          <strong>Каталог чанков недоступен</strong>
          <p>{message || "Обновите страницу или повторите попытку позже."}</p>
          <button type="button" onClick={() => void loadCatalog()}>Повторить</button>
        </div>
      </section>
    );
  }

  return (
    <section className="managed-chunks-shell">
      <header className="managed-chunks-heading">
        <div>
          <small>САЙТ</small>
          <h1>Чанки</h1>
        </div>
        <p>
          {siteName
            ? `Управляемые блоки сайта «${siteName}».`
            : "Управляемые блоки выбранного сайта."}
        </p>
      </header>

      {message ? <div className="managed-chunks-message" role="status">{message}</div> : null}

      {catalog.categories.length ? (
        <>
          <div className="managed-chunks-toolbar">
            <div className="managed-chunks-tabs" role="tablist" aria-label="Категории чанков">
              {catalog.categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category.key}
                  className={activeCategory === category.key ? "active" : ""}
                  onClick={() => setActiveCategory(category.key)}
                >
                  {category.title}
                </button>
              ))}
            </div>
            {canEdit && activeCategoryData?.definitions.length ? (
              <button
                type="button"
                className="managed-chunks-create"
                onClick={() => void openCreate()}
              >
                Создать чанк
              </button>
            ) : null}
          </div>

          {listLoading ? (
            <div className="managed-chunks-state">Загружаем чанки…</div>
          ) : listError ? (
            <div className="managed-chunks-state managed-chunks-state--error" role="alert">
              <strong>Не удалось загрузить чанки</strong>
              <p>{listError}</p>
              <button type="button" onClick={() => void loadInstances()}>Повторить</button>
            </div>
          ) : instances.length ? (
            <div className="managed-chunks-list">
              <div className="managed-chunks-list-head" aria-hidden="true">
                <span>Название</span><span>Тип</span><span>Статус</span><span>Изменён</span><span />
              </div>
              {instances.map((instance) => (
                <button
                  type="button"
                  className="managed-chunks-row"
                  key={instance.id}
                  disabled={openingId === instance.id}
                  onClick={() => void openEdit(instance.id)}
                >
                  <strong>{instance.displayName}</strong>
                  <span>
                    {definitionTitles.get(`${instance.definitionKey}:${instance.schemaVersion}`) ??
                      instance.definitionKey}
                  </span>
                  <span className={`managed-chunks-status managed-chunks-status--${instance.reviewState}`}>
                    {reviewLabels[instance.reviewState]}
                  </span>
                  <time dateTime={instance.updatedAt}>{formatUpdatedAt(instance.updatedAt)}</time>
                  <span className="managed-chunks-open">
                    {openingId === instance.id ? "Открываем…" : "Открыть"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="managed-chunks-state">
              <strong>В этой категории пока нет чанков</strong>
              <p>Создайте первый черновик. Он не появится на сайте до публикации.</p>
              {canEdit && activeCategoryData?.definitions.length ? (
                <button type="button" onClick={() => void openCreate()}>Создать чанк</button>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <div className="managed-chunks-state">
          <strong>Каталог чанков пуст</strong>
          <p>Для этого сайта пока нет доступных определений.</p>
        </div>
      )}

      {editor
        ? createPortal(
            <div className="managed-chunks-overlay" role="presentation">
          <section
            ref={dialogRef}
            className="managed-chunks-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="managed-chunks-dialog-title"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <div>
                <small>{editor.definition.title}</small>
                <h2 id="managed-chunks-dialog-title" tabIndex={-1}>
                  {editor.mode === "create" ? "Новый чанк" : editor.displayName}
                </h2>
              </div>
              <button
                type="button"
                className="managed-chunks-close"
                aria-label="Закрыть редактор"
                disabled={busy}
                onClick={requestCloseEditor}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </header>

            {editor.detail ? (
              <div className="managed-chunks-version-state">
                <span>
                  <small>Опубликовано</small>
                  <strong>
                    {editor.detail.published
                      ? `Версия ${editor.detail.published.versionNumber}`
                      : "Нет опубликованной версии"}
                  </strong>
                </span>
                <span>
                  <small>Текущий черновик</small>
                  <strong>
                    {editor.detail.draft
                      ? `Версия ${editor.detail.draft.versionNumber} · ${reviewLabels[editor.detail.reviewState]}`
                      : "Нет черновика"}
                  </strong>
                </span>
              </div>
            ) : (
              <p className="managed-chunks-draft-note">
                Сохранение создаст черновик. На публичном сайте он не появится.
              </p>
            )}

            {editorError ? <div className="managed-chunks-message managed-chunks-message--error" role="alert">{editorError}</div> : null}

            <form onSubmit={(event) => void saveDraft(event)}>
              <label className="managed-chunks-field">
                <span>Название чанка</span>
                <input
                  value={editor.displayName}
                  minLength={1}
                  maxLength={160}
                  required
                  disabled={busy || editor.mode === "edit"}
                  onChange={(event) =>
                    setEditor((current) => current ? { ...current, displayName: event.target.value } : current)
                  }
                />
              </label>

              {editor.mode === "create" && activeCategoryData && activeCategoryData.definitions.length > 1 ? (
                <label className="managed-chunks-field">
                  <span>Тип чанка</span>
                  <select
                    value={editor.definition.contractId}
                    disabled={busy}
                    onChange={(event) => {
                      const definition = activeCategoryData.definitions.find(
                        (item) => item.contractId === event.target.value,
                      );
                      if (!definition) return;
                      setEditor((current) =>
                        current
                          ? {
                              ...current,
                              definition,
                              values: initialManagedChunkData(definition.fields),
                              baselineValues: initialManagedChunkData(definition.fields),
                            }
                          : current,
                      );
                    }}
                  >
                    {activeCategoryData.definitions.map((definition) => (
                      <option key={definition.contractId} value={definition.contractId}>
                        {definition.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="managed-chunks-fields">
                {editor.definition.fields.map((field) => {
                  const fieldValue = editor.values[field.key];
                  const disabled =
                    busy ||
                    (editor.mode === "edit" && !editorActions?.save);
                  if (field.widget === "image") {
                    return (
                      <ImageField
                        key={field.key}
                        field={field}
                        value={editor.values[field.key]}
                        media={media}
                        siteId={siteId}
                        disabled={disabled}
                        onChange={(value) => updateValue(field.key, value)}
                      />
                    );
                  }
                  if (field.widget === "boolean") {
                    return (
                      <label className="managed-chunks-switch" key={field.key}>
                        <input
                          type="checkbox"
                          checked={editor.values[field.key] === true}
                          disabled={disabled}
                          onChange={(event) => updateValue(field.key, event.target.checked)}
                        />
                        <span>{field.label}</span>
                        {field.help ? <small>{field.help}</small> : null}
                      </label>
                    );
                  }
                  return (
                    <label className="managed-chunks-field" key={field.key}>
                      <span>{field.label}</span>
                      {field.widget === "textarea" ? (
                        <textarea
                          value={typeof fieldValue === "string" ? fieldValue : ""}
                          required={Boolean(field.required && !field.nullable)}
                          minLength={field.constraints?.minLength}
                          maxLength={field.constraints?.maxLength}
                          disabled={disabled}
                          onChange={(event) => updateValue(field.key, event.target.value)}
                        />
                      ) : (
                        <input
                          type={field.widget === "number" ? "number" : "text"}
                          value={
                            typeof fieldValue === "string" ||
                            typeof fieldValue === "number"
                              ? fieldValue
                              : ""
                          }
                          required={Boolean(field.required && !field.nullable)}
                          min={field.widget === "number" ? field.constraints?.min : undefined}
                          max={field.widget === "number" ? field.constraints?.max : undefined}
                          step={field.widget === "number" ? field.constraints?.step : undefined}
                          minLength={field.widget === "text" ? field.constraints?.minLength : undefined}
                          maxLength={field.widget === "text" ? field.constraints?.maxLength : undefined}
                          disabled={disabled}
                          onChange={(event) => updateValue(field.key, event.target.value)}
                        />
                      )}
                      {field.help ? <small>{field.help}</small> : null}
                    </label>
                  );
                })}
              </div>

              {editor.detail && editorDirty ? (
                <p className="managed-chunks-dirty-hint" role="status">
                  Сначала сохраните черновик
                </p>
              ) : null}

              <footer>
                <div className="managed-chunks-workflow">
                  {editorActions?.submit ? (
                    <button type="button" disabled={busy || editorDirty} onClick={() => void runWorkflow("submit")}>Отправить</button>
                  ) : null}
                  {editorActions?.approve ? (
                    <button type="button" disabled={busy || editorDirty} onClick={() => void runWorkflow("approve")}>Одобрить</button>
                  ) : null}
                  {editorActions?.requestChanges ? (
                    <button type="button" className="secondary" disabled={busy || editorDirty} onClick={() => void runWorkflow("request-changes")}>Вернуть на доработку</button>
                  ) : null}
                  {editorActions?.publish ? (
                    <button type="button" disabled={busy || editorDirty} onClick={() => void runWorkflow("publish")}>Опубликовать</button>
                  ) : null}
                  {editorActions?.restore ? (
                    <button type="button" className="secondary" disabled={busy || editorDirty} onClick={() => void runWorkflow("restore")}>Восстановить</button>
                  ) : null}
                </div>
                <div className="managed-chunks-save-actions">
                  <button type="button" className="secondary" disabled={busy} onClick={requestCloseEditor}>Отмена</button>
                  {(editor.mode === "create" || editorActions?.save) ? (
                    <button type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить черновик"}</button>
                  ) : null}
                </div>
              </footer>
            </form>
          </section>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
