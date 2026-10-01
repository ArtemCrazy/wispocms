"use client";

import Image from "next/image";
import {
  ARTICLE_STATUS,
  AI_RECOMMENDATION,
  platformRows,
  unpublishedChanges,
  type Cluster,
  type Overview,
  type CreationLocation,
} from "./creation-state";
import { creationDate } from "./creation-shared";
import { publicationDetails } from "./creation-history-state";
import styles from "./content-center-view.module.css";

export function CreationCluster({
  cluster,
  data,
  busy,
  navigate,
  onEdit,
  onSplit,
}: {
  cluster: Cluster;
  data: Overview;
  busy: boolean;
  navigate: (next: Partial<CreationLocation>) => void;
  onEdit: () => void;
  onSplit: () => void;
}) {
  const rows = platformRows(cluster, data);
  const connected = new Set(data.settings.platforms.map((p) => p.siteId));
  return (
    <div className={styles.clusterLayout}>
      <button
        type="button"
        className={styles.link}
        onClick={() => navigate({ screen: "table", id: null })}
      >
        ← К таблице контента
      </button>
      <section className={styles.card} aria-label="Карточка кластера">
        <div className={styles.clusterHeader}>
          <div>
            <p className={styles.clusterEyebrow}>Кластер № {cluster.number}</p>
            <h2>{cluster.title}</h2>
            <p className={styles.muted}>
              {cluster.direction || "Без направления"}
            </p>
          </div>
          <span
            className={styles.matrixBadge}
            data-tone={cluster.archived ? "neutral" : "accent"}
          >
            {cluster.archived ? "Архивный" : "Актуальный"}
          </span>
        </div>
        {cluster.archived && (
          <p className={styles.notice}>
            Кластер в архиве и не участвует в создании контента. Статьи и
            история сохранены.
          </p>
        )}
        <dl className={styles.clusterMetrics}>
          <div>
            <dt>Запросов</dt>
            <dd>{cluster.queries.length}</dd>
          </div>
          <div>
            <dt>Общая частотность</dt>
            <dd>
              {cluster.queries
                .reduce((sum, q) => sum + q.general, 0)
                .toLocaleString("ru-RU")}
            </dd>
          </div>
          <div>
            <dt>Точная частотность</dt>
            <dd>
              {cluster.queries
                .reduce((sum, q) => sum + q.exact, 0)
                .toLocaleString("ru-RU")}
            </dd>
          </div>
        </dl>
        <div className={styles.clusterActions}>
          <button type="button" disabled={busy} onClick={onEdit}>
            Редактировать кластер
          </button>
          <button
            type="button"
            disabled={busy || cluster.archived || cluster.queries.length < 2}
            onClick={onSplit}
          >
            Разделить кластер
          </button>
          <button
            type="button"
            className={styles.link}
            onClick={() =>
              navigate({
                screen: "history",
                historyTab: "clusters",
                clusterContext: cluster.id,
                id: null,
              })
            }
          >
            История изменений кластера →
          </button>
        </div>
        <details className={styles.clusterQueries} open>
          <summary>Запросы кластера ({cluster.queries.length})</summary>
          <div
            className={styles.contentTableScroll}
            role="region"
            aria-label="Запросы кластера"
            tabIndex={0}
          >
            <table className={styles.clusterQueryTable}>
              <thead>
                <tr>
                  <th scope="col">Запрос</th>
                  <th scope="col">Общая частотность</th>
                  <th scope="col">Точная частотность</th>
                </tr>
              </thead>
              <tbody>
                {cluster.queries.map((query) => (
                  <tr key={query.text}>
                    <td>
                      {query.text}{" "}
                      {query.primary && (
                        <span className={styles.matrixBadge} data-tone="accent">
                          Основной
                        </span>
                      )}
                    </td>
                    <td>{query.general.toLocaleString("ru-RU")}</td>
                    <td>{query.exact.toLocaleString("ru-RU")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <div className={styles.cardHead}>
        <h2>
          Статьи по площадкам{" "}
          <span className={styles.tableCount}>
            {rows.filter((row) => row.article).length}
          </span>
        </h2>
        <button
          type="button"
          className={styles.link}
          onClick={() =>
            navigate({
              screen: "history",
              historyTab: "articles",
              clusterContext: cluster.id,
              id: null,
            })
          }
        >
          История статей →
        </button>
      </div>
      {!rows.length && (
        <section className={styles.card}>
          <p className={styles.muted}>
            {cluster.archived
              ? "У этого кластера нет сохранённых статей."
              : "Подключите площадки для создания статей."}
          </p>
          {!cluster.archived && (
            <button
              type="button"
              onClick={() => navigate({ screen: "settings", id: null })}
            >
              Площадки и правила
            </button>
          )}
        </section>
      )}
      <div className={styles.clusterArticleGrid}>
        {rows.map(({ siteId, name, article }) => {
          const enabled = connected.has(siteId);
          const publication = publicationDetails({
            url: article?.publication_url,
          }).href;
          return (
            <article
              className={`${styles.card} ${styles.clusterArticle}`}
              key={siteId}
              aria-label={`Статья: ${name}`}
            >
              <div className={styles.clusterHeader}>
                <strong>{name}</strong>
                <span className={styles.matrixBadge} data-tone="neutral">
                  {enabled ? "Подключена" : "Площадка отключена"}
                </span>
              </div>
              {article?.cover_media_id && (
                <Image
                  unoptimized
                  width={480}
                  height={270}
                  className={styles.creationImage}
                  src={`/api/sites/${siteId}/content/media/${article.cover_media_id}/file`}
                  alt={`Иллюстрация: ${article.title}`}
                />
              )}
              <h3>
                {article ? (
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() =>
                      navigate({ screen: "article", id: article.id })
                    }
                  >
                    {article.title}
                  </button>
                ) : (
                  "Статья пока не создана"
                )}
              </h3>
              <span
                className={styles.matrixBadge}
                data-tone={
                  article?.status === "published"
                    ? "success"
                    : article?.status === "unpublished"
                      ? "danger"
                      : "neutral"
                }
              >
                {ARTICLE_STATUS[article?.status ?? "missing"]}
              </span>
              {article ? (
                <>
                  <p className={styles.clusterArticleDates}>
                    Создана: {creationDate(article.created_at)}
                    <br />
                    Обновлена: {creationDate(article.updated_at)}
                  </p>
                  {unpublishedChanges(article) && (
                    <p className={styles.notice}>
                      Есть изменения, не опубликованные на сайте.
                    </p>
                  )}
                  {!cluster.archived && (
                    <div className={styles.clusterRecommendation}>
                      <span className={styles.clusterEyebrow}>
                        Рекомендация AI
                      </span>
                      <strong>
                        {AI_RECOMMENDATION[article.recommendation]}
                      </strong>
                      <p>{article.rationale || "Обоснование не указано."}</p>
                    </div>
                  )}
                  <details className={styles.clusterPurpose}>
                    <summary>Назначение и содержание статьи</summary>
                    <dl className={styles.creationEventFields}>
                      <dt>Назначение</dt>
                      <dd>{article.purpose || "Не указано"}</dd>
                      <dt>Задача</dt>
                      <dd>{article.task || "Не указана"}</dd>
                      <dt>Потребность пользователя</dt>
                      <dd>{article.need || "Не указана"}</dd>
                      <dt>Обоснование содержания</dt>
                      <dd>{article.content_rationale || "Не указано"}</dd>
                    </dl>
                  </details>
                  <div className={styles.clusterVersions}>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() =>
                        navigate({
                          screen: "versions",
                          id: article.id,
                          version: article.current_number,
                        })
                      }
                    >
                      Текущая версия V{article.current_number}
                    </button>
                    <span>
                      {article.status === "published" &&
                      article.published_number !== null
                        ? `Опубликована V${article.published_number}`
                        : "Не опубликована"}
                    </span>
                  </div>
                  {article.status === "published" && publication && (
                    <a
                      className={styles.link}
                      href={publication}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Открыть опубликованную статью ↗
                    </a>
                  )}
                </>
              ) : (
                <p className={styles.muted}>
                  {cluster.archived
                    ? "Архивный кластер не участвует в новых запусках."
                    : "При запуске AI определит релевантность кластера этой площадке и необходимость статьи."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
