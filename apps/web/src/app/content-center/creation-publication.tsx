"use client";
import { useState } from "react";
import type { ArticleDetails, Overview } from "./creation-state";
import styles from "./content-center-view.module.css";

export function CreationPublicationTemplateField({
  canManageStructure,
  templates,
  value,
  disabled,
  onChange,
}: {
  canManageStructure: boolean;
  templates: { key: string; version: string; name: string }[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (!canManageStructure) return null;
  return (
    <label className={styles.field}>
      Шаблон статьи
      <select
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {templates.map((template) => (
          <option
            key={JSON.stringify([template.key, template.version])}
            value={JSON.stringify([template.key, template.version])}
          >
            {template.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export type PublicationInput = {
  revision: number;
  siteId: string;
  categoryId: string;
  slug: string;
  templateKey?: string;
  templateVersion?: string;
  confirmMove: boolean;
};

export function publicationFormState(
  details: ArticleDetails,
  data: Overview,
  input: PublicationInput,
) {
  const article = details.article;
  const moving = input.siteId !== article.site_id;
  const site = details.sites.find((s) => s.id === input.siteId);
  const canManageStructure = site?.canManageStructure === true;
  const categories = details.categories.filter(
    (c) => c.site_id === input.siteId,
  );
  const templates = details.templates.filter((t) => t.site_id === input.siteId);
  const occupied = data.articles.some(
    (a) =>
      a.id !== article.id &&
      a.cluster_id === article.cluster_id &&
      a.site_id === input.siteId,
  );
  let blocked = "";
  if (!details.canPublishDirectly)
    blocked = "Публикацию подтверждает владелец сайта или администратор Wispo.";
  else if (!site) blocked = "Выберите доступную площадку.";
  else if (occupied)
    blocked =
      "На этой площадке уже есть другая статья кластера. Она не будет перезаписана.";
  else if (moving && details.correction)
    blocked = "Перед переносом рассмотрите все предложения AI.";
  else if (!categories.length)
    blocked =
      "На площадке нет опубликованных разделов. Сначала опубликуйте раздел в управлении сайтом.";
  else if (!categories.some((c) => c.id === input.categoryId))
    blocked = "Выберите опубликованный раздел площадки.";
  else if (canManageStructure && !templates.length)
    blocked =
      "На площадке нет активного шаблона статьи. Настройте его в управлении сайтом.";
  else if (
    canManageStructure &&
    !templates.some(
      (t) => t.key === input.templateKey && t.version === input.templateVersion,
    )
  )
    blocked = "Выберите доступный шаблон статьи.";
  else if (
    (!article.cms_article_id || moving) &&
    (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 160)
  )
    blocked =
      "Адрес: латинские строчные буквы, цифры и дефисы, до 160 символов.";
  else if (
    (!article.cms_article_id || moving) &&
    ["404", "privacy-policy", "search"].includes(input.slug)
  )
    blocked = "Этот адрес зарезервирован. Укажите другой.";
  else if (moving && article.status === "published" && !input.confirmMove)
    blocked = "Подтвердите перенос и снятие прежней публикации.";
  return { moving, site, categories, templates, blocked, canManageStructure };
}

export function CreationPublicationForm({
  details,
  data,
  busy,
  error,
  onPublish,
  onCancel,
}: {
  details: ArticleDetails;
  data: Overview;
  busy: boolean;
  error: string;
  onPublish: (input: PublicationInput) => void;
  onCancel: () => void;
}) {
  const { article } = details;
  const [siteId, setSiteId] = useState(article.site_id);
  const [categoryId, setCategory] = useState(article.category_id ?? "");
  const [template, setTemplate] = useState("");
  const [slug, setSlug] = useState(`article-${article.id.slice(0, 8)}`);
  const [confirmMove, setConfirmMove] = useState(false);
  const templates = details.templates.filter((t) => t.site_id === siteId);
  const canManageStructure =
    details.sites.find((s) => s.id === siteId)?.canManageStructure === true;
  const selectedTemplate =
    templates.find((t) => JSON.stringify([t.key, t.version]) === template) ??
    (!template ? templates[0] : undefined);
  const input: PublicationInput = {
    revision: article.revision,
    siteId,
    categoryId,
    slug,
    confirmMove,
    ...(canManageStructure
      ? {
          templateKey: selectedTemplate?.key ?? "",
          templateVersion: selectedTemplate?.version ?? "",
        }
      : {}),
  };
  const state = publicationFormState(details, data, input);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !state.blocked) onPublish(input);
      }}
    >
      <p>
        Будет опубликована актуальная версия{" "}
        <strong>V{article.current_number}</strong>. Статьи других площадок не
        изменятся.
      </p>
      {article.status === "published" && (
        <p className={styles.notice}>
          Сейчас на сайте опубликована V{article.published_number}.
          Подтверждение заменит её актуальной версией.
        </p>
      )}
      {details.correction && (
        <p className={styles.notice}>
          Нерассмотренные предложения AI не входят в актуальную версию и не
          будут опубликованы.
        </p>
      )}
      <fieldset disabled={busy} className={styles.formFields}>
        <legend className={styles.visuallyHidden}>Параметры публикации</legend>
        <label className={styles.field}>
          Целевая площадка
          <select
            value={siteId}
            onChange={(event) => {
              setSiteId(event.target.value);
              setCategory("");
              setTemplate("");
              setConfirmMove(false);
            }}
          >
            {!details.sites.some((s) => s.id === siteId) && (
              <option value={siteId}>Площадка недоступна</option>
            )}
            {details.sites.map((s) => {
              const occupied = data.articles.some(
                (a) =>
                  a.id !== article.id &&
                  a.cluster_id === article.cluster_id &&
                  a.site_id === s.id,
              );
              return (
                <option key={s.id} value={s.id} disabled={occupied}>
                  {s.name}
                  {occupied ? " — уже есть статья кластера" : ""}
                </option>
              );
            })}
          </select>
        </label>
        {state.moving && (
          <div className={styles.notice}>
            <p>
              Статья перейдёт на выбранную площадку. Версии и история
              сохранятся. Проверьте соответствие текста правилам новой площадки.
            </p>
            {article.status === "published" && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmMove}
                  onChange={(event) => setConfirmMove(event.target.checked)}
                />{" "}
                Подтверждаю перенос: снять прежнюю публикацию и опубликовать
                актуальную версию на выбранной площадке.
              </label>
            )}
          </div>
        )}
        <label className={styles.field}>
          Раздел
          <select
            required
            value={categoryId}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Выберите опубликованный раздел</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <CreationPublicationTemplateField
          canManageStructure={canManageStructure}
          templates={templates}
          value={
            selectedTemplate
              ? JSON.stringify([selectedTemplate.key, selectedTemplate.version])
              : ""
          }
          disabled={busy}
          onChange={setTemplate}
        />
        {article.cms_article_id && !state.moving ? (
          <p className={styles.muted}>Существующий URL сохранится.</p>
        ) : (
          <label className={styles.field}>
            Адрес статьи (slug)
            <input
              required
              maxLength={160}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
        )}
        {state.blocked && (
          <p className={styles.notice} id="publication-blocked" role="status">
            {state.blocked}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={busy || Boolean(state.blocked)}
            aria-describedby={state.blocked ? "publication-blocked" : undefined}
          >
            {busy ? "Публикуем…" : "Отправить в публикацию"}
          </button>
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </fieldset>
    </form>
  );
}
