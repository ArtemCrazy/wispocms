"use client";

import { useEffect, useState } from "react";
import {
  CreationDialog,
  CreationInstruction,
  creationDate,
  creationRequest,
} from "./creation-shared";
import { launchClusters, type Overview } from "./creation-state";
import styles from "./content-center-view.module.css";

export type PreparedVersion = {
  id: string;
  number: number;
  created_at: string;
  prompt_title?: string | null;
};
type Review = { overview: Overview; prepared: PreparedVersion | null };

export function launchBlockReason({
  busy,
  running,
  voice,
  connected,
  clusterCount,
  platformCount,
}: {
  busy: boolean;
  running: boolean;
  voice: boolean;
  connected: boolean;
  clusterCount: number;
  platformCount: number;
}) {
  if (busy) return "Подождите завершения текущего действия.";
  if (running) return "Дождитесь завершения текущего запуска.";
  if (voice) return "Завершите диктовку перед запуском.";
  if (!connected)
    return "Для создания контента подключите AI в настройках платформы.";
  if (!clusterCount) return "Выберите хотя бы одну актуальную тему в таблице.";
  if (!platformCount)
    return "Выберите площадки в разделе «Площадки и правила».";
  return "";
}

export function latestPrepared(versions: PreparedVersion[]) {
  return versions.reduce<PreparedVersion | null>(
    (latest, v) => (!latest || v.number > latest.number ? v : latest),
    null,
  );
}

export function launchReviewSignature(review: Review, ids: string[]) {
  return JSON.stringify({
    version: review.prepared?.id ?? null,
    settings: review.overview.settings,
    clusters: launchClusters(review.overview.clusters, ids).map((c) => [
      c.id,
      c.revision,
    ]),
    articles: review.overview.articles
      .filter((a) => ids.includes(a.cluster_id))
      .map((a) => [a.id, a.revision]),
  });
}

