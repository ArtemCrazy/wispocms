"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  ArticleDocument,
  documentText,
  legacyDocument,
  StructuredArticleEditor,
} from "./structured-article-editor";

type RedirectAlias = { id: string; fromSlug: string; createdAt: string };

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "hidden" | "draft";
  publicationState: PublicationState;
  publishedAt: string | null;
  sortOrder: number;
  color: string;
  parentId: string | null;
  icon: string | null;
  imageMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageMediaId: string | null;
  structuredData: Record<string, unknown> | null;
  displayTemplateKey: string;
  displayTemplateVersion: string;
  displayTemplateConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string } | null;
  updatedBy: { id: string; fullName: string } | null;
  articleCount: number;
  childCount: number;
  redirects: RedirectAlias[];
};
type Author = { id: string; fullName: string; email: string | null };
type MediaItem = {
  id: string;
  originalName: string;
  altText: string | null;
  mimeType: string;
};
type ArticleStatus =
  "draft" | "review" | "changes_requested" | "published" | "hidden";
type PublicationState =
  "draft" | "published" | "hidden" | "disabled" | "archive";
type EditorialState = "draft" | "review" | "changes" | "approved";
type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  bodyDocument: ArticleDocument | null;
  documentVersion: number;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageMediaId: string | null;
  structuredData: Record<string, unknown> | null;
  status: ArticleStatus;
  publicationState: PublicationState;
  editorialState: EditorialState;
  displayTemplateKey: string;
  displayTemplateVersion: string;
  displayTemplateConfig: Record<string, unknown>;
  publishedAt: string | null;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string } | null;
  updatedBy: { id: string; fullName: string } | null;
  category: Category | null;
  author: Author | null;
  categoryId: string | null;
  authorId: string | null;
  coverMediaId: string | null;
  coverMedia: MediaItem | null;
  previewMediaId: string | null;
  previewMedia: MediaItem | null;
};
type EditorTab = "editor" | "parameters" | "seo" | "history";
type ArticleFilter =
  "all" | `publication:${PublicationState}` | `editorial:${EditorialState}`;
type AutosaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";
type Activity = {
  id: string;
  type: "updated" | "comment" | "status_changed";
  message: string | null;
  fromStatus: ArticleStatus | null;
  toStatus: ArticleStatus | null;
  createdAt: string;
  user: { id: string; fullName: string };
};
type ContentEvent = {
  id: string;
  eventType: string;
  reason: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
};
type ArticleVersion = {
  id: string;
  versionNumber: number;
  reason: string;
  createdAt: string;
  actor: { fullName: string } | null;
};
type PendingSchedule = {
  id: string;
  targetPublicationState: PublicationState;
  executeAt: string;
};
type ContentTemplate = {
  id: string;
  key: string;
  version: string;
  kind: "articles_list" | "article" | "category";
  name: string;
};

const statusNames: Record<ArticleStatus, string> = {
  draft: "Черновик",
  review: "На согласовании",
  changes_requested: "Нужны правки",
  published: "Опубликовано",
  hidden: "Скрыто",
};
const publicationNames: Record<PublicationState, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  hidden: "Скрыто из списков",
  disabled: "Отключено",
  archive: "Архив",
};
const editorialNames: Record<EditorialState, string> = {
  draft: "Черновик",
  review: "На согласовании",
  changes: "Нужны правки",
  approved: "Одобрено",
};

