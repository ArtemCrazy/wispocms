"use client";
import { useState } from "react";
import {
  EVENT_TYPE,
  RUN_STATUS,
  valueText,
  type CreationLocation,
  type History,
} from "./creation-state";
import { creationDate } from "./creation-shared";
import styles from "./content-center-view.module.css";

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
    [type, setType] = useState("");
  const tab = location.historyTab;
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
        `${r.title} ${r.actor_name} ${r.type}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (!actor || r.actor_name === actor) &&
      (!type || r.type === type) &&
      (!from || date >= new Date(`${from}T00:00:00`)) &&
      (!end || date <= end)
    );
  });
  const labels = tab === "runs" ? RUN_STATUS : EVENT_TYPE;
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
              setType("");
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
            <select value={type} onChange={(e) => setType(e.target.value)}>
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
                              <pre>{valueText(r.event.before)}</pre>
                              <b>Стало</b>
                              <pre>{valueText(r.event.after)}</pre>
                              {r.event.related_ids.length > 0 && (
                                <p>
                                  Связанные кластеры:{" "}
                                  {r.event.related_ids.map((id, i) => (
                                    <button
                                      className={styles.link}
                                      key={id}
                                      onClick={() =>
                                        navigate({ screen: "cluster", id })
                                      }
                                    >
                                      Кластер {i + 1} ↗{" "}
                                    </button>
                                  ))}
                                </p>
                              )}
                            </>
                          ) : (
                            <pre>{valueText(r.event.after)}</pre>
                          )}
                        </details>
                      )}
                  </td>
                  <td>{labels[r.type as keyof typeof labels] ?? r.type}</td>
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
