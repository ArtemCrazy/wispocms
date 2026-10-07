"use client";
import { articleSelection, type ArticleSelection } from "./creation-selection";
import { publicationDetails } from "./creation-history-state";
import { CreationPublicationForm } from "./creation-publication";
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

export { CreationPublicationTemplateField } from "./creation-publication";

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

export function CreationVersionPreview({
  number,
  version,
  error,
  busy,
  currentNumber,
  publishedNumber,
  hasCorrection,
  siteSlug,
  onRetry,
  onRestore,
}: {
  number: number;
  version: Version | null;
  error: string;
  busy: boolean;
  currentNumber: number;
  publishedNumber: number | null;
  hasCorrection: boolean;
  siteSlug: string;
  onRetry: () => void;
  onRestore: (number: number) => void;
}) {
  // A late response must never present the previous selection under the new number.
  const selected = version?.number === number ? version : null;
  return (
    <section
      className={styles.card}
      aria-label={`Просмотр версии ${number}`}
      aria-busy={!selected && !error}
    >
      <div className={styles.cardHead}>
        <h2>Версия {number}</h2>
        {selected && (
          <button
            disabled={busy || number === currentNumber || hasCorrection}
            onClick={() => onRestore(number)}
          >
            Восстановить версию
          </button>
        )}
      </div>
      {error ? (
        <div role="alert">
          <p className={styles.error}>{error}</p>
          <button onClick={onRetry}>Повторить загрузку версии</button>
        </div>
      ) : !selected ? (
        <p role="status">Загружаем версию {number}…</p>
      ) : (
        <>
          <p className={styles.muted}>
            {creationDate(selected.created_at)} · {selected.actor_name}
          </p>
          <div className={styles.actions}>
            {number === currentNumber && (
              <span className={styles.badge}>Актуальная</span>
            )}
            {number === publishedNumber && (
              <span className={styles.badge}>Опубликованная</span>
            )}
          </div>
          {selected.reason && <p>{selected.reason}</p>}
          {hasCorrection && (
            <p className={styles.notice}>
              Завершите рассмотрение предложений AI перед восстановлением
              версии.
            </p>
          )}
          <p className={styles.muted}>
            Восстановление создаёт новую актуальную версию и не меняет
            опубликованную статью.
          </p>
          <details className={styles.creationVersionChanges} open>
            <summary>Что изменилось · {selected.changes.length}</summary>
            {selected.changes.length ? (
              <CreationDiff changes={selected.changes} />
            ) : (
              <p className={styles.muted}>
                Для этой версии нет отдельных изменений.
              </p>
            )}
          </details>
          <article
            className={styles.creationVersionText}
            aria-label="Текст выбранной версии"
          >
            <h3>{selected.snapshot.title}</h3>
            {selected.snapshot.excerpt && (
              <p className={styles.muted}>{selected.snapshot.excerpt}</p>
            )}
            {selected.snapshot.document.blocks.map((b) => (
              <Block key={b.id} block={b} siteSlug={siteSlug} />
            ))}
          </article>
        </>
      )}
    </section>
  );
}

