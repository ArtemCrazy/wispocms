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
  onstart: (() => void) | null;
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
  const consentDialog = useRef<HTMLDialogElement | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [interim, setInterim] = useState("");

  useEffect(() => {
    const dialog = consentDialog.current;
    if (consentOpen) dialog?.showModal();
    else dialog?.close();
    return () => dialog?.close();
  }, [consentOpen]);

  useEffect(
    () => () => {
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onstart = null;
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
    setConsentOpen(false);
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
    let instance: Recognition;
    try {
      instance = new Constructor();
      instance.lang = "ru-RU";
      instance.continuous = true;
      instance.interimResults = true;
      const committed = new Set<number>();
      instance.onstart = () => {
        if (recognition.current === instance) setListening(true);
      };
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
        instance.onstart = null;
        instance.onresult = null;
        instance.onerror = null;
        instance.onend = null;
        setActive(false);
        setListening(false);
        setStopping(false);
        setInterim("");
        onActiveChange(false);
        instance.abort();
      };
      instance.onend = () => {
        if (recognition.current !== instance) return;
        recognition.current = null;
        setActive(false);
        setListening(false);
        setStopping(false);
        setInterim("");
        onActiveChange(false);
      };
      recognition.current = instance;
      setInterim("");
      setActive(true);
      setListening(false);
      setStopping(false);
      onActiveChange(true);
      instance.start();
    } catch {
      const current = recognition.current;
      recognition.current = null;
      if (current) {
        current.onstart = null;
        current.onresult = null;
        current.onerror = null;
        current.onend = null;
        current.abort();
      }
      setActive(false);
      setListening(false);
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
            if (!active) {
              setError("");
              setConsentOpen(true);
            } else {
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
            ? listening
              ? "Микрофон включён. Говорите по-русски."
              : "Ожидаем готовности микрофона и распознавания…"
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
      <dialog
        ref={consentDialog}
        className={styles.dialog}
        aria-label="Голосовой ввод инструкции"
        onCancel={(event) => {
          event.preventDefault();
          setConsentOpen(false);
        }}
      >
        <div className={styles.cardHead}>
          <h2>Голосовой ввод инструкции</h2>
          <button
            type="button"
            aria-label="Закрыть окно голосового ввода"
            onClick={() => setConsentOpen(false)}
          >
            ×
          </button>
        </div>
        <p>
          Микрофон пока выключен. После нажатия «Включить микрофон» браузер
          запросит разрешение и начнёт распознавание русской речи.
        </p>
        <p>
          Браузер может передавать речь своему сервису распознавания. CMS не
          сохраняет аудио. Текст добавится в конец инструкции — проверьте его
          перед сохранением.
        </p>
        <p className={styles.muted}>
          Если браузер не поддерживает распознавание, можно ввести текст вручную
          или воспользоваться системной диктовкой.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={disabled}
            onClick={start}
          >
            Включить микрофон
          </button>
          <button type="button" autoFocus onClick={() => setConsentOpen(false)}>
            Отмена
          </button>
        </div>
      </dialog>
    </div>
  );
}
