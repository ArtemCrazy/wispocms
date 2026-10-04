"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ARTICLE_STATUS,
  AI_RECOMMENDATION,
  type Cluster,
  type Overview,
} from "./creation-state";
import {
  clusterPage,
  selectPageClusters,
  tablePlatforms,
} from "./creation-table-state";
import styles from "./content-center-view.module.css";

type Filters = {
  search: string;
  direction: string;
  status: string;
  recommendation: string;
};
export function CreationTable({
  data,
  filtered,
  selected,
  setSelected,
  filters,
  setFilter,
  onAdd,
  onCluster,
  onArticle,
  onMerge,
  onPrepare,
  prepareDisabled = false,
}: {
  data: Overview;
  filtered: Cluster[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  filters: Filters;
  setFilter: (key: keyof Filters, value: string) => void;
  onAdd: () => void;
  onCluster: (id: string) => void;
  onArticle: (id: string) => void;
  onMerge: () => void;
  onPrepare?: () => void;
  prepareDisabled?: boolean;
}) {
  const [size, setSize] = useState(10);
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [collapsed, setCollapsed] = useState({
    active: false,
    archived: false,
  });
  const filterKey = JSON.stringify([filters, size]);
  const page = clusterPage(
    filtered,
    pagination.key === filterKey ? pagination.page : 1,
    size,
  );
  const platforms = tablePlatforms(data);
  const headerRows = platforms.length > 1 ? 2 : 1;
  const activeRows = collapsed.active
    ? []
    : page.rows.filter((c) => !c.archived);
  const selectedActive = data.clusters.filter(
    (c) => !c.archived && selected.includes(c.id),
  );
  const allChecked =
    activeRows.length > 0 && activeRows.every((c) => selected.includes(c.id));
  const someChecked = activeRows.some((c) => selected.includes(c.id));
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkbox.current)
      checkbox.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked]);
  const changePage = (value: number) =>
    setPagination({ key: filterKey, page: value });
  const colCount = 7 + Math.max(1, platforms.length * 2);
  const resetFilters = () =>
    (Object.keys(filters) as (keyof Filters)[]).forEach((key) =>
      setFilter(key, ""),
    );

  return (
    <section
      className={`${styles.card} ${styles.contentTableCard}`}
      aria-label="Таблица контента"
    >
      <div className={styles.cardHead}>
        <h2>
          Таблица контента{" "}
          <span className={styles.tableCount}>{data.clusters.length}</span>
        </h2>
        <button onClick={onAdd}>+ Добавить кластер</button>
      </div>
      {onPrepare && (
        <div className={styles.launchSelection}>
          <p className={styles.muted}>
            Сначала отметьте темы в таблице. Затем проверьте материалы и
            площадки перед созданием статей.
          </p>
          <div className={styles.actions}>
            <button
              disabled={!data.clusters.some((c) => !c.archived)}
              onClick={() =>
                setSelected(
                  data.clusters.filter((c) => !c.archived).map((c) => c.id),
                )
              }
            >
              Выбрать все актуальные темы (
              {data.clusters.filter((c) => !c.archived).length})
            </button>
            <button
              className={styles.primary}
              disabled={prepareDisabled || !selectedActive.length}
              onClick={onPrepare}
            >
              Подготовить статьи
              {selectedActive.length ? ` (${selectedActive.length})` : ""}
            </button>
          </div>
          {!selectedActive.length && (
            <p className={styles.muted}>
              Темы не выбраны. Без выбора запуск не начнётся.
            </p>
          )}
        </div>
      )}
      <div className={styles.contentTableFilters}>
        <label className={`${styles.field} ${styles.contentTableSearch}`}>
          <span className={styles.visuallyHidden}>Поиск по кластерам</span>
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Поиск по кластеру, запросу или статье…"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.visuallyHidden}>Направление</span>
          <select
            value={filters.direction}
            onChange={(e) => setFilter("direction", e.target.value)}
          >
            <option value="">Все направления</option>
            {[
              ...new Set(data.clusters.map((c) => c.direction).filter(Boolean)),
            ].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.visuallyHidden}>Статус статьи</span>
          <select
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="">Все статусы</option>
            {Object.entries(ARTICLE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.visuallyHidden}>Рекомендация AI</span>
          <select
            value={filters.recommendation}
            onChange={(e) => setFilter("recommendation", e.target.value)}
          >
            <option value="">Все рекомендации AI</option>
            {Object.entries(AI_RECOMMENDATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedActive.length > 0 && (
        <div className={styles.tableSelection}>
          <strong>Выбрано кластеров: {selectedActive.length}</strong>
          <span className={styles.muted}>
            Выбор сохраняется между страницами
          </span>
          <button className={styles.link} onClick={() => setSelected([])}>
            Снять выбор
          </button>
          <button disabled={selectedActive.length < 2} onClick={onMerge}>
            Объединить выбранные
          </button>
        </div>
      )}
      <div
        className={styles.contentTableScroll}
        tabIndex={0}
        role="region"
        aria-label="Кластеры и статьи по площадкам"
      >
        <table
          className={styles.contentMatrix}
          style={{ minWidth: 940 + Math.max(1, platforms.length) * 500 }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 48 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            {platforms.map((p) => (
              <Fragment key={p.id}>
                <col style={{ width: 280 }} />
                <col style={{ width: 220 }} />
              </Fragment>
            ))}
            {!platforms.length && <col style={{ width: 500 }} />}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={headerRows} className={styles.matrixCheck}>
                <input
                  ref={checkbox}
                  type="checkbox"
                  aria-label="Выбрать актуальные кластеры на этой странице"
                  disabled={!activeRows.length}
                  checked={allChecked}
                  onChange={(e) =>
                    setSelected(
                      selectPageClusters(
                        selected,
                        activeRows,
                        e.target.checked,
                      ),
                    )
                  }
                />
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixIndex}
              >
                №
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixTitle}
              >
                Кластер
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixDirection}
              >
                Направление
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixNumber}
              >
                Запросов
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixNumber}
              >
                Общая частотность
              </th>
              <th
                rowSpan={headerRows}
                scope="col"
                className={styles.matrixNumber}
              >
                Точная частотность
              </th>
              {platforms.length === 1 && (
                <>
                  <th scope="col" className={styles.matrixStatus}>
                    Статья и статус
                    {!platforms[0].connected && (
                      <small> · Площадка не подключена</small>
                    )}
                  </th>
                  <th scope="col" className={styles.matrixRecommendation}>
                    Рекомендация AI
                  </th>
                </>
              )}
              {platforms.length > 1 &&
                platforms.map((p) => (
                  <th
                    colSpan={2}
                    scope="colgroup"
                    className={styles.matrixPlatformHead}
                    key={p.id}
                  >
                    {p.name}
                    {!p.connected && <small>Не подключена</small>}
                  </th>
                ))}
              {!platforms.length && <th scope="col">Площадки</th>}
            </tr>
            {platforms.length > 1 && (
              <tr>
                {platforms.map((p) => (
                  <Fragment key={p.id}>
                    <th scope="col" className={styles.matrixStatus}>
                      Статья и статус
                    </th>
                    <th scope="col" className={styles.matrixRecommendation}>
                      Рекомендация AI
                    </th>
                  </Fragment>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {([false, true] as const).map((archived) => {
              const group = archived ? "archived" : "active";
              const rows = page.rows.filter((c) => c.archived === archived);
              if (!rows.length) return null;
              return (
                <Fragment key={group}>
                  <tr className={styles.matrixGroup}>
                    <th colSpan={colCount} scope="rowgroup">
                      <button
                        aria-expanded={!collapsed[group]}
                        onClick={() =>
                          setCollapsed({
                            ...collapsed,
                            [group]: !collapsed[group],
                          })
                        }
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            flexBasis: `${(44 / (940 + Math.max(1, platforms.length) * 500)) * 100}%`,
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
                            <path
                              d={
                                collapsed[group]
                                  ? "M6 4l4 4-4 4"
                                  : "M4 6l4 4 4-4"
                              }
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        {archived ? "Архивные кластеры" : "Актуальные кластеры"}
                        <span className={styles.tableCount}>
                          {
                            filtered.filter((c) => c.archived === archived)
                              .length
                          }
                        </span>
                      </button>
                    </th>
                  </tr>
                  {!collapsed[group] &&
                    rows.map((c) => (
                      <tr
                        key={c.id}
                        className={archived ? styles.matrixArchive : undefined}
                      >
                        <td className={styles.matrixCheck}>
                          {archived ? (
                            <span aria-label="Архивный кластер">—</span>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`Выбрать кластер ${c.number}`}
                              checked={selected.includes(c.id)}
                              onChange={(e) =>
                                setSelected(
                                  selectPageClusters(
                                    selected,
                                    [c],
                                    e.target.checked,
                                  ),
                                )
                              }
                            />
                          )}
                        </td>
                        <td className={styles.matrixIndex}>{c.number}</td>
                        <th scope="row" className={styles.matrixTitle}>
                          <button
                            className={styles.link}
                            onClick={() => onCluster(c.id)}
                          >
                            {c.title}
                          </button>
                        </th>
                        <td className={styles.matrixDirection}>
                          {c.direction || "—"}
                        </td>
                        <td className={styles.matrixNumber}>
                          {c.queries.length}
                        </td>
                        <td className={styles.matrixNumber}>
                          {c.queries
                            .reduce((s, q) => s + q.general, 0)
                            .toLocaleString("ru-RU")}
                        </td>
                        <td className={styles.matrixNumber}>
                          {c.queries
                            .reduce((s, q) => s + q.exact, 0)
                            .toLocaleString("ru-RU")}
                        </td>
                        {platforms.map((p) => {
                          const article = data.articles.find(
                            (a) => a.cluster_id === c.id && a.site_id === p.id,
                          );
                          if (!article && !p.connected)
                            return (
                              <Fragment key={p.id}>
                                <td>—</td>
                                <td>—</td>
                              </Fragment>
                            );
                          const status = article?.status ?? "missing";
                          const recommendation =
                            article?.recommendation ?? "create";
                          return (
                            <Fragment key={p.id}>
                              <td className={styles.matrixStatus}>
                                {article && (
                                  <button
                                    className={`${styles.link} ${styles.matrixArticle}`}
                                    onClick={() => onArticle(article.id)}
                                  >
                                    {article.title}
                                  </button>
                                )}
                                <span
                                  className={styles.matrixBadge}
                                  data-tone={
                                    status === "published"
                                      ? "success"
                                      : status === "created"
                                        ? "accent"
                                        : status === "unpublished"
                                          ? "danger"
                                          : "neutral"
                                  }
                                >
                                  {ARTICLE_STATUS[status]}
                                </span>
                              </td>
                              <td className={styles.matrixRecommendation}>
                                {archived ? (
                                  <span className={styles.muted}>—</span>
                                ) : (
                                  <details>
                                    <summary
                                      className={styles.matrixBadge}
                                      data-tone={
                                        recommendation === "unpublish"
                                          ? "danger"
                                          : recommendation === "keep"
                                            ? "neutral"
                                            : "accent"
                                      }
                                    >
                                      {AI_RECOMMENDATION[recommendation]}
                                    </summary>
                                    <p>
                                      {article?.rationale ||
                                        "AI определит релевантность этой площадки при запуске."}
                                    </p>
                                  </details>
                                )}
                              </td>
                            </Fragment>
                          );
                        })}
                        {!platforms.length && (
                          <td className={styles.muted}>
                            Площадки не подключены
                          </td>
                        )}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className={styles.matrixEmpty}>
          <strong>
            {data.clusters.length
              ? "Кластеры не найдены"
              : "Добавьте первый кластер"}
          </strong>
          <p>
            {data.clusters.length
              ? "Попробуйте изменить поиск или фильтры."
              : "Добавьте подготовленные поисковые запросы — здесь появятся статьи и рекомендации по площадкам."}
          </p>
          {data.clusters.length > 0 && (
            <button onClick={resetFilters}>Сбросить фильтры</button>
          )}
        </div>
      )}
      <div className={styles.matrixFooter}>
        <span role="status">
          Показано {filtered.length ? page.start + 1 : 0}–
          {Math.min(page.start + size, filtered.length)} из {filtered.length}
        </span>
        <label>
          На странице{" "}
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[10, 25, 50].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Страницы таблицы контента">
          <button
            aria-label="Предыдущая страница"
            disabled={page.page === 1}
            onClick={() => changePage(page.page - 1)}
          >
            ‹
          </button>
          <span>
            Страница {page.page} из {page.pages}
          </span>
          <button
            aria-label="Следующая страница"
            disabled={page.page === page.pages}
            onClick={() => changePage(page.page + 1)}
          >
            ›
          </button>
        </nav>
      </div>
    </section>
  );
}
