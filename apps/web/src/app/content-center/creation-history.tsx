"use client";
import { useState } from "react";
import {
  type Cluster,
  type CreationLocation,
  type History,
} from "./creation-state";
import {
  clusterSnapshots,
  historyLabels,
  publicationDetails,
} from "./creation-history-state";
import { creationDate } from "./creation-shared";
import styles from "./content-center-view.module.css";

function ClusterSnapshots({
  value,
  navigate,
}: {
  value: unknown;
  navigate: (l: Partial<CreationLocation>) => void;
}) {
  const clusters = clusterSnapshots(value);
  if (!clusters.length)
    return <p className={styles.muted}>Кластер ещё не создан.</p>;
  return clusters.map((cluster: Cluster) => (
    <section key={cluster.id} className={styles.creationEventSnapshot}>
      <button
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
  navigate: (l: Partial<CreationLocation>) => void;
}) {
  const publication = publicationDetails(value);
  return (
    <dl className={styles.creationEventFields}>
      <dt>Опубликованная версия</dt>
      <dd>
        {publication.version !== null && articleId ? (
          <button
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

export function CreationHistory({
  data,
  location,
  navigate,
}: {
  data: History;
  location: CreationLocation;
  navigate: (l: Partial<CreationLocation>) => void;
}) {
  const [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [actor, setActor] = useState(""),
    [types, setTypes] = useState<
      Partial<Record<CreationLocation["historyTab"], string>>
    >({});
  const tab = location.historyTab;
  const type = types[tab] ?? "";
  const labels = historyLabels(tab);
  const rows =
    tab === "runs"
      ? data.runs.map((r) => ({
          id: r.id,
          title: `Запуск № ${r.number}`,
          type: r.status,
          actor_name: r.actor_name,
          created_at: r.created_at,
          run: r,
          event: null,
        }))
      : data.events
          .filter(
            (e) =>
              e.kind === (tab === "clusters" ? "cluster" : "article") &&
              (!location.clusterContext ||
                e.cluster_id === location.clusterContext),
          )
          .map((e) => ({
            id: e.id,
            title: e.title,
            type: e.type,
            actor_name: e.actor_name,
            created_at: e.created_at,
            run: null,
            event: e,
          }));
  const filtered = rows.filter((r) => {
    const date = new Date(r.created_at);
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    return (
      (!search ||
        `${r.title} ${r.actor_name} ${labels[r.type] ?? r.type}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (!actor || r.actor_name === actor) &&
      (!type || r.type === type) &&
      (!from || date >= new Date(`${from}T00:00:00`)) &&
      (!end || date <= end)
    );
  });
  return (
    <>
      <div
        className={styles.creationTabs}
        role="tablist"
        aria-label="История создания контента"
      >
        {(
          [
            ["runs", "Запуски"],
            ["clusters", "Кластеры"],
            ["articles", "Статьи"],
          ] as const
        ).map(([id, name]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.selected : undefined}
            key={id}
            onClick={() => {
              navigate({ screen: "history", historyTab: id });
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h2>
            История{" "}
            {tab === "runs"
              ? "запусков"
              : tab === "clusters"
                ? "кластеров"
                : "статей"}
          </h2>
          {location.clusterContext && (
            <button onClick={() => navigate({ clusterContext: null })}>
              Показать все кластеры
            </button>
          )}
        </div>
        <div className={styles.creationFilters}>
          <label className={styles.field}>
            Поиск
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название, номер, пользователь"
            />
          </label>
          <label className={styles.field}>
            С даты
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            По дату
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            Пользователь
            <select value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Все пользователи</option>
              {[...new Set(rows.map((r) => r.actor_name))].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {tab === "runs" ? "Результат" : "Тип события"}
            <select
              value={type}
              onChange={(e) => setTypes({ ...types, [tab]: e.target.value })}
            >
              <option value="">Все</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Дата и время</th>
                <th>
                  {tab === "runs"
                    ? "Запуск"
                    : tab === "clusters"
                      ? "Кластер"
                      : "Статья"}
                </th>
                <th>{tab === "runs" ? "Результат" : "Событие"}</th>
                {tab === "runs" && <th>Кластеров</th>}
                <th>Пользователь</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{creationDate(r.created_at)}</td>
                  <td>
                    {r.run ? (
                      r.title
                    ) : (
                      <button
                        className={styles.link}
                        onClick={() =>
                          navigate({
                            screen:
                              r.event!.kind === "cluster"
                                ? "cluster"
                                : "article",
                            id: r.event!.article_id ?? r.event!.cluster_id,
                          })
                        }
                      >
                        {r.title}
                      </button>
                    )}
                    {r.event?.type === "version" && (
                      <div>
                        <button
                          className={styles.link}
                          onClick={() =>
                            navigate({
                              screen: "versions",
                              id: r.event!.article_id,
                            })
                          }
                        >
                          История версий →
                        </button>
                      </div>
                    )}
                    {r.event &&
                      (r.event.kind === "cluster" ||
                        r.event.type === "published") && (
                        <details className={styles.creationEvent}>
                          <summary>
                            Посмотреть{" "}
                            {r.event.type === "published"
                              ? "публикацию"
                              : "изменение"}
                          </summary>
                          {r.event.kind === "cluster" ? (
                            <>
                              <b>Было</b>
                              <ClusterSnapshots
                                value={r.event.before}
                                navigate={navigate}
                              />
                              <b>Стало</b>
                              <ClusterSnapshots
                                value={r.event.after}
                                navigate={navigate}
                              />
                              {(r.event.type === "split" ||
                                r.event.type === "merge") && (
                                <p className={styles.muted}>
                                  Исходные кластеры перенесены в архив. Их
                                  статьи и история сохранены.
                                </p>
                              )}
                              {r.event.related_ids.length > 0 && (
                                <p>
                                  Связанные кластеры:{" "}
                                  {r.event.related_ids.map((id) => (
                                    <button
                                      className={styles.link}
                                      key={id}
                                      onClick={() =>
                                        navigate({ screen: "cluster", id })
                                      }
                                    >
                                      {(() => {
                                        const cluster = [
                                          ...clusterSnapshots(r.event!.before),
                                          ...clusterSnapshots(r.event!.after),
                                        ].find((item) => item.id === id);
                                        return cluster
                                          ? `№ ${cluster.number} · ${cluster.title}`
                                          : "Открыть кластер";
                                      })()}{" "}
                                      ↗{" "}
                                    </button>
                                  ))}
                                </p>
                              )}
                            </>
                          ) : (
                            <PublicationDetails
                              value={r.event.after}
                              articleId={r.event.article_id}
                              navigate={navigate}
                            />
                          )}
                        </details>
                      )}
                  </td>
                  <td>{labels[r.type] ?? r.type}</td>
                  {r.run && <td>{r.run.cluster_count}</td>}
                  <td>{r.actor_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p className={styles.muted}>
            Записей по выбранным условиям пока нет.
          </p>
        )}
      </section>
    </>
  );
}
