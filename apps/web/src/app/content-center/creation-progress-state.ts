import type { Operation, Run } from "./creation-state";

export const OPERATION_STATUS: Record<Operation["status"], string> = {
  queued: "В очереди",
  processing: "Обрабатывается",
  succeeded: "Готово",
  failed: "Ошибка",
  skipped: "Пропущено",
};

export function runProgress(run: Run) {
  const counts = {
    queued: 0,
    processing: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  for (const operation of run.operations) counts[operation.status]++;
  const total = run.operations.length;
  const done = counts.succeeded + counts.failed + counts.skipped;
  const active = run.status === "queued" || run.status === "processing";
  const percent = total
    ? Math.min(active ? 99 : 100, Math.floor((done * 100) / total))
    : 0;
  const clusters = Array.from(
    new Set(run.operations.map((o) => o.clusterId)),
  ).map((id) => {
    const operations = run.operations.filter((o) => o.clusterId === id);
    return {
      id,
      title: operations[0].clusterTitle,
      operations,
      done: operations.filter((o) =>
        ["succeeded", "failed", "skipped"].includes(o.status),
      ).length,
    };
  });
  const message =
    run.status === "queued"
      ? "Задача принята. Ожидаем начала обработки."
      : run.status === "processing"
        ? done === total && total > 0
          ? "Операции обработаны. Завершаем запуск…"
          : "Создаём и проверяем контент по кластерам и площадкам."
        : run.status === "succeeded"
          ? "Запуск завершён. Результаты доступны в таблице контента."
          : "Запуск завершился с ошибками. Успешные результаты сохранены; причины указаны в деталях.";
  return { ...counts, total, done, active, percent, clusters, message };
}

export function recentProductionRuns<
  T extends Pick<
    Run,
    | "id"
    | "number"
    | "kind"
    | "status"
    | "cluster_count"
    | "created_at"
    | "actor_name"
  >,
>(runs: T[], current: Run | null) {
  const combined =
    current?.kind === "production"
      ? [current, ...runs.filter((r) => r.id !== current.id)]
      : runs;
  return combined
    .filter((r) => r.kind === "production")
    .sort((a, b) => b.number - a.number)
    .slice(0, 2);
}