export function CreationLauncher({
  base,
  clusterIds,
  retryRunId,
  instruction,
  setInstruction,
  file,
  setFile,
  voice,
  onVoice,
  close,
  onStarted,
}: {
  base: string;
  clusterIds: string[];
  retryRunId: string | null;
  instruction: string;
  setInstruction: (v: string) => void;
  file: File | null;
  setFile: (v: File | null) => void;
  voice: boolean;
  onVoice: (v: boolean) => void;
  close: () => void;
  onStarted: () => Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [documentUrl, setDocumentUrl] = useState("");
  async function readReview() {
    const [overview, preparation] = await Promise.all([
      creationRequest<Overview>(`${base}/creation`),
      creationRequest<{ versions: PreparedVersion[] }>(base),
    ]);
    return { overview, prepared: latestPrepared(preparation.versions) };
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      creationRequest<Overview>(`${base}/creation`),
      creationRequest<{ versions: PreparedVersion[] }>(base),
    ])
      .then(([overview, preparation]) => {
        if (!active) return;
        const prepared = latestPrepared(preparation.versions);
        setReview({ overview, prepared });
        if (prepared) {
          const url = new URL(window.location.href);
          url.searchParams.set("cc", "document");
          url.searchParams.set("ccVersion", prepared.id);
          setDocumentUrl(url.toString());
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  const topics = review
    ? launchClusters(review.overview.clusters, clusterIds)
    : [];
  const platforms = review?.overview.settings.platforms ?? [];
  const running =
    review?.overview.run?.status === "queued" ||
    review?.overview.run?.status === "processing";
  const reason = !review
    ? error
      ? "Закройте окно и попробуйте открыть его снова."
      : "Проверяем состав задания…"
    : launchBlockReason({
        busy,
        running,
        voice,
        connected: review.overview.ai.connected,
        clusterCount: topics.length,
        platformCount: platforms.length,
      });
  async function start() {
    if (!review || reason) return;
    setBusy(true);
    setError("");
    try {
      const fresh = await readReview();
      if (
        launchReviewSignature(fresh, clusterIds) !==
        launchReviewSignature(review, clusterIds)
      ) {
        setReview(fresh);
        if (fresh.prepared) {
          const url = new URL(window.location.href);
          url.searchParams.set("cc", "document");
          url.searchParams.set("ccVersion", fresh.prepared.id);
          setDocumentUrl(url.toString());
        } else setDocumentUrl("");
        throw new Error(
          "Материалы, темы или настройки изменились. Состав задания обновлён — проверьте его и подтвердите запуск ещё раз.",
        );
      }
      const currentTopics = launchClusters(fresh.overview.clusters, clusterIds);
      if (!currentTopics.length)
        throw new Error(
          "Выберите актуальные темы. Запуск без выбора запрещён.",
        );
      const freshReason = launchBlockReason({
        busy: false,
        running:
          fresh.overview.run?.status === "queued" ||
          fresh.overview.run?.status === "processing",
        voice,
        connected: fresh.overview.ai.connected,
        clusterCount: currentTopics.length,
        platformCount: fresh.overview.settings.platforms.length,
      });
      if (freshReason) {
        setReview(fresh);
        throw new Error(freshReason);
      }
      if (file && !fresh.overview.ai.supportsFiles)
        throw new Error(
          "Подключённый AI не поддерживает вложения. Уберите файл перед запуском.",
        );
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          clusterIds: currentTopics.map((c) => c.id),
          instruction,
          ...(retryRunId ? { retryRunId } : {}),
        }),
      );
      if (file && fresh.overview.ai.supportsFiles) form.append("file", file);
      await creationRequest(`${base}/creation/runs`, "POST", form);
      setInstruction("");
      setFile(null);
      await onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CreationDialog
      title={retryRunId ? "Повторить подготовку статей" : "Подготовить статьи"}
      close={close}
      busy={busy || voice}
    >
      <p className={styles.muted}>
        Проверьте, о чём пишем, на основе чего и для каких площадок. Затем
        добавьте пожелания, если они нужны.
      </p>
      {review && (
        <>
          <div className={styles.launchOverview}>
            <section className={styles.launchSection}>
              <h3>1. Выбранные темы · {topics.length}</h3>
              <ul>
                {topics.map((c) => (
                  <li key={c.id}>{c.title}</li>
                ))}
              </ul>
              {!topics.length && <p>Нет выбранных актуальных тем.</p>}
            </section>
            <section className={styles.launchSection}>
              <h3>2. Основа для статей</h3>
              {review.prepared ? (
                <>
                  <strong>
                    {review.prepared.prompt_title || "Обработанная информация"}{" "}
                    · версия {review.prepared.number}
                  </strong>
                  <p className={styles.muted}>
                    {creationDate(review.prepared.created_at)}
                  </p>
                  {documentUrl && (
                    <a href={documentUrl} target="_blank" rel="noreferrer">
                      Прочитать исходный документ ↗
                    </a>
                  )}
                  <p className={styles.muted}>
                    Автоматически используется последняя обработанная версия.
                    Исходные ссылки и файлы заново не собираются.
                  </p>
                </>
              ) : (
                <p>
                  Обработанной информации пока нет. В основу войдут темы,
                  существующие статьи и правила проекта. Новые факты о компании
                  AI не получит.
                </p>
              )}
            </section>
            <section className={styles.launchSection}>
              <h3>3. Подключённые площадки</h3>
              <ul>
                {platforms.map((p) => (
                  <li key={p.siteId}>
                    {review.overview.sites.find((s) => s.id === p.siteId)
                      ?.name ?? "Площадка недоступна"}
                  </li>
                ))}
              </ul>
              {!platforms.length && (
                <p>Сначала подключите площадку в «Площадки и правила».</p>
              )}
              <p className={styles.muted}>
                AI определит релевантность каждой теме. Применяются постоянные
                правила проекта и площадок, учитываются существующие статьи.
              </p>
            </section>
          </div>
          {retryRunId && (
            <p className={styles.notice}>
              Повторяются только ошибочные операции. Пожелания и файл
              предыдущего запуска автоматически не восстанавливаются.
            </p>
          )}
          <CreationInstruction
            base={base}
            value={instruction}
            setValue={setInstruction}
            file={file}
            setFile={setFile}
            disabled={busy || running}
            onVoice={onVoice}
            allowFile={review.overview.ai.supportsFiles}
            label="4. Пожелания к статьям — необязательно"
          />
          <p className={styles.muted}>
            Новые статьи сохранятся как черновики; для существующих AI может
            предложить правки. Статьи со снятой публикацией или нерассмотренными
            предложениями пропускаются. Автоматической публикации нет.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {reason && (
        <p role="status" className={styles.muted}>
          {reason}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={Boolean(reason)}
          onClick={() => void start()}
        >
          {busy ? "Запускаем…" : "Создать статьи"}
        </button>
        <button disabled={busy || voice} onClick={close}>
          Назад к темам
        </button>
      </div>
    </CreationDialog>
  );
}
