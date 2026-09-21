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

/** Explain saved decisions, without generating or reconstructing model reasoning. */
export function sourceSelectionEntries(pages: SourceSnapshot["pages"]) {
  const order = { found: 0, failed: 1, pending: 2, duplicate: 3, loaded: 4 };
  return pages
    .map((page, index) => ({
      page,
      index,
      byAi: /^AI\s*[—-]\s/.test(page.reason ?? ""),
      explanation:
        page.error ||
        (page.duplicateOf ? `Совпадает с ${page.duplicateOf}` : page.reason) ||
        "Причина отбора для этой страницы не сохранена.",
    }))
    .sort(
      (a, b) =>
        order[a.page.status] - order[b.page.status] || a.index - b.index,
    );
}

/** Reading layout only: the archived text and its order remain unchanged. */
export function sourceTextParagraphs(content: string) {
  return content
    .replace(/\r\n?/g, "\n")
    .split(/\n[\t \u00a0]*\n(?:[\t \u00a0]*\n)*/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function SourceTextPreview({ content }: { content: string }) {
  return (
    <div className={styles.sourceTextPreview}>
      <div
        className={styles.sourceReadableText}
        tabIndex={0}
        aria-label="Сохранённый исходный текст"
      >
        {sourceTextParagraphs(content).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}

function MapCardSummary({
  card,
}: {
  card: NonNullable<SourceSnapshot["map"]>;
}) {
  return (
    <section className={styles.sourceMapSummary} aria-label="Карточка организации">
      <div className={styles.sourceMapMain}>
        <div>
          <strong>{card.title}</strong>
          {card.address && <p>{card.address}</p>}
        </div>
        {card.rating !== null && (
          <span className={styles.sourceMapRating}>
            ★ {card.rating.toLocaleString("ru-RU")}
          </span>
        )}
      </div>
      <div className={styles.sourceMapFacts}>
        {card.ratingCount !== null && <span>{card.ratingCount} оценок</span>}
        {card.reviewCount !== null && <span>{card.reviewCount} отзывов</span>}
        <span>{card.reviews.length} отзывов собрано</span>
        <span>{card.products.length} товаров и услуг собрано</span>
      </div>
      {card.categories.length > 0 && (
        <div className={styles.sourceMapCategories}>
          {card.categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
      )}
      <div className={styles.sourceMapContacts}>
        {card.phone && <span>{card.phone}</span>}
        {card.website && (
          <a href={card.website} target="_blank" rel="noreferrer">
            {card.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
          </a>
        )}
        <a href={card.sourceUrl} target="_blank" rel="noreferrer">
          Оригинал в Яндекс Картах
        </a>
      </div>
    </section>
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
        const social = source.mode === "social-feed";
        const map = source.mode === "map-card";
        const selectedFilter = selectedFilters[source.sourceId] ?? "all";
        const visiblePages = filterSourcePages(source.pages, selectedFilter);
        const hintOpen = Boolean(openHints[source.sourceId]);
        const panelId = `${hintId}-${source.sourceId}`;
        const selectionEntries = sourceSelectionEntries(source.pages);
        return (
          <section className={styles.sourceCard} key={source.sourceId}>
            <header className={styles.sourceHeading}>
              <span className={styles.sourceHeadingText}>
                <span className={styles.sourceTitle}>{source.title}</span>
                <span className={styles.sourceDate}>
                  <span>
                    Снимок от{" "}
                    {new Date(source.checkedAt).toLocaleString("ru-RU")}
                  </span>
                  <button
                    type="button"
                    className={styles.sourceInfo}
                    aria-label={`Пояснение об охвате: ${source.title}`}
                    aria-expanded={hintOpen}
                    aria-controls={panelId}
                    title="Пояснение об охвате"
                    onClick={() => {
                      setOpenHints((current) => ({
                        ...current,
                        [source.sourceId]: !current[source.sourceId],
                      }));
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 11v6" />
                      <circle
                        cx="12"
                        cy="7.5"
                        r=".75"
                        fill="currentColor"
                        stroke="none"
                      />
                    </svg>
                  </button>
                </span>
              </span>
            </header>
            <div className={styles.sourceBody}>
              {source.map && <MapCardSummary card={source.map} />}
              <div className={styles.sourceToolbar}>
                <div
                  className={styles.sourceFilters}
                  role="group"
                  aria-label={`Фильтр ${social ? "материалов" : "страниц"}: ${source.title}`}
                >
                  {filters.map(([filter, label]) => {
                    const count = filterSourcePages(
                      source.pages,
                      filter,
                    ).length;
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
              </div>
              <div
                id={panelId}
                className={styles.sourceNote}
                hidden={!hintOpen}
              >
                <details className={styles.sourceText} open>
                  <summary>Как читать результаты</summary>
                  <div className={styles.sourceHelpContent}>
                    {social ? (
                      <p>
                        Здесь описание источника и полученные публикации.
                        «Включено» — собственный текст для обработки; «Не
                        включено» — репосты и записи без текста. Вложения не
                        прочитаны.
                      </p>
                    ) : map ? (
                      <p>
                        Здесь обзор публичной карточки Яндекс Карт и доступные
                        разделы. Включены только данные, которые отдала сама
                        HTML-страница; отсутствие раздела не подтверждает его
                        отсутствие у организации.
                      </p>
                    ) : (
                      <p>
                        Найдено адресов: {source.pages.length}. «Включено» —
                        страницы, полный доступный текст которых вошёл в
                        выбранный набор для обработки. «Не включено» — страницы
                        вне выбранного набора; «Недоступно» — страницы, текст
                        которых получить не удалось.
                      </p>
                    )}
                  </div>
                </details>
                <details className={styles.sourceText}>
                  <summary>
                    {social
                      ? "Период и ограничения"
                      : map
                        ? "Охват карточки"
                        : "Охват разделов"}
                  </summary>
                  <div className={styles.sourceHelpContent}>
                    {source.coverage ? (
                      <>
                        {source.coverage.reasons.map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                        <ul className={styles.sourceCoverageList}>
                          {source.coverage.sections.map((section) => (
                            <li key={section.title}>
                              <strong>{section.title}</strong>:{" "}
                              {section.found
                                ? `собрано ${section.read} из ${section.found}${section.unread ? `, не удалось собрать ${section.unread}` : ""}`
                                : "не найдено в обходе"}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : social || map ? null : (
                      <p>Для этого снимка охват разделов не сохранён.</p>
                    )}
                    {source.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                </details>
                <details className={styles.sourceText}>
                  <summary>
                      {social
                        ? "Правила отбора публикаций"
                        : map
                          ? "Как прочитана карточка"
                          : "Как агент отбирал страницы"}
                  </summary>
                  <div className={styles.sourceHelpContent}>
                    <p>
                      Сохранённые решения и их причины. Сначала материалы вне
                      итогового набора, затем включённые.
                    </p>
                    {!selectionEntries.some((entry) => entry.byAi) && (
                      <p>
                        В этом снимке нет сохранённых решений AI. Ниже — данные
                        {social
                          ? "сбора VK по правилам периода, авторства и наличия текста."
                          : map
                            ? "публичной HTML-карточки Яндекс Карт без API и входа."
                            : "сбора сайта."}
                      </p>
                    )}
                    {selectionEntries.length ? (
                      <ol
                        className={styles.sourceDecisionList}
                        tabIndex={0}
                        aria-label={`Причины отбора ${social ? "материалов" : "страниц"}: ${source.title}`}
                      >
                        {selectionEntries.map(
                          ({ page, index, byAi, explanation }) => (
                            <li key={`${page.url}-${index}`}>
                              <div className={styles.sourcePageHeading}>
                                <strong>{page.title}</strong>
                                <span
                                  className={styles.sourceStatus}
                                  data-status={page.status}
                                >
                                  {statusLabel[page.status]}
                                </span>
                              </div>
                              <span className={styles.sourceDecisionOrigin}>
                                {byAi
                                  ? "Решение AI"
                                  : social
                                    ? "Сбор VK"
                                    : map
                                      ? "Сбор Яндекс Карт"
                                      : "Сбор сайта"}
                              </span>
                              <p>{explanation}</p>
                              {/^https:\/\//i.test(page.url) && (
                                <div className={styles.sourceUrl}>
                                  <a
                                    href={page.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`${page.url} — открыть в новой вкладке`}
                                  >
                                    {page.url.replace(/^https:\/\//i, "")}
                                  </a>
                                </div>
                              )}
                            </li>
                          ),
                        )}
                      </ol>
                    ) : (
                      <p>
                        {social
                          ? "В снимке пока нет материалов."
                          : map
                            ? "В снимке пока нет разделов карточки."
                            : "В снимке пока нет страниц."}
                      </p>
                    )}
                  </div>
                </details>
              </div>
              <p className={styles.sourceFilterCount} role="status">
                {visiblePages.length
                  ? `Показано ${visiblePages.length} из ${source.pages.length}`
                    : social
                      ? "Нет материалов с таким статусом"
                      : map
                        ? "Нет разделов с таким статусом"
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
                          {page.url.replace(/^https:\/\//i, "")}
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
                    {social && page.transcriptStatus && (
                      <p className={styles.sourceReason}>
                        Расшифровка: {transcriptLabel(page.transcriptStatus)}
                        {page.transcriptError ? ` — ${page.transcriptError}` : ""}
                      </p>
                    )}
                    {page.status === "loaded" && page.content && (
                      <details className={styles.sourceText}>
                        <summary>
                          {social
                            ? "Сохранённый текст"
                            : map
                              ? "Сохранённый текст раздела"
                              : "Сохранённый текст страницы"}
                        </summary>
                        <SourceTextPreview content={page.content} />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function transcriptLabel(
  status: NonNullable<SourceSnapshot["pages"][number]["transcriptStatus"]>,
) {
  return status === "succeeded"
    ? "готова"
    : status === "processing"
      ? "обрабатывается"
      : status === "queued"
        ? "в очереди"
        : "ошибка";
}
