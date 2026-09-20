"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./platform-ai-settings.module.css";

type Settings = {
  configured: boolean;
  hasKey: boolean;
  storageReady: boolean;
  revision: number;
  verifiedAt: string | null;
  checkedGroupName?: string;
};

async function request(method = "GET", body?: unknown, suffix = ""): Promise<Settings> {
  const response = await fetch(`/api/platform/settings/vk${suffix}`, {
    method, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(Array.isArray(payload?.message) ? payload.message.join(". ") : payload?.message ?? "Не удалось выполнить запрос VK");
  }
  return response.json();
}

export function PlatformVkSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [token, setToken] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const alive = useRef(true);
  const dirty = Boolean(token);

  useEffect(() => {
    alive.current = true;
    let active = true;
    request().then((value) => { if (active) setSettings(value); }).catch(() => {
      if (active) setError("Не удалось загрузить настройки VK. Обновите страницу.");
    });
    return () => { active = false; alive.current = false; };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  async function act(action: "save" | "check" | "remove") {
    if (!settings || busyRef.current) return;
    if (action === "remove" && !window.confirm("Удалить общий ключ VK? Новые сборы через него станут недоступны. Сохранённые материалы и версии останутся.")) return;
    busyRef.current = true;
    setBusy(action); setError(""); setMessage("");
    try {
      const value = action === "save"
        ? await request("PUT", { token: token.trim(), revision: settings.revision })
        : action === "remove"
          ? await request("DELETE", { revision: settings.revision })
          : await request("POST", { sourceUrl: sourceUrl.trim() }, "/check");
      if (!alive.current) return;
      setSettings(value);
      setToken("");
      setMessage(action === "check" ? `Доступ проверен: ${value.checkedGroupName || "открытое сообщество"}. Проверка не запускает AI.` : action === "save" ? "Общий ключ VK сохранён. Проверьте доступ к сообществу." : "Общий ключ VK удалён.");
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : "Не удалось изменить настройки VK");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy("");
    }
  }

  return <article className={styles.card} aria-label="Общее подключение VK">
    <div className={styles.heading}><div><h2>ВКонтакте</h2><p>Публикации открытых сообществ заказчиков</p></div><span className={styles.status}>{settings?.verifiedAt ? "Доступ проверен" : settings?.hasKey ? "Ключ сохранён · не проверен" : "Не подключён"}</span></div>
    <p>Одно приложение VK для всей CMS. Заказчику не нужно выдавать свой ключ или доступ администратора.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {!settings ? <p>{error ? "Настройки VK недоступны." : "Загружаем настройки VK…"}</p> : <>
      {!settings.storageReady && <p className={styles.error} role="alert">Серверное хранилище ключей не настроено.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void act("save"); }}>
        <fieldset disabled={Boolean(busy) || !settings.storageReady}>
          <label htmlFor="vk-service-key">{settings.hasKey ? "Заменить сервисный ключ приложения VK" : "Сервисный ключ приложения VK"}</label>
          <input id="vk-service-key" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} placeholder={settings.hasKey ? "Ключ сохранён. Для замены вставьте новый" : "Вставьте сервисный ключ приложения вашей компании"} minLength={16} maxLength={1024} required aria-describedby="vk-service-key-help" />
          <p id="vk-service-key-help">Администратор получает сервисный ключ в настройках приложения VK с доступом к API. Ключ сообщества и токен VK ID не подходят. Храним ключ зашифрованным; заказчикам и AI его не передаём.</p>
          <div className={styles.actions}><button className={styles.primary} disabled={!token.trim()} type="submit">{busy === "save" ? "Сохраняем…" : "Сохранить ключ VK"}</button></div>
        </fieldset>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); void act("check"); }}>
        <fieldset disabled={Boolean(busy) || !settings.configured || dirty}>
          <label htmlFor="vk-check-community">Открытое сообщество заказчика для проверки</label>
          <input id="vk-check-community" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://vk.com/community" maxLength={512} required />
          <div className={styles.actions}><button type="submit">{busy === "check" ? "Проверяем…" : "Проверить доступ VK"}</button></div>
        </fieldset>
      </form>
      <div className={styles.details}><p>Проверка читает описание и одну запись через VK API, без AI и сохранения материалов. Она подтверждает доступ к указанному сообществу, не ко всем сообществам.</p>{settings.verifiedAt && <p>Последняя успешная проверка: {new Date(settings.verifiedAt).toLocaleString("ru-RU")}</p>}</div>
      {settings.hasKey && <button type="button" className={styles.remove} disabled={Boolean(busy) || dirty} onClick={() => void act("remove")}>{busy === "remove" ? "Удаляем…" : "Удалить общий ключ VK"}</button>}
    </>}
  </article>;
}