export function CreationProposals({
  proposals,
  busy,
  onDecision,
}: {
  proposals: Proposal[];
  busy: boolean;
  onDecision: (id: string, decision: "accepted" | "rejected") => void;
}) {
  const pending = proposals.filter((p) => p.decision === "pending").length;
  const accepted = proposals.filter((p) => p.decision === "accepted").length;
  return (
    <section
      className={`${styles.card} ${styles.creationArticleProposals}`}
      aria-label="Предложения AI по корректировке"
    >
      <h2>Предложения AI по корректировке</h2>
      <p className={styles.muted}>
        Рассмотрите каждое предложение. После последнего решения принятые
        изменения сохранятся одной версией; если отклонить всё, новой версии не
        будет.
      </p>
      <p role="status">
        Осталось: {pending} · Принято: {accepted} · Отклонено:{" "}
        {proposals.length - pending - accepted}
      </p>
      {proposals.map((p, index) => (
        <div key={p.id} className={styles.creationProposal}>
          <strong>
            Предложение {index + 1} из {proposals.length}
          </strong>
          <CreationDiff changes={[p]} />
          {p.decision === "pending" ? (
            <div className={styles.actions}>
              <button
                disabled={busy}
                className={styles.primary}
                aria-label={`Принять предложение ${index + 1}`}
                onClick={() => onDecision(p.id, "accepted")}
              >
                Принять
              </button>
              <button
                disabled={busy}
                aria-label={`Отклонить предложение ${index + 1}`}
                onClick={() => onDecision(p.id, "rejected")}
              >
                Отклонить
              </button>
            </div>
          ) : (
            <span className={styles.badge}>
              {p.decision === "accepted" ? "Принято" : "Отклонено"}
            </span>
          )}
        </div>
      ))}
    </section>
  );
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
  const requestedNumber = location.version ?? article.current_number;
  const versionKey = `${article.id}:${requestedNumber}:${article.revision}`;
  const [historical, setHistorical] = useState<{
    key: string;
    value: Version | null;
    error: string;
  } | null>(null);
  const [versionRetry, setVersionRetry] = useState(0);
  const correctionRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<ArticleSelection | null>(null);
  useEffect(() => {
    const read = () =>
      setSelection(
        articleRef.current
          ? articleSelection(articleRef.current, window.getSelection())
          : null,
      );
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);
  useEffect(() => {
    onDirtyChange(Boolean(instruction || file || voice || fragment));
    return () => onDirtyChange(false);
  }, [instruction, file, voice, fragment, onDirtyChange]);
  useEffect(() => {
    if (location.screen !== "versions") return;
    let active = true;
    creationRequest<Version>(
      `${base}/articles/${article.id}/versions/${requestedNumber}`,
    )
      .then((v) => {
        if (active) setHistorical({ key: versionKey, value: v, error: "" });
      })
      .catch((e) => {
        if (active)
          setHistorical({ key: versionKey, value: null, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [
    base,
    article.id,
    location.screen,
    requestedNumber,
    versionKey,
    versionRetry,
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
  function choose(target: string, fragment = "") {
    setTarget(target);
    setFragment(fragment);
    correctionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  const running =
    data.run?.status === "queued" || data.run?.status === "processing";
  const articleSite = details.sites.find((s) => s.id === article.site_id);
  const canUnpublishCurrentSite =
    articleSite?.canPublishDirectly ?? details.canPublishDirectly;
  const canPublishToAnySite =
    details.sites.some((site) => site.canPublishDirectly) &&
    (article.status !== "published" || canUnpublishCurrentSite);
  const publicationHref = publicationDetails({
    url: article.publication_url,
  }).href;
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
              version: null,
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
                  {[...details.versions]
                    .sort((a, b) => b.number - a.number)
                    .map((v) => (
                      <tr
                        key={v.id}
                        className={
                          v.number === requestedNumber
                            ? styles.creationSelectedVersion
                            : undefined
                        }
                      >
                        <td>
                          <button
                            className={styles.link}
                            aria-current={
                              v.number === requestedNumber ? "true" : undefined
                            }
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
          <CreationVersionPreview
            number={requestedNumber}
            version={historical?.key === versionKey ? historical.value : null}
            error={historical?.key === versionKey ? historical.error : ""}
            busy={busy}
            currentNumber={article.current_number}
            publishedNumber={article.published_number}
            hasCorrection={Boolean(details.correction)}
            siteSlug={articleSite?.slug ?? article.site_id}
            onRetry={() => {
              setHistorical(null);
              setVersionRetry((v) => v + 1);
            }}
            onRestore={setRestore}
          />
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
              Актуальная версия V{article.current_number} ·{" "}
              {articleSite?.name ?? "Площадка недоступна"}
            </p>
            <p className={styles.muted}>
              {creationDate(version.created_at)} · {version.actor_name}
            </p>
            {unpublishedChanges(article) && (
              <p className={styles.notice}>
                Есть изменения, не опубликованные на сайте. На площадке остаётся
                версия {article.published_number}.
              </p>
            )}
            <p aria-label="Рекомендация AI">
              Рекомендация AI:{" "}
              <strong>{AI_RECOMMENDATION[article.recommendation]}</strong> —{" "}
              {article.rationale}
            </p>
            <div className={styles.actions}>
              {canPublishToAnySite ? (
                <>
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setPublish(true);
                    }}
                  >
                    Отправить в публикацию
                  </button>
                  {article.status === "published" &&
                    canUnpublishCurrentSite && (
                      <button
                        disabled={busy}
                        onClick={() => setUnpublish(true)}
                      >
                        Снять с публикации
                      </button>
                    )}
                </>
              ) : (
                <p className={styles.muted}>
                  Публикацию этой версии подтверждает владелец сайта или
                  администратор Wispo.
                </p>
              )}
              {article.status === "published" && publicationHref && (
                <a
                  className={styles.download}
                  href={publicationHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть публикацию ↗
                </a>
              )}
            </div>
          </section>
          <div className={styles.creationArticleWorkspace}>
            <section
              className={`${styles.card} ${styles.creationArticleReading}`}
              ref={articleRef}
              aria-label="Актуальная статья"
            >
              <div className={styles.articleReadingTools}>
                <h2>Актуальная статья</h2>
                <p className={styles.muted}>
                  Выделите текст статьи для точечной корректировки. Инструкция
                  вводится отдельно.
                </p>
                <button
                  disabled={!selection}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (selection) choose(selection.target, selection.fragment);
                  }}
                >
                  Изменить выделенный фрагмент с помощью AI
                </button>
              </div>
              <article
                className={styles.articleProse}
                aria-label="Текст актуальной статьи"
              >
                <div
                  className={`${styles.creationElement} ${styles.articleTitle}`}
                >
                  <h2 data-ai-target="title">{version.snapshot.title}</h2>
                  <button
                    aria-label="Изменить заголовок с помощью AI"
                    title="Изменить заголовок с помощью AI"
                    onClick={() => choose("title")}
                  >
                    AI
                  </button>
                </div>
                {version.snapshot.excerpt && (
                  <div
                    className={`${styles.creationElement} ${styles.articleLead}`}
                  >
                    <p data-ai-target="excerpt">{version.snapshot.excerpt}</p>
                    <button
                      aria-label="Изменить описание с помощью AI"
                      title="Изменить описание с помощью AI"
                      onClick={() => choose("excerpt")}
                    >
                      AI
                    </button>
                  </div>
                )}
                {version.snapshot.document.blocks.map((b) => (
                  <div key={b.id} className={styles.creationElement}>
                    <div data-ai-target={`block:${b.id}`}>
                      <Block
                        block={b}
                        siteSlug={articleSite?.slug ?? article.site_id}
                      />
                    </div>
                    <button
                      aria-label={`Изменить с помощью AI: ${b.id}`}
                      title="Изменить этот блок с помощью AI"
                      onClick={() => choose(`block:${b.id}`)}
                    >
                      AI
                    </button>
                  </div>
                ))}
              </article>
            </section>
            <section
              ref={correctionRef}
              className={`${styles.card} ${styles.creationArticleCorrection}`}
              aria-label="Корректировка статьи"
            >
              <h2>Корректировка статьи</h2>
              <p className={styles.muted}>
                AI предложит изменения. Содержимое статьи останется прежним,
                пока вы не рассмотрите все предложения.
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
                <p className={styles.muted}>
                  Доступно после подключения AI API.
                </p>
              )}
              {running && (
                <p className={styles.notice} role="status">
                  Идёт обработка. Дождитесь завершения текущего запуска.
                </p>
              )}
              {details.correction && (
                <p className={styles.notice}>
                  Сначала рассмотрите все предложения ниже. Затем можно
                  отправить новую инструкцию.
                </p>
              )}
            </section>
            {details.correction && (
              <CreationProposals
                proposals={details.correction.proposals}
                busy={busy}
                onDecision={(proposalId, decision) =>
                  void act(async () => {
                    await creationRequest(
                      `${base}/articles/${article.id}/decisions`,
                      "POST",
                      {
                        revision: article.revision,
                        correctionId: details.correction!.id,
                        proposalId,
                        decision,
                      },
                    );
                  })
                }
              />
            )}
          </div>
        </>
      )}
      {publish && (
        <CreationDialog
          title="Публикация статьи"
          close={() => setPublish(false)}
          busy={busy}
        >
          <CreationPublicationForm
            details={details}
            data={data}
            busy={busy}
            error={error}
            onCancel={() => setPublish(false)}
            onPublish={(input) =>
              void act(async () => {
                await creationRequest(
                  `${base}/articles/${article.id}/publish`,
                  "POST",
                  input,
                );
                setPublish(false);
              })
            }
          />
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
