"use client";

import { useEffect, useRef, useState } from "react";
import {
  collectDictation,
  speechErrorMessage,
  type DictationResult,
} from "./preparation-state";
import styles from "./content-center-view.module.css";

type SpeechEvent = { results: ArrayLike<DictationResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function SpeechInput({
  disabled,
  onTranscript,
  onActiveChange,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const recognition = useRef<Recognition | null>(null);
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");

  useEffect(
    () => () => {
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
      }
      onActiveChange(false);
    },
    [onActiveChange],
  );

  function start() {
    if (recognition.current || disabled) return;
    setError("");
    const browser = window as SpeechWindow;
    const Constructor =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "В этом браузере голосовой ввод недоступен. Введите задачу текстом или используйте системную диктовку в поле инструкции.",
      );
      return;
    }
    // Explicit consent before the browser may send audio to its speech service.
    if (
      !window.confirm(
        "Начать голосовой ввод? Браузер запросит доступ к микрофону и может передавать речь своему сервису распознавания. CMS не сохраняет аудио. Распознанный текст появится в инструкции; проверьте его перед сохранением.",
      )
    )
      return;
    let instance: Recognition;
    try {
      instance = new Constructor();
      instance.lang = "ru-RU";
      instance.continuous = true;
      instance.interimResults = true;
      const committed = new Set<number>();
      instance.onresult = (event) => {
        if (recognition.current !== instance) return;
        const text = collectDictation(event.results, committed);
        if (text.final) onTranscript(text.final);
        setInterim(text.interim);
      };
      instance.onerror = (event) => {
        if (recognition.current !== instance) return;
        if (event.error !== "aborted")
          setError(speechErrorMessage(event.error));
        recognition.current = null;
        instance.onresult = null;
        instance.onerror = null;
        instance.onend = null;
        setActive(false);
        setStopping(false);
        setInterim("");
        onActiveChange(false);
        instance.abort();
      };
      instance.onend = () => {
        if (recognition.current !== instance) return;
        recognition.current = null;
        setActive(false);
        setStopping(false);
        setInterim("");
        onActiveChange(false);
      };
      recognition.current = instance;
      setInterim("");
      setActive(true);
      setStopping(false);
      onActiveChange(true);
      instance.start();
    } catch {
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
      }
      setActive(false);
      setStopping(false);
      onActiveChange(false);
      setError(speechErrorMessage("start-failed"));
    }
  }

  return (
    <div className={styles.voice}>
      <div className={styles.actions}>
        <button
          type="button"
          aria-pressed={active}
          disabled={stopping || (!active && disabled)}
          onClick={() => {
            if (!active) start();
            else {
              setStopping(true);
              recognition.current?.stop();
            }
          }}
        >
          {stopping
            ? "Завершаем диктовку…"
            : active
              ? "Остановить диктовку"
              : "Голосовой ввод"}
        </button>
        <span className={styles.muted} role="status">
          {active
            ? "Микрофон включён. Говорите по-русски."
            : "Добавляет текст в конец инструкции."}
        </span>
      </div>
      {interim && (
        <p className={styles.dictationPreview} aria-label="Распознаваемая речь">
          {interim}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <p className={styles.muted}>
        Распознавание выполняет браузер; оно может использовать внешний сервис.
        Аудио не сохраняется в CMS. Текст сохраняется только кнопкой «Сохранить
        задачу».
      </p>
    </div>
  );
}
