"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SpeechInput } from "./speech-input";
import { appendDictation } from "./preparation-state";
import styles from "./content-center-view.module.css";
export const creationDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export async function creationRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : body instanceof FormData
        ? { body }
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(". ")
        : (payload?.message ?? "Не удалось выполнить действие"),
    );
  return payload as T;
}
export function CreationDialog({
  title,
  close,
  busy,
  children,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <button aria-label="Закрыть окно" disabled={busy} onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CreationInstruction({
  base,
  value,
  setValue,
  file,
  setFile,
  disabled,
  onVoice,
  children,
}: {
  base: string;
  value: string;
  setValue: (s: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  disabled: boolean;
  onVoice: (a: boolean) => void;
  children?: ReactNode;
}) {
  const [prompts, setPrompts] = useState<Array<{
    id: string;
    title: string;
    content: string;
  }> | null>(null);
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const fileRef = useRef<HTMLInputElement>(null);
  const open = async () => {
    try {
      setError("");
      const data = await creationRequest<{
        prompts: Array<{ id: string; title: string; content: string }>;
      }>(base);
      setPrompts(data.prompts);
      setSelected(data.prompts[0]?.id ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className={styles.cardHead}>
        <h3>Дополнительная инструкция</h3>
        <button disabled={disabled} onClick={() => void open()}>
          Список промптов
        </button>
      </div>
      <label className={styles.field}>
        Задача для текущего запуска
        <textarea
          rows={4}
          maxLength={12000}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Необязательно: на что обратить внимание при создании контента"
        />
      </label>
      {children}
      <div className={styles.actions}>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.md,.csv"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen && chosen.size > 10 * 1024 * 1024) {
              setError("Файл должен быть не больше 10 МБ");
              return;
            }
            setError("");
            setFile(chosen ?? null);
          }}
        />
        <button disabled={disabled} onClick={() => fileRef.current?.click()}>
          Прикрепить файл
        </button>
        {file && (
          <>
            <span>{file.name}</span>
            <button disabled={disabled} onClick={() => setFile(null)}>
              Убрать файл
            </button>
          </>
        )}
      </div>
      <p className={styles.muted}>
        Инструкция и файл относятся только к этому запуску, не становятся
        материалами проекта. Файл — до 10 МБ.
      </p>
      <SpeechInput
        disabled={disabled}
        onTranscript={(text) =>
          setValue(appendDictation(valueRef.current, text).value)
        }
        onActiveChange={onVoice}
        persistenceHint="Текст будет передан вместе с инструкцией только при запуске обработки."
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {prompts && (
        <CreationDialog
          title="Список промптов"
          close={() => {
            setPrompts(null);
            setAdding(false);
          }}
          busy={saving}
        >
          {adding ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                try {
                  const p = await creationRequest<{
                    id: string;
                    title: string;
                    content: string;
                  }>(`${base}/prompts`, "POST", { title, content: text });
                  setPrompts([...prompts, p]);
                  setSelected(p.id);
                  setAdding(false);
                  setTitle("");
                  setText("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <label className={styles.field}>
                Название промпта
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                Текст промпта
                <textarea
                  required
                  rows={6}
                  maxLength={8000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div className={styles.actions}>
                <button className={styles.primary} disabled={saving}>
                  Сохранить промпт
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setAdding(false)}
                >
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className={styles.promptGrid}>
                <div className={styles.promptList}>
                  {prompts.length ? (
                    prompts.map((p) => (
                      <button
                        key={p.id}
                        className={
                          selected === p.id ? styles.selected : undefined
                        }
                        onClick={() => setSelected(p.id)}
                      >
                        {p.title}
                      </button>
                    ))
                  ) : (
                    <p>Промптов пока нет.</p>
                  )}
                </div>
                <div className={styles.promptText}>
                  {prompts.find((p) => p.id === selected)?.content ??
                    "Выберите промпт"}
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={!selected}
                  onClick={() => {
                    setValue(prompts.find((p) => p.id === selected)!.content);
                    setPrompts(null);
                  }}
                >
                  Скопировать в инструкцию
                </button>
                <button onClick={() => setAdding(true)}>Добавить промпт</button>
              </div>
            </>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </CreationDialog>
      )}
    </>
  );
}
