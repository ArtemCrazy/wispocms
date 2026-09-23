"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArmaturexHomeEditor } from "./armaturex-home-editor";
import {
  revisionActions,
  type ArticleRevisionCurrent as PageRevisionCurrent,
} from "./article-revision-actions";
import { parseApiBody } from "./api-response";
import type { BannerSlotDefinition } from "./banner-slot";
import { isArmaturexHomepage } from "./homepage-templates";

type BlockType = "hero" | "text" | "cta";
type PageBlock = {
  id: string;
  type: BlockType;
  title?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  mediaId?: string;
  data?: Record<string, unknown>;
};
type PageItem = {
  id: string;
  title: string;
  slug: string;
  kind: "homepage" | "page";
  status: "draft" | "published";
  blocks: PageBlock[];
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  updatedAt: string;
  systemTemplateKey: string | null;
  systemTemplateVersion: string | null;
  bannerSlots?: BannerSlotDefinition[];
  draftRevisionId?: string | null;
};
type MediaItem = { id: string; originalName: string; altText: string | null };

const blockNames: Record<BlockType, string> = {
  hero: "Первый экран",
  text: "Текстовый блок",
  cta: "Призыв к действию",
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  }
  return parseApiBody<T>(await response.text());
}

export function PagesView({
  siteId,
  siteName,
  siteSlug,
  siteType,
  mode,
  canEdit = true,
  canApprove = true,
  canEditPublished = true,
  openPageId,
  openRequestId,
  onDirtyChange,
  onPagesChange,
  hideSeo = false,
}: {
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  siteType?: "media" | "corporate" | "ecommerce" | "landing";
  mode: "homepage" | "pages";
  canEdit?: boolean;
  canApprove?: boolean;
  canEditPublished?: boolean;
  openPageId?: string;
  openRequestId?: number;
  onDirtyChange?: (dirty: boolean) => void;
  onPagesChange?: (
    pages: Array<
      Pick<
        PageItem,
        "id" | "title" | "slug" | "kind" | "status" | "bannerSlots"
      >
    >,
  ) => void;
  hideSeo?: boolean;
}) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [editor, setEditor] = useState<PageItem | null>(null);
  const [revisionCurrent, setRevisionCurrent] =
    useState<PageRevisionCurrent | null | undefined>(undefined);
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [message, setMessage] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "published"
  >("all");
  const [sortNewest, setSortNewest] = useState(true);
  const handledOpenRequest = useRef<number | undefined>(undefined);
  const openedPageId = useRef<string | null>(null);
  const isSystemPage =
    editor?.kind === "page" &&
    (editor.slug === "privacy-policy" || editor.slug === "404");
  const isVersionedPage = Boolean(
    editor &&
      (editor.kind === "homepage" ||
        (mode === "pages" && editor.kind === "page" && !isSystemPage)),
  );
  const editorCanEdit =
    canEdit &&
    (isVersionedPage || !editor || editor.status !== "published" || canEditPublished);
  const currentRevisionActions =
    isVersionedPage && revisionCurrent
      ? revisionActions(revisionCurrent, { canEdit, canApprove })
      : null;
  const isArmaturexEditor = Boolean(
    editor &&
    isArmaturexHomepage({
      key: editor.systemTemplateKey,
      version: editor.systemTemplateVersion,
    }),
  );

  const load = useCallback(async () => {
    if (!siteId) return;
    const base = `/api/sites/${siteId}/content`;
    const [pageRows, mediaRows] = await Promise.all([
      api<PageItem[]>(`${base}/pages`),
      api<MediaItem[]>(`${base}/media`),
    ]);
    setPages(pageRows);
    setMedia(mediaRows);
    onPagesChange?.(
      pageRows.map(({ id, title, slug, kind, status, bannerSlots }) => ({
        id,
        title,
        slug,
        kind,
        status,
        bannerSlots,
      })),
    );
  }, [onPagesChange, siteId]);

  const reloadRevision = useCallback(async (pageId: string) => {
    if (!siteId) return null;
    const current = (await api<PageRevisionCurrent | null>(
      `/api/sites/${siteId}/content/pages/${pageId}/revisions/current`,
    )) ?? null;
    if (openedPageId.current === pageId) setRevisionCurrent(current);
    return current;
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (
      !openPageId ||
      openRequestId === undefined ||
      handledOpenRequest.current === openRequestId
    )
      return;
    const page = pages.find((item) => item.id === openPageId);
    if (!page || page.slug === "404" || page.slug === "privacy-policy") return;
    const timer = window.setTimeout(() => {
      handledOpenRequest.current = openRequestId;
      openedPageId.current = page.id;
      setEditor(page);
      setRevisionCurrent(undefined);
      setBlocks(page.blocks);
      setDirty(false);
      setMessage("");
      if (page.kind === "homepage" || mode === "pages")
        void reloadRevision(page.id).catch((reason) =>
          setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить версию страницы"),
        );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openPageId, openRequestId, pages, reloadRevision, mode]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const modePages = useMemo(
    () =>
      pages.filter((page) =>
        mode === "homepage"
          ? page.kind === "homepage"
          : page.kind === "page" &&
            page.slug !== "404" &&
            page.slug !== "privacy-policy",
      ),
    [pages, mode],
  );
  const visiblePages = useMemo(() => {
    if (mode === "homepage") return modePages;
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    return modePages
      .filter(
        (page) =>
          (statusFilter === "all" || page.status === statusFilter) &&
          `${page.title} ${page.slug}`
            .toLocaleLowerCase("ru")
            .includes(normalizedQuery),
      )
      .sort((left, right) => {
        const difference =
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime();
        return sortNewest ? difference : -difference;
      });
  }, [mode, modePages, query, sortNewest, statusFilter]);
  const siteTypeLabel =
    siteType === "landing"
      ? "Лендинг"
      : siteType === "ecommerce"
        ? "Интернет-магазин"
        : siteType === "corporate"
          ? "Корпоративный"
          : "Медиа";

  function openEditor(page: PageItem) {
    openedPageId.current = page.id;
    setEditor(page);
    setRevisionCurrent(undefined);
    setBlocks(page.blocks);
    setDirty(false);
    setMessage("");
    if (page.kind === "homepage" || mode === "pages")
      void reloadRevision(page.id).catch((reason) =>
        setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить версию страницы"),
      );
  }

  function closeEditor() {
    if (
      dirty &&
      editorCanEdit &&
      !window.confirm("Закрыть редактор? Несохранённые изменения потеряются.")
    )
      return;
    setDirty(false);
    openedPageId.current = null;
    setRevisionCurrent(undefined);
    setEditor(null);
  }

  function updateBlock(id: string, field: keyof PageBlock, value: string) {
    setDirty(true);
    setBlocks((current) =>
      current.map((block) =>
        block.id === id ? { ...block, [field]: value || undefined } : block,
      ),
    );
  }

  function pagePayload(form: HTMLFormElement) {
    const data = new FormData(form);
    const kind = mode === "homepage" ? "homepage" : "page";
    return {
      title: data.get("title"),
      slug: kind === "homepage" ? "" : data.get("slug"),
      kind,
      status: editor?.status,
      blocks,
      seoTitle: data.get("seoTitle"),
      seoDescription: data.get("seoDescription"),
      canonicalUrl: data.get("canonicalUrl"),
      noIndex: data.get("noIndex") === "on",
      ...(isVersionedPage
        ? { expectedDraftRevisionId: revisionCurrent?.draft?.id ?? null }
        : {}),
    };
  }

  async function savePage(form: HTMLFormElement) {
    if (!siteId || !editor || !editorCanEdit) return;
    if (isVersionedPage && revisionCurrent === undefined) {
      setMessage("Подождите загрузки версии страницы.");
      return;
    }
    const payload = pagePayload(form);
    try {
      await api(`/api/sites/${siteId}/content/pages/${editor.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setDirty(false);
      openedPageId.current = null;
      setRevisionCurrent(undefined);
      setEditor(null);
      setMessage("Страница сохранена");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить страницу",
      );
    }
  }

  async function changePageRevision(
    action: "submit" | "approve" | "request-changes" | "publish",
  ) {
    if (!siteId || !editor || !isVersionedPage || !revisionCurrent) return;
    if (dirty) {
      setMessage("Сначала сохраните изменения страницы.");
      return;
    }
    let reason: string | undefined;
    if (action === "request-changes") {
      reason = window.prompt("Что нужно исправить в этой версии?")?.trim();
      if (!reason) return;
    }
    if (action === "publish" && !window.confirm("Опубликовать именно одобренную версию страницы?"))
      return;
    setStatusBusy(true);
    try {
      const openedRevisionId = revisionCurrent.draft?.id;
      const latest = (await api<PageRevisionCurrent | null>(
        `/api/sites/${siteId}/content/pages/${editor.id}/revisions/current`,
      )) ?? null;
      if (!openedRevisionId || latest?.draft?.id !== openedRevisionId) {
        setMessage("Версия страницы изменилась после открытия. Проверьте новую версию перед действием.");
        return;
      }
      const available = revisionActions(latest, { canEdit, canApprove });
      const permission = action === "request-changes" ? "requestChanges" : action;
      if (!available[permission]) {
        setMessage("Состояние версии изменилось. Обновите страницу и проверьте действия.");
        return;
      }
      await api(`/api/sites/${siteId}/content/pages/${editor.id}/revisions/${openedRevisionId}/${action}`, {
        method: "POST",
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
      });
      if (action === "publish") {
        openedPageId.current = null;
        setRevisionCurrent(undefined);
        setEditor(null);
      } else {
        await reloadRevision(editor.id);
      }
      await load();
      setMessage(
        action === "submit"
          ? "Версия страницы отправлена владельцу на проверку"
          : action === "approve"
            ? "Версия страницы одобрена"
            : action === "request-changes"
              ? "Версия страницы возвращена на доработку"
              : "Одобренная версия страницы опубликована",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить состояние версии страницы");
    } finally {
      setStatusBusy(false);
    }
  }

  async function changeStatus(
    status: PageItem["status"],
    form: HTMLFormElement | null,
  ) {
    if (!siteId || !form || !editor || !form.reportValidity()) return;
    const publishing = status === "published";
    if (
      !window.confirm(
        publishing
          ? "Сохранить изменения и опубликовать страницу?"
          : "Сохранить изменения и снять страницу с публикации?",
      )
    )
      return;
    setStatusBusy(true);
    try {
      if (editorCanEdit)
        await api(`/api/sites/${siteId}/content/pages/${editor.id}`, {
          method: "PATCH",
          body: JSON.stringify(pagePayload(form)),
        });
      const updated = await api<PageItem>(
        `/api/sites/${siteId}/content/pages/${editor.id}/status`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
      setEditor(updated);
      setDirty(false);
      setMessage(
        publishing ? "Страница опубликована" : "Страница снята с публикации",
      );
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить статус страницы",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <section className={`pages-section ${editor ? "page-editor-active" : ""}`}>
      {mode === "homepage" ? (
        <div className="homepage-template-heading">
          <h1>Шаблон главной</h1>
        </div>
      ) : (
        <div className="section-heading">
          <div>
            <h1>Страницы</h1>
            <p>Внутренние страницы сайта {siteName}</p>
          </div>
        </div>
      )}
      {message ? <div className="inline-message">{message}</div> : null}
      {mode === "pages" && modePages.length ? (
        <div className="team-toolbar pages-toolbar">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти страницу по названию или адресу"
              aria-label="Поиск страниц"
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить поиск страниц"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            ) : null}
          </label>
          <select
            aria-label="Фильтр страниц по статусу"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as "all" | "draft" | "published",
              )
            }
          >
            <option value="all">Все статусы</option>
            <option value="draft">Черновики</option>
            <option value="published">Опубликованные</option>
          </select>
          <select
            aria-label="Сортировка страниц"
            value={sortNewest ? "newest" : "oldest"}
            onChange={(event) => setSortNewest(event.target.value === "newest")}
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
          </select>
          <small>
            Показано {visiblePages.length} из {modePages.length}
          </small>
        </div>
      ) : null}
      {mode === "homepage" && visiblePages.length ? (
        <div className="homepage-template-overview">
          {visiblePages.slice(0, 1).map((page) => {
            const previewHref =
              page.status === "published"
                ? `/preview/${siteSlug}`
                : `/preview/${siteSlug}?cmsSiteId=${siteId}&cmsPageId=${page.id}`;
            return (
              <article className="homepage-template-card" key={page.id}>
                <div className="homepage-template-preview" aria-hidden="true">
                  {siteSlug ? (
                    <iframe
                      src={previewHref}
                      title={`Предпросмотр ${siteName ?? "сайта"}`}
                      tabIndex={-1}
                      loading="lazy"
                    />
                  ) : (
                    <span>Предпросмотр сайта</span>
                  )}
                </div>
                <div className="homepage-template-details">
                  <h2>Главная — {siteTypeLabel}</h2>
                  <em className={page.status}>
                    <span aria-hidden="true">✓</span>
                    {page.status === "published" ? "Активен" : "Черновик"}
                  </em>
                  <div>
                    <button type="button" onClick={() => openEditor(page)}>
                      <span aria-hidden="true">◇</span>
                      {canEdit || canApprove
                        ? "Редактировать содержимое"
                        : "Открыть содержимое"}
                    </button>
                    {siteSlug ? (
                      <a href={previewHref} target="_blank" rel="noreferrer">
                        <span aria-hidden="true">◉</span>
                        Предпросмотр
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
          <div className="homepage-template-note">
            <span aria-hidden="true">i</span>
            Здесь редактируются данные существующей главной страницы. Код и
            структура шаблона на этом этапе не изменяются.
          </div>
        </div>
      ) : visiblePages.length ? (
        <div className="pages-list">
          {visiblePages.map((page) => (
            <article key={page.id}>
              <div className="page-type">
                {page.kind === "homepage" ? "⌂" : "□"}
              </div>
              <div>
                <strong>{page.title}</strong>
                <span>{page.kind === "homepage" ? "/" : `/${page.slug}`}</span>
              </div>
              <em className={page.status}>
                {page.status === "published" ? "Опубликована" : "Черновик"}
              </em>
              <small>{page.blocks.length} блок(а)</small>
              <button onClick={() => openEditor(page)}>
                {canEdit || canApprove ? "Открыть" : "Посмотреть"}
              </button>
            </article>
          ))}
        </div>
      ) : mode === "pages" && modePages.length ? (
        <div className="pages-filter-empty">
          <span>⌕</span>
          <h2>Страницы не найдены</h2>
          <p>Измените запрос или сбросьте выбранный статус.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="empty-media">
          <span>◇</span>
          <h2>
            {mode === "homepage"
              ? "Главная ещё не настроена"
              : "Страниц пока нет"}
          </h2>
          <p>
            Структуру страниц задаёт шаблон сайта. После его подключения здесь
            появятся доступные для редактирования поля.
          </p>
        </div>
      )}

      {editor ? (
        <div className="page-editor-region">
          <div className="page-editor-shell">
            <header>
              <div>
                <small>ПОЛЯ ШАБЛОНА</small>
                <h2>{editor.title}</h2>
              </div>
              <button type="button" onClick={closeEditor}>
                ← Назад
              </button>
            </header>
            {message ? (
              <div className="inline-message page-editor-message">
                {message}
              </div>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void savePage(event.currentTarget);
              }}
              onChange={() => {
                if (editorCanEdit) setDirty(true);
              }}
            >
              <div className="page-fields">
                <label>
                  Название
                  <input
                    name="title"
                    readOnly={!editorCanEdit || isSystemPage}
                    required
                    defaultValue={editor.title}
                  />
                </label>
                {mode === "pages" ? (
                  <label>
                    Адрес страницы
                    <input
                      name="slug"
                      readOnly={!editorCanEdit || isSystemPage}
                      required
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      defaultValue={editor.slug}
                      placeholder="about-company"
                    />
                  </label>
                ) : null}
              </div>
              {!hideSeo ? (
                <details className="item-seo-editor">
                  <summary>SEO страницы</summary>
                  <p>
                    Пустые поля используют название страницы и общие настройки
                    сайта.
                  </p>
                  <div className="page-fields">
                    <label>
                      Заголовок в поиске
                      <input
                        name="seoTitle"
                        readOnly={!editorCanEdit}
                        maxLength={240}
                        defaultValue={editor.seoTitle ?? ""}
                        placeholder="До 60–70 символов"
                      />
                    </label>
                    <label>
                      Канонический адрес
                      <input
                        name="canonicalUrl"
                        readOnly={!editorCanEdit}
                        maxLength={500}
                        defaultValue={editor.canonicalUrl ?? ""}
                        placeholder="https://example.ru/page"
                      />
                    </label>
                  </div>
                  <label>
                    Описание в поиске
                    <textarea
                      name="seoDescription"
                      readOnly={!editorCanEdit}
                      rows={3}
                      maxLength={500}
                      defaultValue={editor.seoDescription ?? ""}
                      placeholder="Краткое описание страницы для поисковой выдачи"
                    />
                  </label>
                  <label className="item-seo-checkbox">
                    <input
                      type="checkbox"
                      name="noIndex"
                      disabled={!editorCanEdit}
                      defaultChecked={editor.noIndex}
                    />
                    <span>
                      Скрыть страницу от поисковых систем
                      <small>Добавляет директиву noindex, nofollow</small>
                    </span>
                  </label>
                </details>
              ) : null}
              <section className="workflow-panel">
                <header>
                  <span>ПУБЛИКАЦИЯ</span>
                  <em
                    className={
                      editor.status === "draft"
                        ? "status-draft"
                        : "status-published"
                    }
                  >
                    {editor.status === "draft" ? "Черновик" : "Опубликована"}
                  </em>
                </header>
                <p className="publication-hint">
                  {isVersionedPage
                    ? revisionCurrent === undefined
                      ? "Загружаем состояние версии страницы…"
                      : revisionCurrent?.draft
                      ? `Черновик №${revisionCurrent.draft.versionNumber} · ${revisionCurrent.reviewState}. Публичная страница не меняется до выпуска одобренной версии.`
                      : "Сохраните страницу, чтобы создать первую версию для согласования."
                    : editorCanEdit
                    ? "Перед публикацией текущие изменения сохранятся автоматически. Статус нельзя изменить случайно через обычное сохранение."
                    : "Доступные действия зависят от вашей роли в рабочем пространстве."}
                </p>
                {isVersionedPage ? (
                  <div className="workflow-actions">
                    {currentRevisionActions?.submit ? (
                      <button type="button" disabled={statusBusy || dirty} onClick={() => void changePageRevision("submit")}>
                        Отправить владельцу на проверку
                      </button>
                    ) : null}
                    {currentRevisionActions?.requestChanges ? (
                      <button type="button" className="changes" disabled={statusBusy || dirty} onClick={() => void changePageRevision("request-changes")}>
                        Вернуть на доработку
                      </button>
                    ) : null}
                    {currentRevisionActions?.approve ? (
                      <button type="button" className="publish" disabled={statusBusy || dirty} onClick={() => void changePageRevision("approve")}>
                        Одобрить версию
                      </button>
                    ) : null}
                    {currentRevisionActions?.publish ? (
                      <button type="button" className="publish" disabled={statusBusy || dirty} onClick={() => void changePageRevision("publish")}>
                        Опубликовать одобренную версию
                      </button>
                    ) : null}
                    {dirty ? <small>Сначала сохраните изменения страницы.</small> : null}
                  </div>
                ) : canApprove ? (
                  <div className="workflow-actions">
                    <button
                      type="button"
                      disabled={statusBusy}
                      className={
                        editor.status === "draft" ? "publish" : "changes"
                      }
                      onClick={(event) =>
                        void changeStatus(
                          editor.status === "draft" ? "published" : "draft",
                          event.currentTarget.form,
                        )
                      }
                    >
                      {statusBusy
                        ? "Выполняется…"
                        : editor.status === "draft"
                          ? "Опубликовать страницу"
                          : "Снять с публикации"}
                    </button>
                  </div>
                ) : null}
                {editor.status === "published" && siteSlug ? (
                  <div className="publication-meta">
                    <span>Страница доступна посетителям</span>
                    <a
                      href={
                        editor.kind === "homepage"
                          ? `/preview/${siteSlug}`
                          : `/preview/${siteSlug}/pages/${editor.slug}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Открыть страницу ↗
                    </a>
                  </div>
                ) : !isVersionedPage && siteId && siteSlug ? (
                  <div className="cms-preview-action">
                    <span>Последняя сохранённая версия</span>
                    <a
                      href={`${editor.kind === "homepage" ? `/preview/${siteSlug}` : `/preview/${siteSlug}/pages/${editor.slug}`}?cmsSiteId=${siteId}&cmsPageId=${editor.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Предпросмотр ↗
                    </a>
                  </div>
                ) : null}
                {isVersionedPage && revisionCurrent?.draft && siteId && siteSlug ? (
                  <div className="cms-preview-action">
                    <span>Сохранённая версия №{revisionCurrent.draft.versionNumber}</span>
                    <a
                      href={`${editor.kind === "homepage" ? `/preview/${siteSlug}` : `/preview/${siteSlug}/pages/${editor.slug}`}?cmsSiteId=${siteId}&cmsPageId=${editor.id}&cmsRevisionId=${revisionCurrent.draft.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Посмотреть черновик ↗
                    </a>
                  </div>
                ) : null}
              </section>
              <div className="builder-layout">
                {isArmaturexEditor ? (
                  <ArmaturexHomeEditor
                    blocks={blocks}
                    media={media}
                    disabled={!editorCanEdit}
                    onChange={(nextBlocks) => {
                      setBlocks(nextBlocks);
                      setDirty(true);
                    }}
                  />
                ) : (
                  <div className="blocks-column">
                    {blocks.map((block) => (
                      <article className="block-card" key={block.id}>
                        <header>
                          <span aria-hidden="true">◇</span>
                          <strong>{blockNames[block.type]}</strong>
                        </header>
                        <label>
                          Заголовок
                          <input
                            readOnly={!editorCanEdit}
                            value={block.title ?? ""}
                            onChange={(event) =>
                              updateBlock(block.id, "title", event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Текст
                          <textarea
                            readOnly={!editorCanEdit}
                            rows={4}
                            value={block.text ?? ""}
                            onChange={(event) =>
                              updateBlock(block.id, "text", event.target.value)
                            }
                          />
                        </label>
                        {block.type !== "text" ? (
                          <div className="block-grid">
                            <label>
                              Текст кнопки
                              <input
                                readOnly={!editorCanEdit}
                                value={block.buttonLabel ?? ""}
                                onChange={(event) =>
                                  updateBlock(
                                    block.id,
                                    "buttonLabel",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                            <label>
                              Ссылка
                              <input
                                readOnly={!editorCanEdit}
                                value={block.buttonUrl ?? ""}
                                onChange={(event) =>
                                  updateBlock(
                                    block.id,
                                    "buttonUrl",
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                        {block.type === "hero" ? (
                          <label>
                            Фоновое изображение
                            <select
                              disabled={!editorCanEdit}
                              value={block.mediaId ?? ""}
                              onChange={(event) =>
                                updateBlock(
                                  block.id,
                                  "mediaId",
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">Без изображения</option>
                              {media.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.altText || item.originalName}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
                <aside className="page-preview">
                  <span>ПРЕДПРОСМОТР</span>
                  {isArmaturexEditor && siteId && siteSlug ? (
                    <iframe
                      title="Предпросмотр шаблона Armaturex"
                      src={`/preview/${siteSlug}?cmsSiteId=${siteId}&cmsPageId=${editor.id}${revisionCurrent?.draft?.id ? `&cmsRevisionId=${revisionCurrent.draft.id}` : ""}`}
                    />
                  ) : (
                    <div>
                      {blocks.map((block) => (
                        <section
                          key={block.id}
                          className={`preview-${block.type}`}
                        >
                          {block.mediaId ? (
                            <Image
                              unoptimized
                              fill
                              sizes="420px"
                              src={`/api/sites/${siteId}/content/media/${block.mediaId}/file`}
                              alt=""
                            />
                          ) : null}
                          <div>
                            <h3>{block.title || blockNames[block.type]}</h3>
                            {block.text ? <p>{block.text}</p> : null}
                            {block.buttonLabel ? (
                              <b>{block.buttonLabel}</b>
                            ) : null}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
              <footer>
                <span className={dirty ? "unsaved-indicator" : undefined}>
                  Разделов шаблона: {blocks.length}
                  {dirty ? " · ● Не сохранено" : ""}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeEditor}
                >
                  {editorCanEdit ? "Отмена" : "Закрыть"}
                </button>
                {editorCanEdit ? (
                  <button
                    type="submit"
                    disabled={
                      statusBusy ||
                      (isVersionedPage && revisionCurrent === undefined)
                    }
                  >
                    Сохранить страницу
                  </button>
                ) : null}
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
