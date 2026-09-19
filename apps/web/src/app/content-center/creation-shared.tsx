"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SpeechInput } from "./speech-input";
import { appendDictation } from "./preparation-state";
import styles from "./content-center-view.module.css";
import { GlobalPromptPicker } from "./global-prompt-picker";
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
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [error, setError] = useState("");
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className={styles.cardHead}>
        <h3>Дополнительная инструкция</h3>
        <button disabled={disabled} onClick={() => setPromptsOpen(true)}>
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
      {promptsOpen && (
        <GlobalPromptPicker
          close={() => setPromptsOpen(false)}
          onSelect={(content) => {
            if (value.trim() && !window.confirm("Заменить текущую инструкцию текстом промпта?")) return;
            setValue(content);
            setPromptsOpen(false);
          }}
        />
      )}
    </>
  );
}
