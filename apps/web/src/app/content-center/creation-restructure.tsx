"use client";
import { useState } from "react";
import type { Cluster } from "./creation-state";
import { CreationDialog } from "./creation-shared";
import styles from "./content-center-view.module.css";

export function RestructureClusters({
  kind,
  clusters,
  busy,
  error,
  close,
  submit,
}: {
  kind: "split" | "merge";
  clusters: Cluster[];
  busy: boolean;
  error: string;
  close: () => void;
  submit: (payload: unknown) => Promise<void>;
}) {
  const [second, setSecond] = useState<string[]>([]);
  const [direction, setDirection] = useState(clusters[0]?.direction ?? "");
  const all = clusters.flatMap((c) => c.queries);
  const valid =
    kind === "merge"
      ? clusters.length >= 2
      : second.length > 0 && second.length < all.length;
  return (
    <CreationDialog
      title={kind === "split" ? "Разделить кластер" : "Объединить кластеры"}
      close={close}
      busy={busy}
    >
      <p>
        Исходные кластеры останутся в архиве со своими статьями. Будут созданы
        новые кластеры со связями в истории. Запросы и частотности сохранятся.
      </p>
      <p>{clusters.map((c) => `№ ${c.number} ${c.title}`).join(" · ")}</p>
      <label className={styles.field}>
        Направление новых кластеров
        <input
          maxLength={160}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        />
      </label>
      {kind === "split" ? (
        <>
          <p>
            Отметьте запросы для второго кластера. Неотмеченные останутся в
            первом. В каждом будет основным первый запрос.
          </p>
          {all.map((q) => (
            <label className={styles.creationCheckbox} key={q.text}>
              <input
                type="checkbox"
                checked={second.includes(q.text)}
                onChange={(e) =>
                  setSecond(
                    e.target.checked
                      ? [...second, q.text]
                      : second.filter((t) => t !== q.text),
                  )
                }
              />
              {q.text}
            </label>
          ))}
        </>
      ) : (
        <p>
          Все запросы попадут в один кластер. Основным станет первый запрос.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={busy || !valid}
          onClick={() => {
            const groups =
              kind === "merge"
                ? [all]
                : [
                    all.filter((q) => !second.includes(q.text)),
                    all.filter((q) => second.includes(q.text)),
                  ];
            void submit({
              kind,
              ids: clusters.map((c) => c.id),
              revisions: clusters.map((c) => c.revision),
              clusters: groups.map((queries) => ({
                revision: 0,
                direction,
                archived: false,
                queries: queries.map((q, i) => ({ ...q, primary: i === 0 })),
              })),
            });
          }}
        >
          {kind === "split"
            ? "Подтвердить разделение"
            : "Подтвердить объединение"}
        </button>
        <button disabled={busy} onClick={close}>
          Отмена
        </button>
      </div>
    </CreationDialog>
  );
}
