"use client";

import { useEffect, useRef, useState } from "react";
import { promptRequest, type PlatformPrompt } from "../platform-prompts";
import styles from "./content-center-view.module.css";

export function GlobalPromptPicker({ close, onSelect }: {
  close: () => void;
  onSelect: (content: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [prompts, setPrompts] = useState<PlatformPrompt[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    promptRequest<PlatformPrompt[]>().then((rows) => {
      if (active) { setPrompts(rows); setSelectedId(rows[0]?.id ?? ""); }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить промпты");
    });
    return () => { active = false; };
  }, [attempt]);
  const selected = prompts?.find((p) => p.id === selectedId);
  return <dialog ref={dialog} className={styles.dialog} aria-label="Список промптов" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className={styles.cardHead}><h2>Список промптов</h2><button type="button" aria-label="Закрыть окно" onClick={close}>×</button></div>
    <p className={styles.muted}>Общая библиотека для всех проектов. Администратор редактирует её в настройках платформы.</p>
    {error ? <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Повторить</button></div> : !prompts ? <p role="status">Загружаем промпты…</p> : !prompts.length ? <p>В общей библиотеке пока нет промптов.</p> : <div className={styles.promptGrid}>
      <div className={styles.promptList}>{prompts.map((p) => <button type="button" key={p.id} aria-pressed={p.id === selectedId} className={p.id === selectedId ? styles.selected : undefined} onClick={() => setSelectedId(p.id)}>{p.title}</button>)}</div>
      {selected && <div>
        <h3>{selected.title}</h3>
        <div className={styles.promptText}>{selected.content}</div>
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => onSelect(selected.content)}>Использовать в задаче</button></div>
        <p className={styles.muted}>Текст скопируется в вашу инструкцию. Его можно изменить для этой задачи — общий промпт и другие проекты не изменятся.</p>
      </div>}
    </div>}
  </dialog>;
}
