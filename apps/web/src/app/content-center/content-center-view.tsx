"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { PreparedDocument } from "./prepared-document";
import {
  CONTENT_CENTER_SECTIONS,
  parseContentCenterScreen,
  type ContentCenterScreen as Screen,
} from "./navigation";
import styles from "./content-center-view.module.css";

type Material = {
  id: string;
  title: string;
  kind: "text" | "file" | "url";
  source_url: string | null;
  file_name: string | null;
  content?: string;
  revision: number;
  characters: number;
  updated_at: string;
};
type Prompt = { id: string; title: string; content: string };
type Version = {
  id: string;
  number: number;
  actor_name: string;
  created_at: string;
  reason: string;
  restored_from: number | null;
  content?: string;
};
type Overview = {
  materials: Material[];
  prompts: Prompt[];
  versions: Version[];
  run: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    error: string | null;
  } | null;
  ai: { connected: boolean };
  draft: { instruction: string; without_materials: boolean; revision: number };
};
type MaterialDraft = {
  id?: string;
  title: string;
  kind: Material["kind"];
  sourceUrl: string;
  fileName: string;
  content: string;
  revision?: number;
};
const blankMaterial = (): MaterialDraft => ({
  title: "",
  kind: "text",
  sourceUrl: "",
  fileName: "",
  content: "",
});
const formatDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const materialCount = (count: number) =>
  `${count} ${new Intl.PluralRules("ru").select(count) === "one" ? "материал" : new Intl.PluralRules("ru").select(count) === "few" ? "материала" : "материалов"}`;

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(". ")
        : (payload?.message ??
            "Не удалось выполнить действие. Попробуйте ещё раз."),
    );
  return payload as T;
}

