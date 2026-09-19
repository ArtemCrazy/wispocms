"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  ARTICLE_STATUS,
  AI_RECOMMENDATION,
  RUN_STATUS,
  creationLocation,
  filterClusters,
  launchClusters,
  platformRows,
  type ArticleDetails,
  type Cluster,
  type CreationLocation,
  type History,
  type Overview,
  type Query,
  type Settings,
} from "./creation-state";
import {
  CreationDialog,
  CreationInstruction,
  creationDate,
  creationRequest,
} from "./creation-shared";
import { CreationArticle } from "./creation-article";
import { CreationHistory } from "./creation-history";
import { RestructureClusters } from "./creation-restructure";
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
  function articleCards(c: Cluster) {
    return platformRows(c, data!).map((p) => (
      <article className={styles.card} key={p.siteId}>
        {p.article?.cover_media_id && (
          <Image
            unoptimized
            width={480}
            height={270}
            className={styles.creationImage}
            src={`/api/sites/${p.siteId}/content/media/${p.article.cover_media_id}/file`}
            alt="Иллюстрация статьи"
          />
        )}
        <div className={styles.cardHead}>
          <h3>
            {p.article ? (
              <button
                className={styles.link}
                onClick={() =>
                  navigate({ screen: "article", id: p.article!.id })
                }
              >
                {p.article.title}
              </button>
            ) : (
              p.name
            )}
          </h3>
          <span className={styles.badge}>
            {ARTICLE_STATUS[p.article?.status ?? "missing"]}
          </span>
        </div>
        {p.article ? (
          <>
            <p className={styles.muted}>
              Создана: {creationDate(p.article.created_at)} · Обновлена:{" "}
              {creationDate(p.article.updated_at)}
            </p>
            <details>
              <summary>Рекомендация AI и назначение статьи</summary>
              <p>
                <b>{AI_RECOMMENDATION[p.article.recommendation]}</b> —{" "}
                {p.article.rationale}
              </p>
              <dl>
                <dt>Назначение</dt>
                <dd>{p.article.purpose}</dd>
                <dt>Задача</dt>
                <dd>{p.article.task}</dd>
                <dt>Потребность пользователя</dt>
                <dd>{p.article.need}</dd>
                <dt>Обоснование содержания</dt>
                <dd>{p.article.content_rationale}</dd>
              </dl>
            </details>
          </>
        ) : (
          <p>
            Рекомендация: Создать. Статья для этой площадки пока не существует;
            релевантность определит AI при запуске.
          </p>
        )}
        <div className={styles.creationPublication}>
          <strong>Публикация</strong>
          <p>{p.name}</p>
          {p.article?.publication_url && (
            <a
              href={p.article.publication_url}
              target="_blank"
              rel="noreferrer"
            >
              Открыть опубликованную статью ↗
            </a>
          )}
        </div>
      </article>
    ));
  }
  return (
    <div className={styles.preparationStack}>
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
      {(location.screen === "table" || location.screen === "article") &&
        data.run && (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>Текущий запуск № {data.run.number}</h2>
              <span className={styles.badge}>
                {RUN_STATUS[data.run.status]}
              </span>
            </div>
            <p>
              {
                data.run.operations.filter(
                  (o) => !["queued", "processing"].includes(o.status),
                ).length
              }{" "}
              из {data.run.operations.length} операций ·{" "}
              {creationDate(data.run.created_at)} · {data.run.actor_name}
            </p>
            <progress
              aria-label="Прогресс запуска"
              max={Math.max(1, data.run.operations.length)}
              value={
                data.run.operations.filter(
                  (o) => !["queued", "processing"].includes(o.status),
                ).length
              }
            />
            {data.run.operations.map((o, i) => (
              <div className={styles.creationOperation} key={i}>
                <span>
                  {o.clusterTitle} · {o.siteName}
                </span>
                <span>
                  {o.message ||
                    (o.status === "processing"
                      ? "Обрабатывается"
                      : "В очереди")}
                </span>
              </div>
            ))}
            {["failed", "partial"].includes(data.run.status) &&
              data.run.kind === "production" && (
                <button
                  disabled={busy || !data.ai.connected}
                  onClick={() => {
                    setRetry(true);
                    setLaunchConfirm(true);
                  }}
                >
                  Повторить операции с ошибкой
                </button>
              )}
          </section>
        )}
      {location.screen === "table" && (
        <>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Кластеры и статьи</h2>
                <p className={styles.muted}>
                  Актуальные и архивные кластеры в одной таблице. Статус и
                  рекомендация относятся к статье на конкретной площадке.
                </p>
              </div>
              <button onClick={() => edit()}>Добавить кластер</button>
            </div>
            <div className={styles.creationFilters}>
              <label className={styles.field}>
                Поиск
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Кластер, запрос, статья…"
                />
              </label>
              <label className={styles.field}>
                Направление
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="">Все направления</option>
                  {[
                    ...new Set(
                      data.clusters.map((c) => c.direction).filter(Boolean),
                    ),
                  ].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Статус статьи
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Все статусы</option>
                  {Object.entries(ARTICLE_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Рекомендация AI
                <select
                  value={recommendation}
                  onChange={(e) => setRecommendation(e.target.value)}
                >
                  <option value="">Все рекомендации</option>
                  {Object.entries(AI_RECOMMENDATION).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.creationTable}>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Выбрать показанные актуальные кластеры"
                        checked={
                          filtered.some((c) => !c.archived) &&
                          filtered
                            .filter((c) => !c.archived)
                            .every((c) => selected.includes(c.id))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [
                                  ...new Set([
                                    ...selected,
                                    ...filtered
                                      .filter((c) => !c.archived)
                                      .map((c) => c.id),
                                  ]),
                                ]
                              : selected.filter(
                                  (id) => !filtered.some((c) => c.id === id),
                                ),
                          )
                        }
                      />
                    </th>
                    <th>№</th>
                    <th>Кластер / направление</th>
                    <th>Запросов</th>
                    <th>Общая частотность</th>
                    <th>Точная частотность</th>
                    <th>Площадка · статья · статус · рекомендация</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className={
                        c.archived ? styles.creationArchived : undefined
                      }
                    >
                      <td>
                        <input
                          aria-label={`Выбрать кластер ${c.number}`}
                          type="checkbox"
                          disabled={c.archived}
                          checked={selected.includes(c.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, c.id]
                                : selected.filter((id) => id !== c.id),
                            )
                          }
                        />
                      </td>
                      <td>{c.number}</td>
                      <td>
                        <button
                          className={styles.link}
                          onClick={() =>
                            navigate({ screen: "cluster", id: c.id })
                          }
                        >
                          {c.title}
                        </button>
                        <div className={styles.muted}>
                          {c.direction || "Без направления"}
                        </div>
                        {c.archived && (
                          <span className={styles.badge}>Архив</span>
                        )}
                      </td>
                      <td>{c.queries.length}</td>
                      <td>
                        {c.queries
                          .reduce((s, q) => s + q.general, 0)
                          .toLocaleString("ru-RU")}
                      </td>
                      <td>
                        {c.queries
                          .reduce((s, q) => s + q.exact, 0)
                          .toLocaleString("ru-RU")}
                      </td>
                      <td>
                        {platformRows(c, data).map((p) => (
                          <div
                            className={styles.creationPlatform}
                            key={p.siteId}
                          >
                            <strong>{p.name}</strong>
                            {p.article ? (
                              <button
                                className={styles.link}
                                onClick={() =>
                                  navigate({
                                    screen: "article",
                                    id: p.article!.id,
                                  })
                                }
                              >
                                {p.article.title}
                              </button>
                            ) : (
                              <span>Статьи пока нет</span>
                            )}
                            <span>
                              {ARTICLE_STATUS[p.article?.status ?? "missing"]}
                            </span>
                            <details>
                              <summary>
                                {
                                  AI_RECOMMENDATION[
                                    p.article?.recommendation ?? "create"
                                  ]
                                }
                              </summary>
                              {p.article?.rationale ??
                                "Статья для этой площадки ещё не создана. AI определит релевантность при запуске."}
                            </details>
                          </div>
                        ))}
                        {!data.settings.platforms.length &&
                          !platformRows(c, data).length && (
                            <span className={styles.muted}>
                              Подключите площадки
                            </span>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <p className={styles.muted}>
                {data.clusters.length
                  ? "По этим условиям кластеры не найдены."
                  : "Кластеров пока нет. Можно добавить подготовленные запросы вручную. Автоматическое формирование кластеров относится к отдельному исследовательскому процессу."}
              </p>
            )}
            {selected.length > 0 && (
              <div className={styles.actions}>
                <span>Выбрано: {selected.length}</span>
                <button onClick={() => setSelected([])}>Снять выбор</button>
                <button
                  disabled={selectedClusters.length < 2}
                  onClick={() =>
                    setRestructure({
                      kind: "merge",
                      clusters: selectedClusters,
                    })
                  }
                >
                  Объединить выбранные
                </button>
              </div>
            )}
          </section>
          <section className={styles.card}>
            <h2>Создать контент</h2>
            <CreationInstruction
              base={parentBase}
              value={instruction}
              setValue={setInstruction}
              file={file}
              setFile={setFile}
              disabled={busy || running}
              onVoice={setVoice}
            />
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={
                  busy ||
                  voice ||
                  running ||
                  !data.ai.connected ||
                  !selectedClusters.length ||
                  !data.settings.platforms.length
                }
                onClick={() => {
                  setRetry(false);
                  setLaunchConfirm(true);
                }}
              >
                Создать контент
              </button>
              <span className={styles.muted}>
                {selected.length
                  ? `Для выбранных актуальных кластеров: ${selectedClusters.length}`
                  : `Для всех актуальных кластеров: ${selectedClusters.length}. Фильтры не ограничивают запуск.`}
              </span>
            </div>
          </section>
        </>
      )}
      {location.screen === "cluster" &&
        (cluster ? (
          <>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>
                  Кластер № {cluster.number}: {cluster.title}
                </h2>
                <button onClick={() => edit(cluster)}>
                  Редактировать кластер
                </button>
                <button
                  disabled={cluster.archived || cluster.queries.length < 2}
                  onClick={() =>
                    setRestructure({ kind: "split", clusters: [cluster] })
                  }
                >
                  Разделить кластер
                </button>
              </div>
              <p>
                {cluster.direction || "Без направления"}{" "}
                {cluster.archived && "· Архив"}
              </p>
              <p>
                Запросов: {cluster.queries.length} · Общая частотность:{" "}
                {cluster.queries.reduce((s, q) => s + q.general, 0)} · Точная
                частотность: {cluster.queries.reduce((s, q) => s + q.exact, 0)}
              </p>
              <h3>Запросы кластера</h3>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Запрос</th>
                      <th>Общая частотность</th>
                      <th>Точная частотность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cluster.queries.map((q) => (
                      <tr key={q.text}>
                        <td>
                          {q.text}{" "}
                          {q.primary && (
                            <span className={styles.badge}>Основной</span>
                          )}
                        </td>
                        <td>{q.general}</td>
                        <td>{q.exact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() =>
                  navigate({
                    screen: "history",
                    historyTab: "clusters",
                    clusterContext: cluster.id,
                    id: null,
                  })
                }
              >
                История изменений кластера →
              </button>
            </section>
            <h2>Статьи</h2>
            {articleCards(cluster)}
            {!platformRows(cluster, data).length && (
              <p className={styles.muted}>
                Подключите площадки для создания статей.
              </p>
            )}
          </>
        ) : (
          <p>Кластер не найден.</p>
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
        <CreationDialog
          title={
            retry
              ? "Повторить операции с ошибкой?"
              : "Запустить создание контента?"
          }
          close={() => setLaunchConfirm(false)}
          busy={busy}
        >
          <p>
            {retry
              ? "Будут повторены только неудачные операции последнего запуска с актуальными данными. Старый файл не переносится — прикрепите его заново при необходимости."
              : `Будут обработаны ${selectedClusters.length} актуальных кластеров. AI определит релевантность подключённых площадок.`}
          </p>
          <p>
            Статьи с незавершёнными предложениями и снятые с публикации не
            проверяются повторно. Публикация и снятие не выполняются
            автоматически.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button
              disabled={busy}
              className={styles.primary}
              onClick={() =>
                void act(async () => {
                  const form = new FormData();
                  form.append(
                    "payload",
                    JSON.stringify({
                      clusterIds: retry ? [] : selected,
                      instruction,
                      ...(retry ? { retryRunId: data.run!.id } : {}),
                    }),
                  );
                  if (file) form.append("file", file);
                  await creationRequest(`${base}/runs`, "POST", form);
                  setInstruction("");
                  setFile(null);
                  setLaunchConfirm(false);
                })
              }
            >
              Подтвердить запуск
            </button>
            <button disabled={busy} onClick={() => setLaunchConfirm(false)}>
              Отмена
            </button>
          </div>
        </CreationDialog>
      )}
    </div>
  );
}
