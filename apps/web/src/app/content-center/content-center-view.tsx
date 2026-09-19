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
import { ContentCenterBreadcrumbs } from "./content-center-breadcrumbs";
import { SpeechInput } from "./speech-input";
import { ProjectMaterials } from "./project-materials";
import { SourceRegistry } from "./source-registry";
import { ResearchView } from "./research-view";
import { CreationView } from "./creation-view";
import {
  SOURCE_CATEGORIES,
  type ProjectMaterial as Material,
  type SourceCategory,
  type SourceSnapshot,
} from "./materials";
import { appendDictation, preparationSteps } from "./preparation-state";
import {
  CONTENT_CENTER_SECTIONS,
  parseContentCenterScreen,
  type ContentCenterScreen as Screen,
} from "./navigation";
import styles from "./content-center-view.module.css";
import { GlobalPromptPicker } from "./global-prompt-picker";

type Prompt = { id: string; title: string; content: string };
type Version = {
  id: string;
  number: number;
  actor_name: string;
  created_at: string;
  reason: string;
  restored_from: number | null;
  content?: string;
  sources?: SourceSnapshot[];
};
type Overview = {
  materials: Material[];
  prompts: Prompt[];
  versions: Version[];
  run: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    error: string | null;
    progress?: { message: string } | null;
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
  urlCategory?: SourceCategory;
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
      : body instanceof FormData
        ? { body }
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
  onWorkspaceOpen,
  onDirtyChange,
  onScreenChange,
}: {
  workspaceId: string;
  workspaceName: string;
  onWorkspaceOpen: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onScreenChange: (screen: Screen) => void;
}) {
  const base = `/api/workspaces/${workspaceId}/content-center`;
  const [data, setData] = useState<Overview | null>(null);
  const [screen, setScreen] = useState<Screen>("root");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [document, setDocument] = useState<Version | null>(null);
  const [sourceDetails, setSourceDetails] = useState<SourceSnapshot | null>(
    null,
  );
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [withoutMaterials, setWithoutMaterials] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [creationDirty, setCreationDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [material, setMaterial] = useState<MaterialDraft | null>(null);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [restoreVersion, setRestoreVersion] = useState<Version | null>(null);
  const [removeMaterial, setRemoveMaterial] = useState<Material | null>(null);
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
        instructionRef.current = payload.draft.instruction;
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
    onDirtyChange(dirty || researchDirty || creationDirty);
  }, [dirty, researchDirty, creationDirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !researchDirty && !creationDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, researchDirty, creationDirty]);

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
    if (
      creationDirty &&
      next !== "creation" &&
      !window.confirm("Уйти без сохранения данных создания контента?")
    )
      return;
    if (
      researchDirty &&
      next !== "research" &&
      !window.confirm("Уйти без сохранения изменений исследования?")
    )
      return;
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
    instructionRef.current = value;
    setInstruction(value);
    setDirty(true);
    setNotice("");
  }

  const latest = data?.versions[0];
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
          <ContentCenterBreadcrumbs
            workspaceName={workspaceName}
            screen={screen}
            title={title}
            onWorkspaceOpen={onWorkspaceOpen}
            onNavigate={navigate}
          />
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
                    : CONTENT_CENTER_SECTIONS.find(
                        (section) => section.id === screen,
                      )?.description}
          </p>
        </div>
        {screen === "preparation" && (
          <button
            disabled={busy || !data || Boolean(data.materials.length)}
            aria-pressed={withoutMaterials}
            title={
              data?.materials.length
                ? "Добавленные материалы автоматически участвуют в обработке"
                : undefined
            }
            onClick={() => {
              setWithoutMaterials(!withoutMaterials);
              setDirty(true);
            }}
          >
            {withoutMaterials ? "✓ " : ""}У меня нет материалов
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
                  instructionRef.current = result.draft.instruction;
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
                    ) : section.id === "creation" ? (
                      <span className={styles.badge}>Кластеры и статьи</span>
                    ) : (
                      <span className={styles.badge}>Конкурентный анализ</span>
                    )}
                  </div>
                  <button
                    className={
                      section.id === "preparation" ? styles.primary : undefined
                    }
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

          {screen === "research" && (
            <ResearchView
              workspaceId={workspaceId}
              onDirtyChange={setResearchDirty}
            />
          )}
          {screen === "creation" && (
            <CreationView
              workspaceId={workspaceId}
              onDirtyChange={setCreationDirty}
            />
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
              <div className={styles.preparationStack}>
                <ProjectMaterials
                  materials={data.materials}
                  busy={busy}
                  base={base}
                  showSources={(item) =>
                    void act(async () => {
                      const row = await request<Material>(
                        `${base}/materials/${item.id}`,
                      );
                      setSourceDetails(row.site_pages ?? null);
                    })
                  }
                  add={(kind, urlCategory) => {
                    setMaterial({ ...blankMaterial(), kind, urlCategory });
                    setDialogError("");
                  }}
                  edit={(item) =>
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
                        urlCategory: row.url_category,
                      });
                    })
                  }
                  remove={(item) => {
                    setRemoveMaterial(item);
                    setDialogError("");
                  }}
                  upload={(file) =>
                    void act(async () => {
                      if (file.size > 10 * 1024 * 1024)
                        throw new Error("Файл должен быть не больше 10 МБ");
                      const body = new FormData();
                      body.append("file", file);
                      await request(`${base}/files`, "POST", body);
                      await load();
                      setWithoutMaterials(false);
                      setNotice(`Файл «${file.name}» загружен`);
                    })
                  }
                />
                {withoutMaterials && !data.materials.length && (
                  <div className={styles.notice}>
                    Выбран режим без материалов: AI получит только вашу
                    инструкцию, без предыдущего результата. Вымышленные факты не
                    добавляются.
                  </div>
                )}
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Сформировать обработанную информацию</h2>
                    <button
                      disabled={busy || voiceActive}
                      onClick={() => {
                        setPromptsOpen(true);
                        setDialogError("");
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
                  <SpeechInput
                    disabled={busy}
                    onActiveChange={setVoiceActive}
                    onTranscript={(text) => {
                      const appended = appendDictation(
                        instructionRef.current,
                        text,
                      );
                      if (appended.overflow) {
                        setError(
                          "Инструкция ограничена 12 000 символами. Последняя распознанная фраза не добавлена; остановите диктовку и сократите текст.",
                        );
                      } else changeInstruction(appended.value);
                    }}
                  />
                  <div className={styles.actions}>
                    <button
                      disabled={busy || voiceActive || !dirty}
                      onClick={() => void act(saveDraft)}
                    >
                      Сохранить задачу
                    </button>
                    <button
                      className={styles.primary}
                      disabled={
                        busy ||
                        voiceActive ||
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
                        : "Запустить обработку материалов"}
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
                    {data.materials.length && latest
                      ? ` и предыдущий результат V${latest.number}`
                      : ""}
                    .
                    {!data.materials.length &&
                      withoutMaterials &&
                      " Будет передана только инструкция, без прежних результатов."}
                  </p>
                </article>
                <article
                  className={`${styles.card} ${styles.processingHistory}`}
                >
                  <div>
                    <div className={styles.cardHead}>
                      <h2>Процесс обработки</h2>
                    </div>
                    {!data.run && (
                      <p className={styles.muted}>
                        {data.ai.connected
                          ? "Обработка ещё не запускалась. Добавьте материалы, задайте инструкцию и запустите обработку."
                          : "Ожидает подключения AI. Материалы, промпты и инструкцию можно сохранить заранее."}
                      </p>
                    )}
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
                            ? (data.run.progress?.message ??
                              "AI готовит документ. Текущая версия остаётся доступной.")
                            : data.run.status === "failed"
                              ? data.run.error
                              : "Обработка завершена. Новая версия доступна ниже."}
                        <ol
                          className={styles.runSteps}
                          aria-label="Этапы обработки"
                        >
                          {preparationSteps(data.run.status).map(
                            (step, index) => (
                              <li
                                key={step.title}
                                data-state={step.state}
                                aria-current={
                                  step.state === "active" ? "step" : undefined
                                }
                              >
                                <span
                                  className={styles.stepNumber}
                                  aria-hidden="true"
                                >
                                  {step.state === "done" ? "✓" : index + 1}
                                </span>
                                <span>
                                  {step.title}
                                  <small>
                                    {
                                      {
                                        done: "Готово",
                                        active: "Выполняется",
                                        waiting: "Ожидание",
                                        failed: "Не завершено",
                                      }[step.state]
                                    }
                                  </small>
                                </span>
                              </li>
                            ),
                          )}
                        </ol>
                        {data.run.status === "failed" && (
                          <p className={styles.muted}>
                            Новая версия не создана. Последний успешный
                            результат сохранён. Проверьте задачу и повторите
                            запуск.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className={styles.cardHead}>
                      <h2>История версий</h2>
                      <button
                        className={styles.link}
                        onClick={() => navigate("history")}
                      >
                        Все версии →
                      </button>
                    </div>
                    {!data.versions.length ? (
                      <p className={styles.muted}>
                        Версий пока нет. Первая появится после успешной
                        обработки.
                      </p>
                    ) : (
                      <ol className={styles.recentVersions}>
                        {data.versions.slice(0, 3).map((version) => (
                          <li key={version.id}>
                            <button
                              className={styles.link}
                              onClick={() => navigate("document", version.id)}
                            >
                              Версия {version.number}
                            </button>
                            {version.id === latest?.id && (
                              <span className={styles.badge}>Текущая</span>
                            )}
                            <p className={styles.muted}>
                              {formatDate(version.created_at)} ·{" "}
                              {version.actor_name}
                            </p>
                            <p className={styles.muted}>{version.reason}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </article>
                <article className={styles.card}>
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
                    </>
                  ) : (
                    <p className={styles.muted}>
                      Здесь появится документ после первой успешной обработки.
                    </p>
                  )}
                  <button
                    className={`${styles.primary} ${styles.openResult}`}
                    disabled={!latest}
                    onClick={() => latest && navigate("document", latest.id)}
                  >
                    Открыть обработанную информацию ↗
                  </button>
                </article>
              </div>
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
                  <SourceRegistry sources={document.sources ?? []} />
                </>
              )}
            </article>
          )}
        </>
      )}

      {sourceDetails && (
        <Dialog
          title="Источники и охват"
          busy={false}
          close={() => setSourceDetails(null)}
        >
          <SourceRegistry sources={[sourceDetails]} />
        </Dialog>
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
                  {(["text", "url"] as const).map((kind) => (
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
                    Категория источника
                    <select
                      value={material.urlCategory ?? "other"}
                      onChange={(event) =>
                        setMaterial({
                          ...material,
                          urlCategory: event.target.value as SourceCategory,
                        })
                      }
                    >
                      {SOURCE_CATEGORIES.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    {material.urlCategory === "site"
                      ? "Адрес сайта"
                      : "Адрес страницы"}
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
                    {material.urlCategory === "site" ? (
                      "При запуске обработки автоматически соберём основные страницы о компании и продукте. Блог и новости прочитаем выборочно. Выбирать страницы вручную не нужно."
                    ) : (
                      <>
                        Сохраним ссылку и попробуем прочитать одну публичную
                        HTTPS-страницу. Если сайт закрывает доступ или требует
                        JavaScript, ссылка останется в материалах с
                        предупреждением.
                      </>
                    )}
                    Добавьте недоступный текст вручную. При сохранении ссылка
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
                    До 40 000 символов. Документы и изображения загружаются в
                    разделе «Файлы и тексты проекта».
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
        <GlobalPromptPicker
          close={() => setPromptsOpen(false)}
          onSelect={(content) => {
            if (
              instruction.trim() &&
              !window.confirm("Заменить текущую инструкцию текстом промпта?")
            )
              return;
            changeInstruction(content);
            setPromptsOpen(false);
          }}
        />
      )}

      {removeMaterial && (
        <Dialog
          title="Удалить материал?"
          busy={busy}
          close={() => setRemoveMaterial(null)}
        >
          {dialogError && (
            <div className={styles.error} role="alert">
              {dialogError}
            </div>
          )}
          <p>
            Материал «{removeMaterial.title}» будет удалён из текущего набора.
            Уже созданные версии и контекст запущенной обработки сохранятся.
          </p>
          <div className={styles.actions}>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request(
                    `${base}/materials/${removeMaterial.id}?revision=${removeMaterial.revision}`,
                    "DELETE",
                  );
                  await load();
                  setRemoveMaterial(null);
                  setNotice("Материал удалён");
                }, true)
              }
            >
              Удалить материал
            </button>
            <button disabled={busy} onClick={() => setRemoveMaterial(null)}>
              Отмена
            </button>
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
