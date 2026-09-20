"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./platform-ai-settings.module.css";
type Settings = {
  configured: boolean;
  hasKey: boolean;
  storageReady: boolean;
  revision: number;
  appId: string;
  redirectUri: string;
};

export function PlatformSocialSettings({
  network,
  onDirtyChange,
}: {
  network: "instagram" | "youtube";
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [secret, setSecret] = useState("");
  const [appId, setAppId] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  const instagram = network === "instagram";
  const title = instagram ? "Instagram" : "YouTube";
  const dirty = Boolean(
    secret ||
    (instagram &&
      settings &&
      (appId !== settings.appId || redirectUri !== settings.redirectUri)),
  );
  async function request(method = "GET", body?: unknown): Promise<Settings> {
    const response = await fetch(`/api/platform/settings/social/${network}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        Array.isArray(payload?.message)
          ? payload.message.join(". ")
          : (payload?.message ?? "Не удалось изменить настройки."),
      );
    }
    return response.json();
  }
  useEffect(() => {
    alive.current = true;
    let active = true;
    void fetch(`/api/platform/settings/social/${network}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as Settings;
        if (active) {
          setSettings(value);
          setAppId(value.appId);
          setRedirectUri(value.redirectUri);
        }
      })
      .catch(() => {
        if (active) setError(`Не удалось загрузить настройки ${network}.`);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [network]);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function save(remove = false) {
    if (!settings || pending.current) return;
    if (
      remove &&
      !window.confirm(
        `Удалить настройки ${title}? Новые сборы будут недоступны, материалы и версии сохранятся.`,
      )
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await request(
        remove ? "DELETE" : "PUT",
        remove
          ? { revision: settings.revision }
          : {
              revision: settings.revision,
              secret: secret.trim(),
              ...(instagram
                ? { appId: appId.trim(), redirectUri: redirectUri.trim() }
                : {}),
            },
      );
      if (!alive.current) return;
      setSettings(value);
      setSecret("");
      setAppId(value.appId);
      setRedirectUri(value.redirectUri);
      setMessage(
        remove
          ? "Настройки удалены."
          : instagram
            ? "Приложение сохранено. Теперь подключите аккаунт в информации об источнике. После изменения приложения прежние аккаунты нужно подключить заново."
            : "Ключ сохранён. Доступ будет проверен при сборе канала.",
      );
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось сохранить настройки.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <article className={styles.card} aria-label={`Настройки ${title}`}>
      <div className={styles.heading}>
        <div>
          <h2>{title}</h2>
          <p>
            {instagram
              ? "Собственные публикации профессионального аккаунта заказчика"
              : "Публичные каналы заказчиков"}
          </p>
        </div>
        <span className={styles.status}>
          {settings?.hasKey ? "Настройки сохранены" : "Не настроено"}
        </span>
      </div>
      <p>
        {instagram
          ? "Создайте приложение Meta с Instagram Login. Запросите только чтение профиля и публикаций — instagram_business_basic. Для аккаунтов заказчиков вне тестовых ролей необходимо одобрение соответствующего доступа Meta."
          : "Один ключ YouTube Data API v3 для всей CMS. Авторизация заказчика для публичных описаний не нужна. Ограничьте ключ этим API и IP сервера в Google Cloud."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || !settings?.storageReady}>
          {instagram && (
            <>
              <label htmlFor="instagram-app-id">Instagram App ID</label>
              <input
                id="instagram-app-id"
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                disabled={busy}
                required
                inputMode="numeric"
                autoComplete="off"
                maxLength={32}
              />
              <label htmlFor="instagram-redirect">
                Доверенный Redirect URI
              </label>
              <input
                id="instagram-redirect"
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                disabled={busy}
                required
                type="url"
                placeholder="https://cms.kpbox.ru/api/social/instagram/callback"
                maxLength={512}
              />
              <p>
                Точный HTTPS-адрес возврата должен быть добавлен в настройках
                Meta. Подключать аккаунт нужно с этого же домена CMS.
              </p>
            </>
          )}
          <label htmlFor={`${network}-secret`}>
            {instagram ? "Instagram App Secret" : "Ключ YouTube Data API"}
          </label>
          <input
            id={`${network}-secret`}
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            disabled={busy || !settings?.storageReady}
            required
            minLength={16}
            maxLength={4096}
            placeholder={
              settings?.hasKey
                ? "Сохранён. Для замены введите новый"
                : "Ключ приложения"
            }
          />
          <p>
            Ключ хранится зашифрованным, не возвращается в браузер и не
            передаётся AI.
          </p>
          <button
            type="submit"
            disabled={busy || !settings?.storageReady || !secret.trim()}
          >
            {busy ? "Сохраняем…" : `Сохранить ${title}`}
          </button>
        </fieldset>
      </form>
      {settings?.hasKey && (
        <button
          type="button"
          className={styles.remove}
          disabled={busy || dirty}
          onClick={() => void save(true)}
        >
          Удалить настройки {title}
        </button>
      )}
    </article>
  );
}
