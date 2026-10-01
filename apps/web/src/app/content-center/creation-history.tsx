"use client";
import { Fragment, useState } from "react";
import {
  type CreationLocation,
  type History,
  type HistoryEvent,
} from "./creation-state";
import {
  clusterSnapshots,
  historyLabels,
  historyRows,
  historyPage,
  historyTone,
  publicationDetails,
  type HistoryFilters,
} from "./creation-history-state";
import { creationDate } from "./creation-shared";
import styles from "./content-center-view.module.css";

type Navigate = (location: Partial<CreationLocation>) => void;

function ClusterSnapshots({
  value,
  navigate,
}: {
  value: unknown;
  navigate: Navigate;
}) {
  const clusters = clusterSnapshots(value);
  if (!clusters.length)
    return <p className={styles.muted}>Кластер ещё не создан.</p>;
  return clusters.map((cluster) => (
    <section key={cluster.id} className={styles.creationEventSnapshot}>
      <button
        type="button"
        className={styles.link}
        onClick={() => navigate({ screen: "cluster", id: cluster.id })}
      >
        № {cluster.number} · {cluster.title} ↗
      </button>
      <dl className={styles.creationEventFields}>
        <dt>Направление</dt>
        <dd>{cluster.direction || "Не указано"}</dd>
        <dt>Состояние</dt>
        <dd>{cluster.archived ? "В архиве" : "Актуальный"}</dd>
        <dt>Запросов</dt>
        <dd>{cluster.queries.length}</dd>
        <dt>Общая частотность</dt>
        <dd>
          {cluster.queries
            .reduce((sum, query) => sum + query.general, 0)
            .toLocaleString("ru-RU")}
        </dd>
        <dt>Точная частотность</dt>
        <dd>
          {cluster.queries
            .reduce((sum, query) => sum + query.exact, 0)
            .toLocaleString("ru-RU")}
        </dd>
      </dl>
      <div className={styles.tableWrap}>
        <table>
          <caption>Запросы и частотность на момент события</caption>
          <thead>
            <tr>
              <th>Запрос</th>
              <th>Общая</th>
              <th>Точная</th>
            </tr>
          </thead>
          <tbody>
            {cluster.queries.map((query) => (
              <tr key={query.text}>
                <td>
                  {query.text}
                  {query.primary && <strong> · основной</strong>}
                </td>
                <td>{query.general}</td>
                <td>{query.exact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ));
}

function PublicationDetails({
  value,
  articleId,
  navigate,
}: {
  value: unknown;
  articleId: string | null;
  navigate: Navigate;
}) {
  const publication = publicationDetails(value);
  return (
    <dl className={styles.creationEventFields}>
      <dt>Опубликованная версия</dt>
      <dd>
        {publication.version !== null && articleId ? (
          <button
            type="button"
            className={styles.link}
            onClick={() =>
              navigate({
                screen: "versions",
                id: articleId,
                version: publication.version,
              })
            }
          >
            Версия {publication.version} ↗
          </button>
        ) : (
          "Не указана"
        )}
      </dd>
      <dt>Площадка</dt>
      <dd>{publication.siteName}</dd>
      <dt>Адрес публикации</dt>
      <dd>
        {publication.href ? (
          <a
            className={styles.link}
            href={publication.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {publication.href}
          </a>
        ) : (
          "Не указан"
        )}
      </dd>
    </dl>
  );
}

function EventDetails({
  event,
  navigate,
}: {
  event: HistoryEvent;
  navigate: Navigate;
}) {
  if (event.kind !== "cluster")
    return (
      <PublicationDetails
        value={event.after}
        articleId={event.article_id}
        navigate={navigate}
      />
    );
  const snapshots = [
    ...clusterSnapshots(event.before),
    ...clusterSnapshots(event.after),
  ];
  return (
    <>
      <h3>Изменение кластера</h3>
      <div className={styles.historyComparison}>
        <div>
          <h4>Было</h4>
          <ClusterSnapshots value={event.before} navigate={navigate} />
        </div>
        <div>
          <h4>Стало</h4>
          <ClusterSnapshots value={event.after} navigate={navigate} />
        </div>
      </div>
      {(event.type === "split" || event.type === "merge") && (
        <p className={styles.muted}>
          Исходные кластеры перенесены в архив. Их статьи и история сохранены.
        </p>
      )}
      {event.related_ids.length > 0 && (
        <p>
          Связанные кластеры:{" "}
          {event.related_ids.map((id) => {
            const cluster = snapshots.find((item) => item.id === id);
            return (
              <button
                type="button"
                className={styles.link}
                key={id}
                onClick={() => navigate({ screen: "cluster", id })}
              >
                {cluster
                  ? `№ ${cluster.number} · ${cluster.title}`
                  : "Открыть кластер"}{" "}
                ↗{" "}
              </button>
            );
          })}
        </p>
      )}
    </>
  );
}

const emptyFilters: HistoryFilters = {
  search: "",
  from: "",
  to: "",
  actor: "",
  type: "",
};

export function CreationHistory({
  data,
  location,
  navigate,
}: {
  data: History;
  location: CreationLocation;
  navigate: Navigate;
}) {
  const tab = location.historyTab;
  const [filters, setFilters] = useState<
    Partial<Record<CreationLocation["historyTab"], HistoryFilters>>
  >({});
  const [size, setSize] = useState(10);
  const [ascending, setAscending] = useState(false);
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const [expanded, setExpanded] = useState<string[]>([]);
  const current = filters[tab] ?? emptyFilters;
  const labels = historyLabels(tab);
  const rows = historyRows(data, tab, location.clusterContext);
  const pageKey = JSON.stringify([
    tab,
    location.clusterContext,
    current,
    size,
    ascending,
  ]);
  const page = historyPage(
    rows,
    labels,
    current,
    paging.key === pageKey ? paging.page : 1,
    size,
    ascending,
  );
  const setFilter = (key: keyof HistoryFilters, value: string) =>
    setFilters({ ...filters, [tab]: { ...current, [key]: value } });
  const reset = () => setFilters({ ...filters, [tab]: { ...emptyFilters } });
  const filtered = Object.values(current).some(Boolean);
  const actors = [...new Set(rows.map((row) => row.actor_name))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
  const title =
    tab === "runs" ? "Запуск" : tab === "clusters" ? "Кластер" : "Статья";
  return (
    <section className={`${styles.card} ${styles.historyCard}`}>
      <div className={styles.cardHead}>
        <h2>История</h2>
        {location.clusterContext && (
          <button
            type="button"
            onClick={() => navigate({ clusterContext: null })}
          >
            Показать все кластеры
          </button>
        )}
      </div>
      <div className={styles.historyTabs} aria-label="Разделы истории">
        {(
          [
            ["runs", "Запуски"],
            ["clusters", "Кластеры"],
            ["articles", "Статьи"],
          ] as const
        ).map(([id, name]) => (
          <button
            type="button"
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? styles.selected : undefined}
            key={id}
            onClick={() => navigate({ screen: "history", historyTab: id })}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={styles.historyFilters}>
        <label className={`${styles.field} ${styles.historySearch}`}>
          Поиск
          <input
            type="search"
            value={current.search}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder={
              tab === "runs"
                ? "Номер запуска, пользователь…"
                : "Название, пользователь…"
            }
          />
        </label>
        <label className={styles.field}>
          С даты
          <input
            type="date"
            value={current.from}
            max={current.to || undefined}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          По дату
          <input
            type="date"
            value={current.to}
            min={current.from || undefined}
            onChange={(e) => setFilter("to", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          {tab === "runs" ? "Результат" : "Тип события"}
          <select
            value={current.type}
            onChange={(e) => setFilter("type", e.target.value)}
          >
            <option value="">
              {tab === "runs" ? "Все результаты" : "Все типы изменений"}
            </option>
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Пользователь
          <select
            value={current.actor}
            onChange={(e) => setFilter("actor", e.target.value)}
          >
            <option value="">Все пользователи</option>
            {actors.map((actor) => (
              <option key={actor}>{actor}</option>
            ))}
          </select>
        </label>
      </div>
      {page.invalidRange && (
        <p className={styles.error} role="alert">
          Начальная дата должна быть не позже конечной.
        </p>
      )}
      {filtered && (
        <button type="button" className={styles.link} onClick={reset}>
          Сбросить фильтры
        </button>
      )}
      <div
        className={styles.contentTableScroll}
        role="region"
        aria-label={`История: ${title}`}
        tabIndex={0}
      >
        <table className={styles.historyTable}>
          <thead>
            <tr>
              {tab !== "runs" && (
                <th scope="col">
                  <span className={styles.visuallyHidden}>Подробности</span>
                </th>
              )}
              <th
                scope="col"
                aria-sort={ascending ? "ascending" : "descending"}
              >
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => setAscending(!ascending)}
                >
                  Дата и время {ascending ? "↑" : "↓"}
                </button>
              </th>
              <th scope="col">{title}</th>
              {tab === "runs" && <th scope="col">Кластеров</th>}
              <th scope="col">{tab === "runs" ? "Результат" : "Событие"}</th>
              <th scope="col">Пользователь</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const canExpand =
                row.event &&
                (row.event.kind === "cluster" ||
                  row.event.type === "published");
              const open = expanded.includes(row.id);
              return (
                <Fragment key={row.id}>
                  <tr data-expanded={Boolean(canExpand && open)}>
                    {tab !== "runs" && (
                      <td className={styles.historyDisclosure}>
                        {canExpand && (
                          <button
                            type="button"
                            aria-label={`Подробности: ${row.title}`}
                            aria-expanded={open}
                            aria-controls={`history-event-${row.id}`}
                            onClick={() =>
                              setExpanded(
                                open
                                  ? expanded.filter((id) => id !== row.id)
                                  : [...expanded, row.id],
                              )
                            }
                          >
                            {open ? "⌄" : "›"}
                          </button>
                        )}
                      </td>
                    )}
                    <td className={styles.historyDate}>
                      {creationDate(row.created_at)}
                    </td>
                    <td className={styles.historyTitle}>
                      {row.run ? (
                        <strong>{row.title}</strong>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() =>
                              navigate({
                                screen:
                                  row.event!.kind === "cluster"
                                    ? "cluster"
                                    : "article",
                                id:
                                  row.event!.article_id ??
                                  row.event!.cluster_id,
                              })
                            }
                          >
                            {row.title}
                          </button>
                          {row.event?.type === "version" && (
                            <div>
                              <button
                                type="button"
                                className={styles.link}
                                onClick={() =>
                                  navigate({
                                    screen: "versions",
                                    id: row.event!.article_id,
                                  })
                                }
                              >
                                История версий →
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    {row.run && <td>{row.run.cluster_count}</td>}
                    <td>
                      <span
                        className={styles.matrixBadge}
                        data-tone={historyTone(row.type)}
                      >
                        {labels[row.type] ?? row.type}
                      </span>
                    </td>
                    <td>
                      <span className={styles.historyActor}>
                        <span
                          className={styles.historyAvatar}
                          aria-hidden="true"
                        >
                          {row.actor_name
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toLocaleUpperCase()}
                        </span>
                        {row.actor_name}
                      </span>
                    </td>
                  </tr>
                  {canExpand && (
                    <tr
                      id={`history-event-${row.id}`}
                      hidden={!open}
                      className={styles.historyDetailsRow}
                    >
                      <td colSpan={5}>
                        <EventDetails event={row.event!} navigate={navigate} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!page.rows.length && (
        <div className={styles.matrixEmpty}>
          <strong>
            {filtered ? "Записи не найдены" : "История пока пуста"}
          </strong>
          <p>
            {filtered
              ? "Измените поиск или фильтры."
              : "Здесь появятся сохранённые события этого раздела."}
          </p>
        </div>
      )}
      <div className={styles.matrixFooter}>
        <span role="status">
          Показано {page.total ? page.offset + 1 : 0}–
          {Math.min(page.offset + size, page.total)} из {page.total}
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
        <nav aria-label="Страницы истории">
          <button
            type="button"
            aria-label="Предыдущая страница"
            disabled={page.page === 1}
            onClick={() => setPaging({ key: pageKey, page: page.page - 1 })}
          >
            ‹
          </button>
          <span>
            Страница {page.page} из {page.pages}
          </span>
          <button
            type="button"
            aria-label="Следующая страница"
            disabled={page.page === page.pages}
            onClick={() => setPaging({ key: pageKey, page: page.page + 1 })}
          >
            ›
          </button>
        </nav>
      </div>
    </section>
  );
}
