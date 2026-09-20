"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./content-center-view.module.css";

type Connection = { connected: boolean; groupName?: string };
export function VkConnection({
  path,
  revision,
  disabled,
  request,
  onUpdated,
  onConnectionChange,
}: {
  path: string;
  revision: number;
  disabled: boolean;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onUpdated: () => Promise<unknown>;
  onConnectionChange: (connected: boolean) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    void request<Connection>(`${path}/vk`)
      .then((value) => {
        if (!active) return;
        setConnection(value);
        onConnectionChange(value.connected);
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось проверить подключение VK. Откройте источник заново.",
          );
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [path, request, onConnectionChange]);

  async function change(remove = false) {
    if (busyRef.current || disabled) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await request<Connection>(
        `${path}/vk`,
        remove ? "DELETE" : "PUT",
        remove ? { revision } : { revision, token, consent },
      );
      if (!alive.current) return;
      setToken("");
      setConsent(false);
      setConnection(value);
      onConnectionChange(value.connected);
      await onUpdated();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось изменить подключение VK",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <section aria-label="Подключение VK">
      <div className={styles.cardHead}>
        <h3>
          {connection?.connected
            ? `VK · ${connection.groupName}`
            : "Подключить VK"}
        </h3>
        {connection?.connected && (
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void change(true)}
          >
            Отключить VK
          </button>
        )}
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
          Проверяем подключение…
        </p>
      )}
      {connection && !connection.connected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change();
          }}
        >
          <fieldset className={styles.formFields} disabled={busy || disabled}>
            <label className={styles.field}>
              Пользовательский ключ VK администратора сообщества
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={16}
                maxLength={1024}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <p className={styles.muted}>
              Ключ передаётся только VK для проверки и чтения. В CMS хранится
              зашифрованным и не передаётся AI. Ключ сообщества или VK ID может
              не поддерживать чтение стены.
            </p>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Подтверждаю, что это сообщество заказчика и его собственные
              публикации можно использовать для AI-обработки в этом workspace.
            </label>
            <div className={styles.actions} style={{ margin: "16px 0" }}>
              <button className={styles.primary} type="submit">
                {busy ? "Проверяем доступ…" : "Подключить сообщество"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
