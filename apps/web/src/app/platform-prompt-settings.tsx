"use client";

import { useEffect, useState, type FormEvent } from "react";
import { promptRequest, type PlatformPrompt } from "./platform-prompts";
import styles from "./platform-ai-settings.module.css";

type Draft = { id?: string; revision?: number; title: string; content: string };
export function PlatformPromptSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [prompts, setPrompts] = useState<PlatformPrompt[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = Boolean(draft && (draft.title !== original?.title || draft.content !== original?.content));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    let active = true;
    promptRequest<PlatformPrompt[]>().then((rows) => { if (active) setPrompts(rows); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить промпты"); });
    return () => { active = false; };
  }, []);
  const canLeave = () => !dirty || window.confirm("Не сохранять изменения промпта?");
  function select(value: Draft | null) {
    if (!canLeave()) return;
    setDraft(value); setOriginal(value); setError(""); setMessage("");
  }
  async function reload() {
    if (!canLeave()) return;
    setBusy(true); setError("");
    try { setPrompts(await promptRequest<PlatformPrompt[]>()); setDraft(null); setOriginal(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить промпты"); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await promptRequest<PlatformPrompt>(draft.id ? "PUT" : "POST", {
        title: draft.title, content: draft.content, ...(draft.id ? { revision: draft.revision } : {}),
      }, draft.id);
      setPrompts((rows) => draft.id ? (rows ?? []).map((p) => p.id === saved.id ? saved : p) : [saved, ...(rows ?? [])]);
      setDraft(saved); setOriginal(saved); setMessage("Промпт сохранён в общей библиотеке всех проектов.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить промпт"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft?.id || busy || !window.confirm("Удалить промпт из общей библиотеки всех проектов? Скопированные инструкции и результаты сохранятся.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await promptRequest("DELETE", { revision: draft.revision }, draft.id);
      setPrompts((rows) => (rows ?? []).filter((p) => p.id !== draft.id));
      setDraft(null); setOriginal(null); setMessage("Промпт удалён из общей библиотеки.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить промпт"); }
    finally { setBusy(false); }
  }
  return <article className={styles.card} aria-label="Общая библиотека промптов">
    <div className={styles.heading}><div><h2>Промпты</h2><p>Единая библиотека платформы. Доступна во всех проектах — в подготовке информации и создании контента.</p></div><button type="button" disabled={busy} onClick={() => void reload()}>Обновить список</button></div>
    <p>Здесь хранятся общие шаблоны задач, без материалов и конфиденциальных данных клиентов. Изменения видны всем проектам при следующем открытии списка. Уже скопированные инструкции и результаты не меняются.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    {!prompts ? <p>{error ? "Повторите загрузку кнопкой «Обновить список»." : "Загружаем промпты…"}</p> : <div className={styles.promptLayout}>
      <div className={styles.promptList}>
        <button type="button" disabled={busy || prompts.length >= 100} onClick={() => select({ title: "", content: "" })}>+ Добавить промпт</button>
        {prompts.map((p) => <button type="button" key={p.id} disabled={busy} className={draft?.id === p.id ? styles.selectedPrompt : undefined} aria-pressed={draft?.id === p.id} onClick={() => select(p)}>{p.title}</button>)}
        {!prompts.length && <p>Промптов пока нет.</p>}
      </div>
      {draft ? <form onSubmit={(event) => void save(event)}><fieldset disabled={busy}>
        <h3>{draft.id ? "Редактирование промпта" : "Новый промпт"}</h3>
        <label htmlFor="platform-prompt-title">Название промпта</label><input id="platform-prompt-title" value={draft.title} maxLength={160} required onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        <label htmlFor="platform-prompt-content">Текст промпта</label><textarea id="platform-prompt-content" value={draft.content} maxLength={12000} rows={18} required onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={!dirty || !draft.title.trim() || !draft.content.trim()}>{busy ? "Сохраняем…" : "Сохранить промпт"}</button>
          <button type="button" onClick={() => select(null)}>Закрыть</button>
          {draft.id && <button type="button" className={styles.remove} onClick={() => void remove()}>Удалить промпт</button>}
        </div>
      </fieldset></form> : <p>Выберите промпт для редактирования или добавьте новый.</p>}
    </div>}
  </article>;
}
