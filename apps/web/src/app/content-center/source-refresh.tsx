"use client";

import { useEffect, useRef, useState } from "react";
import {
  isVkMaterial,
  isTelegramMaterial,
  isApiSocialMaterial,
  type ProjectMaterial,
} from "./materials";
import { VkConnection } from "./vk-connection";
import { SocialConnection } from "./social-connection";
import { SourceRegistry } from "./source-registry";
import { YoutubeTranscriptionQueue } from "./youtube-transcription-queue";
import styles from "./content-center-view.module.css";

export function SourceRefresh({
  initial,
  base,
  request,
  onUpdated,
}: {
  initial: ProjectMaterial;
  base: string;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onUpdated: () => Promise<unknown>;
}) {
  const [material, setMaterial] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [vkConnected, setVkConnected] = useState(false);
  const [socialReady, setSocialReady] = useState(false);
  const vk = isVkMaterial(material);
  const telegram = isTelegramMaterial(material);
  const instagram = isApiSocialMaterial(material, "instagram");
  const youtube = isApiSocialMaterial(material, "youtube");
  const alive = useRef(true);
  const submittingRef = useRef(false);
  const running =
    material.collection_run?.status === "queued" ||
    material.collection_run?.status === "processing";
  const path = `${base}/materials/${material.id}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!running) return;
    let active = true;
    let fetching = false;
    const timer = window.setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const row = await request<ProjectMaterial>(path);
        if (!active) return;
        setMaterial(row);
        setError("");
        if (
          row.collection_run?.status !== "queued" &&
          row.collection_run?.status !== "processing"
        )
          await onUpdated();
      } catch (error) {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Не удалось проверить сбор",
          );
      } finally {
        fetching = false;
      }
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [running, path, request, onUpdated]);

  async function refresh() {
    if (submittingRef.current || running) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const run = await request<NonNullable<ProjectMaterial["collection_run"]>>(
        `${path}/refresh`,
        "POST",
        { revision: material.revision },
      );
      if (alive.current)
        setMaterial((current) => ({ ...current, collection_run: run }));
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error ? error.message : "Не удалось запустить сбор",
        );
    } finally {
      submittingRef.current = false;
      if (alive.current) setSubmitting(false);
    }
  }

  return (
    <>
      {vk && (
        <VkConnection
          path={path}
          request={request}
          onConnectionChange={setVkConnected}
        />
      )}
      {telegram && (
        <p className={styles.muted}>
          Публичный Telegram-канал: до 100 последних доступных публикаций без
          ограничения по давности. Без репостов, комментариев и чтения вложений.
        </p>
      )}
      {(instagram || youtube) && (
        <SocialConnection
          network={instagram ? "instagram" : "youtube"}
          path={path}
          revision={material.revision}
          running={running}
          request={request}
          onReady={setSocialReady}
          onChanged={async () => {
            setMaterial(await request<ProjectMaterial>(path));
            await onUpdated();
          }}
        />
      )}
      {(material.url_category === "site" ||
        vk ||
        telegram ||
        instagram ||
        youtube) && (
        <>
          <div className={styles.sourceRefreshBar}>
            <button
              type="button"
              disabled={
                submitting ||
                running ||
                (vk && !vkConnected) ||
                ((instagram || youtube) && !socialReady)
              }
              onClick={() => void refresh()}
            >
              {submitting
                ? "Запускаем сбор…"
                : running
                  ? "Сбор выполняется…"
                  : "Обновить сбор"}
            </button>
          </div>
          {running && (
            <p role="status" className={styles.muted}>
              {material.collection_run?.progress?.message ??
                "Сбор в очереди. Можно закрыть окно — он продолжится."}
            </p>
          )}
          {(error || material.collection_run?.error) && (
            <p role="alert" className={styles.error}>
              {error || material.collection_run?.error}
            </p>
          )}
        </>
      )}
      {youtube && (
        <YoutubeTranscriptionQueue
          material={material}
          path={path}
          request={request}
          onMaterialUpdated={(updated) => {
            setMaterial(updated);
            void onUpdated();
          }}
        />
      )}
      {material.site_pages ? (
        <SourceRegistry sources={[material.site_pages]} />
      ) : (
        <p className={styles.muted}>Сохранённого сбора пока нет.</p>
      )}
    </>
  );
}
