"use client";

import { useId, useState } from "react";
import type { SourceSnapshot } from "./materials";
import styles from "./content-center-view.module.css";

const statusLabel = {
  loaded: "Включена в сбор",
  found: "Не включена",
  failed: "Недоступна",
  duplicate: "Дубликат",
  pending: "Не проверена",
};

type SourceFilter =
  "all" | "unread" | SourceSnapshot["pages"][number]["status"];

const filters = [
  ["all", "Все"],
  ["loaded", "Включено"],
  ["found", "Не включено"],
  ["failed", "Недоступно"],
  ["pending", "Не проверено"],
  ["duplicate", "Дубликаты"],
] as const;

export function filterSourcePages(
  pages: SourceSnapshot["pages"],
  filter: SourceFilter,
) {
  return pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) =>
      filter === "all"
        ? true
        : filter === "unread"
          ? page.status !== "loaded"
          : page.status === filter,
    );
}

/** Archived plain text, never rendered as source-provided HTML. */
export function SourceRegistry({ sources }: { sources: SourceSnapshot[] }) {
  const hintId = useId();
  const [openHints, setOpenHints] = useState<Record<string, boolean>>({});
  const [selectedFilters, setSelectedFilters] = useState<
    Record<string, SourceFilter>
  >({});
  if (!sources.length) return null;
  return (
    <div className={styles.sourceRegistry}>
      {sources.map((source) => {
        const selectedFilter = selectedFilters[source.sourceId] ?? "all";
        const visiblePages = filterSourcePages(source.pages, selectedFilter);
        const hintOpen = Boolean(openHints[source.sourceId]);
        const panelId = `${hintId}-${source.sourceId}`;
        return (
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
                Включено{" "}
                {source.pages.filter((p) => p.status === "loaded").length} из{" "}
                {source.pages.length}
              </span>
              <button
                type="button"
                className={styles.sourceInfo}
                aria-label={`Пояснение об охвате: ${source.title}`}
                aria-expanded={hintOpen}
                aria-controls={panelId}
                title="Что означают эти числа"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const card = event.currentTarget.closest("details");
                  if (card) card.open = true;
                  setOpenHints((current) => ({
                    ...current,
                    [source.sourceId]: !current[source.sourceId],
                  }));
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v6" />
                  <circle cx="12" cy="7.5" r=".75" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <span className={styles.sourceChevron} aria-hidden="true" />
            </summary>
            <div className={styles.sourceBody}>
              <div id={panelId} className={styles.sourceNote} hidden={!hintOpen}>
                <p>
                  Найдено адресов: {source.pages.length}. «Включено» — страницы,
                  полный доступный текст которых вошёл в выбранный набор для
                  обработки. «Не включено» — страницы вне выбранного набора;
                  «Недоступно» — страницы, текст которых получить не удалось.
                </p>
                <p>
                  Это результат конкретного обхода, а не подтверждение, что
                  найдены все страницы сайта. Даже если включены все найденные
                  страницы, другие адреса могли остаться необнаруженными.
                  Обновление сбора само по себе не запускает AI-анализ.
                </p>
                {source.coverage && (
                  <>
                    {source.coverage.reasons.map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                    <details className={styles.sourceText}>
                      <summary>Охват разделов</summary>
                      <ul>
                        {source.coverage.sections.map((section) => (
                          <li key={section.title}>
                            <strong>{section.title}</strong>:{" "}
                            {section.found
                              ? `собрано ${section.read} из ${section.found}${section.unread ? `, не удалось собрать ${section.unread}` : ""}`
                              : "не найдено в обходе"}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
                {source.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <h3 className={styles.sourceListHeading}>Страницы источника</h3>
              <div
                className={styles.sourceFilters}
                role="group"
                aria-label={`Фильтр страниц: ${source.title}`}
              >
                {filters.map(([filter, label]) => {
                  const count = filterSourcePages(source.pages, filter).length;
                  if (
                    (filter === "duplicate" || filter === "pending") &&
                    count === 0
                  )
                    return null;
                  return (
                    <button
                      key={filter}
                      type="button"
                      aria-pressed={selectedFilter === filter}
                      onClick={() =>
                        setSelectedFilters((current) => ({
                          ...current,
                          [source.sourceId]: filter,
                        }))
                      }
                    >
                      {label} <span>{count}</span>
                    </button>
                  );
                })}
              </div>
              <p className={styles.sourceFilterCount} role="status">
                {visiblePages.length
                  ? `Показано ${visiblePages.length} из ${source.pages.length}`
                  : "Нет страниц с таким статусом"}
              </p>
              <ul className={styles.sourcePages}>
                {visiblePages.map(({ page, index }) => (
                  <li
                    className={styles.sourcePage}
                    key={`${page.url}-${index}`}
                  >
                    <div className={styles.sourcePageHeading}>
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
                    <p
                      className={styles.sourceReason}
                      data-status={page.status}
                    >
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
        );
      })}
    </div>
  );
}
