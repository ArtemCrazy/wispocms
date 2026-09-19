"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { ArticleDocumentBlock } from "../structured-article-editor";
import {
  ARTICLE_STATUS,
  AI_RECOMMENDATION,
  unpublishedChanges,
  valueText,
  type ArticleDetails,
  type CreationLocation,
  type Overview,
  type Proposal,
  type Version,
} from "./creation-state";
import {
  CreationDialog,
  CreationInstruction,
  creationDate,
  creationRequest,
} from "./creation-shared";
import styles from "./content-center-view.module.css";

export function CreationDiff({ changes }: { changes: Proposal[] }) {
  return (
    <div className={styles.creationDiffList}>
      {changes.map((p) => (
        <div key={p.id} className={styles.creationDiff}>
          <strong>
            {p.target === "title"
              ? "Заголовок"
              : p.target === "excerpt"
                ? "Описание"
                : p.target === "document"
                  ? "Документ"
                  : "Элемент статьи"}
          </strong>
          <div>
            <section>
              <b>Было</b>
              <pre>{valueText(p.before)}</pre>
            </section>
            <section>
              <b>Стало</b>
              <pre>{valueText(p.after)}</pre>
            </section>
          </div>
          {p.reason && <p className={styles.muted}>{p.reason}</p>}
        </div>
      ))}
    </div>
  );
}
function Block({
  block,
  siteSlug,
}: {
  block: ArticleDocumentBlock;
  siteSlug: string;
}) {
  if (block.type === "image")
    return (
      <figure>
        <Image
          src={`/api/sites/${encodeURIComponent(siteSlug)}/content/media/${block.mediaId}/file`}
          width={960}
          height={540}
          unoptimized
          alt={block.alt ?? ""}
          className={styles.creationImage}
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  if (block.type === "heading")
    return block.level === 2 ? (
      <h2>{block.text}</h2>
    ) : block.level === 3 ? (
      <h3>{block.text}</h3>
    ) : (
      <h4>{block.text}</h4>
    );
  if (block.type === "bullet_list")
    return (
      <ul>
        {block.items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    );
  if (block.type === "numbered_list")
    return (
      <ol>
        {block.items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    );
  if (block.type === "quote")
    return (
      <blockquote>
        {block.text}
        {block.cite && <cite>{block.cite}</cite>}
      </blockquote>
    );
  return <p className={styles.creationText}>{block.text}</p>;
}
export function CreationArticle({
  base,
  parentBase,
  details,
  data,
  location,
  navigate,
  refresh,
  onDirtyChange,
}: {
  base: string;
  parentBase: string;
  details: ArticleDetails;
  data: Overview;
  location: CreationLocation;
  navigate: (l: Partial<CreationLocation>) => void;
  refresh: () => Promise<void>;
  onDirtyChange: (v: boolean) => void;
}) {
  const { article, version } = details;
  const [instruction, setInstruction] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [target, setTarget] = useState(""),
    [fragment, setFragment] = useState("");
  const [voice, setVoice] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [publish, setPublish] = useState(false),
    [unpublish, setUnpublish] = useState(false),
    [restore, setRestore] = useState<number | null>(null);
  const [category, setCategory] = useState(article.category_id ?? ""),
    [slug, setSlug] = useState(`article-${article.id.slice(0, 8)}`),
    [template, setTemplate] = useState("");
  const [historical, setHistorical] = useState<Version | null>(null);
  const correctionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    onDirtyChange(Boolean(instruction || file || voice || fragment));
    return () => onDirtyChange(false);
  }, [instruction, file, voice, fragment, onDirtyChange]);
  useEffect(() => {
    if (location.screen !== "versions") return;
    let active = true;
    creationRequest<Version>(
      `${base}/articles/${article.id}/versions/${location.version ?? article.current_number}`,
    )
      .then((v) => {
        if (active) setHistorical(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [
    base,
    article.id,
    article.current_number,
    location.screen,
    location.version,
  ]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(target: string) {
    setTarget(target);
    setFragment("");
    correctionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  const running =
    data.run?.status === "queued" || data.run?.status === "processing";
  const publishTemplate =
    template ||
    [details.templates[0]?.key, details.templates[0]?.version].join(":");
  return (
    <>
      <div className={styles.actions}>
        <button
          onClick={() =>
            navigate({ screen: "cluster", id: article.cluster_id })
          }
        >
          ← Кластер
        </button>
        <button
          onClick={() =>
            navigate({
              screen: location.screen === "versions" ? "article" : "versions",
              id: article.id,
            })
          }
        >
          {location.screen === "versions" ? "К статье" : "История версий"}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {location.screen === "versions" ? (
        <>
          <section className={styles.card}>
            <h2>История версий: {version.snapshot.title}</h2>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Версия</th>
                    <th>Состояние</th>
                    <th>Дата и время</th>
                    <th>Пользователь</th>
                  </tr>
                </thead>
                <tbody>
                  {details.versions.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <button
                          className={styles.link}
                          onClick={() =>
                            navigate({
                              screen: "versions",
                              id: article.id,
                              version: v.number,
                            })
                          }
                        >
                          Версия {v.number}
                        </button>
                      </td>
                      <td>
                        {v.number === article.current_number && (
                          <span className={styles.badge}>Актуальная</span>
                        )}{" "}
                        {v.number === article.published_number && (
                          <span className={styles.badge}>Опубликованная</span>
                        )}
                      </td>
                      <td>{creationDate(v.created_at)}</td>
                      <td>{v.actor_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {historical && (
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2>Версия {historical.number}</h2>
                <button
                  disabled={
                    busy ||
                    historical.number === article.current_number ||
                    Boolean(details.correction)
                  }
                  onClick={() => setRestore(historical.number)}
                >
                  Восстановить версию
                </button>
              </div>
              <p>
                {creationDate(historical.created_at)} · {historical.actor_name}
              </p>
              <p>{historical.reason}</p>
              <h3>Что изменилось</h3>
              {historical.changes.length ? (
                <CreationDiff changes={historical.changes} />
              ) : (
                <p className={styles.muted}>
                  Первая версия — предыдущего состояния нет.
                </p>
              )}
              <h3>{historical.snapshot.title}</h3>
              {historical.snapshot.document.blocks.map((b) => (
                <Block key={b.id} block={b} siteSlug={article.site_id} />
              ))}
            </section>
          )}
        </>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2>{version.snapshot.title}</h2>
              <span className={styles.badge}>
                {ARTICLE_STATUS[article.status]}
              </span>
            </div>
            <p className={styles.muted}>
              Версия {article.current_number} · {details.sites[0]?.name}
            </p>
            {unpublishedChanges(article) && (
              <p className={styles.notice}>
                Есть изменения, не опубликованные на сайте. На площадке остаётся
                версия {article.published_number}.
              </p>
            )}
            <p>
              <strong>{AI_RECOMMENDATION[article.recommendation]}</strong> —{" "}
              {article.rationale}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={busy}
                onClick={() => setPublish(true)}
              >
                Отправить в публикацию
              </button>
              {article.status === "published" && (
                <button disabled={busy} onClick={() => setUnpublish(true)}>
                  Снять с публикации
                </button>
              )}
              {article.publication_url && (
                <a
                  className={styles.download}
                  href={article.publication_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть публикацию ↗
                </a>
              )}
            </div>
          </section>
          <section ref={correctionRef} className={styles.card}>
            <h2>Корректировка статьи</h2>
            <p className={styles.muted}>
              AI предложит изменения. Содержимое статьи останется прежним, пока
              вы не рассмотрите все предложения.
            </p>
            {target ? (
              <div className={styles.notice}>
                <strong>
                  Контекст:{" "}
                  {target === "title"
                    ? "заголовок"
                    : target === "excerpt"
                      ? "описание"
                      : "выбранный элемент"}
                </strong>
                <pre className={styles.creationPre}>
                  {valueText(
                    target === "title"
                      ? version.snapshot.title
                      : target === "excerpt"
                        ? version.snapshot.excerpt
                        : version.snapshot.document.blocks.find(
                            (b) => `block:${b.id}` === target,
                          ),
                  )}
                </pre>
                <button onClick={() => choose("")}>
                  Корректировать статью целиком
                </button>
              </div>
            ) : (
              <p>Область: вся статья.</p>
            )}
            <CreationInstruction
              base={parentBase}
              value={instruction}
              setValue={setInstruction}
              file={file}
              setFile={setFile}
              disabled={busy || running || Boolean(details.correction)}
              onVoice={setVoice}
            >
              <label className={styles.field}>
                Конкретный фрагмент (необязательно)
                <textarea
                  rows={2}
                  maxLength={12000}
                  value={fragment}
                  onChange={(e) => setFragment(e.target.value)}
                  placeholder="Вставьте фрагмент текущего элемента или статьи. Это контекст, не инструкция."
                />
              </label>
            </CreationInstruction>
            <button
              className={styles.primary}
              disabled={
                busy ||
                voice ||
                running ||
                !data.ai.connected ||
                !instruction.trim() ||
                Boolean(details.correction)
              }
              onClick={() =>
                void act(async () => {
                  const form = new FormData();
                  form.append(
                    "payload",
                    JSON.stringify({
                      revision: article.revision,
                      instruction,
                      ...(target ? { target } : {}),
                      ...(fragment ? { fragment } : {}),
                    }),
                  );
                  if (file) form.append("file", file);
                  await creationRequest(
                    `${base}/articles/${article.id}/correct`,
                    "POST",
                    form,
                  );
                  setInstruction("");
                  setFile(null);
                })
              }
            >
              Получить предложения AI
            </button>
            {!data.ai.connected && (
              <p className={styles.muted}>Доступно после подключения AI API.</p>
            )}
          </section>
          {details.correction && (
            <section className={styles.card}>
              <h2>Предложения AI по корректировке</h2>
              <p className={styles.muted}>
                Рассмотрите каждое предложение. После последнего решения
                принятые изменения сохранятся одной версией; если отклонить всё,
                новой версии не будет.
              </p>
              {details.correction.proposals.map((p) => (
                <div key={p.id} className={styles.creationProposal}>
                  <CreationDiff changes={[p]} />
                  {p.decision === "pending" ? (
                    <div className={styles.actions}>
                      {(["accepted", "rejected"] as const).map((decision) => (
                        <button
                          key={decision}
                          disabled={busy}
                          className={
                            decision === "accepted" ? styles.primary : undefined
                          }
                          onClick={() =>
                            void act(async () => {
                              await creationRequest(
                                `${base}/articles/${article.id}/decisions`,
                                "POST",
                                {
                                  revision: article.revision,
                                  correctionId: details.correction!.id,
                                  proposalId: p.id,
                                  decision,
                                },
                              );
                            })
                          }
                        >
                          {decision === "accepted" ? "Принять" : "Отклонить"}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className={styles.badge}>
                      {p.decision === "accepted" ? "Принято" : "Отклонено"}
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}
          <section className={styles.card}>
            <h2>Актуальная статья</h2>
            <div className={styles.creationElement}>
              <h2>{version.snapshot.title}</h2>
              <button onClick={() => choose("title")}>
                Изменить с помощью AI
              </button>
            </div>
            {version.snapshot.excerpt && (
              <div className={styles.creationElement}>
                <p>{version.snapshot.excerpt}</p>
                <button onClick={() => choose("excerpt")}>
                  Изменить с помощью AI
                </button>
              </div>
            )}
            {version.snapshot.document.blocks.map((b) => (
              <div key={b.id} className={styles.creationElement}>
                <Block block={b} siteSlug={article.site_id} />
                <button
                  aria-label={`Изменить с помощью AI: ${b.id}`}
                  onClick={() => choose(`block:${b.id}`)}
                >
                  Изменить с помощью AI
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {publish && (
        <CreationDialog
          title="Публикация статьи"
          close={() => setPublish(false)}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const [templateKey, templateVersion] =
                  publishTemplate.split(":");
                await creationRequest(
                  `${base}/articles/${article.id}/publish`,
                  "POST",
                  {
                    revision: article.revision,
                    siteId: article.site_id,
                    categoryId: category,
                    slug,
                    templateKey,
                    templateVersion,
                  },
                );
                setPublish(false);
              });
            }}
          >
            <p>
              Будет опубликована текущая версия {article.current_number}. Статьи
              других площадок не изменятся.
            </p>
            <label className={styles.field}>
              Целевая площадка
              <select value={article.site_id} disabled>
                {details.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Раздел
              <select
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Выберите опубликованный раздел</option>
                {details.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Шаблон статьи
              <select
                required
                value={publishTemplate}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {details.templates.map((t) => (
                  <option
                    key={`${t.key}:${t.version}`}
                    value={`${t.key}:${t.version}`}
                  >
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {article.cms_article_id ? (
              <p className={styles.muted}>Существующий URL сохранится.</p>
            ) : (
              <label className={styles.field}>
                Адрес статьи (slug)
                <input
                  required
                  maxLength={160}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </label>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={busy || !category || !details.templates.length}
              >
                Отправить в публикацию
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPublish(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        </CreationDialog>
      )}
      {unpublish && (
        <CreationDialog
          title="Снять статью с публикации?"
          close={() => setUnpublish(false)}
          busy={busy}
        >
          <p>
            Публичная страница станет недоступной. Статья и её версии останутся
            в CMS.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await creationRequest(
                    `${base}/articles/${article.id}/unpublish`,
                    "POST",
                    { revision: article.revision },
                  );
                  setUnpublish(false);
                })
              }
            >
              Подтвердить снятие
            </button>
            <button disabled={busy} onClick={() => setUnpublish(false)}>
              Отмена
            </button>
          </div>
        </CreationDialog>
      )}
      {restore !== null && (
        <CreationDialog
          title={`Восстановить версию ${restore}?`}
          close={() => setRestore(null)}
          busy={busy}
        >
          <p>
            Будет создана новая актуальная версия. Существующие версии и
            опубликованная статья не изменятся.
          </p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button
              disabled={busy}
              className={styles.primary}
              onClick={() =>
                void act(async () => {
                  await creationRequest(
                    `${base}/articles/${article.id}/restore`,
                    "POST",
                    { revision: article.revision, number: restore },
                  );
                  setRestore(null);
                })
              }
            >
              Подтвердить восстановление
            </button>
            <button disabled={busy} onClick={() => setRestore(null)}>
              Отмена
            </button>
          </div>
        </CreationDialog>
      )}
    </>
  );
}