function Dialog({
  title,
  children,
  close,
  busy,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={close}
          aria-label="Закрыть окно"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ContentCenterView({
  workspaceId,
  workspaceName,
  onDirtyChange,
  onScreenChange,
}: {
  workspaceId: string;
  workspaceName: string;
  onDirtyChange: (dirty: boolean) => void;
  onScreenChange: (screen: Screen) => void;
}) {
  const base = `/api/workspaces/${workspaceId}/content-center`;
  const [data, setData] = useState<Overview | null>(null);
  const [screen, setScreen] = useState<Screen>("root");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [document, setDocument] = useState<Version | null>(null);
  const [instruction, setInstruction] = useState("");
  const [withoutMaterials, setWithoutMaterials] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [material, setMaterial] = useState<MaterialDraft | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [restoreVersion, setRestoreVersion] = useState<Version | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    const payload = await request<Overview>(base);
    if (alive.current) setData(payload);
    return payload;
  }, [base]);

  useEffect(() => {
    alive.current = true;
    let active = true;
    const restoreScreen = () => {
      const params = new URL(window.location.href).searchParams;
      const target = parseContentCenterScreen(params.get("cc"));
      setScreen(target);
      onScreenChange(target);
      setVersionId(params.get("ccVersion"));
    };
    restoreScreen();
    window.addEventListener("popstate", restoreScreen);
    void load()
      .then((payload) => {
        if (!active) return;
        setInstruction(payload.draft.instruction);
        setWithoutMaterials(
          payload.materials.length ? false : payload.draft.without_materials,
        );
        setDraftRevision(payload.draft.revision);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      alive.current = false;
      window.removeEventListener("popstate", restoreScreen);
      onDirtyChange(false);
    };
  }, [load, onDirtyChange, onScreenChange]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const running =
    data?.run?.status === "queued" || data?.run?.status === "processing";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void load().catch((e) => setError(e.message));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, load]);

  useEffect(() => {
    if (screen !== "document" || !versionId) return;
    let active = true;
    void request<Version>(`${base}/versions/${versionId}`)
      .then((row) => {
        if (active) setDocument(row);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, screen, versionId]);

  function navigate(next: Screen, id?: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("cc", next);
    if (id) url.searchParams.set("ccVersion", id);
    else url.searchParams.delete("ccVersion");
    window.history.pushState({}, "", url);
    setScreen(next);
    onScreenChange(next);
    setVersionId(id ?? null);
    setDocument(null);
    setError("");
    setNotice("");
  }

  async function act(action: () => Promise<void>, modal = false) {
    setBusy(true);
    setError("");
    setDialogError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Не удалось выполнить действие";
      if (modal) setDialogError(message);
      else setError(message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function saveDraft() {
    const result = await request<{ revision: number }>(`${base}/draft`, "PUT", {
      instruction,
      withoutMaterials: data?.materials.length ? false : withoutMaterials,
      revision: draftRevision,
    });
    setDraftRevision(result.revision);
    setDirty(false);
    setNotice("Задача сохранена");
  }

  function changeInstruction(value: string) {
    setInstruction(value);
    setDirty(true);
    setNotice("");
  }

  const latest = data?.versions[0];
  const selectedPrompt = data?.prompts.find((p) => p.id === selectedPromptId);
  const title = {
    root: "Контент-центр",
    preparation: "Подготовка информации",
    research: "Исследование и анализ",
    creation: "Создание контента",
    history: "История версий",
    document: "Обработанная информация",
  }[screen];

  return (
    <section className={styles.view} aria-label="Контент-центр">
      <div className={styles.heading}>
        <div>
          {screen !== "root" && (
            <button
              className={styles.link}
              onClick={() =>
                navigate(
                  screen === "history" || screen === "document"
                    ? "preparation"
                    : "root",
                )
              }
            >
              ←{" "}
              {screen === "history" || screen === "document"
                ? "Подготовка информации"
                : "Контент-центр"}
            </button>
          )}
          <div className={styles.eyebrow}>
            {workspaceName} · общее для сайтов пространства
          </div>
          <h1>{title}</h1>
          <p className={styles.muted}>
            {screen === "root"
              ? "Информация о проекте и подготовка материалов для ваших сайтов."
              : screen === "preparation"
                ? "Добавьте материалы проекта и задайте, какую информацию нужно подготовить."
                : screen === "history"
                  ? "Сохранённые результаты. Восстановление создаёт новую версию."
                  : screen === "document"
                    ? "Документ для чтения и использования на следующих этапах."
                    : CONTENT_CENTER_SECTIONS.find((section) => section.id === screen)?.description}
          </p>
        </div>
        {screen === "preparation" && (
          <button onClick={() => navigate("history")}>
            История версий{data ? ` · ${data.versions.length}` : ""}
          </button>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}
      {!data ? (
        <div className={styles.card}>
          {error ? (
            <button
              onClick={() =>
                void act(async () => {
                  const result = await load();
                  setInstruction(result.draft.instruction);
                  setDraftRevision(result.draft.revision);
                  setWithoutMaterials(result.draft.without_materials);
                })
              }
            >
              Повторить загрузку
            </button>
          ) : (
            "Загружаем данные…"
          )}
        </div>
      ) : (
        <>
          {screen === "root" && (
            <div className={styles.cards}>
              {CONTENT_CENTER_SECTIONS.map((section) => (
                <article
                  key={section.id}
                  className={`${styles.card} ${styles.entry}`}
                >
                  <div>
                    <h2>{section.label}</h2>
                    <p>{section.description}</p>
                    {section.id === "preparation" ? (
                      <p className={styles.muted}>
                        Материалов: {data.materials.length} · Версий результата:{" "}
                        {data.versions.length}
                      </p>
                    ) : (
                      <span className={styles.badge}>Следующий этап</span>
                    )}
                  </div>
                  <button
                    className={section.id === "preparation" ? styles.primary : undefined}
                    aria-label={`Открыть раздел «${section.label}»`}
                    onClick={() => navigate(section.id)}
                  >
                    {section.id === "preparation"
                      ? "Перейти к подготовке →"
                      : "Открыть раздел →"}
                  </button>
                </article>
              ))}
            </div>
          )}

          {(screen === "research" || screen === "creation") && (
            <article className={styles.card}>
              <div className={styles.cardHead}>
                <h2>{screen === "research" ? "Раздел ожидает проектирования" : "Раздел ещё не реализован"}</h2>
              </div>
              <p className={styles.muted}>
                {screen === "research"
                  ? "Исследования и анализ пока недоступны. Структура и рабочие действия появятся после завершения проектирования этого процесса."
                  : "Работа с кластерами, статьями и историей запусков предусмотрена ТЗ и будет реализована на следующем этапе."}
              </p>
              <p>Сейчас можно собрать материалы проекта и сохранить задачу в разделе «Подготовка информации».</p>
              <button onClick={() => navigate("preparation")}>Перейти к подготовке →</button>
            </article>
          )}

          {screen === "preparation" && (
            <>
              {!data.ai.connected && (
                <div className={styles.notice}>
                  <strong>Материалы можно готовить уже сейчас.</strong> AI ещё
                  не подключён. Сохраните источники, промпты и задачу —
                  обработка станет доступна после подключения API.
                </div>
              )}
              <div className={styles.grid}>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Материалы проекта</h2>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMaterial(blankMaterial());
                        setDialogError("");
                      }}
                    >
                      + Добавить
                    </button>
                  </div>
                  <p className={styles.muted}>
                    Все сохранённые материалы автоматически попадут в обработку.
                    Изменение источников не меняет готовые версии.
                  </p>
                  {data.materials.length === 0 ? (
                    <div className={styles.empty}>
                      Добавьте ссылку на страницу, текст или файл TXT /
                      Markdown.
                    </div>
                  ) : (
                    data.materials.map((item) => (
                      <div key={item.id} className={styles.material}>
                        <strong>{item.title}</strong>
                        <p>
                          {item.kind === "url"
                            ? item.source_url
                            : item.kind === "file"
                              ? item.file_name
                              : "Текстовый материал"}{" "}
                          · {item.characters.toLocaleString("ru-RU")} симв.
                        </p>
                        <div className={styles.actions}>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                const row = await request<Material>(
                                  `${base}/materials/${item.id}`,
                                );
                                setMaterial({
                                  id: row.id,
                                  title: row.title,
                                  kind: row.kind,
                                  sourceUrl: row.source_url ?? "",
                                  fileName: row.file_name ?? "",
                                  content: row.content ?? "",
                                  revision: row.revision,
                                });
                              })
                            }
                          >
                            Открыть и изменить
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Удалить материал «${item.title}»? Готовые версии сохранятся.`,
                                )
                              )
                                void act(async () => {
                                  await request(
                                    `${base}/materials/${item.id}?revision=${item.revision}`,
                                    "DELETE",
                                  );
                                  await load();
                                });
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {!data.materials.length && (
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={withoutMaterials}
                        onChange={(e) => {
                          setWithoutMaterials(e.target.checked);
                          setDirty(true);
                        }}
                      />
                      <span>
                        У меня нет материалов
                        <br />
                        <span className={styles.muted}>
                          Использовать только мою задачу. Не добавлять
                          вымышленные факты.
                        </span>
                      </span>
                    </label>
                  )}
                </article>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Задача для AI</h2>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setPromptsOpen(true);
                        setDialogError("");
                        setNewPrompt(null);
                        setSelectedPromptId(data.prompts[0]?.id ?? null);
                      }}
                    >
                      Список промптов
                    </button>
                  </div>
                  <p className={styles.muted}>
                    Опишите структуру документа, нужные акценты или
                    корректировки предыдущего результата.
                  </p>
                  <label className={styles.field}>
                    Ваша инструкция
                    <textarea
                      disabled={busy}
                      value={instruction}
                      maxLength={12000}
                      onChange={(e) => changeInstruction(e.target.value)}
                      placeholder="Собери информацию о компании: продукты, аудитория, преимущества, тон коммуникации. Отдельно перечисли, каких сведений не хватает."
                    />
                  </label>
                  <div className={styles.actions}>
                    <button
                      disabled={busy || !dirty}
                      onClick={() => void act(saveDraft)}
                    >
                      Сохранить задачу
                    </button>
                    <button
                      className={styles.primary}
                      disabled={
                        busy ||
                        running ||
                        !data.ai.connected ||
                        !instruction.trim() ||
                        (!data.materials.length && !withoutMaterials)
                      }
                      onClick={() =>
                        void act(async () => {
                          if (dirty) await saveDraft();
                          await request(`${base}/runs`, "POST", {
                            instruction,
                            withoutMaterials: data.materials.length
                              ? false
                              : withoutMaterials,
                          });
                          await load();
                        })
                      }
                    >
                      {running
                        ? "Обработка выполняется…"
                        : "Подготовить информацию"}
                    </button>
                  </div>
                  <p className={styles.muted}>
                    {dirty
                      ? "Есть несохранённые изменения задачи"
                      : draftRevision
                        ? "Задача сохранена в рабочем пространстве"
                        : "Инструкция пока не задана"}
                  </p>
                  <p className={styles.muted}>
                    Контекст:{" "}
                    {data.materials.length
                      ? materialCount(data.materials.length)
                      : "без материалов"}
                    {latest ? ` и предыдущий результат V${latest.number}` : ""}.
                  </p>
                  {data.run && (
                    <div
                      className={
                        data.run.status === "failed"
                          ? styles.error
                          : styles.notice
                      }
                      role="status"
                      style={{ marginTop: 20 }}
                    >
                      {data.run.status === "queued"
                        ? "Задача в очереди. Можно уйти со страницы — обработка продолжится."
                        : data.run.status === "processing"
                          ? "AI готовит документ. Текущая версия остаётся доступной."
                          : data.run.status === "failed"
                            ? data.run.error
                            : "Обработка завершена. Новая версия доступна ниже."}
                    </div>
                  )}
                </article>
              </div>
              <article className={`${styles.card} ${styles.result}`}>
                <div className={styles.cardHead}>
                  <h2>Обработанная информация</h2>
                  {latest && (
                    <span className={styles.badge}>
                      Текущая · V{latest.number}
                    </span>
                  )}
                </div>
                {latest ? (
                  <>
                    <p className={styles.muted}>
                      {formatDate(latest.created_at)} · {latest.actor_name}
                    </p>
                    <button
                      className={styles.link}
                      onClick={() => navigate("document", latest.id)}
                    >
                      Открыть документ →
                    </button>
                  </>
                ) : (
                  <p className={styles.muted}>
                    Здесь появится документ после первой успешной обработки.
                  </p>
                )}
              </article>
            </>
          )}

          {screen === "history" && (
            <article className={styles.card}>
              {!data.versions.length ? (
                <div className={styles.empty}>
                  Версий пока нет. Они появятся после успешной обработки
                  материалов.
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Версия</th>
                        <th>Создана</th>
                        <th>Пользователь</th>
                        <th>Основание</th>
                        <th>Документ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.versions.map((v) => (
                        <tr key={v.id}>
                          <td>
                            V{v.number}{" "}
                            {v.id === latest?.id && (
                              <span className={styles.badge}>Текущая</span>
                            )}
                          </td>
                          <td>{formatDate(v.created_at)}</td>
                          <td>{v.actor_name}</td>
                          <td>{v.reason}</td>
                          <td>
                            <button onClick={() => navigate("document", v.id)}>
                              Открыть
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}

          {screen === "document" && (
            <article className={`${styles.card} ${styles.document}`}>
              {!versionId ? (
                <p>
                  Выберите документ в{" "}
                  <button
                    className={styles.link}
                    onClick={() => navigate("history")}
                  >
                    истории версий
                  </button>
                  .
                </p>
              ) : !document ? (
                <p>Загружаем документ…</p>
              ) : (
                <>
                  <div className={styles.cardHead}>
                    <div>
                      <span className={styles.badge}>
                        V{document.number} ·{" "}
                        {document.id === latest?.id
                          ? "Текущая версия"
                          : "Историческая версия"}
                      </span>
                      <p className={styles.muted}>
                        {formatDate(document.created_at)} ·{" "}
                        {document.actor_name}
                      </p>
                    </div>
                    {document.id !== latest?.id && (
                      <button
                        disabled={busy || running}
                        onClick={() => {
                          setRestoreVersion(document);
                          setDialogError("");
                        }}
                      >
                        Восстановить эту версию
                      </button>
                    )}
                  </div>
                  <PreparedDocument content={document.content ?? ""} />
                </>
              )}
            </article>
          )}
        </>
      )}

      {material && (
        <Dialog
          title={material.id ? "Изменить материал" : "Добавить материал"}
          busy={busy}
          close={() => setMaterial(null)}
        >
          {dialogError && (
            <div className={styles.error} role="alert">
              {dialogError}
            </div>
          )}
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void act(async () => {
                await request(
                  `${base}/materials${material.id ? `/${material.id}` : ""}`,
                  material.id ? "PUT" : "POST",
                  material,
                );
                await load();
                setMaterial(null);
                setWithoutMaterials(false);
              }, true);
            }}
          >
            <fieldset disabled={busy} className={styles.formFields}>
              {!material.id && (
                <div className={styles.actions}>
                  {(["text", "url", "file"] as const).map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      className={material.kind === kind ? styles.selected : ""}
                      onClick={() => setMaterial({ ...blankMaterial(), kind })}
                    >
                      {{ text: "Текст", url: "Ссылка", file: "Файл" }[kind]}
                    </button>
                  ))}
                </div>
              )}
              <label className={styles.field}>
                Название
                <input
                  autoFocus
                  required
                  maxLength={160}
                  value={material.title}
                  onChange={(e) =>
                    setMaterial({ ...material, title: e.target.value })
                  }
                />
              </label>
              {material.kind === "url" ? (
                <>
                  <label className={styles.field}>
                    Адрес страницы
                    <input
                      type="url"
                      required
                      maxLength={2048}
                      value={material.sourceUrl}
                      placeholder="https://example.ru/about"
                      onChange={(e) =>
                        setMaterial({ ...material, sourceUrl: e.target.value })
                      }
                    />
                  </label>
                  <p className={styles.muted}>
                    Загрузим текст одной публичной HTTPS-страницы. Сайты с
                    авторизацией или содержимым, доступным только через
                    JavaScript, пока добавляйте текстом. При сохранении ссылка
                    читается заново.
                  </p>
                  {material.content && (
                    <details>
                      <summary>Ранее загруженный текст</summary>
                      <div className={styles.promptText}>
                        {material.content}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <>
                  {material.kind === "file" && (
                    <label className={styles.field}>
                      Файл TXT или Markdown, UTF-8
                      <input
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (
                            file.size > 80000 ||
                            !/\.(txt|md)$/i.test(file.name)
                          ) {
                            setDialogError(
                              "Выберите TXT или MD размером до 80 КБ.",
                            );
                            return;
                          }
                          try {
                            const content = await file.text();
                            if (
                              content.length > 40000 ||
                              content.includes("\uFFFD") ||
                              content.includes("\0")
                            )
                              throw new Error(
                                "Нужен текст в UTF-8, до 40 000 символов.",
                              );
                            setMaterial({
                              ...material,
                              title: material.title || file.name,
                              fileName: file.name,
                              content,
                            });
                            setDialogError("");
                          } catch (reason) {
                            setDialogError(
                              reason instanceof Error
                                ? reason.message
                                : "Файл не прочитан",
                            );
                          }
                        }}
                      />
                      {material.fileName && (
                        <span className={styles.muted}>
                          {material.fileName}
                        </span>
                      )}
                    </label>
                  )}
                  <label className={styles.field}>
                    Текст материала
                    <textarea
                      required
                      maxLength={40000}
                      value={material.content}
                      onChange={(e) =>
                        setMaterial({ ...material, content: e.target.value })
                      }
                    />
                  </label>
                  <p className={styles.muted}>
                    До 40 000 символов. PDF, Word, изображения и распознавание
                    добавим отдельно.
                  </p>
                </>
              )}
              <div className={styles.actions} style={{ marginTop: 20 }}>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={
                    busy || (material.kind === "file" && !material.fileName)
                  }
                >
                  {busy ? "Сохраняем…" : "Сохранить материал"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMaterial(null)}
                >
                  Отмена
                </button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      )}

      {promptsOpen && (
        <Dialog
          title="Список промптов"
          busy={busy}
          close={() => setPromptsOpen(false)}
        >
          {dialogError && (
            <div className={styles.error} role="alert">
              {dialogError}
            </div>
          )}
          <div className={styles.promptGrid}>
            <div className={styles.promptList}>
              <button onClick={() => setNewPrompt({ title: "", content: "" })}>
                + Новый промпт
              </button>
              {data?.prompts.map((p) => (
                <button
                  className={
                    selectedPromptId === p.id && !newPrompt
                      ? styles.selected
                      : ""
                  }
                  key={p.id}
                  onClick={() => {
                    setSelectedPromptId(p.id);
                    setNewPrompt(null);
                  }}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <div>
              {newPrompt ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const row = await request<{ id: string }>(
                        `${base}/prompts`,
                        "POST",
                        newPrompt,
                      );
                      await load();
                      setSelectedPromptId(row.id);
                      setNewPrompt(null);
                    }, true);
                  }}
                >
                  <fieldset disabled={busy} className={styles.formFields}>
                    <label className={styles.field}>
                      Название
                      <input
                        autoFocus
                        required
                        maxLength={160}
                        value={newPrompt.title}
                        onChange={(e) =>
                          setNewPrompt({ ...newPrompt, title: e.target.value })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      Текст промпта
                      <textarea
                        required
                        maxLength={12000}
                        value={newPrompt.content}
                        onChange={(e) =>
                          setNewPrompt({
                            ...newPrompt,
                            content: e.target.value,
                          })
                        }
                      />
                    </label>
                    <div className={styles.actions}>
                      <button className={styles.primary} disabled={busy}>
                        Сохранить промпт
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setNewPrompt(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : selectedPrompt ? (
                <>
                  <h3>{selectedPrompt.title}</h3>
                  <div className={styles.promptText}>
                    {selectedPrompt.content}
                  </div>
                  <button
                    className={styles.primary}
                    style={{ marginTop: 16 }}
                    onClick={() => {
                      if (
                        instruction.trim() &&
                        !window.confirm(
                          "Заменить текущую инструкцию текстом промпта?",
                        )
                      )
                        return;
                      changeInstruction(selectedPrompt.content);
                      setPromptsOpen(false);
                    }}
                  >
                    Использовать в задаче
                  </button>
                  <p className={styles.muted}>
                    Текст скопируется в инструкцию. Сам промпт останется без
                    изменений.
                  </p>
                </>
              ) : (
                <p className={styles.muted}>
                  Создайте первый промпт для повторяющейся задачи.
                </p>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {restoreVersion && (
        <Dialog
          title={`Восстановить V${restoreVersion.number}?`}
          busy={busy}
          close={() => setRestoreVersion(null)}
        >
          {dialogError && (
            <div className={styles.error} role="alert">
              {dialogError}
            </div>
          )}
          <p>
            Будет создана новая текущая версия с содержимым V
            {restoreVersion.number}. Все существующие версии сохранятся.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const row = await request<{ id: string }>(
                    `${base}/versions/${restoreVersion.id}/restore`,
                    "POST",
                    { currentNumber: latest?.number },
                  );
                  await load();
                  setRestoreVersion(null);
                  navigate("document", row.id);
                }, true)
              }
            >
              Восстановить
            </button>
            <button disabled={busy} onClick={() => setRestoreVersion(null)}>
              Отмена
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
