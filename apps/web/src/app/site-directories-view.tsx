"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { parseApiBody } from "./api-response";
import {
  ArticleRevisionCurrent,
  revisionActions,
} from "./article-revision-actions";
import {
  categoryRevisionApiBase,
  categoryRevisionPreviewPath,
} from "./category-revision-links";

type Category = {
  id: string;
  name: string;
  slug: string;
  color: string;
  parentId: string | null;
  icon: string | null;
  imageMediaId: string | null;
  imageMedia?: MediaItem | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageMediaId: string | null;
  structuredData: Record<string, unknown> | null;
  publicationState: "draft" | "published" | "hidden" | "disabled" | "archive";
  draftRevisionId?: string | null;
};

type CmsCategoryVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
  actorUserId: string | null;
};

type MediaItem = {
  id: string;
  originalName: string;
  mimeType: string;
};

type Author = {
  id: string;
  fullName: string;
  email: string | null;
  bio: string | null;
  draftRevisionId?: string | null;
};

type AuthorPreview = Author & {
  revisionId: string;
  versionNumber: number;
};

type DirectoryMode = "categories" | "authors";

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

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function SiteDirectoryView({
  siteId,
  siteName,
  siteSlug,
  mode,
  canEdit = true,
  canApprove = true,
  focusId,
  focusRequestId,
}: {
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  mode: DirectoryMode;
  canEdit?: boolean;
  canApprove?: boolean;
  focusId?: string;
  focusRequestId?: number;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [revisionCurrent, setRevisionCurrent] = useState<
    ArticleRevisionCurrent | null | undefined
  >(undefined);
  const [categoryVersions, setCategoryVersions] = useState<
    CmsCategoryVersion[]
  >([]);
  const [authorRevisionCurrent, setAuthorRevisionCurrent] = useState<
    ArticleRevisionCurrent | null | undefined
  >(undefined);
  const [authorVersions, setAuthorVersions] = useState<CmsCategoryVersion[]>([]);
  const [authorPreview, setAuthorPreview] = useState<AuthorPreview | null>(null);
  const currentRevisionActions = revisionCurrent
    ? revisionActions(revisionCurrent, { canEdit, canApprove })
    : null;
  const currentAuthorRevisionActions = authorRevisionCurrent
    ? revisionActions(authorRevisionCurrent, { canEdit, canApprove })
    : null;

  const reloadCategoryRevision = useCallback(
    async (categoryId: string) => {
      if (!siteId) return null;
      const base = categoryRevisionApiBase(siteId, categoryId);
      const current =
        (await api<ArticleRevisionCurrent | null>(`${base}/current`)) ?? null;
      const versions = current ? await api<CmsCategoryVersion[]>(base) : [];
      setRevisionCurrent(current);
      setCategoryVersions(versions);
      return current;
    },
    [siteId],
  );

  const reloadAuthorRevision = useCallback(
    async (authorId: string) => {
      if (!siteId) return null;
      const base = `/api/sites/${encodeURIComponent(siteId)}/content/authors/${encodeURIComponent(authorId)}/revisions`;
      const current =
        (await api<ArticleRevisionCurrent | null>(`${base}/current`)) ?? null;
      const versions = current ? await api<CmsCategoryVersion[]>(base) : [];
      setAuthorRevisionCurrent(current);
      setAuthorVersions(versions);
      setAuthorPreview(null);
      return current;
    },
    [siteId],
  );

  const load = useCallback(async () => {
    if (!siteId) return;
    if (mode === "categories") {
      const [nextCategories, nextMedia] = await Promise.all([
        api<Category[]>(`/api/sites/${siteId}/content/categories`),
        api<MediaItem[]>(`/api/sites/${siteId}/content/media`),
      ]);
      setCategories(nextCategories);
      setMedia(nextMedia.filter((item) => item.mimeType.startsWith("image/")));
    } else {
      setAuthors(await api(`/api/sites/${siteId}/content/authors`));
    }
  }, [siteId, mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCreating(false);
      setEditingId(null);
      setNewParentId(null);
      setRevisionCurrent(undefined);
      setCategoryVersions([]);
      setAuthorRevisionCurrent(undefined);
      setAuthorVersions([]);
      setAuthorPreview(null);
      setQuery("");
      void load().catch((error) => setMessage(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!focusId || focusRequestId === undefined) return;
    const exists =
      mode === "categories"
        ? categories.some((item) => item.id === focusId)
        : authors.some((item) => item.id === focusId);
    if (!exists) return;
    const timer = window.setTimeout(() => {
      setQuery("");
      setFocusedId(focusId);
      document
        .getElementById(`directory-${focusId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authors, categories, focusId, focusRequestId, mode]);

  async function openCategoryEditor(categoryId: string) {
    setEditingId(categoryId);
    setCreating(false);
    setNewParentId(null);
    setMessage("");
    setRevisionCurrent(undefined);
    setCategoryVersions([]);
    setBusy(true);
    try {
      await reloadCategoryRevision(categoryId);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось открыть рубрику",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openAuthorEditor(authorId: string) {
    setEditingId(authorId);
    setCreating(false);
    setMessage("");
    setAuthorRevisionCurrent(undefined);
    setAuthorVersions([]);
    setAuthorPreview(null);
    setBusy(true);
    try {
      await reloadAuthorRevision(authorId);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось открыть автора",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>, itemId?: string) {
    event.preventDefault();
    if (!siteId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const structuredDataSource = String(
      data.get("structuredData") ?? "",
    ).trim();
    let structuredData: Record<string, unknown> | null = null;
    try {
      structuredData = structuredDataSource
        ? JSON.parse(structuredDataSource)
        : null;
    } catch {
      setMessage("Проверьте JSON структурированных данных рубрики");
      return;
    }
    const payload =
      mode === "categories"
        ? {
            name: String(data.get("name") ?? ""),
            slug: String(data.get("slug") ?? ""),
            color: String(data.get("color") ?? "#9f91ef"),
            parentId: String(data.get("parentId") ?? "") || null,
            icon: String(data.get("icon") ?? "").trim() || null,
            imageMediaId: String(data.get("imageMediaId") ?? "") || null,
            seoTitle: String(data.get("seoTitle") ?? "").trim() || null,
            seoDescription:
              String(data.get("seoDescription") ?? "").trim() || null,
            canonicalUrl: String(data.get("canonicalUrl") ?? "").trim() || null,
            noIndex: data.get("noIndex") === "on",
            ogTitle: String(data.get("ogTitle") ?? "").trim() || null,
            ogDescription:
              String(data.get("ogDescription") ?? "").trim() || null,
            ogImageMediaId: String(data.get("ogImageMediaId") ?? "") || null,
            structuredData,
            ...(itemId
              ? {
                  expectedDraftRevisionId:
                    revisionCurrent?.draft?.id ?? null,
                }
              : {}),
          }
        : {
            fullName: String(data.get("fullName") ?? ""),
            email: String(data.get("email") ?? "").trim() || null,
            bio: String(data.get("bio") ?? "").trim() || null,
            ...(itemId
              ? {
                  expectedDraftRevisionId:
                    authorRevisionCurrent?.draft?.id ?? null,
                }
              : {}),
          };
    setBusy(true);
    setMessage("");
    try {
      const saved = await api<Category | Author>(
        `/api/sites/${siteId}/content/${mode}${itemId ? `/${itemId}` : ""}`,
        {
          method: itemId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setCreating(false);
      setNewParentId(null);
      if (mode === "categories") {
        const category = saved as Category;
        setEditingId(category.id);
        await reloadCategoryRevision(category.id);
      } else {
        const author = saved as Author;
        setEditingId(author.id);
        await reloadAuthorRevision(author.id);
      }
      setMessage(
        mode === "categories"
          ? itemId
            ? "Новая версия рубрики сохранена"
            : "Рубрика создана как черновик"
          : itemId
            ? "Новая версия автора сохранена"
            : "Автор создан как черновик",
      );
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeCategoryRevision(
    action: "submit" | "approve" | "request-changes" | "publish",
  ) {
    if (!siteId || !editingId || !revisionCurrent?.draft) return;
    let reason: string | undefined;
    if (action === "request-changes") {
      reason = window.prompt("Что нужно исправить в этой версии?")?.trim();
      if (!reason) return;
    }
    if (
      action === "publish" &&
      !window.confirm(
        "Опубликовать именно одобренную версию рубрики? Изменения станут видны посетителям сайта.",
      )
    )
      return;
    setBusy(true);
    try {
      const base = categoryRevisionApiBase(siteId, editingId);
      const openedRevisionId = revisionCurrent.draft.id;
      const latest =
        (await api<ArticleRevisionCurrent | null>(`${base}/current`)) ?? null;
      if (latest?.draft?.id !== openedRevisionId) {
        setMessage(
          "Версия рубрики изменилась после открытия. Проверьте новую версию перед действием.",
        );
        return;
      }
      const available = revisionActions(latest, { canEdit, canApprove });
      const permission =
        action === "request-changes" ? "requestChanges" : action;
      if (!available[permission]) {
        setMessage(
          "Состояние версии изменилось. Обновите рубрику и проверьте действия.",
        );
        return;
      }
      await api(
        `${base}/${encodeURIComponent(openedRevisionId)}/${action}`,
        {
          method: "POST",
          ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        },
      );
      await Promise.all([reloadCategoryRevision(editingId), load()]);
      setMessage(
        action === "submit"
          ? "Версия рубрики отправлена владельцу сайта на проверку"
          : action === "approve"
            ? "Версия рубрики одобрена. Теперь её можно опубликовать"
            : action === "request-changes"
              ? "Версия рубрики возвращена на доработку"
              : "Одобренная версия рубрики опубликована",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить состояние версии рубрики",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreCategoryRevision(version: CmsCategoryVersion) {
    if (!siteId || !editingId || !revisionCurrent?.draft) return;
    if (
      !window.confirm(
        `Восстановить версию ${version.versionNumber} как новый черновик?`,
      )
    )
      return;
    setBusy(true);
    try {
      const base = categoryRevisionApiBase(siteId, editingId);
      await api(`${base}/${encodeURIComponent(version.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({
          expectedDraftRevisionId: revisionCurrent.draft.id,
        }),
      });
      await Promise.all([reloadCategoryRevision(editingId), load()]);
      setMessage("Выбранная версия восстановлена как новый черновик");
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось восстановить версию рубрики",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeAuthorRevision(
    action: "submit" | "approve" | "request-changes" | "publish",
  ) {
    if (!siteId || !editingId || !authorRevisionCurrent?.draft) return;
    let reason: string | undefined;
    if (action === "request-changes") {
      reason = window.prompt("Что нужно исправить в этой версии?")?.trim();
      if (!reason) return;
    }
    if (
      action === "publish" &&
      !window.confirm(
        "Опубликовать именно одобренную версию автора? Изменения появятся в опубликованных материалах.",
      )
    )
      return;
    setBusy(true);
    try {
      const base = `/api/sites/${encodeURIComponent(siteId)}/content/authors/${encodeURIComponent(editingId)}/revisions`;
      const openedRevisionId = authorRevisionCurrent.draft.id;
      const latest =
        (await api<ArticleRevisionCurrent | null>(`${base}/current`)) ?? null;
      if (latest?.draft?.id !== openedRevisionId) {
        setMessage(
          "Версия автора изменилась после открытия. Проверьте новую версию перед действием.",
        );
        return;
      }
      const available = revisionActions(latest, { canEdit, canApprove });
      const permission =
        action === "request-changes" ? "requestChanges" : action;
      if (!available[permission]) {
        setMessage(
          "Состояние версии изменилось. Обновите автора и проверьте действия.",
        );
        return;
      }
      await api(
        `${base}/${encodeURIComponent(openedRevisionId)}/${action}`,
        {
          method: "POST",
          ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        },
      );
      await Promise.all([reloadAuthorRevision(editingId), load()]);
      setMessage(
        action === "submit"
          ? "Версия автора отправлена владельцу сайта на проверку"
          : action === "approve"
            ? "Версия автора одобрена. Теперь её можно опубликовать"
            : action === "request-changes"
              ? "Версия автора возвращена на доработку"
              : "Одобренная версия автора опубликована",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить состояние версии автора",
      );
    } finally {
      setBusy(false);
    }
  }

  async function previewAuthorRevision() {
    if (!siteId || !editingId || !authorRevisionCurrent?.draft) return;
    setBusy(true);
    try {
      const base = `/api/sites/${encodeURIComponent(siteId)}/content/authors/${encodeURIComponent(editingId)}/revisions`;
      const preview = await api<AuthorPreview>(
        `${base}/${encodeURIComponent(authorRevisionCurrent.draft.id)}/preview`,
      );
      setAuthorPreview(preview);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось открыть версию автора",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreAuthorRevision(version: CmsCategoryVersion) {
    if (!siteId || !editingId || !authorRevisionCurrent?.draft) return;
    if (
      !window.confirm(
        `Восстановить версию ${version.versionNumber} как новый черновик?`,
      )
    )
      return;
    setBusy(true);
    try {
      const base = `/api/sites/${encodeURIComponent(siteId)}/content/authors/${encodeURIComponent(editingId)}/revisions`;
      await api(`${base}/${encodeURIComponent(version.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({
          expectedDraftRevisionId: authorRevisionCurrent.draft.id,
        }),
      });
      await Promise.all([reloadAuthorRevision(editingId), load()]);
      setMessage("Выбранная версия автора восстановлена как новый черновик");
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось восстановить версию автора",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Category | Author) {
    if (!siteId) return;
    const label = "name" in item ? item.name : item.fullName;
    const entity = mode === "categories" ? "рубрику" : "автора";
    if (!window.confirm(`Удалить ${entity} «${label}»?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/sites/${siteId}/content/${mode}/${item.id}`, {
        method: "DELETE",
      });
      setMessage(mode === "categories" ? "Рубрика удалена" : "Автор удалён");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось удалить",
      );
    } finally {
      setBusy(false);
    }
  }

  const isCategories = mode === "categories";
  const count = isCategories ? categories.length : authors.length;
  const normalizedQuery = query.trim().toLowerCase();
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const includedCategoryIds = new Set<string>();
  if (normalizedQuery) {
    categories.forEach((category) => {
      if (
        `${category.name} ${category.slug} ${category.seoTitle ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        includedCategoryIds.add(category.id);
        let parentId = category.parentId;
        while (parentId && !includedCategoryIds.has(parentId)) {
          includedCategoryIds.add(parentId);
          parentId = categoryById.get(parentId)?.parentId ?? null;
        }
      }
    });
  }
  const categoryChildren = new Map<string | null, Category[]>();
  categories.forEach((category) => {
    const parentId = categoryById.has(category.parentId ?? "")
      ? category.parentId
      : null;
    categoryChildren.set(parentId, [
      ...(categoryChildren.get(parentId) ?? []),
      category,
    ]);
  });
  categoryChildren.forEach((items) =>
    items.sort((left, right) => left.name.localeCompare(right.name, "ru")),
  );
  const visibleCategories: Array<{
    category: Category;
    depth: number;
    hasChildren: boolean;
  }> = [];
  const addCategoryRows = (
    parentId: string | null,
    depth: number,
    visited: Set<string>,
  ) => {
    (categoryChildren.get(parentId) ?? []).forEach((category) => {
      if (visited.has(category.id)) return;
      const nextVisited = new Set(visited).add(category.id);
      const hasChildren = (categoryChildren.get(category.id)?.length ?? 0) > 0;
      if (!normalizedQuery || includedCategoryIds.has(category.id)) {
        visibleCategories.push({ category, depth, hasChildren });
      }
      if (normalizedQuery || !collapsedIds.has(category.id)) {
        addCategoryRows(category.id, depth + 1, nextVisited);
      }
    });
  };
  addCategoryRows(null, 0, new Set());
  const visibleAuthors = authors
    .filter((author) =>
      `${author.fullName} ${author.email ?? ""} ${author.bio ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    )
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "ru"));
  const visibleCount = isCategories
    ? normalizedQuery
      ? categories.filter((category) =>
          `${category.name} ${category.slug} ${category.seoTitle ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery),
        ).length
      : categories.length
    : visibleAuthors.length;

  const categoryForm = (category?: Category) =>
    category && revisionCurrent === undefined ? (
      <p role="status">Загружаем актуальную версию рубрики…</p>
    ) : (
      <form
      key={`${category?.id ?? "new"}-${revisionCurrent?.draft?.id ?? "base"}`}
      className="directory-form category-settings-form"
      onSubmit={(event) => save(event, category?.id)}
    >
      <label>
        <span>Название</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="Название рубрики"
          defaultValue={category?.name}
        />
      </label>
      <label>
        <span>Адрес рубрики</span>
        <input
          name="slug"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          placeholder="slug-latin"
          defaultValue={category?.slug}
        />
      </label>
      <label>
        <span>Родительская рубрика</span>
        <select
          name="parentId"
          defaultValue={category?.parentId ?? newParentId ?? ""}
        >
          <option value="">Верхний уровень</option>
          {categories
            .filter((item) => item.id !== category?.id)
            .sort((left, right) => left.name.localeCompare(right.name, "ru"))
            .map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <div className="category-visual-fields">
        <label>
          <span>Иконка</span>
          <input
            name="icon"
            maxLength={80}
            placeholder="Например, 📰"
            defaultValue={category?.icon ?? ""}
          />
        </label>
        <label className="directory-color-field">
          <span>Цвет</span>
          <input
            name="color"
            type="color"
            defaultValue={category?.color ?? "#9f91ef"}
          />
        </label>
      </div>
      <label>
        <span>Изображение рубрики</span>
        <select name="imageMediaId" defaultValue={category?.imageMediaId ?? ""}>
          <option value="">Не выбрано</option>
          {media.map((item) => (
            <option value={item.id} key={item.id}>
              {item.originalName}
            </option>
          ))}
        </select>
      </label>
      <div className="category-form-divider">
        <strong>SEO</strong>
        <span>Настройки страницы этой рубрики</span>
      </div>
      <label>
        <span>SEO-заголовок</span>
        <input
          name="seoTitle"
          maxLength={240}
          placeholder="Если пусто, используется название"
          defaultValue={category?.seoTitle ?? ""}
        />
      </label>
      <label>
        <span>SEO-описание</span>
        <textarea
          name="seoDescription"
          maxLength={500}
          rows={4}
          placeholder="Краткое описание рубрики для поисковых систем"
          defaultValue={category?.seoDescription ?? ""}
        />
      </label>
      <label>
        <span>Канонический адрес</span>
        <input
          name="canonicalUrl"
          type="url"
          maxLength={500}
          placeholder="https://example.ru/articles/news"
          defaultValue={category?.canonicalUrl ?? ""}
        />
      </label>
      <label>
        <span>OG-заголовок</span>
        <input
          name="ogTitle"
          maxLength={240}
          defaultValue={category?.ogTitle ?? ""}
        />
      </label>
      <label>
        <span>OG-описание</span>
        <textarea
          name="ogDescription"
          maxLength={500}
          rows={3}
          defaultValue={category?.ogDescription ?? ""}
        />
      </label>
      <label>
        <span>OG-изображение</span>
        <select
          name="ogImageMediaId"
          defaultValue={category?.ogImageMediaId ?? ""}
        >
          <option value="">Не выбрано</option>
          {media.map((item) => (
            <option value={item.id} key={item.id}>
              {item.originalName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Структурированные данные (JSON)</span>
        <textarea
          name="structuredData"
          rows={6}
          defaultValue={
            category?.structuredData
              ? JSON.stringify(category.structuredData, null, 2)
              : ""
          }
        />
      </label>
      <label className="category-checkbox">
        <input
          name="noIndex"
          type="checkbox"
          defaultChecked={category?.noIndex}
        />
        <span>Запретить индексацию этой рубрики</span>
      </label>
      {category ? (
        <section className="workflow-panel">
          <strong>
            Версия рубрики{" "}
            {revisionCurrent?.draft
              ? `№${revisionCurrent.draft.versionNumber}`
              : "не создана"}
          </strong>
          <p className="publication-hint">
            {revisionCurrent === undefined
              ? "Загружаем состояние версии рубрики…"
              : revisionCurrent?.draft
                ? `Состояние: ${revisionCurrent.reviewState}. Публичная рубрика не меняется до выпуска одобренной версии.`
                : "Сохраните рубрику, чтобы создать первую версию для согласования."}
          </p>
          <div className="workflow-actions">
            {currentRevisionActions?.submit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeCategoryRevision("submit")}
              >
                Отправить владельцу на проверку
              </button>
            ) : null}
            {currentRevisionActions?.requestChanges ? (
              <button
                type="button"
                className="changes"
                disabled={busy}
                onClick={() => void changeCategoryRevision("request-changes")}
              >
                Вернуть на доработку
              </button>
            ) : null}
            {currentRevisionActions?.approve ? (
              <button
                type="button"
                className="publish"
                disabled={busy}
                onClick={() => void changeCategoryRevision("approve")}
              >
                Одобрить версию
              </button>
            ) : null}
            {currentRevisionActions?.publish ? (
              <button
                type="button"
                className="publish"
                disabled={busy}
                onClick={() => void changeCategoryRevision("publish")}
              >
                Опубликовать одобренную версию
              </button>
            ) : null}
          </div>
          {revisionCurrent?.draft && siteId && siteSlug ? (
            <a
              href={categoryRevisionPreviewPath({
                siteSlug,
                siteId,
                categoryId: category.id,
                categorySlug: category.slug,
                revisionId: revisionCurrent.draft.id,
              })}
              target="_blank"
              rel="noreferrer"
            >
              Посмотреть выбранную версию ↗
            </a>
          ) : null}
          {categoryVersions.length ? (
            <div className="activity-list">
              {categoryVersions.map((version) => (
                <article key={version.id}>
                  <div>
                    <strong>Версия №{version.versionNumber}</strong>
                    <small>
                      {new Intl.DateTimeFormat("ru", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(version.createdAt))}
                    </small>
                  </div>
                  {canEdit && version.id !== revisionCurrent?.draft?.id ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreCategoryRevision(version)}
                    >
                      Восстановить как черновик
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <p>Новая рубрика будет создана как черновик.</p>
      )}
      <div className="directory-form-actions">
        <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setCreating(false);
            setEditingId(null);
            setNewParentId(null);
          }}
        >
          Отмена
        </button>
      </div>
      </form>
    );

  const authorForm = (author?: Author) =>
    author && authorRevisionCurrent === undefined ? (
      <p role="status">Загружаем актуальную версию автора…</p>
    ) : (
    <form
      key={`${author?.id ?? "new"}-${authorRevisionCurrent?.draft?.id ?? "base"}`}
      className="directory-form directory-edit-form author-edit-form"
      onSubmit={(event) => save(event, author?.id)}
    >
      <div className="author-fields">
        <label>
          <span>Имя и фамилия</span>
          <input
            name="fullName"
            required
            minLength={2}
            maxLength={160}
            placeholder="Имя и фамилия"
            defaultValue={author?.fullName}
          />
        </label>
        <label>
          <span>Почта</span>
          <input
            name="email"
            type="email"
            maxLength={255}
            placeholder="author@example.ru"
            defaultValue={author?.email ?? ""}
          />
        </label>
        <label>
          <span>Описание</span>
          <input
            name="bio"
            maxLength={500}
            placeholder="Короткое описание"
            defaultValue={author?.bio ?? ""}
          />
        </label>
        <div className="directory-form-actions">
          <button disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setCreating(false);
              setEditingId(null);
              setAuthorRevisionCurrent(undefined);
              setAuthorVersions([]);
              setAuthorPreview(null);
            }}
          >
            Отмена
          </button>
        </div>
      </div>
      {author ? (
        <section className="workflow-panel">
          <strong>
            Версия автора{" "}
            {authorRevisionCurrent?.draft
              ? `№${authorRevisionCurrent.draft.versionNumber}`
              : "не создана"}
          </strong>
          <p className="publication-hint">
            {authorRevisionCurrent?.draft
              ? `Состояние: ${authorRevisionCurrent.reviewState}. Опубликованные материалы не меняются до выпуска одобренной версии.`
              : "Сохраните автора, чтобы создать первую версию для согласования."}
          </p>
          <div className="workflow-actions">
            {currentAuthorRevisionActions?.submit ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeAuthorRevision("submit")}
              >
                Отправить владельцу на проверку
              </button>
            ) : null}
            {currentAuthorRevisionActions?.requestChanges ? (
              <button
                type="button"
                className="changes"
                disabled={busy}
                onClick={() => void changeAuthorRevision("request-changes")}
              >
                Вернуть на доработку
              </button>
            ) : null}
            {currentAuthorRevisionActions?.approve ? (
              <button
                type="button"
                className="publish"
                disabled={busy}
                onClick={() => void changeAuthorRevision("approve")}
              >
                Одобрить версию
              </button>
            ) : null}
            {currentAuthorRevisionActions?.publish ? (
              <button
                type="button"
                className="publish"
                disabled={busy}
                onClick={() => void changeAuthorRevision("publish")}
              >
                Опубликовать одобренную версию
              </button>
            ) : null}
          </div>
          {authorRevisionCurrent?.draft ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void previewAuthorRevision()}
            >
              Просмотреть выбранную версию
            </button>
          ) : null}
          {authorPreview ? (
            <article
              className="author-revision-preview"
              role="region"
              aria-label="Предпросмотр автора"
            >
              <strong>{authorPreview.fullName}</strong>
              <small>{authorPreview.email ?? "Почта не указана"}</small>
              <p>{authorPreview.bio ?? "Описание не добавлено"}</p>
              <small>Версия №{authorPreview.versionNumber}</small>
            </article>
          ) : null}
          {authorVersions.length ? (
            <div className="activity-list">
              {authorVersions.map((version) => (
                <article key={version.id}>
                  <div>
                    <strong>Версия №{version.versionNumber}</strong>
                    <small>
                      {new Intl.DateTimeFormat("ru", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(version.createdAt))}
                    </small>
                  </div>
                  {canEdit &&
                  version.id !== authorRevisionCurrent?.draft?.id ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreAuthorRevision(version)}
                    >
                      Восстановить как черновик
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <p>Новый автор будет создан как черновик.</p>
      )}
    </form>
    );

  return (
    <section className="directory-section">
      <div className="section-heading">
        <div>
          <h1>{isCategories ? "Рубрики" : "Авторы"}</h1>
          <p>
            {isCategories
              ? `Разделы публикаций сайта ${siteName}`
              : `Редакционная команда сайта ${siteName}`}
          </p>
        </div>
        {canEdit ? (
          <button
            className="primary-button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
              setNewParentId(null);
              setRevisionCurrent(undefined);
              setCategoryVersions([]);
              setAuthorRevisionCurrent(undefined);
              setAuthorVersions([]);
              setAuthorPreview(null);
              setMessage("");
            }}
          >
            <span>＋</span>
            {isCategories ? "Добавить рубрику" : "Добавить автора"}
          </button>
        ) : null}
      </div>

      <div className="directory-summary">
        <span>{count}</span>
        {isCategories ? "рубрик на сайте" : "авторов на сайте"}
      </div>
      {count ? (
        <div className="directory-toolbar">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isCategories
                  ? "Найти рубрику по названию или адресу"
                  : "Найти автора по имени, почте или описанию"
              }
              aria-label={isCategories ? "Поиск рубрик" : "Поиск авторов"}
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            ) : null}
          </label>
          <small>
            Показано {visibleCount} из {count}
          </small>
        </div>
      ) : null}
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      {creating && !isCategories ? authorForm() : null}

      {isCategories ? (
        <div className="category-tree">
          {visibleCategories.map(({ category, depth, hasChildren }) => (
            <article
              className={focusedId === category.id ? "focused" : undefined}
              id={`directory-${category.id}`}
              key={category.id}
              style={{ paddingLeft: `${12 + depth * 24}px` }}
            >
              <button
                type="button"
                className="category-tree-toggle"
                disabled={!hasChildren}
                aria-label={
                  collapsedIds.has(category.id)
                    ? `Раскрыть рубрику ${category.name}`
                    : `Свернуть рубрику ${category.name}`
                }
                onClick={() =>
                  setCollapsedIds((current) => {
                    const next = new Set(current);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    return next;
                  })
                }
              >
                {hasChildren ? (collapsedIds.has(category.id) ? "›" : "⌄") : ""}
              </button>
              <span
                className="category-tree-icon"
                style={{ background: category.color }}
              >
                {category.icon || "#"}
              </span>
              <div className="category-tree-copy">
                <strong>{category.name}</strong>
                <small>/{category.slug}</small>
              </div>
              {canEdit ? (
                <div className="directory-actions">
                  <button
                    aria-label={`Добавить дочернюю рубрику в ${category.name}`}
                    title="Добавить дочернюю рубрику"
                    onClick={() => {
                      setCreating(true);
                      setEditingId(null);
                      setNewParentId(category.id);
                      setRevisionCurrent(undefined);
                      setCategoryVersions([]);
                      setMessage("");
                    }}
                  >
                    ＋
                  </button>
                  <button
                    aria-label={`Настроить рубрику ${category.name}`}
                    title="Настройки рубрики"
                    onClick={() => {
                      void openCategoryEditor(category.id);
                    }}
                  >
                    ⚙
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {!visibleCategories.length ? (
            <div className="directory-empty">
              {categories.length
                ? "По вашему запросу рубрики не найдены"
                : "Рубрики пока не добавлены"}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="authors-grid">
          {visibleAuthors.map((author) =>
            editingId === author.id ? (
              <div
                className="directory-edit-card"
                id={`directory-${author.id}`}
                key={author.id}
              >
                {authorForm(author)}
              </div>
            ) : (
              <article
                className={focusedId === author.id ? "focused" : undefined}
                id={`directory-${author.id}`}
                key={author.id}
              >
                <i>{initials(author.fullName)}</i>
                <div>
                  <strong>{author.fullName}</strong>
                  <small>{author.email ?? "Почта не указана"}</small>
                  <p>{author.bio ?? "Описание пока не добавлено"}</p>
                </div>
                {canEdit || canApprove ? (
                  <div className="directory-actions">
                    {canEdit ? (
                      <button
                        aria-label={`Редактировать автора ${author.fullName}`}
                        onClick={() => void openAuthorEditor(author.id)}
                      >
                        ✎
                      </button>
                    ) : null}
                    {canApprove ? (
                      <button
                        className="danger"
                        disabled={busy}
                        aria-label={`Удалить автора ${author.fullName}`}
                        onClick={() => void remove(author)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ),
          )}
          {!visibleAuthors.length ? (
            <div className="directory-empty">
              {authors.length
                ? "По вашему запросу авторы не найдены"
                : "Авторы пока не добавлены"}
            </div>
          ) : null}
        </div>
      )}
      {isCategories && (creating || editingId) ? (
        <>
          <button
            type="button"
            className="category-panel-scrim"
            aria-label="Закрыть настройки рубрики"
            onClick={() => {
              setCreating(false);
              setEditingId(null);
              setNewParentId(null);
            }}
          />
          <aside
            className="category-settings-panel"
            aria-label="Настройки рубрики"
          >
            <header>
              <div>
                <strong>
                  {editingId ? "Настройки рубрики" : "Новая рубрика"}
                </strong>
                <span>
                  {editingId
                    ? "Структура, адрес, оформление и SEO"
                    : newParentId
                      ? `Внутри «${categoryById.get(newParentId)?.name ?? "рубрики"}»`
                      : "На верхнем уровне структуры"}
                </span>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => {
                  setCreating(false);
                  setEditingId(null);
                  setNewParentId(null);
                }}
              >
                ×
              </button>
            </header>
            {categoryForm(
              editingId
                ? categories.find((category) => category.id === editingId)
                : undefined,
            )}
          </aside>
        </>
      ) : null}
    </section>
  );
}
