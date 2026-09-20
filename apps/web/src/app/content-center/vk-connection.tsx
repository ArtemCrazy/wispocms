"use client";

import { useEffect, useState } from "react";
import styles from "./content-center-view.module.css";

type Connection = { connected: boolean; ready: boolean; platformConfigured: boolean; groupName?: string };
export function VkConnection({
  path,
  request,
  onConnectionChange,
}: {
  path: string;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onConnectionChange: (connected: boolean) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    onConnectionChange(false);
    void request<Connection>(`${path}/vk`)
      .then((value) => {
        if (!active) return;
        setConnection(value);
        onConnectionChange(value.ready);
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось проверить настройки VK. Откройте источник заново.",
          );
      });
    return () => {
      active = false;
    };
  }, [path, request, onConnectionChange]);

  return (
    <section aria-label="Источник VK">
      <div className={styles.cardHead}>
        <h3>
          {connection?.connected
            ? `VK · ${connection.groupName}`
            : "ВКонтакте"}
        </h3>
      </div>
      <p className={styles.muted}>
        Описание, закреплённый пост и собственные текстовые публикации за 180
        дней — до 500 записей. Без комментариев и чтения вложений.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!connection && !error && (
        <p className={styles.muted} role="status">
          Проверяем настройки VK…
        </p>
      )}
      {connection && !connection.ready && (
        <p className={styles.muted} role="status">
          Администратор CMS должен настроить общее подключение VK в настройках платформы.
          Ключ заказчика не нужен. Сохранённые материалы остаются доступны.
        </p>
      )}
    </section>
  );
}
