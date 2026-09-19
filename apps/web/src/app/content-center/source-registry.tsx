import type { SourceSnapshot } from "./materials";
import styles from "./content-center-view.module.css";

const statusLabel = {
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
        <details
          className={styles.sourceCard}
          key={source.sourceId}
          open={sources.length === 1}
        >
          <summary className={styles.sourceHeading}>
            <span className={styles.sourceHeadingText}>
              <span className={styles.sourceTitle}>{source.title}</span>
              <span className={styles.sourceDate}>
                Снимок от {new Date(source.checkedAt).toLocaleString("ru-RU")}
              </span>
            </span>
            <span className={styles.sourceCoverage}>
              Прочитано{" "}
              {source.pages.filter((p) => p.status === "loaded").length} из{" "}
              {source.pages.length}
            </span>
            <span className={styles.sourceChevron} aria-hidden="true" />
          </summary>
          <div className={styles.sourceBody}>
            <dl className={styles.sourceStats} aria-label="Охват источника">
              <div>
                <dt>Обнаружено страниц</dt>
                <dd>{source.pages.length}</dd>
              </div>
              {(
                [
                  ["loaded", "Прочитано"],
                  ["found", "Не включено"],
                  ["failed", "Недоступно"],
                  ["duplicate", "Дубликаты"],
                ] as const
              ).map(([state, label]) => {
                const count = source.pages.filter(
                  (page) => page.status === state,
                ).length;
                return count > 0 || state === "loaded" ? (
                  <div key={state} data-status={state}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ) : null;
              })}
            </dl>
            <div className={styles.sourceNote}>
              <p>Охват этого запуска, не полный аудит сайта.</p>
              {source.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
            <h3 className={styles.sourceListHeading}>Страницы источника</h3>
            <ul className={styles.sourcePages}>
              {source.pages.map((page, index) => (
                <li className={styles.sourcePage} key={`${page.url}-${index}`}>
                  <div className={styles.sourcePageHeading}>
                    <span className={styles.sourceReference}>
                      [{source.sourceId}.{index + 1}]
                    </span>
                    <h4>{page.title}</h4>
                    <span
                      className={styles.sourceStatus}
                      data-status={page.status}
                    >
                      {statusLabel[page.status]}
                    </span>
                  </div>
                  {/^https:\/\//i.test(page.url) && (
                    <div className={styles.sourceUrl}>
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${page.url} — открыть в новой вкладке`}
                      >
                        {page.url}
                      </a>
                    </div>
                  )}
                  <p className={styles.sourceReason} data-status={page.status}>
                    {page.error ??
                      (page.duplicateOf
                        ? `Совпадает с ${page.duplicateOf}`
                        : page.reason)}
                  </p>
                  {page.status === "loaded" && page.content && (
                    <details className={styles.sourceText}>
                      <summary>Сохранённый текст страницы</summary>
                      <pre>{page.content}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
    </div>
  );
}
