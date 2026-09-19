import type { SourceSnapshot } from "./materials";
import styles from "./content-center-view.module.css";

const status = {
  loaded: "Прочитана",
  found: "Не включена",
  failed: "Недоступна",
  duplicate: "Дубликат",
};

/** Archived plain text, never rendered as source-provided HTML. */
export function SourceRegistry({ sources }: { sources: SourceSnapshot[] }) {
  if (!sources.length) return null;
  return (
    <div className={styles.sourceRegistry}>
      {sources.map((source) => (
        <details key={source.sourceId}>
          <summary>
            {source.title} · прочитано{" "}
            {source.pages.filter((p) => p.status === "loaded").length} из{" "}
            {source.pages.length} обнаруженных
          </summary>
          <p className={styles.muted}>
            Снимок источника:{" "}
            {new Date(source.checkedAt).toLocaleString("ru-RU")}. Это охват
            конкретного запуска, не полный аудит сайта.
          </p>
          {source.warnings.map((warning) => (
            <p className={styles.muted} key={warning}>
              {warning}
            </p>
          ))}
          <ul>
            {source.pages.map((page, index) => (
              <li key={`${page.url}-${index}`}>
                <strong>
                  [{source.sourceId}.{index + 1}] {page.title}
                </strong>{" "}
                — {status[page.status]}
                {/^https:\/\//i.test(page.url) && (
                  <div>
                    <a href={page.url} target="_blank" rel="noreferrer">
                      {page.url}
                    </a>
                  </div>
                )}
                <p className={styles.muted}>
                  {page.error ??
                    (page.duplicateOf
                      ? `Совпадает с ${page.duplicateOf}`
                      : page.reason)}
                </p>
                {page.status === "loaded" && page.content && (
                  <details>
                    <summary>Сохранённый текст</summary>
                    <pre>{page.content}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
