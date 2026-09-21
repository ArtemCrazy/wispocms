"use client";

import { useEffect, useState } from "react";
import styles from "./platform-ai-settings.module.css";

type Settings = {
  configured: boolean;
  hasKey: boolean;
  storageReady: boolean;
  model: string;
  models: string[];
  revision: number;
  verifiedAt: string | null;
};

const endpoint = "/api/platform/settings/youtube-transcription";

async function request(method = "GET", body?: unknown, suffix = "") {
  const response = await fetch(endpoint + suffix, {
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
        : (payload?.message ?? "Не удалось выполнить запрос"),
    );
  }
  return (await response.json()) as Settings;
}

export function PlatformYoutubeTranscriptionSettings({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = Boolean(apiKey || (settings && model !== settings.model));

  useEffect(() => {
    let active = true;
    request()
      .then((value) => {
        if (active) {
          setSettings(value);
          setModel(value.model);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  async function act(action: "save" | "check" | "remove") {
    if (!settings || busy) return;
    if (
      action === "remove" &&
      !window.confirm(
        "Удалить сохранённый ключ Groq? Очередь и уже готовые расшифровки сохранятся.",
      )
    )
      return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const value =
        action === "save"
          ? await request("PUT", {
              revision: settings.revision,
              model,
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            })
          : action === "remove"
            ? await request("DELETE", { revision: settings.revision })
            : await request("POST", undefined, "/check");
      setSettings(value);
      setModel(value.model);
      setApiKey("");
      setMessage(
        action === "save"
          ? "Ключ Groq сохранён. Проверьте подключение перед запуском очереди."
          : action === "remove"
            ? "Ключ Groq удалён. Готовые расшифровки сохранены."
            : "Groq доступен, модель Whisper подтверждена. Аудио ещё не отправлялось.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить запрос");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className={styles.card} aria-label="Настройки расшифровки YouTube">
      <div className={styles.heading}>
        <div>
          <h2>Groq Whisper</h2>
          <p>Расшифровка аудио публичных видео YouTube</p>
        </div>
        <span className={styles.status}>
          {settings?.verifiedAt
            ? "Доступ проверен"
            : settings?.hasKey
              ? "Ключ сохранён · не проверен"
              : "Не подключён"}
        </span>
      </div>
      <p>
        Отдельный ключ Groq используется только очередью расшифровки. Ключ
        YouTube Data API нужен для списка видео и не заменяет этот ключ.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      {!settings ? (
        <p>{error ? "Обновите страницу, чтобы повторить загрузку." : "Загружаем настройки…"}</p>
      ) : (
        <>
          {!settings.storageReady && (
            <p className={styles.error} role="alert">
              Серверное хранилище ключей не настроено. Сохранение и очередь
              недоступны.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act("save");
            }}
          >
            <fieldset disabled={Boolean(busy) || !settings.storageReady}>
              <label htmlFor="groq-whisper-key">
                {settings.hasKey ? "Заменить API-ключ Groq" : "API-ключ Groq"}
              </label>
              <input
                id="groq-whisper-key"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.hasKey ? "Сохранён. Для замены вставьте новый" : "Вставьте ключ Groq (gsk_…)"}
                maxLength={256}
                required={!settings.hasKey}
              />
              <p>
                Ключ хранится зашифрованным и не возвращается в браузер. Его
                можно будет заменить без удаления очереди.
              </p>
              <label htmlFor="groq-whisper-model">Модель Whisper</label>
              <select
                id="groq-whisper-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {settings.models.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={!dirty || (!settings.hasKey && !apiKey.trim())}
                  type="submit"
                >
                  {busy === "save" ? "Сохраняем…" : "Сохранить"}
                </button>
                <button
                  type="button"
                  disabled={!settings.configured || dirty}
                  onClick={() => void act("check")}
                >
                  {busy === "check" ? "Проверяем…" : "Проверить подключение"}
                </button>
              </div>
            </fieldset>
          </form>
          <div className={styles.details}>
            <p>
              Проверка обращается к списку моделей Groq и не отправляет видео.
              При запуске очереди CMS сама скачивает аудио публичного видео и
              отправляет его в Whisper по одному заданию.
            </p>
            {settings.verifiedAt && (
              <p>Последняя успешная проверка: {new Date(settings.verifiedAt).toLocaleString("ru-RU")}</p>
            )}
          </div>
          {settings.hasKey && (
            <button
              type="button"
              className={styles.remove}
              disabled={Boolean(busy) || dirty}
              onClick={() => void act("remove")}
            >
              {busy === "remove" ? "Удаляем…" : "Удалить ключ Groq"}
            </button>
          )}
        </>
      )}
    </article>
  );
}
