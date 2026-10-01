"use client";

import { CreationInstruction } from "./creation-shared";
import styles from "./content-center-view.module.css";

export function launchBlockReason({
  busy,
  running,
  voice,
  connected,
  clusterCount,
  platformCount,
}: {
  busy: boolean;
  running: boolean;
  voice: boolean;
  connected: boolean;
  clusterCount: number;
  platformCount: number;
}) {
  if (busy) return "Подождите завершения текущего действия.";
  if (running) return "Дождитесь завершения текущего запуска.";
  if (voice) return "Завершите диктовку перед запуском.";
  if (!connected)
    return "Для создания контента подключите AI в настройках платформы.";
  if (!clusterCount) return "Добавьте актуальный кластер в таблицу ниже.";
  if (!platformCount)
    return "Выберите площадки в разделе «Площадки и правила».";
  return "";
}

export function CreationLauncher({
  base,
  instruction,
  setInstruction,
  file,
  setFile,
  busy,
  running,
  voice,
  connected,
  clusterCount,
  platformCount,
  hasSelection,
  onVoice,
  onLaunch,
}: {
  base: string;
  instruction: string;
  setInstruction: (value: string) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  busy: boolean;
  running: boolean;
  voice: boolean;
  connected: boolean;
  clusterCount: number;
  platformCount: number;
  hasSelection: boolean;
  onVoice: (active: boolean) => void;
  onLaunch: () => void;
}) {
  const reason = launchBlockReason({
    busy,
    running,
    voice,
    connected,
    clusterCount,
    platformCount,
  });
  return (
    <section
      className={`${styles.card} ${styles.creationLauncher}`}
      aria-label="Подготовка контента"
    >
      <CreationInstruction
        base={base}
        value={instruction}
        setValue={setInstruction}
        file={file}
        setFile={setFile}
        disabled={busy || running}
        onVoice={onVoice}
        launcher
        action={
          <button
            type="button"
            className={styles.primary}
            disabled={Boolean(reason)}
            aria-describedby={reason ? "creation-launch-blocked" : undefined}
            onClick={onLaunch}
          >
            {running ? "Создание выполняется…" : "Создать контент"}
            <span aria-hidden="true"> →</span>
          </button>
        }
      />
      <div className={styles.launcherSummary}>
        <span>
          {hasSelection
            ? "Выбрано актуальных кластеров"
            : "Все актуальные кластеры"}
          : <strong>{clusterCount}</strong>
        </span>
        {!hasSelection && <span>Фильтры таблицы не ограничивают запуск.</span>}
      </div>
      {reason && (
        <p
          id="creation-launch-blocked"
          className={styles.launcherHint}
          role="status"
        >
          {reason}
        </p>
      )}
    </section>
  );
}
