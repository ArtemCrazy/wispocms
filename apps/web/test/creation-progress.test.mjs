import assert from "node:assert/strict";
import test from "node:test";
import { runProgress, recentProductionRuns, OPERATION_STATUS } from "../src/app/content-center/creation-progress-state.ts";

const operation = (status, clusterId = "c1") => ({ clusterId, clusterTitle: clusterId, siteId: "site", siteName: "Сайт", articleId: null, status, message: "" });
const run = (status, operations = []) => ({ id: "r2", number: 2, kind: "production", status, operations, cluster_count: 2, actor_name: "Редактор", created_at: "2026-10-02T00:00:00Z" });

test("progress counts terminal operations separately from success and groups all platforms by cluster", () => {
  const progress = runProgress(run("processing", [operation("succeeded"), operation("failed"), operation("skipped", "c2"), operation("processing", "c2"), operation("queued", "c3")]));
  assert.equal(progress.percent, 60);
  assert.equal(progress.done, 3);
  assert.equal(progress.total, 5);
  assert.equal(progress.succeeded, 1);
  assert.equal(progress.failed, 1);
  assert.equal(progress.skipped, 1);
  assert.deepEqual(progress.clusters.map((c) => [c.id, c.done, c.operations.length]), [["c1", 2, 2], ["c2", 1, 2], ["c3", 0, 1]]);
});

test("queue, finalization, success and failure cannot produce fake completion or NaN", () => {
  const queued = runProgress(run("queued", [operation("queued")]));
  assert.equal(queued.percent, 0);
  assert.equal(queued.active, true);
  assert.match(queued.message, /Ожидаем/);
  const finishing = runProgress(run("processing", [operation("succeeded")]));
  assert.equal(finishing.percent, 99);
  assert.match(finishing.message, /Завершаем/);
  assert.equal(runProgress(run("succeeded", [operation("succeeded")])).percent, 100);
  const partial = runProgress(run("partial", [operation("succeeded"), operation("failed")]));
  assert.equal(partial.percent, 100);
  assert.equal(partial.active, false);
  assert.match(partial.message, /ошибками/);
  for (const status of ["queued", "processing", "succeeded", "failed", "partial"])
    assert.equal(runProgress(run(status)).percent, 0);
  assert.equal(OPERATION_STATUS.succeeded, "Готово");
  assert.equal(OPERATION_STATUS.skipped, "Пропущено");
});

test("recent runs overlay fresh status, omit corrections and limit to two without mutating history", () => {
  const old = { ...run("processing"), id: "r1", number: 1 };
  const list = [old, { ...run("succeeded"), id: "r0", number: 0 }];
  const current = { ...old, status: "succeeded" };
  assert.equal(recentProductionRuns(list, current)[0].status, "succeeded");
  assert.equal(list[0].status, "processing");
  assert.deepEqual(recentProductionRuns(list, run("queued")).map((r) => r.id), ["r2", "r1"]);
  assert.equal(recentProductionRuns(list, { ...run("queued"), kind: "correction" })[0].id, "r1");
  assert.deepEqual(recentProductionRuns([], null), []);
});
