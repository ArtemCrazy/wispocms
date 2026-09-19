"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./platform-ai-settings.module.css";
import { PlatformPromptSettings } from "./platform-prompt-settings";

type Settings = {
  configured: boolean; hasKey: boolean; storageReady: boolean;
  model: string; models: string[]; revision: number;
  updatedAt: string | null; verifiedAt: string | null;
};
const endpoint = "/api/platform/settings/deepseek";

async function request(method = "GET", body?: unknown, suffix = ""): Promise<Settings> {
  const response = await fetch(endpoint + suffix, {
    method, credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(Array.isArray(payload?.message) ? payload.message.join(". ") : payload?.message ?? "Не удалось выполнить запрос");
  }
  return response.json();
}

export function PlatformAiSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const aiDirty = Boolean(apiKey || (settings && model !== settings.model));
  const [promptsDirty, setPromptsDirty] = useState(false);
  const dirty = aiDirty || promptsDirty;

  useEffect(() => {
    let active = true;
    request().then((value) => {
      if (active) { setSettings(value); setModel(value.model); }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить настройки");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    if (dirty) window.addEventListener("beforeunload", warn);
    return () => { onDirtyChange?.(false); window.removeEventListener("beforeunload", warn); };
  }, [dirty, onDirtyChange]);

  async function act(action: "save" | "check" | "remove") {
    if (!settings || busy) return;
    if (action === "remove" && !window.confirm("Удалить сохранённый ключ DeepSeek? Новые AI-запуски станут недоступны. Уже созданные результаты сохранятся.")) return;
    setBusy(action); setError(""); setMessage("");
    try {
      const value = action === "save"
        ? await request("PUT", { revision: settings.revision, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
        : action === "remove" ? await request("DELETE", { revision: settings.revision })
          : await request("POST", undefined, "/check");
      setSettings(value); setModel(value.model); setApiKey("");
      setMessage(action === "save" ? "Ключ и модель сохранены. Теперь проверьте подключение." : action === "remove" ? "Ключ удалён. Существующие результаты сохранены." : "Ключ принят, модель доступна. Материалы не отправлялись. Можно перейти к тестовому запуску.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить запрос");
    } finally { setBusy(""); }
  }

  function save(event: FormEvent) { event.preventDefault(); void act("save"); }
  return <section className={styles.root} aria-label="Настройки платформы">
    <header><h1>Настройки платформы</h1><p>Подключения и общая библиотека промптов для всех рабочих пространств. Доступно только администратору.</p></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {!settings ? <p>{error ? "Обновите страницу, чтобы повторить загрузку." : "Загружаем настройки…"}</p> : <article className={styles.card}>
      <div className={styles.heading}><div><h2>DeepSeek</h2><p>Подготовка информации и создание контента</p></div><span className={styles.status}>{settings.verifiedAt ? "Доступ проверен" : settings.hasKey ? "Ключ сохранён · не проверен" : "Не подключён"}</span></div>
      {!settings.storageReady && <p className={styles.error} role="alert">Серверное хранилище ключей не настроено. Сохранение и запуск AI недоступны.</p>}
      <form onSubmit={save}>
        <fieldset disabled={Boolean(busy) || !settings.storageReady}>
          <label htmlFor="deepseek-api-key">{settings.hasKey ? "Заменить API-ключ" : "API-ключ DeepSeek"}</label>
          <input id="deepseek-api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.hasKey ? "Ключ сохранён. Для замены вставьте новый" : "Вставьте ваш ключ DeepSeek"} maxLength={256} required={!settings.hasKey} aria-describedby="deepseek-key-help" />
          <p id="deepseek-key-help">Ключ хранится зашифрованным на сервере. Сохранённое значение не отображается и не возвращается в браузер. Пустое поле при смене модели сохраняет прежний ключ.</p>
          <label htmlFor="deepseek-model">Модель</label>
          <select id="deepseek-model" value={model} onChange={(event) => setModel(event.target.value)}>{settings.models.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={!aiDirty || (!settings.hasKey && !apiKey.trim())} type="submit">{busy === "save" ? "Сохраняем…" : "Сохранить"}</button>
            <button type="button" disabled={!settings.configured || aiDirty} onClick={() => void act("check")}>{busy === "check" ? "Проверяем…" : "Проверить подключение"}</button>
          </div>
        </fieldset>
      </form>
      <div className={styles.details}>
        <p>Проверка подтверждает доступ к API и выбранной модели, но не запускает генерацию и не отправляет данные проектов.</p>
        <p>При запуске обработки текстовые материалы, задача и нужный контекст выбранного workspace передаются DeepSeek. Генерация оплачивается с вашего аккаунта DeepSeek. Сохранение ключа ничего не запускает автоматически.</p>
        <p>Сейчас поддерживаются текстовые материалы. PDF, Office, изображения и вложения в генерацию пока не поддерживаются. Ссылки сами по себе не загружаются; автоматический поиск источников не подключён.</p>
        {settings.verifiedAt && <p>Последняя успешная проверка: {new Date(settings.verifiedAt).toLocaleString("ru-RU")}</p>}
      </div>
      {settings.hasKey && <button type="button" className={styles.remove} disabled={Boolean(busy) || aiDirty} onClick={() => void act("remove")}>{busy === "remove" ? "Удаляем…" : "Удалить ключ"}</button>}
    </article>}
    <PlatformPromptSettings onDirtyChange={setPromptsDirty} />
  </section>;
}
