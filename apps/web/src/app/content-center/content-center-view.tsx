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
import { SiteMaterialFields, siteMaterialTitle } from "./site-material-fields";
import {
  MapMaterialFields,
  mapProviderForUrl,
  mapSourceUrl,
  type MapProvider,
} from "./map-material-fields";
import {
  SocialMaterialFields,
  socialNetworkForUrl,
  socialSourceUrl,
  type SocialNetwork,
} from "./social-material-fields";
import { SourceRegistry } from "./source-registry";
import { SourceRefresh } from "./source-refresh";
import { ResearchView } from "./research-view";
import { CreationView } from "./creation-view";
import {
  SOURCE_CATEGORIES,
  isVkMaterial,
  isSocialFeedMaterial,
  displayMaterialUrl,
  materialSourceUrl,
  type ProjectMaterial as Material,
  type SourceCategory,
  type SourceSnapshot,
} from "./materials";
import {
  appendDictation,
  PREPARATION_STAGES,
  preparationOperation,
  preparationRunLabel,
  preparationStageIndex,
  type PreparationProgress,
} from "./preparation-state";
import {
  CONTENT_CENTER_SECTIONS,
  parseContentCenterScreen,
  type ContentCenterScreen as Screen,
} from "./navigation";
import styles from "./content-center-view.module.css";
import { GlobalPromptPicker } from "./global-prompt-picker";
import {
  preparationDraftTitle,
  preparationVersionLabel,
} from "./preparation-version";

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
  prompt_title?: string | null;
  instruction?: string | null;
};
type Overview = {
  materials: Material[];
  prompts: Prompt[];
  versions: Version[];
  run: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    resumable?: boolean;
    materialIds?: string[] | null;
    error: string | null;
    progress?: PreparationProgress | null;
  } | null;
  ai: { connected: boolean };
  draft: {
    instruction: string;
    prompt_title?: string | null;
    without_materials: boolean;
    revision: number;
  };
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
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={styles.dialogHeader}>
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
      <div className={styles.dialogBody}>{children}</div>
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
  const [sourceDetails, setSourceDetails] = useState<
    (Material & { sourceBase: string }) | null
  >(null);
  const [instruction, setInstruction] = useState("");
  const [promptTitle, setPromptTitle] = useState("");
  const instructionRef = useRef("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [submittingRun, setSubmittingRun] = useState(false);
  const [runRequestError, setRunRequestError] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [draftRevision, setDraftRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [creationDirty, setCreationDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [material, setMaterial] = useState<MaterialDraft | null>(null);
  const [siteMaterialMode, setSiteMaterialMode] = useState(false);
  const [socialMaterialMode, setSocialMaterialMode] = useState(false);
  const [mapMaterialMode, setMapMaterialMode] = useState(false);
  const [socialNetwork, setSocialNetwork] = useState<SocialNetwork>("vk");
  const [mapProvider, setMapProvider] = useState<MapProvider>("yandex");
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
        setPromptTitle(preparationDraftTitle(payload.draft, payload.prompts));
        instructionRef.current = payload.draft.instruction;
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
  const runProgress = data?.run?.progress;
  const currentStage = preparationStageIndex(runProgress?.stage);
  const currentOperation = preparationOperation(runProgress);
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
    setRunRequestError("");
    setNotice("");
  }

  async function act(
    action: () => Promise<void>,
    modal = false,
    onError?: (message: string) => void,
  ) {
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
      if (onError) onError(message);
      else if (modal) setDialogError(message);
      else setError(message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function saveDraft() {
    const result = await request<{ revision: number }>(`${base}/draft`, "PUT", {
      instruction,
      promptTitle,
      withoutMaterials: !data?.materials.length,
      revision: draftRevision,
    });
    setDraftRevision(result.revision);
    setDirty(false);
  }

  function changeInstruction(value: string) {
    instructionRef.current = value;
    setInstruction(value);
    setRunRequestError("");
    setDirty(true);
    setNotice("");
  }

  const latest = data?.versions[0];
  const canResumeRun = Boolean(
    data?.run?.status === "failed" &&
      data.run.resumable &&
      !dirty &&
      instruction === data.draft.instruction,
  );
  const resumableMaterialIds =
    data?.run?.materialIds ?? data?.materials.map((item) => item.id) ?? [];
  const resumeMatchesSelection =
    canResumeRun &&
    selectedMaterialIds.length === resumableMaterialIds.length &&
    selectedMaterialIds.every((id) => resumableMaterialIds.includes(id));
  function openRunDialog() {
    if (!data) return;
    setSelectedMaterialIds(
      canResumeRun && data.run?.materialIds
        ? data.run.materialIds
        : data.materials.map((item) => item.id),
    );
    setRunRequestError("");
    setRunDialogOpen(true);
  }
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
      <ContentCenterBreadcrumbs
        workspaceName={workspaceName}
        screen={screen}
        title={title}
        onWorkspaceOpen={onWorkspaceOpen}
        onNavigate={navigate}
      />
      <div className={styles.heading}>
        <div>
          <h1>{title}</h1>
          <p className={styles.muted}>
            {screen === "root"
              ? "Информация о проекте и подготовка материалов для ваших сайтов."
              : screen === "preparation"
                ? "Добавьте материалы проекта. Источники и результат выберете при запуске обработки."
                : screen === "history"
                  ? "Сохранённые результаты. Восстановление создаёт новую версию."
                  : screen === "document"
                    ? "Документ для чтения и использования на следующих этапах."
                    : CONTENT_CENTER_SECTIONS.find(
                        (section) => section.id === screen,
                      )?.description}
          </p>
        </div>
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
                  не подключён. Источники и промпты можно подготовить заранее;
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
                      setSourceDetails({ ...row, sourceBase: base });
                    })
                  }
                  add={(kind, urlCategory) => {
                    setSocialMaterialMode(
                      kind === "url" && urlCategory === "social",
                    );
                    setSocialNetwork("vk");
                    setMapMaterialMode(
                      kind === "url" && urlCategory === "maps",
                    );
                    setMapProvider("yandex");
                    setSiteMaterialMode(
                      kind === "url" && urlCategory === "site",
                    );
                    setMaterial({ ...blankMaterial(), kind, urlCategory });
                    setDialogError("");
                  }}
                  edit={(item) =>
                    void act(async () => {
                      const row = await request<Material>(
                        `${base}/materials/${item.id}`,
                      );
                      setSiteMaterialMode(
                        row.kind === "url" && row.url_category === "site",
                      );
                      setSocialMaterialMode(
                        row.kind === "url" && row.url_category === "social",
                      );
                      setMapMaterialMode(
                        row.kind === "url" && row.url_category === "maps",
                      );
                      setMapProvider(mapProviderForUrl(row.source_url ?? ""));
                      setSocialNetwork(
                        socialNetworkForUrl(row.source_url ?? ""),
                      );
                      setMaterial({
                        id: row.id,
                        title: row.title,
                        kind: row.kind,
                        sourceUrl: displayMaterialUrl(row.source_url),
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
                      setNotice(`Файл «${file.name}» загружен`);
                    })
                  }
                />
                <div className={styles.preparationSidebar}>
                <article className={`${styles.card} ${styles.preparationTask}`}>
                  <div className={styles.actions}>
                    <button
                      className={styles.primary}
                      disabled={busy || submittingRun || running}
                      onClick={openRunDialog}
                    >
                      Запустить обработку материалов
                    </button>
                    {(submittingRun || runRequestError || data.run) && (
                      <span
                        className={styles.runInlineStatus}
                        data-state={submittingRun ? "processing" : runRequestError ? "failed" : data.run?.status}
                        role={(runRequestError || data.run?.status === "failed") && !submittingRun ? "alert" : "status"}
                      >
                        {(submittingRun || running) && (
                          <span className={styles.runSpinner} aria-hidden="true" />
                        )}
                        {submittingRun
                          ? "Запускаем задачу…"
                          : runRequestError
                            ? `Не удалось запустить: ${runRequestError}`
                          : data.run
                            ? `${preparationRunLabel(data.run.status, data.run.error)}${data.run.status === "failed" && data.run.progress?.message ? ` Этап: ${data.run.progress.message}.` : ""}`
                            : null}
                      </span>
                    )}
                  </div>
                  {running && (
                    <div className={styles.runProgress} role="group" aria-label="Ход обработки материалов">
                      <ol className={styles.runStages}>
                        {PREPARATION_STAGES.map((stage, index) => (
                          <li
                            key={stage.key}
                            data-state={
                              currentStage < 0
                                ? "pending"
                                : index < currentStage
                                  ? "done"
                                  : index === currentStage
                                    ? "active"
                                    : "pending"
                            }
                          >
                            {stage.label}
                          </li>
                        ))}
                      </ol>
                      <div className={styles.runProgressHeading}>
                        <strong>
                          {currentStage >= 0
                            ? PREPARATION_STAGES[currentStage].label
                            : "Ожидаем начала"}
                        </strong>
                        {currentOperation && (
                          <span>≈ {currentOperation.percent}% текущей операции</span>
                        )}
                      </div>
                      <progress
                        className={styles.runProgressBar}
                        max={100}
                        value={currentOperation?.percent}
                        aria-label="Ход текущей операции"
                      />
                      <p className={styles.runProgressDetail}>
                        {runProgress?.message || "Задача принята и ожидает обработки."}
                      </p>
                      {currentOperation && (
                        <span className={styles.runProgressCount}>
                          {currentOperation.completed} из {currentOperation.total}
                        </span>
                      )}
                    </div>
                  )}
                </article>
                <article className={styles.card}>
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
                              {preparationVersionLabel(version)} ↗
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
                </div>
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
                        <th>Запрос и версия</th>
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
                            {preparationVersionLabel(v)}{" "}
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
                      <h2>{preparationVersionLabel(document)}</h2>
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
                  {document.instruction && (
                    <details className={styles.versionInstruction}>
                      <summary>Промпт этого запроса</summary>
                      <pre>{document.instruction}</pre>
                    </details>
                  )}
                  <PreparedDocument
                    content={document.content ?? ""}
                    hideSourceReferences
                  />
                  <SourceRegistry sources={document.sources ?? []} />
                </>
              )}
            </article>
          )}
        </>
      )}

      {runDialogOpen && data && (
        <Dialog
          title="Запустить обработку материалов"
          busy={busy || submittingRun || voiceActive}
          close={() => setRunDialogOpen(false)}
        >
          <p className={styles.muted}>
            Выберите источники и опишите желаемый результат. AI получит только
            отмеченные материалы.
          </p>
          <div className={styles.runDialogGrid}>
            <section className={styles.runSources} aria-label="Источники обработки">
              <div className={styles.runSectionHead}>
                <h3>Источники</h3>
                {data.materials.length > 0 && (
                  <button
                    type="button"
                    disabled={busy || submittingRun}
                    onClick={() => setSelectedMaterialIds(
                      selectedMaterialIds.length === data.materials.length
                        ? []
                        : data.materials.map((item) => item.id),
                    )}
                  >
                    {selectedMaterialIds.length === data.materials.length ? "Снять все" : "Выбрать все"}
                  </button>
                )}
              </div>
              <p className={styles.muted}>{selectedMaterialIds.length} из {data.materials.length} выбрано</p>
              {data.materials.length ? (
                <div className={styles.runSourceList}>
                  {data.materials.map((item) => (
                    <label className={styles.runSource} key={item.id}>
                      <input
                        type="checkbox"
                        checked={selectedMaterialIds.includes(item.id)}
                        disabled={busy || submittingRun}
                        onChange={(event) => {
                          setSelectedMaterialIds((ids) =>
                            event.target.checked
                              ? [...ids, item.id]
                              : ids.filter((id) => id !== item.id),
                          );
                          setRunRequestError("");
                        }}
                      />
                      <span>
                        <strong title={item.title}>{item.title}</strong>
                        <small title={item.source_url ?? undefined}>
                          {item.kind === "file"
                            ? `Файл · ${item.file_name?.split(".").pop()?.toUpperCase() ?? "документ"}`
                            : item.kind === "url"
                              ? displayMaterialUrl(item.source_url)
                              : "Текст проекта"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>Материалов пока нет. Можно запустить обработку только по инструкции.</p>
              )}
            </section>
            <section className={styles.runOutcome} aria-label="Результат обработки">
              <div className={styles.runSectionHead}>
                <h3>Что получить на выходе</h3>
                <button
                  type="button"
                  disabled={busy || submittingRun || voiceActive}
                  onClick={() => setPromptsOpen(true)}
                >
                  Выбрать промпт
                </button>
              </div>
              <p className={styles.muted}>
                {promptTitle ? `Основа: ${promptTitle}` : "Выберите готовый промпт или напишите свою инструкцию."}
              </p>
              <label className={styles.field}>
                Инструкция
                <textarea
                  disabled={busy || submittingRun}
                  value={instruction}
                  maxLength={12000}
                  onChange={(event) => changeInstruction(event.target.value)}
                  placeholder="Какие выводы нужны по выбранным источникам?"
                />
              </label>
              <SpeechInput
                disabled={busy || submittingRun}
                onActiveChange={setVoiceActive}
                onTranscript={(text) => {
                  const appended = appendDictation(instructionRef.current, text);
                  if (appended.overflow) {
                    setRunRequestError("Инструкция ограничена 12 000 символами. Сократите текст перед запуском.");
                  } else changeInstruction(appended.value);
                }}
              />
            </section>
          </div>
          {runRequestError && <div className={styles.error} role="alert">{runRequestError}</div>}
          {canResumeRun && (
            <p className={styles.muted}>
              {resumeMatchesSelection
                ? "Предыдущую неудачную обработку можно продолжить с сохранённого этапа."
                : "Выбран другой набор материалов: начнётся новая обработка."}
            </p>
          )}
          <div className={styles.runDialogFooter}>
            <span className={styles.muted}>
              {selectedMaterialIds.length ? materialCount(selectedMaterialIds.length) : "Без материалов"}
              {resumeMatchesSelection
                ? " · продолжение прежнего запуска"
                : " · прежние результаты не входят в новый запрос"}
            </span>
            <div className={styles.actions}>
              <button type="button" disabled={busy || submittingRun || voiceActive} onClick={() => setRunDialogOpen(false)}>Отмена</button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || submittingRun || voiceActive || !data.ai.connected || !instruction.trim() || (data.materials.length > 0 && !selectedMaterialIds.length)}
                onClick={() => {
                  setSubmittingRun(true);
                  setRunRequestError("");
                  void act(async () => {
                    if (resumeMatchesSelection && data.run) {
                      await request(`${base}/runs/${data.run.id}/resume`, "POST");
                    } else {
                      if (dirty) await saveDraft();
                      await request(`${base}/runs`, "POST", {
                        instruction,
                        promptTitle,
                        withoutMaterials: !data.materials.length,
                        materialIds: selectedMaterialIds,
                      });
                    }
                    await load();
                    setRunDialogOpen(false);
                  }, false, setRunRequestError).finally(() => {
                    if (alive.current) setSubmittingRun(false);
                  });
                }}
              >
                {submittingRun ? "Запускаем…" : resumeMatchesSelection ? "Продолжить обработку" : "Запустить обработку"}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {sourceDetails && sourceDetails.sourceBase === base && (
        <Dialog
          title="Источники и охват"
          busy={false}
          close={() => setSourceDetails(null)}
        >
          <SourceRefresh
            key={`${base}-${sourceDetails.id}`}
            initial={sourceDetails}
            base={base}
            request={request}
            onUpdated={load}
          />
        </Dialog>
      )}
      {material && (
        <Dialog
          title={
            siteMaterialMode
              ? material.id
                ? "Изменить сайт"
                : "Добавить сайт"
              : mapMaterialMode
                ? material.id
                  ? "Изменить карту"
                  : "Добавить карту"
              : socialMaterialMode
                ? material.id
                  ? "Изменить социальную сеть"
                  : "Добавить социальную сеть"
                : material.id
                  ? "Изменить материал"
                  : "Добавить материал"
          }
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
                const normalizedMaterial =
                  material.kind === "url"
                    ? {
                        ...material,
                        sourceUrl: materialSourceUrl(material.sourceUrl),
                      }
                    : material;
                const saved = await request<{ id: string }>(
                  `${base}/materials${material.id ? `/${material.id}` : ""}`,
                  material.id ? "PUT" : "POST",
                  siteMaterialMode
                    ? {
                        ...normalizedMaterial,
                        kind: "url",
                        urlCategory: "site",
                        title:
                          material.title ||
                          siteMaterialTitle(material.sourceUrl),
                      }
                    : socialMaterialMode
                      ? {
                          ...normalizedMaterial,
                          kind: "url",
                          urlCategory: "social",
                          sourceUrl: socialSourceUrl(
                            material.sourceUrl,
                            socialNetwork,
                          ),
                          title:
                            material.title ||
                            siteMaterialTitle(material.sourceUrl),
                        }
                      : mapMaterialMode
                        ? {
                            ...normalizedMaterial,
                            kind: "url",
                            urlCategory: "maps",
                            sourceUrl: mapSourceUrl(
                              material.sourceUrl,
                              mapProvider,
                            ),
                            title:
                              material.title ||
                              siteMaterialTitle(material.sourceUrl),
                          }
                      : normalizedMaterial,
                );
                await load();
                setMaterial(null);
                if (
                  isSocialFeedMaterial({
                    kind: material.kind,
                    url_category: material.urlCategory ?? "other",
                    source_url: normalizedMaterial.sourceUrl,
                  }) ||
                  mapMaterialMode
                ) {
                  const row = await request<Material>(
                    `${base}/materials/${saved.id}`,
                  );
                  setSourceDetails({ ...row, sourceBase: base });
                }
              }, true);
            }}
          >
            <fieldset disabled={busy} className={styles.formFields}>
              {siteMaterialMode ? (
                <SiteMaterialFields
                  sourceUrl={material.sourceUrl}
                  onChange={(sourceUrl) =>
                    setMaterial({ ...material, sourceUrl })
                  }
                />
              ) : mapMaterialMode ? (
                <MapMaterialFields
                  provider={mapProvider}
                  sourceUrl={material.sourceUrl}
                  onProviderChange={(provider) => {
                    setMapProvider(provider);
                    setDialogError("");
                  }}
                  onChange={(sourceUrl) => {
                    setMaterial({ ...material, sourceUrl });
                    setDialogError("");
                  }}
                />
              ) : socialMaterialMode ? (
                <SocialMaterialFields
                  network={socialNetwork}
                  sourceUrl={material.sourceUrl}
                  onNetworkChange={(network) => {
                    setSocialNetwork(network);
                    setDialogError("");
                  }}
                  onChange={(sourceUrl) => {
                    setMaterial({ ...material, sourceUrl });
                    setDialogError("");
                  }}
                />
              ) : (
                <>
                  {!material.id && (
                    <div className={styles.actions}>
                      {(["text", "url"] as const).map((kind) => (
                        <button
                          type="button"
                          key={kind}
                          className={
                            material.kind === kind ? styles.selected : ""
                          }
                          onClick={() =>
                            setMaterial({ ...blankMaterial(), kind })
                          }
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
                          type="text"
                          inputMode="url"
                          autoCapitalize="none"
                          spellCheck={false}
                          required
                          maxLength={2048}
                          value={material.sourceUrl}
                          placeholder="example.ru/about"
                          onChange={(e) =>
                            setMaterial({
                              ...material,
                              sourceUrl: e.target.value,
                            })
                          }
                        />
                      </label>
                      <p className={styles.muted}>
                        {isVkMaterial({
                          kind: material.kind,
                          url_category: material.urlCategory ?? "other",
                          source_url: material.sourceUrl,
                        }) ? (
                          "Для сбора нужно общее подключение VK в настройках CMS — ключ заказчика не нужен."
                        ) : material.urlCategory === "maps" ? (
                          "Соберём публичную карточку выбранной карты без входа и API: обзор, доступные контакты, рейтинг, график и особенности. Полный архив отзывов и товары могут быть недоступны в открытом ответе площадки."
                        ) : material.urlCategory === "site" ? (
                          "При запуске обработки автоматически соберём основные страницы о компании и продукте. Блог и новости прочитаем выборочно. Выбирать страницы вручную не нужно."
                        ) : (
                          <>
                            Сохраним ссылку и попробуем прочитать одну публичную
                            HTTPS-страницу. Если сайт закрывает доступ или
                            требует JavaScript, ссылка останется в материалах с
                            предупреждением. Добавьте недоступный текст вручную.
                            При сохранении ссылка читается заново.
                          </>
                        )}
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
                          value={material.content}
                          onChange={(e) =>
                            setMaterial({
                              ...material,
                              content: e.target.value,
                            })
                          }
                        />
                      </label>
                      <p className={styles.muted}>
                        Документы и изображения загружаются в разделе «Файлы и
                        тексты проекта».
                      </p>
                    </>
                  )}
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
                  {busy
                    ? "Сохраняем…"
                    : siteMaterialMode
                      ? "Сохранить сайт"
                      : socialMaterialMode
                        ? "Сохранить"
                        : "Сохранить материал"}
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
          onSelect={(content, title) => {
            if (
              instruction.trim() &&
              !window.confirm("Заменить текущую инструкцию текстом промпта?")
            )
              return;
            changeInstruction(content);
            setPromptTitle(title);
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
