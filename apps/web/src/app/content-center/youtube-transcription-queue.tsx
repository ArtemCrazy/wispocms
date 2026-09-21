"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectMaterial } from "./materials";
import { isApiSocialMaterial } from "./materials";
import styles from "./content-center-view.module.css";

type Job = {
  id: string;
  video_id: string;
  video_url: string;
  title: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
};
type Queue = {
  total: number;
  counts: Partial<Record<Job["status"], number>>;
  jobs: Job[];
};

function count(queue: Queue | null, status: Job["status"]) {
  return queue?.counts[status] ?? 0;
}

export function YoutubeTranscriptionQueue({
  material,
  path,
  request,
  onMaterialUpdated,
}: {
  material: ProjectMaterial;
  path: string;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onMaterialUpdated: (material: ProjectMaterial) => void;
}) {
  const youtube = isApiSocialMaterial(material, "youtube");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const hadRunning = useRef(false);
  const queuePath = `${path}/transcriptions`;

  const load = useCallback(async () => {
    if (!youtube) return;
    try {
      const value = await request<Queue>(queuePath);
      if (alive.current) {
        setQueue(value);
        setError("");
        const isRunning = Boolean(
          (value.counts.queued ?? 0) || (value.counts.processing ?? 0),
        );
        if (hadRunning.current && !isRunning) {
          const updated = await request<ProjectMaterial>(path);
          if (alive.current) onMaterialUpdated(updated);
        }
        hadRunning.current = isRunning;
      }
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить очередь");
    }
  }, [onMaterialUpdated, path, queuePath, request, youtube]);

  useEffect(() => {
    alive.current = true;
    const initial = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(initial);
      alive.current = false;
    };
  }, [load]);

  const running = Boolean(count(queue, "queued") || count(queue, "processing"));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 3500);
    return () => window.clearInterval(timer);
  }, [load, running]);

  async function enqueue(retry = false) {
    if (busy || !material.site_pages) return;
    setBusy(retry ? "retry" : "enqueue");
    setError("");
    try {
      const value = await request<Queue>(
        retry ? `${queuePath}/retry` : queuePath,
        "POST",
        retry ? undefined : { revision: material.revision },
      );
      if (alive.current) setQueue(value);
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "Не удалось запустить очередь");
    } finally {
      if (alive.current) setBusy("");
    }
  }

  if (!youtube) return null;
  return (
    <section className={styles.youtubeTranscription} aria-label="Расшифровка видео YouTube">
      <div className={styles.sourceRefreshBar}>
        <div>
          <strong>Расшифровка видео</strong>
          <p className={styles.muted}>
            {queue?.total
              ? `Готово ${count(queue, "succeeded")} из ${queue.total} · в очереди ${count(queue, "queued")} · обрабатывается ${count(queue, "processing")}`
              : "Поставьте найденные видео в очередь Groq Whisper после обновления сбора."}
          </p>
        </div>
        <div className={styles.sourceActions}>
          <button
            type="button"
            disabled={Boolean(busy) || !material.site_pages || running}
            onClick={() => void enqueue()}
          >
            {busy === "enqueue" ? "Ставим в очередь…" : running ? "Расшифровка выполняется…" : "Расшифровать видео"}
          </button>
          {count(queue, "failed") > 0 && !running && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void enqueue(true)}>
              {busy === "retry" ? "Повторяем…" : `Повторить ошибки (${count(queue, "failed")})`}
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {count(queue, "failed") > 0 && (
        <p className={styles.muted}>
          Ошибки сохраняются у конкретного видео. После исправления ключа или
          доступа к видео можно повторить только неудачные задания.
        </p>
      )}
    </section>
  );
}
