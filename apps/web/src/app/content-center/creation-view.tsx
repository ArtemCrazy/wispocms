"use client";
import { useCallback, useEffect, useState } from "react";
import {
  creationLocation,
  filterClusters,
  launchClusters,
  type ArticleDetails,
  type Cluster,
  type CreationLocation,
  type History,
  type Overview,
  type Query,
  type Settings,
} from "./creation-state";
import { CreationDialog, creationRequest } from "./creation-shared";
import { CreationArticle } from "./creation-article";
import { CreationHistory } from "./creation-history";
import { RestructureClusters } from "./creation-restructure";
import { CreationTable } from "./creation-table";
import { CreationLauncher } from "./creation-launcher";
import { CreationRunPanels } from "./creation-progress";
import { CreationCluster } from "./creation-cluster";
import styles from "./content-center-view.module.css";
const emptyLocation: CreationLocation = {
  screen: "table",
  id: null,
  historyTab: "runs",
  version: null,
  clusterContext: null,
};
const emptyQuery = (): Query => ({
  text: "",
  general: 0,
  exact: 0,
  primary: true,
});

export function CreationView({
  workspaceId,
  onDirtyChange,
}: {
  workspaceId: string;
  onDirtyChange: (v: boolean) => void;
}) {
  const parentBase = `/api/workspaces/${workspaceId}/content-center`,
    base = `${parentBase}/creation`;
  const [data, setData] = useState<Overview | null>(null),
    [location, setLocation] = useState<CreationLocation>(emptyLocation),
    [details, setDetails] = useState<ArticleDetails | null>(null),
    [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [direction, setDirection] = useState(""),
    [status, setStatus] = useState(""),
    [recommendation, setRecommendation] = useState("");
  const [instruction, setInstruction] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [voice, setVoice] = useState(false),
    [articleDirty, setArticleDirty] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null),
    [settingsDirty, setSettingsDirty] = useState(false);
  const [clusterEdit, setClusterEdit] = useState<{
    id?: string;
    revision: number;
    direction: string;
    queries: Query[];
    archived: boolean;
  } | null>(null);
  const [launchConfirm, setLaunchConfirm] = useState(false),
    [retry, setRetry] = useState(false);
  const [restructure, setRestructure] = useState<{
    kind: "split" | "merge";
    clusters: Cluster[];
  } | null>(null);
  const dirty = Boolean(
    instruction ||
    file ||
    voice ||
    settingsDirty ||
    articleDirty ||
    clusterEdit,
  );
  const load = useCallback(async () => {
    const result = await creationRequest<Overview>(base);
    setData(result);
    return result;
  }, [base]);
  useEffect(() => {
    let active = true;
    creationRequest<Overview>(base)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const pop = () =>
      setLocation(creationLocation(new URL(window.location.href).searchParams));
    pop();
    window.addEventListener("popstate", pop);
    return () => {
      active = false;
      window.removeEventListener("popstate", pop);
    };
  }, [base]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const loadDetails = useCallback(async () => {
    if (
      location.id &&
      (location.screen === "article" || location.screen === "versions")
    )
      setDetails(
        await creationRequest<ArticleDetails>(
          `${base}/articles/${location.id}`,
        ),
      );
  }, [base, location.id, location.screen]);
  useEffect(() => {
    let active = true;
    if (
      location.id &&
      (location.screen === "article" || location.screen === "versions")
    )
      creationRequest<ArticleDetails>(`${base}/articles/${location.id}`)
        .then((d) => {
          if (active) setDetails(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    if (location.screen === "history")
      creationRequest<History>(`${base}/history`)
        .then((h) => {
          if (active) setHistory(h);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [base, location.id, location.screen]);
  const running =
    data?.run?.status === "queued" || data?.run?.status === "processing";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () =>
        void load()
          .then(() => loadDetails())
          .catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [running, load, loadDetails]);
  const navigate = (next: Partial<CreationLocation>) => {
    if (
      (articleDirty || settingsDirty) &&
      !window.confirm("Уйти без сохранения введённых данных?")
    )
      return;
    setSettingsDirty(false);
    setSettings(null);
    if (next.id !== undefined && next.id !== location.id) setDetails(null);
    setError("");
    const target = { ...location, ...next };
    if (next.screen && next.screen !== location.screen) {
      target.version = next.version ?? null;
      if (next.screen !== "history") target.clusterContext = null;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("cc", "creation");
    url.searchParams.set("creation", target.screen);
    for (const [key, value] of [
      ["contentId", target.id],
      ["contentHistory", target.historyTab],
      ["contentVersion", target.version],
      ["clusterContext", target.clusterContext],
    ] as Array<[string, string | number | null]>) {
      if (value) url.searchParams.set(key, String(value));
      else url.searchParams.delete(key);
    }
    window.history.pushState({}, "", url);
    setLocation(target);
  };
  async function refresh() {
    await load();
    await loadDetails();
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return <p role="status">{error || "Загружаем создание контента…"}</p>;
  const filtered = filterClusters(
    data,
    search,
    direction,
    status,
    recommendation,
  );
  const cluster = data.clusters.find((c) => c.id === location.id);
  const currentSettings = settings ?? data.settings;
  const selectedClusters = launchClusters(data.clusters, selected);
  function edit(c?: Cluster) {
    setClusterEdit(
      c
        ? { ...c, queries: c.queries.map((q) => ({ ...q })) }
        : {
            revision: 0,
            direction: "",
            queries: [emptyQuery()],
            archived: false,
          },
    );
  }
  return (
    <div className={styles.creationLayout}>
      <nav className={styles.creationTabs} aria-label="Создание контента">
        <button
          className={location.screen === "table" ? styles.selected : undefined}
          onClick={() => navigate({ screen: "table", id: null })}
        >
          Кластеры и статьи
        </button>
        <button
          className={
            location.screen === "history" ? styles.selected : undefined
          }
          onClick={() => navigate({ screen: "history", id: null })}
        >
          История
        </button>
        <button
          className={
            location.screen === "settings" ? styles.selected : undefined
          }
          onClick={() => navigate({ screen: "settings", id: null })}
        >
          Площадки и правила
        </button>
      </nav>
      {error && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <button disabled={busy} onClick={() => void act(async () => {})}>
            Обновить данные
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!data.ai.connected && (
        <div className={styles.notice}>
          AI ещё не подключён. Можно настроить площадки и правила, добавить
          кластеры и проверить структуру раздела. Создание и AI-корректировка
          статей станут доступны после подключения API.
        </div>
      )}
      {location.screen === "article" && data.run && (
        <CreationRunPanels
          key={base}
          base={base}
          run={data.run}
          showHistory={location.screen === "table"}
          retryDisabled={busy || voice || !data.ai.connected}
          onRetry={() => {
            setRetry(true);
            setLaunchConfirm(true);
          }}
          onHistory={() =>
            navigate({
              screen: "history",
              historyTab: "runs",
              id: null,
              clusterContext: null,
            })
          }
        />
      )}
      {location.screen === "table" && (
        <>
          <CreationTable
            data={data}
            filtered={filtered}
            selected={selected}
            setSelected={setSelected}
            filters={{ search, direction, status, recommendation }}
            setFilter={(key, value) =>
              ({
                search: setSearch,
                direction: setDirection,
                status: setStatus,
                recommendation: setRecommendation,
              })[key](value)
            }
            onAdd={() => edit()}
            onCluster={(id) => navigate({ screen: "cluster", id })}
            onArticle={(id) => navigate({ screen: "article", id })}
            onMerge={() =>
              setRestructure({ kind: "merge", clusters: selectedClusters })
            }
            prepareDisabled={busy || running}
            onPrepare={() => {
              if (!selectedClusters.length) return;
              setRetry(false);
              setLaunchConfirm(true);
            }}
          />
          <CreationRunPanels
            key={base}
            base={base}
            run={data.run}
            showHistory
            retryDisabled={busy || voice || !data.ai.connected}
            onRetry={() => {
              setRetry(true);
              setLaunchConfirm(true);
            }}
            onHistory={() =>
              navigate({
                screen: "history",
                historyTab: "runs",
                id: null,
                clusterContext: null,
              })
            }
          />
        </>
      )}
      {location.screen === "cluster" &&
        (cluster ? (
          <CreationCluster
            cluster={cluster}
            data={data}
            busy={busy}
            navigate={navigate}
            onEdit={() => edit(cluster)}
            onSplit={() =>
              setRestructure({ kind: "split", clusters: [cluster] })
            }
          />
        ) : (
          <section className={styles.card}>
            <p>Кластер не найден.</p>
            <button
              type="button"
              onClick={() => navigate({ screen: "table", id: null })}
            >
              К таблице контента
            </button>
          </section>
        ))}
      {(location.screen === "article" || location.screen === "versions") &&
        (details && details.article.id === location.id ? (
          <CreationArticle
            key={details.article.id}
            base={base}
            parentBase={parentBase}
            details={details}
            data={data}
            location={location}
            navigate={navigate}
            refresh={refresh}
            onDirtyChange={setArticleDirty}
          />
        ) : (
          <p>Загружаем статью…</p>
        ))}
      {location.screen === "history" &&
        (history ? (
          <CreationHistory
            data={history}
            location={location}
            navigate={navigate}
          />
        ) : (
          <p>Загружаем историю…</p>
        ))}
      {location.screen === "settings" && (
        <section className={styles.card}>
          <h2>Площадки и постоянные правила</h2>
          <p className={styles.muted}>
            В MVP подключаются сайты этого workspace, у которых есть CMS статей.
            Правила автоматически входят в контекст каждого запуска.
          </p>
          <label className={styles.field}>
            Постоянные правила проекта
            <textarea
              rows={5}
              maxLength={16000}
              value={currentSettings.rules}
              onChange={(e) => {
                setSettings({ ...currentSettings, rules: e.target.value });
                setSettingsDirty(true);
              }}
              placeholder="Тон коммуникации, обращение к читателю, структура, глубина, объём, допустимые материалы"
            />
          </label>
          <h3>Подключённые площадки</h3>
          {data.sites.map((s) => {
            const p = currentSettings.platforms.find((p) => p.siteId === s.id);
            return (
              <div key={s.id} className={styles.creationPlatform}>
                <label className={styles.creationCheckbox}>
                  <input
                    type="checkbox"
                    checked={Boolean(p)}
                    onChange={(e) => {
                      setSettings({
                        ...currentSettings,
                        platforms: e.target.checked
                          ? [
                              ...currentSettings.platforms,
                              { siteId: s.id, rules: "" },
                            ]
                          : currentSettings.platforms.filter(
                              (p) => p.siteId !== s.id,
                            ),
                      });
                      setSettingsDirty(true);
                    }}
                  />
                  {s.name}
                </label>
                {p && (
                  <label className={styles.field}>
                    Правила площадки «{s.name}»
                    <textarea
                      rows={3}
                      maxLength={12000}
                      value={p.rules}
                      onChange={(e) => {
                        setSettings({
                          ...currentSettings,
                          platforms: currentSettings.platforms.map((p) =>
                            p.siteId === s.id
                              ? { ...p, rules: e.target.value }
                              : p,
                          ),
                        });
                        setSettingsDirty(true);
                      }}
                    />
                  </label>
                )}
              </div>
            );
          })}
          {!data.sites.length && (
            <p>В workspace пока нет сайтов с шаблоном статьи.</p>
          )}
          <button
            disabled={busy || !settingsDirty}
            className={styles.primary}
            onClick={() =>
              void act(async () => {
                const saved = await creationRequest<Settings>(
                  `${base}/settings`,
                  "PUT",
                  currentSettings,
                );
                setSettings(saved);
                setSettingsDirty(false);
                setNotice("Площадки и правила сохранены");
              })
            }
          >
            Сохранить настройки
          </button>
        </section>
      )}
      {clusterEdit && (
        <CreationDialog
          title={clusterEdit.id ? "Редактирование кластера" : "Новый кластер"}
          close={() => setClusterEdit(null)}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const { id, ...dto } = clusterEdit;
                await creationRequest(
                  `${base}/clusters${id ? `/${id}` : ""}`,
                  id ? "PUT" : "POST",
                  dto,
                );
                setClusterEdit(null);
              });
            }}
          >
            <p className={styles.muted}>
              Название формируется по основному запросу. Направление — метка для
              группировки, не отдельная сущность.
            </p>
            <label className={styles.field}>
              Направление
              <input
                maxLength={160}
                value={clusterEdit.direction}
                onChange={(e) =>
                  setClusterEdit({ ...clusterEdit, direction: e.target.value })
                }
              />
            </label>
            <div className={styles.creationQueryEditor}>
              {clusterEdit.queries.map((q, i) => (
                <div key={i}>
                  <label className={styles.creationCheckbox}>
                    <input
                      type="radio"
                      name="primary-query"
                      aria-label={`Основной запрос ${i + 1}`}
                      checked={q.primary}
                      onChange={() =>
                        setClusterEdit({
                          ...clusterEdit,
                          queries: clusterEdit.queries.map((q, j) => ({
                            ...q,
                            primary: i === j,
                          })),
                        })
                      }
                    />
                    Основной
                  </label>
                  <label className={styles.field}>
                    Запрос {i + 1}
                    <input
                      required
                      maxLength={240}
                      value={q.text}
                      onChange={(e) =>
                        setClusterEdit({
                          ...clusterEdit,
                          queries: clusterEdit.queries.map((q, j) =>
                            i === j ? { ...q, text: e.target.value } : q,
                          ),
                        })
                      }
                    />
                  </label>
                  {(["general", "exact"] as const).map((k) => (
                    <label key={k} className={styles.field}>
                      {k === "general" ? "Общая" : "Точная"} частотность
                      <input
                        type="number"
                        required
                        min={0}
                        max={2147483647}
                        value={q[k]}
                        onChange={(e) =>
                          setClusterEdit({
                            ...clusterEdit,
                            queries: clusterEdit.queries.map((q, j) =>
                              i === j
                                ? { ...q, [k]: Number(e.target.value) }
                                : q,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={clusterEdit.queries.length === 1}
                    onClick={() => {
                      const queries = clusterEdit.queries.filter(
                        (_q, j) => j !== i,
                      );
                      if (q.primary)
                        queries[0] = { ...queries[0], primary: true };
                      setClusterEdit({ ...clusterEdit, queries });
                    }}
                  >
                    Убрать запрос
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={clusterEdit.queries.length >= 500}
              onClick={() =>
                setClusterEdit({
                  ...clusterEdit,
                  queries: [
                    ...clusterEdit.queries,
                    { ...emptyQuery(), primary: false },
                  ],
                })
              }
            >
              Добавить запрос
            </button>
            <label className={styles.creationCheckbox}>
              <input
                type="checkbox"
                checked={clusterEdit.archived}
                onChange={(e) =>
                  setClusterEdit({ ...clusterEdit, archived: e.target.checked })
                }
              />
              В архиве (не участвует в запуске)
            </label>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button className={styles.primary} disabled={busy}>
                Сохранить кластер
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setClusterEdit(null)}
              >
                Отмена
              </button>
            </div>
          </form>
        </CreationDialog>
      )}
      {restructure && (
        <RestructureClusters
          kind={restructure.kind}
          clusters={restructure.clusters}
          busy={busy}
          error={error}
          close={() => setRestructure(null)}
          submit={(payload) =>
            act(async () => {
              await creationRequest(
                `${base}/clusters/restructure`,
                "POST",
                payload,
              );
              setRestructure(null);
              setSelected([]);
            })
          }
        />
      )}
      {launchConfirm && (
        <CreationLauncher
          base={parentBase}
          clusterIds={
            retry
              ? [
                  ...new Set(
                    data.run?.operations
                      .filter((o) => o.status === "failed")
                      .map((o) => o.clusterId) ?? [],
                  ),
                ]
              : selected
          }
          retryRunId={retry ? (data.run?.id ?? null) : null}
          instruction={instruction}
          setInstruction={setInstruction}
          file={file}
          setFile={setFile}
          voice={voice}
          onVoice={setVoice}
          close={() => {
            setVoice(false);
            setLaunchConfirm(false);
          }}
          onStarted={async () => {
            setLaunchConfirm(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
