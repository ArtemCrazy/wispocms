"use client";

import { useEffect, useState } from "react";
import { RUN_STATUS, type History, type Run } from "./creation-state";
import { creationDate, creationRequest } from "./creation-shared";
import {
  OPERATION_STATUS,
  recentProductionRuns,
  runProgress,
} from "./creation-progress-state";
import styles from "./content-center-view.module.css";

export function CreationProgress({
  run,
  retryDisabled,
  onRetry,
}: {
  run: Run | null;
  retryDisabled: boolean;
  onRetry: () => void;
}) {
  if (!run)
    return (
      <section className={styles.card} aria-label="Прогресс создания контента">
        <h2>Создание контента</h2>
        <p className={styles.muted}>
          Запусков пока нет. Здесь появятся прогресс и результаты обработки.
        </p>
      </section>
    );
  const progress = runProgress(run);
  const hasErrors = run.status === "failed" || run.status === "partial";
  const steps = [
    { title: "Задача принята", state: "done", label: "Готово" },
    {
      title: "Обработка кластеров и площадок",
      state:
        run.status === "queued"
          ? "waiting"
          : progress.active
            ? "active"
            : hasErrors
              ? "error"
              : "done",
      label:
        run.status === "queued"
          ? "Ожидает"
          : progress.active
            ? "В процессе"
            : hasErrors
              ? "С ошибками"
              : "Готово",
    },
    {
      title: "Завершение запуска",
      state: progress.active ? "waiting" : hasErrors ? "error" : "done",
      label: progress.active ? "Ожидает" : RUN_STATUS[run.status],
    },
  ];
  return (
    <section className={styles.card} aria-label="Прогресс создания контента">
      <div className={styles.cardHead}>
        <h2>
          {progress.active ? "Идёт создание контента" : "Результат запуска"}
        </h2>
        <span className={styles.runBadge} data-status={run.status}>
          {RUN_STATUS[run.status]}
        </span>
      </div>
      <p className={styles.runMeta}>
        {run.kind === "correction" ? "Корректировка" : "Запуск"} №{run.number} ·{" "}
        {creationDate(run.created_at)}
      </p>
      <div className={styles.runProgressBar} data-error={hasErrors}>
        <progress
          aria-label="Обработанные операции"
          max={100}
          value={progress.percent}
        />
        <strong>{progress.percent}%</strong>
      </div>
      <p className={styles.runMessage} role="status">
        {progress.message}
      </p>
      <p className={styles.runCounts}>
        Обработано операций: {progress.done} из {progress.total} · Успешно:{" "}
        {progress.succeeded} · Ошибок: {progress.failed} · Пропущено:{" "}
        {progress.skipped}
      </p>
      <ol className={styles.runSteps}>
        {steps.map((step) => (
          <li key={step.title} data-state={step.state}>
            <span className={styles.runStepIcon} aria-hidden="true">
              {step.state === "done" ? "✓" : step.state === "error" ? "!" : "•"}
            </span>
            <span>{step.title}</span>
            <small>{step.label}</small>
          </li>
        ))}
      </ol>
      {progress.clusters.length > 0 && (
        <details className={styles.runDetails}>
          <summary>
            По кластерам и площадкам ({progress.clusters.length})
          </summary>
          <div className={styles.runClusterList}>
            {progress.clusters.map((cluster) => (
              <div key={cluster.id} className={styles.runCluster}>
                <div className={styles.cardHead}>
                  <strong>{cluster.title}</strong>
                  <span>
                    {cluster.done} / {cluster.operations.length}
                  </span>
                </div>
                {cluster.operations.map((operation, index) => (
                  <div
                    className={styles.runOperation}
                    key={`${operation.siteId}-${index}`}
                  >
                    <span>{operation.siteName}</span>
                    <span
                      className={styles.runBadge}
                      data-status={operation.status}
                    >
                      {OPERATION_STATUS[operation.status]}
                    </span>
                    {operation.message && <p>{operation.message}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
      {hasErrors && run.kind === "production" && (
        <button type="button" disabled={retryDisabled} onClick={onRetry}>
          Повторить операции с ошибкой
        </button>
      )}
    </section>
  );
}

export function RecentRunList({
  runs,
  loading,
  error,
  onReload,
  onHistory,
}: {
  runs: Array<
    Pick<
      Run,
      | "id"
      | "number"
      | "kind"
      | "status"
      | "cluster_count"
      | "created_at"
      | "actor_name"
    >
  >;
  loading: boolean;
  error: string;
  onReload: () => void;
  onHistory: () => void;
}) {
  return (
    <section className={styles.card} aria-label="Последние запуски">
      <div className={styles.cardHead}>
        <h2>История запусков</h2>
        <button type="button" className={styles.link} onClick={onHistory}>
          Все запуски →
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <button type="button" onClick={onReload}>
            Повторить загрузку
          </button>
        </p>
      )}
      {loading && (
        <p role="status" className={styles.muted}>
          Загружаем историю…
        </p>
      )}
      {!loading && !error && !runs.length && (
        <p className={styles.muted}>История появится после первого запуска.</p>
      )}
      <ul className={styles.recentRunList}>
        {runs.map((run) => (
          <li
            key={run.id}
            data-active={run.status === "queued" || run.status === "processing"}
          >
            <div className={styles.cardHead}>
              <strong>Запуск №{run.number}</strong>
              <span className={styles.runBadge} data-status={run.status}>
                {RUN_STATUS[run.status]}
              </span>
            </div>
            <p>
              {creationDate(run.created_at)} · {run.actor_name}
            </p>
            <p>Кластеров: {run.cluster_count}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CreationRunPanels({
  base,
  run,
  showHistory,
  retryDisabled,
  onRetry,
  onHistory,
}: {
  base: string;
  run: Run | null;
  showHistory: boolean;
  retryDisabled: boolean;
  onRetry: () => void;
  onHistory: () => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    runs: History["runs"];
    error: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${base}:${showHistory}:${run?.id}:${run?.status}:${attempt}`;
  const current = result?.key === requestKey ? result : null;
  useEffect(() => {
    if (!showHistory) return;
    let active = true;
    // Reuse the existing history contract, only on entry/status transitions, not each progress poll.
    creationRequest<History>(`${base}/history`)
      .then((history) => {
        if (active)
          setResult({ key: requestKey, runs: history.runs, error: "" });
      })
      .catch(() => {
        if (active)
          setResult({
            key: requestKey,
            runs: [],
            error: "Не удалось загрузить последние запуски.",
          });
      });
    return () => {
      active = false;
    };
  }, [base, showHistory, requestKey]);
  return (
    <div className={showHistory ? styles.runPanels : undefined}>
      <CreationProgress
        run={run}
        retryDisabled={retryDisabled}
        onRetry={onRetry}
      />
      {showHistory && (
        <RecentRunList
          runs={recentProductionRuns(current?.runs ?? [], run)}
          loading={!current}
          error={current?.error ?? ""}
          onReload={() => setAttempt((value) => value + 1)}
          onHistory={onHistory}
        />
      )}
    </div>
  );
}
