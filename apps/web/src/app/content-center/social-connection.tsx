"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./content-center-view.module.css";
type Status = {
  ready: boolean;
  connected?: boolean;
  platformConfigured: boolean;
  username?: string;
  expiresAt?: string;
  redirectOrigin?: string;
};
export function SocialConnection({
  network,
  path,
  revision,
  running,
  request,
  onReady,
  onChanged,
}: {
  network: "instagram" | "youtube";
  path: string;
  revision: number;
  running: boolean;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onReady: (ready: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let active = true;
    onReady(false);
    void request<Status>(`${path}/social`)
      .then((value) => {
        if (active) {
          setStatus(value);
          onReady(value.ready);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось проверить подключение. Откройте источник заново.",
          );
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [path, revision, request, onReady]);
  async function act(disconnect = false) {
    if (pending.current || running) return;
    if (
      disconnect &&
      !window.confirm(
        "Отключить Instagram? Текущий сбор будет очищен; исторические версии останутся. Разрешение приложения можно также отозвать в настройках Instagram.",
      )
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (disconnect) {
        const value = await request<Status>(`${path}/social`, "DELETE", {
          revision,
        });
        if (!alive.current) return;
        setStatus(value);
        onReady(value.ready);
        await onChanged();
      } else {
        const value = await request<{ url: string }>(
          `${path}/social/connect`,
          "POST",
          { revision },
        );
        if (!alive.current) return;
        const url = new URL(value.url);
        if (
          url.origin !== "https://www.instagram.com" ||
          url.pathname !== "/oauth/authorize"
        )
          throw new Error("Некорректный адрес подключения.");
        window.location.assign(url.href);
      }
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось подключить Instagram.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label={`Подключение ${network === "instagram" ? "Instagram" : "YouTube"}`}
    >
      <h3>
        {network === "instagram"
          ? `Instagram${status?.username ? ` · @${status.username}` : ""}`
          : "YouTube"}
      </h3>
      <p className={styles.muted}>
        {network === "instagram"
          ? "Подписи к 100 последним публикациям и Reels, даты и ссылки. Без чтения фото, видео, Stories и комментариев."
          : "До 100 последних видео: названия, описания, даты и ссылки. Без просмотра видео и чтения субтитров."}
      </p>
      {!status && !error && <p role="status">Проверяем подключение…</p>}
      {status && !status.platformConfigured && (
        <p role="status" className={styles.muted}>
          Администратору CMS нужно настроить{" "}
          {network === "instagram"
            ? "приложение Instagram"
            : "YouTube Data API"}{" "}
          в настройках платформы.
        </p>
      )}
      {network === "instagram" && status?.platformConfigured && (
        <div className={styles.cardHead}>
          <button
            type="button"
            disabled={busy || running}
            onClick={() => void act()}
          >
            {busy
              ? "Подождите…"
              : status.ready
                ? "Переподключить Instagram"
                : "Подключить Instagram"}
          </button>
          {status.connected && (
            <button
              type="button"
              disabled={busy || running}
              onClick={() => void act(true)}
            >
              Отключить
            </button>
          )}
        </div>
      )}
      {network === "instagram" && status?.connected && !status.ready && (
        <p className={styles.muted}>
          Доступ истёк или настройки приложения изменились. Подключите аккаунт
          заново.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