function matchesArticleFilter(article: Article, filter: ArticleFilter) {
  if (filter === "all") return true;
  const [kind, state] = filter.split(":");
  return kind === "publication"
    ? article.publicationState === state
    : article.editorialState === state;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new RequestError(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
      response.status,
    );
  }
  return response.json();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё\s-]/gi, "")
    .replace(
      /[а-яё]/gi,
      (letter) =>
        (
          ({
            а: "a",
            б: "b",
            в: "v",
            г: "g",
            д: "d",
            е: "e",
            ё: "e",
            ж: "zh",
            з: "z",
            и: "i",
            й: "y",
            к: "k",
            л: "l",
            м: "m",
            н: "n",
            о: "o",
            п: "p",
            р: "r",
            с: "s",
            т: "t",
            у: "u",
            ф: "f",
            х: "h",
            ц: "c",
            ч: "ch",
            ш: "sh",
            щ: "sch",
            ъ: "",
            ы: "y",
            ь: "",
            э: "e",
            ю: "yu",
            я: "ya",
          }) as Record<string, string>
        )[letter.toLowerCase()] ?? "",
    )
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function ContentView({
  siteId,
  siteName,
  siteSlug,
  canEdit = true,
  canApprove = true,
  canEditPublished = true,
  onCountChange,
  onDirtyChange,
  openArticleId,
  openCategoryId,
  openAuthorId,
  openRequestId,
}: {
  siteId?: string;
  siteName?: string;
  siteSlug?: string;
  canEdit?: boolean;
  canApprove?: boolean;
  canEditPublished?: boolean;
  onCountChange?: (count: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  openArticleId?: string;
  openCategoryId?: string;
  openAuthorId?: string;
  openRequestId?: number;
}) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [contentEvents, setContentEvents] = useState<ContentEvent[]>([]);
  const [articleVersions, setArticleVersions] = useState<ArticleVersion[]>([]);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [relatedIds, setRelatedIds] = useState<string[]>([]);
  const [pendingSchedule, setPendingSchedule] =
    useState<PendingSchedule | null>(null);
  const [categorySchedule, setCategorySchedule] =
    useState<PendingSchedule | null>(null);
  const [trash, setTrash] = useState<{
    articles: Article[];
    categories: Category[];
  } | null>(null);
  const [articleRedirects, setArticleRedirects] = useState<RedirectAlias[]>([]);
  const [categoryActivity, setCategoryActivity] = useState<
    Array<{
      id: string;
      action: string;
      message: string | null;
      createdAt: string;
      user: { fullName: string } | null;
    }>
  >([]);
  const [comment, setComment] = useState("");
  const [editor, setEditor] = useState<Article | "new" | null>(null);
  const [catalog, setCatalog] = useState<"author" | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(
    new Set(),
  );
  const [categoryEditor, setCategoryEditor] = useState<Category | "new" | null>(
    null,
  );
  const [newCategoryParentId, setNewCategoryParentId] = useState<string | null>(
    null,
  );
  const [newArticleCategoryId, setNewArticleCategoryId] = useState<
    string | null
  >(null);
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryTab, setCategoryTab] = useState<
    "parameters" | "seo" | "history"
  >("parameters");
  const [searchQuery, setSearchQuery] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [filter, setFilter] = useState<ArticleFilter>("all");
  const [sortNewest, setSortNewest] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [articleBody, setArticleBody] = useState("");
  const articleBodyRef = useRef("");
  const [articleDocument, setArticleDocument] = useState<ArticleDocument>(() =>
    legacyDocument(""),
  );
  const articleDocumentRef = useRef<ArticleDocument>(legacyDocument(""));
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const autosaveArticleId = useRef<string | null>(null);
  const autosaveExpectedRevision = useRef<number | null>(null);
  const autosavePersistedBody = useRef("");
  const autosavePendingBody = useRef<string | null>(null);
  const autosaveRun = useRef<Promise<void> | null>(null);
  const autosaveBlocked = useRef(false);
  const handledOpenRequest = useRef<number | undefined>(undefined);
  const handledCategoryOpenRequest = useRef<number | undefined>(undefined);
  const handledAuthorOpenRequest = useRef<number | undefined>(undefined);
  const editorCanEdit =
    canEdit &&
    (editor === "new" ||
      !editor ||
      editor.publicationState !== "published" ||
      canEditPublished);

  const drainAutosave = useCallback((): Promise<void> => {
    if (autosaveRun.current) return autosaveRun.current;
    const run = (async () => {
      while (autosavePendingBody.current !== null) {
        const serializedDocument = autosavePendingBody.current;
        const bodyDocument = JSON.parse(serializedDocument) as ArticleDocument;
        autosavePendingBody.current = null;
        const articleId = autosaveArticleId.current;
        const expectedRevision = autosaveExpectedRevision.current;
        if (!siteId || !articleId || expectedRevision === null) return;
        setAutosaveStatus("saving");
        try {
          const saved = await request<{
            body: string;
            bodyDocument: ArticleDocument;
            revision: number;
            updatedAt: string;
          }>(`/api/sites/${siteId}/content/articles/${articleId}/body`, {
            method: "PATCH",
            body: JSON.stringify({ bodyDocument, expectedRevision }),
          });
          autosavePersistedBody.current = serializedDocument;
          autosaveExpectedRevision.current = saved.revision;
          if (autosaveArticleId.current === articleId)
            setEditor((current) =>
              current && current !== "new" && current.id === articleId
                ? {
                    ...current,
                    body: saved.body,
                    bodyDocument: saved.bodyDocument,
                    revision: saved.revision,
                    updatedAt: saved.updatedAt,
                  }
                : current,
            );
        } catch (reason) {
          if (autosaveArticleId.current === articleId) {
            autosaveBlocked.current = true;
            if (reason instanceof RequestError && reason.status === 409) {
              autosavePendingBody.current = null;
              setAutosaveStatus("conflict");
              setMessage(
                "Конфликт версий: материал уже изменён в другой вкладке. Локальный текст остаётся в редакторе. Скопируйте его и перезагрузите материал перед продолжением.",
              );
            } else {
              autosavePendingBody.current = JSON.stringify(
                articleDocumentRef.current,
              );
              setAutosaveStatus("error");
              setMessage(
                reason instanceof Error
                  ? `Автосохранение: ${reason.message}. Текст сохранён в редакторе — повторите попытку.`
                  : "Не удалось автоматически сохранить текст. Он остаётся в редакторе.",
              );
            }
          }
          throw reason;
        }
      }
      setAutosaveStatus("saved");
    })();
    autosaveRun.current = run.finally(() => {
      autosaveRun.current = null;
    });
    return autosaveRun.current;
  }, [siteId]);

  useEffect(() => {
    if (!editor || editor === "new" || !editorCanEdit) return;
    if (autosaveStatus === "conflict") return;
    const serializedDocument = JSON.stringify(articleDocument);
    if (serializedDocument === autosavePersistedBody.current) return;
    const timer = window.setTimeout(() => {
      autosavePendingBody.current = serializedDocument;
      autosaveBlocked.current = false;
      void drainAutosave().catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [articleDocument, autosaveStatus, drainAutosave, editor, editorCanEdit]);

  const load = useCallback(async () => {
    if (!siteId) {
      setLoading(false);
      return;
    }
    try {
      const base = `/api/sites/${siteId}/content`;
      const [articleRows, categoryRows, authorRows, mediaRows, templateRows] =
        await Promise.all([
          request<Article[]>(`${base}/articles`),
          request<Category[]>(`${base}/categories`),
          request<Author[]>(`${base}/authors`),
          request<MediaItem[]>(`${base}/media`),
          request<ContentTemplate[]>(`${base}/templates`),
        ]);
      setArticles(articleRows);
      setSelectedIds((current) =>
        current.filter((id) =>
          articleRows.some((article) => article.id === id),
        ),
      );
      setCategories(categoryRows);
      setAuthors(authorRows);
      setMedia(mediaRows);
      setTemplates(templateRows);
      setMessage("");
      onCountChange?.(articleRows.length);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить контент",
      );
    } finally {
      setLoading(false);
    }
  }, [siteId, onCountChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const restoreLocation = () => {
      const params = new URL(window.location.href).searchParams;
      const categoryId = params.get("contentCategory");
      const articleId = params.get("contentArticle");
      setSelectedCategoryId(
        categoryId && categories.some((item) => item.id === categoryId)
          ? categoryId
          : null,
      );
      if (articleId) {
        const article = articles.find((item) => item.id === articleId);
        if (
          article &&
          (!editor || editor === "new" || editor.id !== article.id)
        )
          void openEditor(article, false);
      } else if (editor && editor !== "new") {
        setEditor(null);
      }
    };
    restoreLocation();
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
    // URL restoration intentionally snapshots the current editor; openEditor also writes history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, categories]);

  useEffect(() => {
    if (
      !siteId ||
      !openArticleId ||
      openRequestId === undefined ||
      handledOpenRequest.current === openRequestId
    )
      return;
    const article = articles.find((item) => item.id === openArticleId);
    if (!article) return;
    const timer = window.setTimeout(() => {
      handledOpenRequest.current = openRequestId;
      setEditor(article);
      const document = article.bodyDocument ?? legacyDocument(article.body);
      setArticleBody(article.body);
      articleBodyRef.current = article.body;
      setArticleDocument(document);
      articleDocumentRef.current = document;
      autosaveArticleId.current = article.id;
      autosaveExpectedRevision.current = article.revision ?? 0;
      autosavePersistedBody.current = JSON.stringify(document);
      autosavePendingBody.current = null;
      autosaveBlocked.current = false;
      setAutosaveStatus("saved");
      setDirty(false);
      setActivity([]);
      setContentEvents([]);
      setArticleVersions([]);
      setRelatedIds([]);
      setPendingSchedule(null);
      setArticleRedirects([]);
      void Promise.all([
        request<Activity[]>(
          `/api/sites/${siteId}/content/articles/${article.id}/activity`,
        ),
        request<RedirectAlias[]>(
          `/api/sites/${siteId}/content/articles/${article.id}/redirects`,
        ),
        request<ContentEvent[]>(
          `/api/sites/${siteId}/content/articles/${article.id}/events`,
        ),
        request<ArticleVersion[]>(
          `/api/sites/${siteId}/content/articles/${article.id}/versions`,
        ),
        request<Array<{ relatedArticleId: string }>>(
          `/api/sites/${siteId}/content/articles/${article.id}/related`,
        ),
        request<PendingSchedule | null>(
          `/api/sites/${siteId}/content/articles/${article.id}/schedule`,
        ),
      ])
        .then(
          ([
            activityRows,
            redirectRows,
            eventRows,
            versionRows,
            relatedRows,
            schedule,
          ]) => {
            setActivity(activityRows);
            setArticleRedirects(redirectRows);
            setContentEvents(eventRows);
            setArticleVersions(versionRows);
            setRelatedIds(relatedRows.map((row) => row.relatedArticleId));
            setPendingSchedule(schedule);
          },
        )
        .catch((reason) =>
          setMessage(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить историю",
          ),
        );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [articles, openArticleId, openRequestId, siteId]);

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

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const categoryChildren = useMemo(() => {
    const children = new Map<string | null, Category[]>();
    categories.forEach((category) => {
      const parentId = categoryById.has(category.parentId ?? "")
        ? category.parentId
        : null;
      children.set(parentId, [...(children.get(parentId) ?? []), category]);
    });
    children.forEach((items) =>
      items.sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
      ),
    );
    return children;
  }, [categories, categoryById]);

  useEffect(() => {
    if (
      !openCategoryId ||
      openRequestId === undefined ||
      handledCategoryOpenRequest.current === openRequestId
    )
      return;
    const category = categoryById.get(openCategoryId);
    if (!category) return;
    const timer = window.setTimeout(() => {
      handledCategoryOpenRequest.current = openRequestId;
      setEditor(null);
      setCategoryEditor(null);
      setSelectedCategoryId(category.id);
      setSelectedAuthorId(null);
      setDirty(false);
      setCollapsedCategoryIds((current) => {
        const next = new Set(current);
        let parentId = category.parentId;
        while (parentId) {
          next.delete(parentId);
          parentId = categoryById.get(parentId)?.parentId ?? null;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [categoryById, openCategoryId, openRequestId]);
  useEffect(() => {
    if (
      !openAuthorId ||
      openRequestId === undefined ||
      handledAuthorOpenRequest.current === openRequestId ||
      !authors.some((author) => author.id === openAuthorId)
    )
      return;
    const timer = window.setTimeout(() => {
      handledAuthorOpenRequest.current = openRequestId;
      setEditor(null);
      setCategoryEditor(null);
      setSelectedCategoryId(null);
      setSelectedAuthorId(openAuthorId);
      setDirty(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authors, openAuthorId, openRequestId]);
  const categoryBranchIds = useMemo(() => {
    if (!selectedCategoryId || selectedCategoryId === "uncategorized")
      return null;
    const ids = new Set<string>();
    const collect = (categoryId: string) => {
      if (ids.has(categoryId)) return;
      ids.add(categoryId);
      (categoryChildren.get(categoryId) ?? []).forEach((category) =>
        collect(category.id),
      );
    };
    collect(selectedCategoryId);
    return ids;
  }, [categoryChildren, selectedCategoryId]);
  const visibleArticles = useMemo(() => {
    const statusFiltered =
      filter === "all"
        ? articles
        : articles.filter((article) => matchesArticleFilter(article, filter));
    const categoryFiltered =
      selectedCategoryId === "uncategorized"
        ? statusFiltered.filter((article) => !article.categoryId)
        : categoryBranchIds
          ? statusFiltered.filter(
              (article) =>
                !!article.categoryId &&
                categoryBranchIds.has(article.categoryId),
            )
          : statusFiltered;
    const authorFiltered = selectedAuthorId
      ? categoryFiltered.filter(
          (article) => article.authorId === selectedAuthorId,
        )
      : categoryFiltered;
    const query = searchQuery.trim().toLocaleLowerCase("ru");
    const filtered = query
      ? authorFiltered.filter(
          (article) =>
            article.title.toLocaleLowerCase("ru").includes(query) ||
            article.category?.name.toLocaleLowerCase("ru").includes(query),
        )
      : authorFiltered;
    return [...filtered].sort(
      (left, right) =>
        (new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()) *
        (sortNewest ? 1 : -1),
    );
  }, [
    articles,
    categoryBranchIds,
    filter,
    selectedAuthorId,
    selectedCategoryId,
    searchQuery,
    sortNewest,
  ]);
  const searchVisibleCategoryIds = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ru");
    const treeFilterActive = filter !== "all" || Boolean(selectedAuthorId);
    if (!query && !treeFilterActive) return null;
    const ids = new Set<string>();
    const includeWithParents = (categoryId: string | null) => {
      let currentId = categoryId;
      while (currentId && !ids.has(currentId)) {
        ids.add(currentId);
        currentId = categoryById.get(currentId)?.parentId ?? null;
      }
    };
    if (query)
      categories
        .filter((category) =>
          category.name.toLocaleLowerCase("ru").includes(query),
        )
        .forEach((category) => includeWithParents(category.id));
    articles
      .filter(
        (article) =>
          matchesArticleFilter(article, filter) &&
          (!selectedAuthorId || article.authorId === selectedAuthorId) &&
          (!query ||
            article.title.toLocaleLowerCase("ru").includes(query) ||
            article.category?.name.toLocaleLowerCase("ru").includes(query)),
      )
      .forEach((article) => includeWithParents(article.categoryId));
    return ids;
  }, [
    articles,
    categories,
    categoryById,
    filter,
    searchQuery,
    selectedAuthorId,
  ]);
  const categoryTreeRows = useMemo(() => {
    const rows: Array<
      | {
          kind: "category";
          category: Category;
          depth: number;
          hasChildren: boolean;
        }
      | { kind: "article"; article: Article; depth: number }
    > = [];
    const visited = new Set<string>();
    const addCategory = (category: Category, depth: number) => {
      if (visited.has(category.id)) return;
      if (
        searchVisibleCategoryIds &&
        !searchVisibleCategoryIds.has(category.id)
      )
        return;
      visited.add(category.id);
      const childCategories = categoryChildren.get(category.id) ?? [];
      const query = searchQuery.trim().toLocaleLowerCase("ru");
      const categoryMatches = category.name
        .toLocaleLowerCase("ru")
        .includes(query);
      const categoryArticles = articles
        .filter(
          (article) =>
            article.categoryId === category.id &&
            matchesArticleFilter(article, filter) &&
            (!selectedAuthorId || article.authorId === selectedAuthorId) &&
            (!query ||
              categoryMatches ||
              article.title.toLocaleLowerCase("ru").includes(query)),
        )
        .sort((left, right) => left.title.localeCompare(right.title, "ru"));
      rows.push({
        kind: "category",
        category,
        depth,
        hasChildren: childCategories.length > 0 || categoryArticles.length > 0,
      });
      if (!collapsedCategoryIds.has(category.id) || query) {
        childCategories.forEach((child) => addCategory(child, depth + 1));
        categoryArticles.forEach((article) =>
          rows.push({ kind: "article", article, depth: depth + 1 }),
        );
      }
    };
    const addBranch = (parentId: string | null, depth: number) => {
      (categoryChildren.get(parentId) ?? []).forEach((category) => {
        addCategory(category, depth);
      });
    };
    const selected =
      selectedCategoryId && selectedCategoryId !== "uncategorized"
        ? categoryById.get(selectedCategoryId)
        : null;
    if (selected) addCategory(selected, 0);
    else addBranch(null, 0);
    return rows;
  }, [
    articles,
    categoryById,
    categoryChildren,
    collapsedCategoryIds,
    filter,
    searchQuery,
    searchVisibleCategoryIds,
    selectedCategoryId,
    selectedAuthorId,
  ]);
  const count = (target: ArticleFilter) =>
    articles.filter((article) => matchesArticleFilter(article, target)).length;
  const allVisibleSelected =
    visibleArticles.length > 0 &&
    visibleArticles.every((article) => selectedIds.includes(article.id));
  const selectedArticles = articles.filter((article) =>
    selectedIds.includes(article.id),
  );
  const canSendSelectedToReview =
    canEdit &&
    selectedArticles.length > 0 &&
    selectedArticles.every(
      (article) =>
        article.editorialState === "draft" ||
        article.editorialState === "changes",
    );
  const canApproveSelected =
    canApprove &&
    selectedArticles.length > 0 &&
    selectedArticles.every((article) => article.editorialState === "review");
  const canPublishSelected =
    canApprove &&
    selectedArticles.length > 0 &&
    selectedArticles.every(
      (article) =>
        article.editorialState === "approved" &&
        article.publicationState !== "published",
    );
  const canUnpublishSelected =
    canApprove &&
    selectedArticles.length > 0 &&
    selectedArticles.every(
      (article) => article.publicationState === "published",
    );
  const canDeleteSelected =
    canEdit &&
    selectedArticles.length > 0 &&
    selectedArticles.every(
      (article) => article.publicationState !== "published",
    );

  function toggleAllVisible() {
    setSelectedIds((current) =>
      allVisibleSelected
        ? current.filter(
            (id) => !visibleArticles.some((article) => article.id === id),
          )
        : [
            ...new Set([
              ...current,
              ...visibleArticles.map((article) => article.id),
            ]),
          ],
    );
  }

  function toggleArticle(articleId: string) {
    setSelectedIds((current) =>
      current.includes(articleId)
        ? current.filter((id) => id !== articleId)
        : [...current, articleId],
    );
  }

  async function changeSelectedStatus(
    status: ArticleStatus,
    confirmation: string,
  ) {
    if (!siteId || !selectedArticles.length) return;
    if (!window.confirm(confirmation)) return;
    setBulkBusy(true);
    const failedIds: string[] = [];
    let completed = 0;
    for (const article of selectedArticles) {
      try {
        const editorialState =
          status === "review"
            ? "review"
            : status === "changes_requested"
              ? "changes"
              : status === "published" && article.editorialState === "review"
                ? "approved"
                : null;
        await request(
          `/api/sites/${siteId}/content/articles/${article.id}/${editorialState ? "editorial" : "publication"}`,
          {
            method: "POST",
            body: JSON.stringify({ state: editorialState ?? status }),
          },
        );
        completed += 1;
      } catch {
        failedIds.push(article.id);
      }
    }
    setSelectedIds(failedIds);
    setMessage(
      failedIds.length
        ? `Обработано: ${completed}. Не удалось изменить: ${failedIds.length}.`
        : `Статус изменён у ${completed} ${completed === 1 ? "материала" : "материалов"}`,
    );
    await load();
    setBulkBusy(false);
  }

  async function deleteSelectedArticles() {
    if (!siteId || !selectedArticles.length || !canDeleteSelected) return;
    if (
      !window.confirm(
        `Переместить выбранные материалы (${selectedArticles.length}) в корзину?`,
      )
    )
      return;
    setBulkBusy(true);
    const failedIds: string[] = [];
    let completed = 0;
    for (const article of selectedArticles) {
      try {
        await request(`/api/sites/${siteId}/content/articles/${article.id}`, {
          method: "DELETE",
        });
        completed += 1;
      } catch {
        failedIds.push(article.id);
      }
    }
    setSelectedIds(failedIds);
    setMessage(
      failedIds.length
        ? `Удалено: ${completed}. Не удалось удалить: ${failedIds.length}.`
        : `Удалено материалов: ${completed}`,
    );
    await load();
    setBulkBusy(false);
  }

  async function openEditor(article: Article | "new", updateHistory = true) {
    if (
      editor &&
      editor !== "new" &&
      (autosaveRun.current ||
        autosavePendingBody.current !== null ||
        JSON.stringify(articleDocumentRef.current) !==
          autosavePersistedBody.current)
    ) {
      setMessage(
        "Дождитесь сохранения текста перед открытием другого материала",
      );
      return;
    }
    setEditor(article);
    if (updateHistory) {
      const url = new URL(window.location.href);
      if (article === "new") url.searchParams.delete("contentArticle");
      else url.searchParams.set("contentArticle", article.id);
      window.history.pushState({}, "", url);
    }
    setEditorTab("editor");
    const body = article === "new" ? "" : article.body;
    const document =
      article === "new"
        ? legacyDocument("")
        : (article.bodyDocument ?? legacyDocument(article.body));
    setArticleBody(body);
    articleBodyRef.current = body;
    setArticleDocument(document);
    articleDocumentRef.current = document;
    autosaveArticleId.current = article === "new" ? null : article.id;
    autosaveExpectedRevision.current =
      article === "new" ? null : (article.revision ?? 0);
    autosavePersistedBody.current = JSON.stringify(document);
    autosavePendingBody.current = null;
    autosaveBlocked.current = false;
    setAutosaveStatus(article === "new" ? "idle" : "saved");
    setDirty(false);
    setActivity([]);
    setContentEvents([]);
    setArticleVersions([]);
    setRelatedIds([]);
    setPendingSchedule(null);
    setArticleRedirects([]);
    if (article !== "new" && siteId) {
      try {
        const [
          activityRows,
          redirectRows,
          eventRows,
          versionRows,
          relatedRows,
          schedule,
        ] = await Promise.all([
          request<Activity[]>(
            `/api/sites/${siteId}/content/articles/${article.id}/activity`,
          ),
          request<RedirectAlias[]>(
            `/api/sites/${siteId}/content/articles/${article.id}/redirects`,
          ),
          request<ContentEvent[]>(
            `/api/sites/${siteId}/content/articles/${article.id}/events`,
          ),
          request<ArticleVersion[]>(
            `/api/sites/${siteId}/content/articles/${article.id}/versions`,
          ),
          request<Array<{ relatedArticleId: string }>>(
            `/api/sites/${siteId}/content/articles/${article.id}/related`,
          ),
          request<PendingSchedule | null>(
            `/api/sites/${siteId}/content/articles/${article.id}/schedule`,
          ),
        ]);
        setActivity(activityRows);
        setArticleRedirects(redirectRows);
        setContentEvents(eventRows);
        setArticleVersions(versionRows);
        setRelatedIds(relatedRows.map((row) => row.relatedArticleId));
        setPendingSchedule(schedule);
      } catch (reason) {
        setMessage(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить историю",
        );
      }
    }
  }

  function startNewArticle(categoryId: string | null = null) {
    setNewArticleCategoryId(categoryId);
    void openEditor("new");
  }

  function closeEditor() {
    if (
      editor !== "new" &&
      (autosaveRun.current ||
        autosavePendingBody.current !== null ||
        JSON.stringify(articleDocumentRef.current) !==
          autosavePersistedBody.current ||
        autosaveBlocked.current)
    ) {
      setMessage(
        autosaveBlocked.current
          ? "Текст не сохранён. Повторите автосохранение перед закрытием."
          : "Дождитесь завершения автосохранения перед закрытием.",
      );
      return;
    }
    if (
      dirty &&
      editorCanEdit &&
      !window.confirm("Закрыть редактор? Несохранённые изменения потеряются.")
    )
      return;
    setDirty(false);
    autosaveArticleId.current = null;
    autosaveExpectedRevision.current = null;
    autosavePendingBody.current = null;
    setEditor(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("contentArticle");
    window.history.pushState({}, "", url);
  }

  function openCategory(categoryId: string | null) {
    setSelectedCategoryId(categoryId);
    const url = new URL(window.location.href);
    if (categoryId) url.searchParams.set("contentCategory", categoryId);
    else url.searchParams.delete("contentCategory");
    url.searchParams.delete("contentArticle");
    window.history.pushState({}, "", url);
  }

  async function flushAutosave() {
    if (!editor || editor === "new") return true;
    if (autosaveStatus === "conflict") return false;
    const latestDocument = JSON.stringify(articleDocumentRef.current);
    if (latestDocument !== autosavePersistedBody.current) {
      autosavePendingBody.current = latestDocument;
      autosaveBlocked.current = false;
    }
    try {
      await drainAutosave();
      return autosavePersistedBody.current === latestDocument;
    } catch {
      return false;
    }
  }

  function articlePayload(form: HTMLFormElement) {
    const data = new FormData(form);
    const publishedAt = data.get("publishedAt");
    const sortOrder = data.get("sortOrder");
    const [displayTemplateKey, displayTemplateVersion] = String(
      data.get("displayTemplateSelection") ?? "standard-article@1",
    ).split("@");
    const structuredDataSource = String(
      data.get("structuredData") ?? "",
    ).trim();
    return {
      ...Object.fromEntries(
        [...data.entries()].filter(
          ([name, value]) =>
            ![
              "noIndex",
              "scheduleAt",
              "scheduleState",
              "displayTemplateSelection",
              "structuredData",
            ].includes(name) && value !== "",
        ),
      ),
      noIndex: data.get("noIndex") === "on",
      displayTemplateKey,
      displayTemplateVersion,
      structuredData: structuredDataSource
        ? JSON.parse(structuredDataSource)
        : null,
      body: articleBody,
      bodyDocument: articleDocument,
      publishedAt:
        typeof publishedAt === "string" && publishedAt
          ? new Date(publishedAt).toISOString()
          : null,
      sortOrder:
        typeof sortOrder === "string" && sortOrder ? Number(sortOrder) : 0,
    };
  }

  async function reloadActivity(articleId: string) {
    if (!siteId) return;
    const [activityRows, eventRows, versionRows] = await Promise.all([
      request<Activity[]>(
        `/api/sites/${siteId}/content/articles/${articleId}/activity`,
      ),
      request<ContentEvent[]>(
        `/api/sites/${siteId}/content/articles/${articleId}/events`,
      ),
      request<ArticleVersion[]>(
        `/api/sites/${siteId}/content/articles/${articleId}/versions`,
      ),
    ]);
    setActivity(activityRows);
    setContentEvents(eventRows);
    setArticleVersions(versionRows);
  }

  async function removeArticleRedirect(redirectId: string) {
    if (!siteId || !editor || editor === "new") return;
    if (!window.confirm("Удалить этот прежний адрес?")) return;
    await request(
      `/api/sites/${siteId}/content/articles/${editor.id}/redirects/${redirectId}`,
      { method: "DELETE" },
    );
    setArticleRedirects((rows) => rows.filter((row) => row.id !== redirectId));
  }

  async function changeStatus(
    status: ArticleStatus,
    form?: HTMLFormElement | null,
  ) {
    if (!siteId || !editor || editor === "new") return;
    if (form && !form.reportValidity()) return;
    if (
      status === "published" &&
      !window.confirm(
        "Опубликовать материал на сайте? Он сразу станет доступен посетителям.",
      )
    )
      return;
    if (
      status === "draft" &&
      !window.confirm("Снять материал с публикации и вернуть в черновик?")
    )
      return;
    setStatusBusy(true);
    try {
      if (!(await flushAutosave())) {
        setMessage("Не удалось сохранить текст. Публикация не выполнена.");
        return;
      }
      let current = editor;
      if (form && editorCanEdit) {
        current = await request<Article>(
          `/api/sites/${siteId}/content/articles/${editor.id}`,
          { method: "PATCH", body: JSON.stringify(articlePayload(form)) },
        );
      }
      const editorialState =
        status === "review"
          ? "review"
          : status === "changes_requested"
            ? "changes"
            : null;
      const publicationState =
        status === "published" || status === "hidden" || status === "draft"
          ? status
          : null;
      const updated = await request<Article>(
        `/api/sites/${siteId}/content/articles/${editor.id}/${editorialState ? "editorial" : "publication"}`,
        {
          method: "POST",
          body: JSON.stringify({ state: editorialState ?? publicationState }),
        },
      );
      setEditor({ ...current, ...updated });
      setDirty(false);
      setMessage(
        status === "published"
          ? "Материал опубликован и доступен на сайте"
          : status === "draft"
            ? "Материал снят с публикации"
            : "Статус материала изменён",
      );
      await reloadActivity(editor.id);
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось изменить статус",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function approveEditorial(form?: HTMLFormElement | null) {
    if (!siteId || !editor || editor === "new") return;
    if (form && !form.reportValidity()) return;
    setStatusBusy(true);
    try {
      if (!(await flushAutosave())) return;
      const updated = await request<Article>(
        `/api/sites/${siteId}/content/articles/${editor.id}/editorial`,
        { method: "POST", body: JSON.stringify({ state: "approved" }) },
      );
      setEditor((current) =>
        current && current !== "new" ? { ...current, ...updated } : current,
      );
      setMessage("Редакционная версия одобрена");
      await reloadActivity(editor.id);
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось одобрить",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveRelatedArticles() {
    if (!siteId || !editor || editor === "new") return;
    try {
      await request(
        `/api/sites/${siteId}/content/articles/${editor.id}/related`,
        {
          method: "PATCH",
          body: JSON.stringify({ articleIds: relatedIds }),
        },
      );
      setMessage("Связанные материалы сохранены");
      await reloadActivity(editor.id);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить связи",
      );
    }
  }

  async function restoreVersion(version: ArticleVersion) {
    if (!siteId || !editor || editor === "new") return;
    if (
      !window.confirm(`Восстановить версию ${version.versionNumber} как новую?`)
    )
      return;
    try {
      const restored = await request<Article>(
        `/api/sites/${siteId}/content/articles/${editor.id}/versions/${version.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ expectedRevision: editor.revision }),
        },
      );
      await openEditor(restored, false);
      await load();
      setMessage(`Версия ${version.versionNumber} восстановлена как новая`);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось восстановить версию",
      );
    }
  }

  async function compareVersion(version: ArticleVersion) {
    if (!siteId || !editor || editor === "new" || !articleVersions.length)
      return;
    const current = articleVersions[0];
    const comparison = await request<{ changes: Record<string, unknown> }>(
      `/api/sites/${siteId}/content/articles/${editor.id}/versions/compare?from=${version.versionNumber}&to=${current.versionNumber}`,
    );
    const fields = Object.keys(comparison.changes);
    setMessage(
      fields.length
        ? `Версия ${version.versionNumber}: изменены поля ${fields.join(", ")}`
        : `Версия ${version.versionNumber} совпадает с текущей`,
    );
  }

  async function scheduleArticle(form: HTMLFormElement) {
    if (!siteId || !editor || editor === "new") return;
    const data = new FormData(form);
    const scheduleAt = String(data.get("scheduleAt") ?? "");
    const state = String(data.get("scheduleState") ?? "published");
    if (!scheduleAt) {
      setMessage("Укажите дату и время перехода");
      return;
    }
    try {
      const saved = await request<PendingSchedule>(
        `/api/sites/${siteId}/content/articles/${editor.id}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({
            state,
            executeAt: new Date(scheduleAt).toISOString(),
          }),
        },
      );
      setPendingSchedule(saved);
      setMessage("Переход запланирован");
      await reloadActivity(editor.id);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось создать расписание",
      );
    }
  }

  async function cancelArticleSchedule() {
    if (!siteId || !editor || editor === "new") return;
    await request(
      `/api/sites/${siteId}/content/articles/${editor.id}/schedule`,
      {
        method: "DELETE",
      },
    );
    setPendingSchedule(null);
    setMessage("Запланированный переход отменён");
    await reloadActivity(editor.id);
  }

  async function addComment() {
    if (!siteId || !editor || editor === "new") return;
    if (!comment.trim()) return;
    try {
      await request(
        `/api/sites/${siteId}/content/articles/${editor.id}/comments`,
        { method: "POST", body: JSON.stringify({ message: comment }) },
      );
      setComment("");
      await reloadActivity(editor.id);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось добавить комментарий",
      );
    }
  }

  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !editor || !editorCanEdit) return;
    try {
      const isNew = editor === "new";
      if (!isNew && !(await flushAutosave())) {
        setMessage(
          "Не удалось сохранить текст. Остальные изменения не отправлены.",
        );
        return;
      }
      const payload = articlePayload(event.currentTarget);
      const url = isNew
        ? `/api/sites/${siteId}/content/articles`
        : `/api/sites/${siteId}/content/articles/${editor.id}`;
      await request(url, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      setDirty(false);
      setEditor(null);
      const nextLocation = new URL(window.location.href);
      nextLocation.searchParams.delete("contentArticle");
      window.history.replaceState({}, "", nextLocation);
      setMessage(isNew ? "Материал создан" : "Изменения сохранены");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить материал",
      );
    }
  }

  async function deleteArticle() {
    if (!siteId || !editor || editor === "new") return;
    if (
      !window.confirm(
        `Переместить статью «${editor.title}» в корзину? Её можно восстановить.`,
      )
    )
      return;
    setStatusBusy(true);
    try {
      await request(`/api/sites/${siteId}/content/articles/${editor.id}`, {
        method: "DELETE",
      });
      setDirty(false);
      setEditor(null);
      const nextLocation = new URL(window.location.href);
      nextLocation.searchParams.delete("contentArticle");
      window.history.replaceState({}, "", nextLocation);
      setSelectedIds((current) => current.filter((id) => id !== editor.id));
      setMessage("Статья перемещена в корзину");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось удалить статью",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function createCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !catalog) return;
    const data = new FormData(event.currentTarget);
    try {
      const payload = Object.fromEntries(
        [...data.entries()].filter(([, value]) => value !== ""),
      );
      await request(`/api/sites/${siteId}/content/authors`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setCatalog(null);
      setMessage("Автор добавлен");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить",
      );
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !categoryEditor) return;
    const data = new FormData(event.currentTarget);
    const [displayTemplateKey, displayTemplateVersion] = String(
      data.get("displayTemplateSelection") ?? "standard-category@1",
    ).split("@");
    const categoryStructuredDataSource = String(
      data.get("structuredData") ?? "",
    ).trim();
    let categoryStructuredData: Record<string, unknown> | null = null;
    try {
      categoryStructuredData = categoryStructuredDataSource
        ? JSON.parse(categoryStructuredDataSource)
        : null;
    } catch {
      setMessage("Проверьте JSON структурированных данных рубрики");
      return;
    }
    const payload = {
      name: String(data.get("name") ?? ""),
      slug: String(data.get("slug") ?? ""),
      description: String(data.get("description") ?? "").trim() || null,
      sortOrder: Number(data.get("sortOrder") ?? 0),
      color: String(data.get("color") ?? "#9f91ef"),
      parentId: String(data.get("parentId") ?? "") || null,
      icon: String(data.get("icon") ?? "").trim() || null,
      imageMediaId: String(data.get("imageMediaId") ?? "") || null,
      seoTitle: String(data.get("seoTitle") ?? "").trim() || null,
      seoDescription: String(data.get("seoDescription") ?? "").trim() || null,
      canonicalUrl: String(data.get("canonicalUrl") ?? "").trim() || null,
      noIndex: data.get("noIndex") === "on",
      ogTitle: String(data.get("ogTitle") ?? "").trim() || null,
      ogDescription: String(data.get("ogDescription") ?? "").trim() || null,
      ogImageMediaId: String(data.get("ogImageMediaId") ?? "") || null,
      structuredData: categoryStructuredData,
      displayTemplateKey,
      displayTemplateVersion,
    };
    setCategoryBusy(true);
    try {
      const categoryId = categoryEditor === "new" ? null : categoryEditor.id;
      await request(
        `/api/sites/${siteId}/content/categories${categoryId ? `/${categoryId}` : ""}`,
        {
          method: categoryId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setCategoryEditor(null);
      setNewCategoryParentId(null);
      setMessage(categoryId ? "Рубрика обновлена" : "Рубрика добавлена");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить рубрику",
      );
    } finally {
      setCategoryBusy(false);
    }
  }

  async function deleteCategory(category: Category) {
    if (!siteId) return;
    const summary = await request<{
      articleCount: number;
      childCount: number;
      publishedArticleCount: number;
    }>(`/api/sites/${siteId}/content/categories/${category.id}/delete-summary`);
    if (
      !window.confirm(
        `Переместить ветку «${category.name}» в корзину? Будут скрыты ${summary.articleCount} материалов (${summary.publishedArticleCount} опубликовано) и ${summary.childCount} дочерних рубрик. Ветку можно восстановить.`,
      )
    )
      return;
    setCategoryBusy(true);
    try {
      await request(`/api/sites/${siteId}/content/categories/${category.id}`, {
        method: "DELETE",
      });
      if (selectedCategoryId === category.id) openCategory(null);
      setCategoryEditor(null);
      setMessage("Ветка рубрики перемещена в корзину");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось удалить рубрику",
      );
    } finally {
      setCategoryBusy(false);
    }
  }

  async function changeCategoryPublication(state: PublicationState) {
    if (!siteId || !categoryEditor || categoryEditor === "new") return;
    setCategoryBusy(true);
    try {
      const updated = await request<Category>(
        `/api/sites/${siteId}/content/categories/${categoryEditor.id}/publication`,
        { method: "POST", body: JSON.stringify({ state }) },
      );
      setCategoryEditor(updated);
      setMessage(`Статус рубрики: ${publicationNames[state]}`);
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить публикацию",
      );
    } finally {
      setCategoryBusy(false);
    }
  }

  async function scheduleCategory(form: HTMLFormElement) {
    if (!siteId || !categoryEditor || categoryEditor === "new") return;
    const data = new FormData(form);
    const executeAt = String(data.get("categoryScheduleAt") ?? "");
    const state = String(data.get("categoryScheduleState") ?? "published");
    if (!executeAt) return setMessage("Укажите дату и время перехода");
    const saved = await request<PendingSchedule>(
      `/api/sites/${siteId}/content/categories/${categoryEditor.id}/schedule`,
      {
        method: "POST",
        body: JSON.stringify({
          state,
          executeAt: new Date(executeAt).toISOString(),
        }),
      },
    );
    setCategorySchedule(saved);
    setMessage("Переход рубрики запланирован");
  }

  async function cancelCategorySchedule() {
    if (!siteId || !categoryEditor || categoryEditor === "new") return;
    await request(
      `/api/sites/${siteId}/content/categories/${categoryEditor.id}/schedule`,
      { method: "DELETE" },
    );
    setCategorySchedule(null);
    setMessage("Запланированный переход рубрики отменён");
  }

  async function duplicateArticle() {
    if (!siteId || !editor || editor === "new") return;
    const duplicate = await request<Article>(
      `/api/sites/${siteId}/content/articles/${editor.id}/duplicate`,
      {
        method: "POST",
        body: JSON.stringify({
          slug: `${editor.slug.slice(0, 130)}-copy-${Date.now().toString(36)}`,
        }),
      },
    );
    await load();
    await openEditor(duplicate);
    setMessage("Копия статьи создана как черновик");
  }

  async function duplicateCategory() {
    if (!siteId || !categoryEditor || categoryEditor === "new") return;
    const duplicate = await request<Category>(
      `/api/sites/${siteId}/content/categories/${categoryEditor.id}/duplicate`,
      {
        method: "POST",
        body: JSON.stringify({
          slug: `${categoryEditor.slug.slice(0, 70)}-copy-${Date.now().toString(36)}`,
        }),
      },
    );
    await load();
    setCategoryEditor(duplicate);
    setMessage("Копия рубрики создана как черновик");
  }

  async function openTrash() {
    if (!siteId) return;
    setTrash(
      await request<{ articles: Article[]; categories: Category[] }>(
        `/api/sites/${siteId}/content/trash`,
      ),
    );
  }

  async function restoreFromTrash(type: "articles" | "categories", id: string) {
    if (!siteId) return;
    await request(`/api/sites/${siteId}/content/${type}/${id}/restore`, {
      method: "POST",
    });
    await Promise.all([load(), openTrash()]);
    setMessage("Материал восстановлен как черновик");
  }

  if (loading) return <div className="section-state">Загружаем материалы…</div>;

  return (
    <>
      {!categoryEditor ? (
        <>
          <section className="page-head">
            <div>
              <h1>Статьи</h1>
              <p>Публикации сайта {siteName ?? "не выбран"}</p>
            </div>
            {canEdit ? (
              <div className="content-add-menu">
                <button type="button" onClick={() => void openTrash()}>
                  Корзина
                </button>
                <button
                  className="primary-button"
                  disabled={!siteId}
                  aria-expanded={addMenuOpen}
                  onClick={() => setAddMenuOpen((open) => !open)}
                >
                  <span>＋</span>Добавить
                </button>
                {addMenuOpen ? (
                  <div role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        startNewArticle(
                          selectedCategoryId === "uncategorized"
                            ? null
                            : selectedCategoryId,
                        );
                      }}
                    >
                      Статья
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setCategoryTab("parameters");
                        setCategoryEditor("new");
                        setNewCategoryParentId(
                          selectedCategoryId === "uncategorized"
                            ? null
                            : selectedCategoryId,
                        );
                      }}
                    >
                      Рубрика
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          {trash ? (
            <section className="directory-form">
              <header className="category-level-heading">
                <strong>Корзина</strong>
                <button type="button" onClick={() => setTrash(null)}>
                  Закрыть
                </button>
              </header>
              {[
                ...trash.categories.map((item) => ({
                  type: "categories" as const,
                  id: item.id,
                  name: `Рубрика: ${item.name}`,
                })),
                ...trash.articles.map((item) => ({
                  type: "articles" as const,
                  id: item.id,
                  name: `Статья: ${item.title}`,
                })),
              ].map((item) => (
                <div
                  className="workflow-actions"
                  key={`${item.type}-${item.id}`}
                >
                  <span>{item.name}</span>
                  <button
                    type="button"
                    onClick={() => void restoreFromTrash(item.type, item.id)}
                  >
                    Восстановить
                  </button>
                </div>
              ))}
              {!trash.categories.length && !trash.articles.length ? (
                <p>Корзина пуста.</p>
              ) : null}
            </section>
          ) : null}

          {message ? <div className="inline-message">{message}</div> : null}
          <section className="stats-grid" aria-label="Сводка по контенту">
            <article>
              <span className="stat-icon violet">▤</span>
              <div>
                <b>{articles.length}</b>
                <small>Всего материалов</small>
              </div>
              <em>в базе CMS</em>
            </article>
            <article>
              <span className="stat-icon amber">◷</span>
              <div>
                <b>{count("editorial:review")}</b>
                <small>На согласовании</small>
              </div>
              <em className="muted">требуют внимания</em>
            </article>
            <article>
              <span className="stat-icon green">✓</span>
              <div>
                <b>{count("publication:published")}</b>
                <small>Опубликовано</small>
              </div>
              <em>готовы на сайте</em>
            </article>
            <article>
              <span className="stat-icon blue">✎</span>
              <div>
                <b>{count("editorial:draft")}</b>
                <small>Черновики</small>
              </div>
              <em className="muted">в работе</em>
            </article>
          </section>

          <section className="panel">
            <div className="panel-toolbar">
              <div className="tabs">
                {(
                  [
                    ["all", "Все"],
                    ["editorial:draft", "Черновики"],
                    ["editorial:review", "Согласование"],
                    ["editorial:changes", "Нужны правки"],
                    ["editorial:approved", "Одобрено"],
                    ["publication:published", "Опубликовано"],
                    ["publication:hidden", "Скрыто"],
                    ["publication:disabled", "Отключено"],
                    ["publication:archive", "Архив"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`tab ${filter === value ? "active" : ""}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}{" "}
                    <span>
                      {value === "all" ? articles.length : count(value)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="filters">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск по рубрикам и статьям"
                  aria-label="Поиск по рубрикам и статьям"
                />
                <select
                  aria-label="Фильтр по автору"
                  value={selectedAuthorId ?? ""}
                  onChange={(event) =>
                    setSelectedAuthorId(event.target.value || null)
                  }
                >
                  <option value="">Все авторы</option>
                  {authors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.fullName}
                    </option>
                  ))}
                </select>
                {canEdit ? (
                  <button onClick={() => setCatalog("author")}>＋ Автор</button>
                ) : null}
                <button
                  aria-pressed={!sortNewest}
                  onClick={() => setSortNewest((newest) => !newest)}
                >
                  ⇅ {sortNewest ? "Сначала новые" : "Сначала старые"}
                </button>
              </div>
            </div>
            {selectedIds.length ? (
              <div className="selection-bar">
                <span>
                  Выбрано материалов: <strong>{selectedIds.length}</strong>
                </span>
                <div className="selection-actions">
                  {canEdit ? (
                    <button
                      disabled={bulkBusy || !canSendSelectedToReview}
                      onClick={() =>
                        void changeSelectedStatus(
                          "review",
                          `Отправить выбранные материалы (${selectedArticles.length}) на согласование?`,
                        )
                      }
                    >
                      На согласование
                    </button>
                  ) : null}
                  {canApprove ? (
                    <>
                      <button
                        disabled={bulkBusy || !canApproveSelected}
                        onClick={() =>
                          void changeSelectedStatus(
                            "changes_requested",
                            `Вернуть выбранные материалы (${selectedArticles.length}) на доработку?`,
                          )
                        }
                      >
                        Нужны правки
                      </button>
                      <button
                        className="primary"
                        disabled={bulkBusy || !canApproveSelected}
                        onClick={() =>
                          void changeSelectedStatus(
                            "published",
                            `Одобрить выбранные материалы (${selectedArticles.length})?`,
                          )
                        }
                      >
                        Одобрить
                      </button>
                      <button
                        className="primary"
                        disabled={bulkBusy || !canPublishSelected}
                        onClick={() =>
                          void changeSelectedStatus(
                            "published",
                            `Опубликовать выбранные материалы (${selectedArticles.length})? Они сразу станут доступны посетителям.`,
                          )
                        }
                      >
                        Опубликовать
                      </button>
                      <button
                        disabled={bulkBusy || !canUnpublishSelected}
                        onClick={() =>
                          void changeSelectedStatus(
                            "draft",
                            `Снять выбранные материалы (${selectedArticles.length}) с публикации?`,
                          )
                        }
                      >
                        Снять с публикации
                      </button>
                    </>
                  ) : null}
                  {canEdit ? (
                    <button
                      className="danger"
                      disabled={bulkBusy || !canDeleteSelected}
                      onClick={() => void deleteSelectedArticles()}
                    >
                      Удалить
                    </button>
                  ) : null}
                  <button
                    disabled={bulkBusy}
                    onClick={() => setSelectedIds([])}
                  >
                    Снять выделение
                  </button>
                </div>
              </div>
            ) : null}
            <div className="content-structure-layout">
              <aside
                className="article-structure-tree"
                aria-label="Структура статей"
              >
                <header>
                  <div>
                    <strong>Структура статей</strong>
                    <span>Рубрики и материалы сайта</span>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      title="Добавить рубрику"
                      aria-label="Добавить рубрику"
                      onClick={() => {
                        setCategoryEditor("new");
                        setNewCategoryParentId(null);
                      }}
                    >
                      ＋
                    </button>
                  ) : null}
                </header>
                <div className="article-tree-scroll">
                  {categoryTreeRows.map((row) =>
                    row.kind === "category" ? (
                      <div
                        className={`article-tree-category ${selectedCategoryId === row.category.id ? "active" : ""}`}
                        key={`category-${row.category.id}`}
                        style={{ paddingLeft: `${8 + row.depth * 17}px` }}
                      >
                        <button
                          type="button"
                          className="article-tree-toggle"
                          disabled={!row.hasChildren}
                          aria-label={
                            collapsedCategoryIds.has(row.category.id)
                              ? `Раскрыть ${row.category.name}`
                              : `Свернуть ${row.category.name}`
                          }
                          onClick={() =>
                            setCollapsedCategoryIds((current) => {
                              const next = new Set(current);
                              if (next.has(row.category.id))
                                next.delete(row.category.id);
                              else next.add(row.category.id);
                              return next;
                            })
                          }
                        >
                          {row.hasChildren
                            ? collapsedCategoryIds.has(row.category.id)
                              ? "›"
                              : "⌄"
                            : ""}
                        </button>
                        <button
                          type="button"
                          className="article-tree-category-name"
                          onClick={() => openCategory(row.category.id)}
                        >
                          <i style={{ background: row.category.color }}>
                            {row.category.icon || "#"}
                          </i>
                          <span>
                            <strong>{row.category.name}</strong>
                            <small>
                              {
                                articles.filter(
                                  (article) =>
                                    article.categoryId === row.category.id,
                                ).length
                              }
                            </small>
                          </span>
                        </button>
                        {canEdit ? (
                          <div className="article-tree-actions">
                            <button
                              type="button"
                              title="Новая статья в рубрике"
                              aria-label={`Создать статью в рубрике ${row.category.name}`}
                              onClick={() => startNewArticle(row.category.id)}
                            >
                              ＋
                            </button>
                            <button
                              type="button"
                              title="Добавить дочернюю рубрику"
                              aria-label={`Добавить дочернюю рубрику в ${row.category.name}`}
                              onClick={() => {
                                setCategoryEditor("new");
                                setNewCategoryParentId(row.category.id);
                              }}
                            >
                              ⊞
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="article-tree-item"
                        key={`article-${row.article.id}`}
                        style={{ paddingLeft: `${31 + row.depth * 17}px` }}
                        onClick={() => void openEditor(row.article)}
                        title={row.article.title}
                      >
                        <span>▤</span>
                        <strong>{row.article.title}</strong>
                        <i
                          className={`status-dot status-dot-${row.article.status}`}
                        />
                      </button>
                    ),
                  )}
                  {!selectedCategoryId &&
                  visibleArticles.some((article) => !article.categoryId) ? (
                    <button
                      type="button"
                      className={`article-tree-all article-tree-uncategorized ${selectedCategoryId === "uncategorized" ? "active" : ""}`}
                      onClick={() => openCategory("uncategorized")}
                    >
                      <span>□</span>
                      <strong>Без рубрики</strong>
                      <small>
                        {
                          visibleArticles.filter(
                            (article) => !article.categoryId,
                          ).length
                        }
                      </small>
                    </button>
                  ) : null}
                </div>
              </aside>
              <div className="content-table-area">
                {selectedCategoryId &&
                selectedCategoryId !== "uncategorized" ? (
                  <header className="category-level-heading">
                    <button type="button" onClick={() => openCategory(null)}>
                      ← Ко всем статьям
                    </button>
                    <div>
                      <strong>
                        {categoryById.get(selectedCategoryId)?.name}
                      </strong>
                      <span>Рубрика и вложенная структура</span>
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          const category = categoryById.get(selectedCategoryId);
                          if (!category) return;
                          setCategoryEditor(category);
                          setCategoryTab("parameters");
                          setNewCategoryParentId(null);
                          if (siteId)
                            void Promise.all([
                              request<ContentEvent[]>(
                                `/api/sites/${siteId}/content/categories/${category.id}/events`,
                              ),
                              request<PendingSchedule | null>(
                                `/api/sites/${siteId}/content/categories/${category.id}/schedule`,
                              ),
                            ]).then(([rows, schedule]) => {
                              setCategoryActivity(
                                rows.map((row) => ({
                                  id: row.id,
                                  action: row.eventType,
                                  message: row.reason,
                                  createdAt: row.createdAt,
                                  user: row.actor,
                                })),
                              );
                              setCategorySchedule(schedule);
                            });
                        }}
                      >
                        Настроить категорию
                      </button>
                    ) : null}
                  </header>
                ) : null}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Выбрать все"
                            checked={allVisibleSelected}
                            onChange={toggleAllVisible}
                          />
                        </th>
                        <th>Название</th>
                        <th>Категория</th>
                        <th>Автор</th>
                        <th>Статус</th>
                        <th>Изменено</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleArticles.map((article) => (
                        <tr
                          key={article.id}
                          className={
                            selectedIds.includes(article.id) ? "selected" : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Выбрать ${article.title}`}
                              checked={selectedIds.includes(article.id)}
                              onChange={() => toggleArticle(article.id)}
                            />
                          </td>
                          <td>
                            <div className="article-title-cell">
                              {article.coverMedia ? (
                                <Image
                                  unoptimized
                                  width={42}
                                  height={34}
                                  src={`/api/sites/${siteId}/content/media/${article.coverMedia.id}/file`}
                                  alt=""
                                />
                              ) : null}
                              <span>
                                <button
                                  className="article-link"
                                  onClick={() => void openEditor(article)}
                                >
                                  {article.title}
                                </button>
                                <small>Статья · {siteName}</small>
                              </span>
                            </div>
                          </td>
                          <td>
                            <span
                              className="category-dot"
                              style={{ background: article.category?.color }}
                            />
                            {article.category?.name ?? "Без категории"}
                          </td>
                          <td>
                            {article.author ? (
                              <>
                                <span className="mini-avatar">
                                  {article.author.fullName
                                    .split(" ")
                                    .map((part) => part[0])
                                    .join("")
                                    .slice(0, 2)}
                                </span>
                                {article.author.fullName}
                              </>
                            ) : (
                              "Не назначен"
                            )}
                          </td>
                          <td>
                            <span
                              className={`status status-${article.publicationState}`}
                            >
                              {publicationNames[article.publicationState]}
                            </span>
                            <small>
                              {editorialNames[article.editorialState]}
                            </small>
                          </td>
                          <td className="date-cell">
                            {new Intl.DateTimeFormat("ru", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(article.updatedAt))}
                          </td>
                          <td>
                            <button
                              className="more-button"
                              onClick={() => void openEditor(article)}
                              aria-label="Редактировать"
                            >
                              •••
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!visibleArticles.length ? (
                    <div className="empty-content">
                      <span>▤</span>
                      <h2>Материалов пока нет</h2>
                      <p>
                        {canEdit
                          ? "Создайте первую статью или измените фильтр."
                          : "Материалы появятся здесь после создания редакцией."}
                      </p>
                      {canEdit ? (
                        <button onClick={() => startNewArticle()}>
                          Создать материал
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="pagination">
                  <span>
                    Показано {visibleArticles.length} из {articles.length}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {categoryEditor ? (
        <section
          className="category-settings-level"
          aria-label="Настройки рубрики"
        >
          <header>
            <div>
              <strong>
                {categoryEditor === "new"
                  ? "Новая рубрика"
                  : "Настройки рубрики"}
              </strong>
              <span>Настройки внутри раздела статей</span>
            </div>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => {
                setCategoryEditor(null);
                setNewCategoryParentId(null);
              }}
            >
              ×
            </button>
          </header>
          <nav className="category-settings-tabs" aria-label="Разделы рубрики">
            {(
              [
                ["parameters", "Параметры"],
                ["seo", "SEO"],
                ["history", "История изменений"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={categoryTab === value ? "active" : ""}
                onClick={() => setCategoryTab(value)}
              >
                {label}
              </button>
            ))}
          </nav>
          <form
            className="directory-form category-settings-form"
            onSubmit={saveCategory}
          >
            <div
              className={`category-tab-panel ${categoryTab === "parameters" ? "active" : ""}`}
            >
              <label>
                <span>Название</span>
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Название рубрики"
                  defaultValue={
                    categoryEditor === "new" ? "" : categoryEditor.name
                  }
                />
              </label>
              <label>
                <span>Адрес рубрики</span>
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="slug-latin"
                  defaultValue={
                    categoryEditor === "new" ? "" : categoryEditor.slug
                  }
                />
              </label>
              <label>
                <span>Описание</span>
                <textarea
                  name="description"
                  rows={5}
                  maxLength={10000}
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.description ?? "")
                  }
                />
              </label>
            </div>
            <div
              className={`category-tab-panel ${categoryTab === "parameters" ? "active" : ""}`}
            >
              <label>
                <span>Родительская рубрика</span>
                <select
                  name="parentId"
                  defaultValue={
                    categoryEditor === "new"
                      ? (newCategoryParentId ?? "")
                      : (categoryEditor.parentId ?? "")
                  }
                >
                  <option value="">Верхний уровень</option>
                  {categories
                    .filter(
                      (category) =>
                        categoryEditor === "new" ||
                        category.id !== categoryEditor.id,
                    )
                    .map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Порядок среди соседей</span>
                <input
                  name="sortOrder"
                  type="number"
                  min={-100000}
                  max={100000}
                  defaultValue={
                    categoryEditor === "new" ? 0 : categoryEditor.sortOrder
                  }
                />
              </label>
            </div>
            <div
              className={`category-tab-panel ${categoryTab === "parameters" ? "active" : ""}`}
            >
              {categoryEditor !== "new" ? (
                <div className="workflow-panel">
                  <strong>
                    Публикация:{" "}
                    {publicationNames[categoryEditor.publicationState]}
                  </strong>
                  <div className="workflow-actions">
                    {(
                      [
                        "draft",
                        "published",
                        "hidden",
                        "disabled",
                        "archive",
                      ] as PublicationState[]
                    ).map((state) => (
                      <button
                        key={state}
                        type="button"
                        disabled={
                          categoryBusy ||
                          state === categoryEditor.publicationState
                        }
                        onClick={() => void changeCategoryPublication(state)}
                      >
                        {publicationNames[state]}
                      </button>
                    ))}
                  </div>
                  <div className="editor-grid publication-settings">
                    {categorySchedule ? (
                      <div className="cms-preview-action">
                        <span>
                          {
                            publicationNames[
                              categorySchedule.targetPublicationState
                            ]
                          }{" "}
                          ·{" "}
                          {new Intl.DateTimeFormat("ru", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(categorySchedule.executeAt))}
                        </span>
                        <button
                          type="button"
                          onClick={() => void cancelCategorySchedule()}
                        >
                          Отменить
                        </button>
                      </div>
                    ) : null}
                    <input type="datetime-local" name="categoryScheduleAt" />
                    <select
                      name="categoryScheduleState"
                      defaultValue="published"
                    >
                      <option value="published">Опубликовать</option>
                      <option value="hidden">Скрыть</option>
                      <option value="disabled">Отключить</option>
                      <option value="archive">В архив</option>
                      <option value="draft">В черновик</option>
                    </select>
                    <button
                      type="button"
                      onClick={(event) =>
                        event.currentTarget.form &&
                        void scheduleCategory(event.currentTarget.form)
                      }
                    >
                      Запланировать
                    </button>
                  </div>
                </div>
              ) : (
                <p>Новая рубрика будет создана как черновик.</p>
              )}
              <label>
                <span>Шаблон рубрики</span>
                <select
                  name="displayTemplateSelection"
                  defaultValue={
                    categoryEditor === "new"
                      ? "standard-category@1"
                      : `${categoryEditor.displayTemplateKey}@${categoryEditor.displayTemplateVersion}`
                  }
                >
                  {templates
                    .filter((template) => template.kind === "category")
                    .map((template) => (
                      <option
                        key={template.id}
                        value={`${template.key}@${template.version}`}
                      >
                        {template.name} · v{template.version}
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
                    defaultValue={
                      categoryEditor === "new"
                        ? ""
                        : (categoryEditor.icon ?? "")
                    }
                  />
                </label>
                <label className="directory-color-field">
                  <span>Цвет</span>
                  <input
                    name="color"
                    type="color"
                    defaultValue={
                      categoryEditor === "new"
                        ? "#9f91ef"
                        : categoryEditor.color
                    }
                  />
                </label>
              </div>
              <label>
                <span>Изображение рубрики</span>
                <select
                  name="imageMediaId"
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.imageMediaId ?? "")
                  }
                >
                  <option value="">Не выбрано</option>
                  {media
                    .filter((item) => item.mimeType.startsWith("image/"))
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.originalName}
                      </option>
                    ))}
                </select>
              </label>
              {categoryEditor !== "new" && siteId && siteSlug ? (
                <a
                  href={`/preview/${siteSlug}/categories/${categoryEditor.slug}?cmsSiteId=${siteId}&cmsCategoryId=${categoryEditor.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Предпросмотр рубрики ↗
                </a>
              ) : null}
            </div>
            <div
              className={`category-tab-panel ${categoryTab === "seo" ? "active" : ""}`}
            >
              <label>
                <span>SEO-заголовок</span>
                <input
                  name="seoTitle"
                  maxLength={240}
                  placeholder="Если пусто, используется название"
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.seoTitle ?? "")
                  }
                />
              </label>
              <label>
                <span>SEO-описание</span>
                <textarea
                  name="seoDescription"
                  maxLength={500}
                  rows={4}
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.seoDescription ?? "")
                  }
                />
              </label>
              <label>
                <span>Канонический адрес</span>
                <input
                  name="canonicalUrl"
                  type="url"
                  maxLength={500}
                  placeholder="https://example.ru/categories/news"
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.canonicalUrl ?? "")
                  }
                />
              </label>
              <label>
                <span>OG-заголовок</span>
                <input
                  name="ogTitle"
                  maxLength={240}
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.ogTitle ?? "")
                  }
                />
              </label>
              <label>
                <span>OG-описание</span>
                <textarea
                  name="ogDescription"
                  maxLength={500}
                  rows={3}
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.ogDescription ?? "")
                  }
                />
              </label>
              <label>
                <span>OG-изображение</span>
                <select
                  name="ogImageMediaId"
                  defaultValue={
                    categoryEditor === "new"
                      ? ""
                      : (categoryEditor.ogImageMediaId ?? "")
                  }
                >
                  <option value="">Не выбрано</option>
                  {media
                    .filter((item) => item.mimeType.startsWith("image/"))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
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
                    categoryEditor === "new" || !categoryEditor.structuredData
                      ? ""
                      : JSON.stringify(categoryEditor.structuredData, null, 2)
                  }
                />
              </label>
              <label className="category-checkbox">
                <input
                  name="noIndex"
                  type="checkbox"
                  defaultChecked={
                    categoryEditor === "new" ? false : categoryEditor.noIndex
                  }
                />
                <span>Запретить индексацию этой рубрики</span>
              </label>
              {categoryEditor !== "new" ? (
                <div className="redirect-aliases">
                  <strong>Прежние адреса</strong>
                  {categoryEditor.redirects.length ? (
                    categoryEditor.redirects.map((redirect) => (
                      <div key={redirect.id}>
                        <code>/categories/{redirect.fromSlug}</code>
                        <button
                          type="button"
                          onClick={() =>
                            siteId &&
                            void request(
                              `/api/sites/${siteId}/content/categories/${categoryEditor.id}/redirects/${redirect.id}`,
                              { method: "DELETE" },
                            ).then(load)
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    ))
                  ) : (
                    <small>Прежних адресов нет.</small>
                  )}
                </div>
              ) : null}
            </div>
            <div
              className={`category-tab-panel ${categoryTab === "history" ? "active" : ""}`}
            >
              {categoryEditor !== "new" ? (
                <>
                  <p>
                    Создано{" "}
                    {categoryEditor.createdBy?.fullName ??
                      "пользователь не определён"}
                    ,{" "}
                    {new Intl.DateTimeFormat("ru", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(categoryEditor.createdAt))}
                  </p>
                  <p>
                    Обновлено{" "}
                    {categoryEditor.updatedBy?.fullName ??
                      "пользователь не определён"}
                    ,{" "}
                    {new Intl.DateTimeFormat("ru", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(categoryEditor.updatedAt))}
                  </p>
                  <div className="activity-list">
                    {categoryActivity.map((item) => (
                      <article key={item.id}>
                        <div>
                          <strong>{item.user?.fullName ?? "Система"}</strong>
                          <small>
                            {new Intl.DateTimeFormat("ru", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(item.createdAt))}
                          </small>
                          <p>{item.message ?? item.action}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p>История появится после создания рубрики.</p>
              )}
            </div>
            <div className="directory-form-actions">
              {categoryEditor !== "new" ? (
                <>
                  <button
                    type="button"
                    disabled={categoryBusy}
                    onClick={() => void duplicateCategory()}
                  >
                    Создать копию
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={categoryBusy}
                    onClick={() => void deleteCategory(categoryEditor)}
                  >
                    В корзину
                  </button>
                </>
              ) : null}
              <button disabled={categoryBusy}>
                {categoryBusy ? "Сохраняем…" : "Сохранить"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCategoryEditor(null);
                  setNewCategoryParentId(null);
                }}
              >
                Отмена
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {editor ? (
        <div className="drawer-backdrop" onMouseDown={closeEditor}>
          <aside
            className="editor-drawer"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>
                  {editor === "new"
                    ? "НОВЫЙ МАТЕРИАЛ"
                    : editorCanEdit
                      ? "РЕДАКТИРОВАНИЕ"
                      : "ПРОСМОТР И СОГЛАСОВАНИЕ"}
                </small>
                <h2>{editor === "new" ? "Создать статью" : editor.title}</h2>
              </div>
              <button onClick={closeEditor}>×</button>
            </header>
            <form
              onSubmit={saveArticle}
              onChange={(event) => {
                if (
                  editorCanEdit &&
                  !(event.target as HTMLElement).closest(".comment-form") &&
                  (event.target as HTMLElement).getAttribute("name") !== "body"
                )
                  setDirty(true);
              }}
            >
              <nav className="article-editor-tabs" aria-label="Разделы статьи">
                {(
                  [
                    ["editor", "Редактор"],
                    ["parameters", "Параметры"],
                    ["seo", "SEO"],
                    ["history", "История изменений"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={editorTab === id ? "active" : ""}
                    aria-current={editorTab === id ? "page" : undefined}
                    onClick={() => setEditorTab(id)}
                  >
                    {label}
                  </button>
                ))}
                {editor !== "new" ? (
                  <span className={`autosave-status ${autosaveStatus}`}>
                    {autosaveStatus === "saving" ? (
                      "Сохраняем…"
                    ) : autosaveStatus === "conflict" ? (
                      "Конфликт версий — скопируйте текст и перезагрузите"
                    ) : autosaveStatus === "error" ? (
                      <button
                        type="button"
                        onClick={() => {
                          autosavePendingBody.current = JSON.stringify(
                            articleDocumentRef.current,
                          );
                          autosaveBlocked.current = false;
                          void drainAutosave().catch(() => undefined);
                        }}
                      >
                        Ошибка — повторить
                      </button>
                    ) : (
                      "Сохранено"
                    )}
                  </span>
                ) : null}
              </nav>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Название
                <input
                  name="title"
                  readOnly={!editorCanEdit}
                  defaultValue={editor === "new" ? "" : editor.title}
                  required
                  minLength={2}
                />
              </label>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Slug
                <input
                  name="slug"
                  readOnly={!editorCanEdit}
                  defaultValue={editor === "new" ? "" : editor.slug}
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  onFocus={(event) => {
                    if (editorCanEdit && !event.currentTarget.value) {
                      const title =
                        event.currentTarget.form?.elements.namedItem(
                          "title",
                        ) as HTMLInputElement;
                      event.currentTarget.value = slugify(title?.value ?? "");
                      setDirty(true);
                    }
                  }}
                />
              </label>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Краткое описание
                <textarea
                  name="excerpt"
                  readOnly={!editorCanEdit}
                  rows={3}
                  defaultValue={editor === "new" ? "" : (editor.excerpt ?? "")}
                />
              </label>
              <div
                className={`article-tab-panel ${editorTab === "editor" ? "active" : ""}`}
              >
                <StructuredArticleEditor
                  value={articleDocument}
                  media={media.filter((item) =>
                    item.mimeType.startsWith("image/"),
                  )}
                  readOnly={!editorCanEdit}
                  onChange={(document) => {
                    articleDocumentRef.current = document;
                    setArticleDocument(document);
                    const body = documentText(document);
                    articleBodyRef.current = body;
                    setArticleBody(body);
                  }}
                />
              </div>
              <div
                className={`editor-grid article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                <label>
                  Категория
                  <select
                    name="categoryId"
                    disabled={!editorCanEdit}
                    defaultValue={
                      editor === "new"
                        ? (newArticleCategoryId ?? "")
                        : (editor.categoryId ?? "")
                    }
                  >
                    <option value="">Без категории</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Автор
                  <select
                    name="authorId"
                    disabled={!editorCanEdit}
                    defaultValue={
                      editor === "new" ? "" : (editor.authorId ?? "")
                    }
                  >
                    <option value="">Не назначен</option>
                    {authors.map((author) => (
                      <option key={author.id} value={author.id}>
                        {author.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Обложка
                <select
                  name="coverMediaId"
                  disabled={!editorCanEdit}
                  defaultValue={
                    editor === "new" ? "" : (editor.coverMediaId ?? "")
                  }
                >
                  <option value="">Без обложки</option>
                  {media.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.altText || item.originalName}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Изображение превью
                <select
                  name="previewMediaId"
                  disabled={!editorCanEdit}
                  defaultValue={
                    editor === "new" ? "" : (editor.previewMediaId ?? "")
                  }
                >
                  <option value="">Использовать обложку</option>
                  {media.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.altText || item.originalName}
                    </option>
                  ))}
                </select>
                <small>Отдельное изображение для карточек и списков.</small>
              </label>
              <label
                className={`article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
              >
                Шаблон статьи
                <select
                  name="displayTemplateSelection"
                  disabled={!editorCanEdit}
                  defaultValue={
                    editor === "new"
                      ? "standard-article@1"
                      : `${editor.displayTemplateKey}@${editor.displayTemplateVersion}`
                  }
                >
                  {templates
                    .filter((template) => template.kind === "article")
                    .map((template) => (
                      <option
                        key={template.id}
                        value={`${template.key}@${template.version}`}
                      >
                        {template.name} · v{template.version}
                      </option>
                    ))}
                </select>
              </label>
              {editor !== "new" ? (
                <section
                  className={`workflow-panel article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
                >
                  <strong>Связанные материалы · ручной порядок</strong>
                  {relatedIds.map((id, index) => {
                    const related = articles.find(
                      (article) => article.id === id,
                    );
                    return (
                      <div className="workflow-actions" key={id}>
                        <span>{related?.title ?? id}</span>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() =>
                            setRelatedIds((rows) => {
                              const next = [...rows];
                              [next[index - 1], next[index]] = [
                                next[index],
                                next[index - 1],
                              ];
                              return next;
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === relatedIds.length - 1}
                          onClick={() =>
                            setRelatedIds((rows) => {
                              const next = [...rows];
                              [next[index], next[index + 1]] = [
                                next[index + 1],
                                next[index],
                              ];
                              return next;
                            })
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRelatedIds((rows) =>
                              rows.filter((row) => row !== id),
                            )
                          }
                        >
                          Удалить
                        </button>
                      </div>
                    );
                  })}
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value)
                        setRelatedIds((rows) => [...rows, event.target.value]);
                    }}
                  >
                    <option value="">Добавить материал…</option>
                    {articles
                      .filter(
                        (article) =>
                          article.id !== editor.id &&
                          !relatedIds.includes(article.id),
                      )
                      .map((article) => (
                        <option key={article.id} value={article.id}>
                          {article.title}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void saveRelatedArticles()}
                  >
                    Сохранить связи
                  </button>
                </section>
              ) : null}
              <details
                className={`item-seo-editor article-tab-panel ${editorTab === "seo" ? "active" : ""}`}
                open
              >
                <summary>SEO для материала</summary>
                <p>
                  Если поля пустые, заголовок и описание возьмутся из материала,
                  а адрес — из общих настроек сайта.
                </p>
                <label>
                  Заголовок в поиске
                  <input
                    name="seoTitle"
                    readOnly={!editorCanEdit}
                    maxLength={240}
                    defaultValue={
                      editor === "new" ? "" : (editor.seoTitle ?? "")
                    }
                    placeholder="До 60–70 символов"
                  />
                </label>
                <label>
                  Описание в поиске
                  <textarea
                    name="seoDescription"
                    readOnly={!editorCanEdit}
                    rows={3}
                    maxLength={500}
                    defaultValue={
                      editor === "new" ? "" : (editor.seoDescription ?? "")
                    }
                    placeholder="Краткое описание страницы для поисковой выдачи"
                  />
                </label>
                <label>
                  Канонический адрес
                  <input
                    name="canonicalUrl"
                    readOnly={!editorCanEdit}
                    maxLength={500}
                    defaultValue={
                      editor === "new" ? "" : (editor.canonicalUrl ?? "")
                    }
                    placeholder="https://example.ru/articles/material"
                  />
                </label>
                <label>
                  OG-заголовок
                  <input
                    name="ogTitle"
                    readOnly={!editorCanEdit}
                    maxLength={240}
                    defaultValue={
                      editor === "new" ? "" : (editor.ogTitle ?? "")
                    }
                  />
                </label>
                <label>
                  OG-описание
                  <textarea
                    name="ogDescription"
                    readOnly={!editorCanEdit}
                    rows={3}
                    maxLength={500}
                    defaultValue={
                      editor === "new" ? "" : (editor.ogDescription ?? "")
                    }
                  />
                </label>
                <label>
                  OG-изображение
                  <select
                    name="ogImageMediaId"
                    disabled={!editorCanEdit}
                    defaultValue={
                      editor === "new" ? "" : (editor.ogImageMediaId ?? "")
                    }
                  >
                    <option value="">Не выбрано</option>
                    {media
                      .filter((item) => item.mimeType.startsWith("image/"))
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.originalName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Структурированные данные (JSON)
                  <textarea
                    name="structuredData"
                    readOnly={!editorCanEdit}
                    rows={6}
                    defaultValue={
                      editor === "new" || !editor.structuredData
                        ? ""
                        : JSON.stringify(editor.structuredData, null, 2)
                    }
                  />
                </label>
                <label className="item-seo-checkbox">
                  <input
                    type="checkbox"
                    name="noIndex"
                    disabled={!editorCanEdit}
                    defaultChecked={editor === "new" ? false : editor.noIndex}
                  />
                  <span>
                    Скрыть материал от поисковых систем
                    <small>Добавляет директиву noindex, nofollow</small>
                  </span>
                </label>
                {editor !== "new" ? (
                  <div className="redirect-aliases">
                    <strong>Прежние адреса</strong>
                    {articleRedirects.length ? (
                      articleRedirects.map((redirect) => (
                        <div key={redirect.id}>
                          <code>/articles/{redirect.fromSlug}</code>
                          {editorCanEdit ? (
                            <button
                              type="button"
                              onClick={() =>
                                void removeArticleRedirect(redirect.id)
                              }
                            >
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <small>Прежних адресов нет.</small>
                    )}
                  </div>
                ) : null}
              </details>
              {editor === "new" ? (
                <section
                  className={`workflow-panel article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
                >
                  <input type="hidden" name="status" value="draft" />
                  <div className="editor-grid publication-settings">
                    <label>
                      Дата публикации
                      <input type="datetime-local" name="publishedAt" />
                      <small>
                        Материал станет видимым только после публикации и
                        наступления этой даты.
                      </small>
                    </label>
                    <label>
                      Порядок в ленте
                      <input
                        type="number"
                        name="sortOrder"
                        min={-100000}
                        max={100000}
                        defaultValue={0}
                      />
                      <small>Меньшее число показывается раньше.</small>
                    </label>
                  </div>
                  <p className="publication-hint">
                    Новый материал сохраняется как черновик. После создания его
                    можно отправить на согласование.
                  </p>
                </section>
              ) : (
                <section
                  className={`workflow-panel article-tab-panel ${editorTab === "parameters" ? "active" : ""}`}
                >
                  <div className="editor-grid publication-settings">
                    <label>
                      Дата публикации
                      <input
                        type="datetime-local"
                        name="publishedAt"
                        readOnly={!editorCanEdit}
                        defaultValue={
                          editor.publishedAt
                            ? new Date(editor.publishedAt)
                                .toISOString()
                                .slice(0, 16)
                            : ""
                        }
                      />
                      <small>
                        Будущая дата скроет материал до указанного времени.
                      </small>
                    </label>
                    <label>
                      Порядок в ленте
                      <input
                        type="number"
                        name="sortOrder"
                        min={-100000}
                        max={100000}
                        readOnly={!editorCanEdit}
                        defaultValue={editor.sortOrder ?? 0}
                      />
                      <small>Меньшее число показывается раньше.</small>
                    </label>
                  </div>
                  <header>
                    <span>
                      Редакция:{" "}
                      <strong>{editorialNames[editor.editorialState]}</strong>
                    </span>
                    <span>
                      Публикация:{" "}
                      <strong>
                        {publicationNames[editor.publicationState]}
                      </strong>
                    </span>
                  </header>
                  {editor.publicationState === "published" &&
                  editor.publishedAt ? (
                    <div className="publication-meta">
                      <span>
                        Опубликовано{" "}
                        {new Intl.DateTimeFormat("ru", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(editor.publishedAt))}
                      </span>
                      {siteSlug ? (
                        <a
                          href={`/preview/${siteSlug}/articles/${editor.slug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Открыть статью ↗
                        </a>
                      ) : null}
                    </div>
                  ) : siteId && siteSlug ? (
                    <div className="cms-preview-action">
                      <span>Последняя сохранённая версия</span>
                      <a
                        href={`/preview/${siteSlug}/articles/${editor.slug}?cmsSiteId=${siteId}&cmsArticleId=${editor.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Предпросмотр ↗
                      </a>
                    </div>
                  ) : (
                    <p className="publication-hint">
                      {editorCanEdit
                        ? "При смене статуса актуальные изменения сохранятся автоматически."
                        : "Доступные действия зависят от вашей роли в рабочем пространстве."}
                    </p>
                  )}
                  {pendingSchedule ? (
                    <div className="cms-preview-action">
                      <span>
                        Запланировано:{" "}
                        {
                          publicationNames[
                            pendingSchedule.targetPublicationState
                          ]
                        }{" "}
                        ·{" "}
                        {new Intl.DateTimeFormat("ru", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(pendingSchedule.executeAt))}
                      </span>
                      <button
                        type="button"
                        onClick={() => void cancelArticleSchedule()}
                      >
                        Отменить
                      </button>
                    </div>
                  ) : null}
                  <div className="editor-grid publication-settings">
                    <label>
                      Запланировать переход
                      <input type="datetime-local" name="scheduleAt" />
                    </label>
                    <label>
                      Состояние
                      <select name="scheduleState" defaultValue="published">
                        <option value="published">Опубликовать</option>
                        <option value="hidden">Скрыть из списков</option>
                        <option value="disabled">Отключить</option>
                        <option value="archive">В архив</option>
                        <option value="draft">В черновик</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={(event) =>
                        event.currentTarget.form &&
                        void scheduleArticle(event.currentTarget.form)
                      }
                    >
                      Запланировать
                    </button>
                  </div>
                  <div className="workflow-actions">
                    {canEdit &&
                    (editor.editorialState === "draft" ||
                      editor.editorialState === "changes") ? (
                      <button
                        disabled={statusBusy}
                        type="button"
                        onClick={(event) =>
                          void changeStatus("review", event.currentTarget.form)
                        }
                      >
                        Отправить на согласование
                      </button>
                    ) : null}
                    {canApprove && editor.editorialState === "review" ? (
                      <>
                        <button
                          disabled={statusBusy}
                          type="button"
                          className="changes"
                          onClick={(event) =>
                            void changeStatus(
                              "changes_requested",
                              event.currentTarget.form,
                            )
                          }
                        >
                          Нужны правки
                        </button>
                        <button
                          disabled={statusBusy}
                          type="button"
                          className="publish"
                          onClick={(event) =>
                            void approveEditorial(event.currentTarget.form)
                          }
                        >
                          {statusBusy ? "Одобряем…" : "Одобрить"}
                        </button>
                      </>
                    ) : null}
                    {canApprove &&
                    editor.editorialState === "approved" &&
                    editor.publicationState !== "published" ? (
                      <button
                        disabled={statusBusy}
                        type="button"
                        className="publish"
                        onClick={(event) =>
                          void changeStatus(
                            "published",
                            event.currentTarget.form,
                          )
                        }
                      >
                        Опубликовать
                      </button>
                    ) : null}
                    {canApprove && editor.publicationState === "published" ? (
                      <>
                        <button
                          disabled={statusBusy}
                          type="button"
                          className="changes"
                          onClick={(event) =>
                            void changeStatus("draft", event.currentTarget.form)
                          }
                        >
                          Снять с публикации
                        </button>
                        <button
                          disabled={statusBusy}
                          type="button"
                          onClick={(event) =>
                            void changeStatus(
                              "hidden",
                              event.currentTarget.form,
                            )
                          }
                        >
                          Скрыть
                        </button>
                      </>
                    ) : null}
                    {canApprove && editor.publicationState === "hidden" ? (
                      <>
                        <button
                          disabled={statusBusy}
                          type="button"
                          onClick={(event) =>
                            void changeStatus("draft", event.currentTarget.form)
                          }
                        >
                          В черновик
                        </button>
                        <button
                          disabled={statusBusy}
                          type="button"
                          className="publish"
                          onClick={(event) =>
                            void changeStatus(
                              "published",
                              event.currentTarget.form,
                            )
                          }
                        >
                          Опубликовать снова
                        </button>
                      </>
                    ) : null}
                    {canApprove && editor.publicationState !== "disabled" ? (
                      <button
                        disabled={statusBusy}
                        type="button"
                        onClick={() =>
                          siteId &&
                          request<Article>(
                            `/api/sites/${siteId}/content/articles/${editor.id}/publication`,
                            {
                              method: "POST",
                              body: JSON.stringify({ state: "disabled" }),
                            },
                          ).then((updated) => {
                            setEditor((current) =>
                              current && current !== "new"
                                ? { ...current, ...updated }
                                : current,
                            );
                            void load();
                          })
                        }
                      >
                        Отключить
                      </button>
                    ) : null}
                    {canApprove && editor.publicationState !== "archive" ? (
                      <button
                        disabled={statusBusy}
                        type="button"
                        onClick={() =>
                          siteId &&
                          request<Article>(
                            `/api/sites/${siteId}/content/articles/${editor.id}/publication`,
                            {
                              method: "POST",
                              body: JSON.stringify({ state: "archive" }),
                            },
                          ).then((updated) => {
                            setEditor((current) =>
                              current && current !== "new"
                                ? { ...current, ...updated }
                                : current,
                            );
                            void load();
                          })
                        }
                      >
                        В архив
                      </button>
                    ) : null}
                  </div>
                </section>
              )}
              {editor !== "new" ? (
                <section
                  className={`activity-panel article-tab-panel ${editorTab === "history" ? "active" : ""}`}
                >
                  <h3>Обсуждение и история</h3>
                  <p className="article-system-history">
                    Создано{" "}
                    {editor.createdBy?.fullName ?? "пользователь не определён"},{" "}
                    {new Intl.DateTimeFormat("ru", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(editor.createdAt))}
                    {" · "}Обновлено{" "}
                    {editor.updatedBy?.fullName ?? "пользователь не определён"},{" "}
                    {new Intl.DateTimeFormat("ru", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(editor.updatedAt))}
                  </p>
                  <h4>Версии</h4>
                  <div className="activity-list">
                    {articleVersions.map((version) => (
                      <article key={version.id}>
                        <div>
                          <strong>Версия {version.versionNumber}</strong>
                          <small>
                            {version.actor?.fullName ?? "Система"} ·{" "}
                            {new Intl.DateTimeFormat("ru", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(version.createdAt))}
                          </small>
                          <p>{version.reason}</p>
                          {editorCanEdit ? (
                            <div className="workflow-actions">
                              <button
                                type="button"
                                onClick={() => void compareVersion(version)}
                              >
                                Сравнить с текущей
                              </button>
                              <button
                                type="button"
                                onClick={() => void restoreVersion(version)}
                              >
                                Восстановить как новую
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                  <h4>Неизменяемые события</h4>
                  <div className="activity-list">
                    {contentEvents.map((item) => (
                      <article key={item.id}>
                        <div>
                          <strong>{item.actor?.fullName ?? "Система"}</strong>
                          <small>
                            {new Intl.DateTimeFormat("ru", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(item.createdAt))}
                          </small>
                          <p>{item.reason ?? item.eventType}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  <h4>Обсуждение</h4>
                  <div className="comment-form">
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      placeholder="Добавить комментарий…"
                    />
                    <button
                      type="button"
                      disabled={!comment.trim()}
                      onClick={() => void addComment()}
                    >
                      Отправить
                    </button>
                  </div>
                  <div className="activity-list">
                    {activity.map((item) => (
                      <article key={item.id}>
                        <span>
                          {item.user.fullName
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                        <div>
                          <strong>{item.user.fullName}</strong>
                          <small>
                            {new Intl.DateTimeFormat("ru", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(item.createdAt))}
                          </small>
                          <p>
                            {item.type === "status_changed" && item.toStatus
                              ? `Изменил статус: ${statusNames[item.toStatus]}`
                              : item.message}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
              <footer>
                {dirty ? (
                  <span className="unsaved-indicator">● Не сохранено</span>
                ) : null}
                {editor !== "new" &&
                canEdit &&
                editor.publicationState !== "published" ? (
                  <>
                    <button
                      type="button"
                      disabled={statusBusy}
                      onClick={() => void duplicateArticle()}
                    >
                      Создать копию
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={statusBusy}
                      onClick={() => void deleteArticle()}
                    >
                      В корзину
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  onClick={closeEditor}
                >
                  {editorCanEdit ? "Отмена" : "Закрыть"}
                </button>
                {editorCanEdit ? (
                  <button type="submit">
                    {editor === "new"
                      ? "Создать материал"
                      : "Сохранить изменения"}
                  </button>
                ) : null}
              </footer>
            </form>
          </aside>
        </div>
      ) : null}

      {catalog ? (
        <div className="drawer-backdrop" onMouseDown={() => setCatalog(null)}>
          <form
            className="catalog-dialog"
            onSubmit={createCatalogItem}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2>Новый автор</h2>
              <button type="button" onClick={() => setCatalog(null)}>
                ×
              </button>
            </header>
            <label>
              Имя и фамилия
              <input name="fullName" required />
            </label>
            <label>
              Почта
              <input name="email" type="email" />
            </label>
            <label>
              Описание
              <textarea name="bio" rows={4} />
            </label>
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setCatalog(null)}
              >
                Отмена
              </button>
              <button>Добавить</button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
