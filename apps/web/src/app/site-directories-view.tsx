"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
  return response.json();
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
  mode,
  canEdit = true,
  focusId,
  focusRequestId,
}: {
  siteId?: string;
  siteName?: string;
  mode: DirectoryMode;
  canEdit?: boolean;
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
          }
        : {
            fullName: String(data.get("fullName") ?? ""),
            email: String(data.get("email") ?? "").trim() || null,
            bio: String(data.get("bio") ?? "").trim() || null,
          };
    setBusy(true);
    setMessage("");
    try {
      await api(
        `/api/sites/${siteId}/content/${mode}${itemId ? `/${itemId}` : ""}`,
        {
          method: itemId ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      setCreating(false);
      setEditingId(null);
      setNewParentId(null);
      setMessage(
        mode === "categories"
          ? itemId
            ? "Рубрика обновлена"
            : "Рубрика добавлена"
          : itemId
            ? "Автор обновлён"
            : "Автор добавлен",
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

  const categoryForm = (category?: Category) => (
    <form
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

  const authorForm = (author?: Author) => (
    <form
      className="directory-form directory-edit-form author-edit-form"
      onSubmit={(event) => save(event, author?.id)}
    >
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
        <button disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setCreating(false);
            setEditingId(null);
          }}
        >
          Отмена
        </button>
      </div>
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
                      setMessage("");
                    }}
                  >
                    ＋
                  </button>
                  <button
                    aria-label={`Настроить рубрику ${category.name}`}
                    title="Настройки рубрики"
                    onClick={() => {
                      setEditingId(category.id);
                      setCreating(false);
                      setNewParentId(null);
                      setMessage("");
                    }}
                  >
                    ⚙
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    aria-label={`Удалить рубрику ${category.name}`}
                    onClick={() => void remove(category)}
                  >
                    ×
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
                {canEdit ? (
                  <div className="directory-actions">
                    <button
                      aria-label={`Редактировать автора ${author.fullName}`}
                      onClick={() => {
                        setEditingId(author.id);
                        setCreating(false);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      aria-label={`Удалить автора ${author.fullName}`}
                      onClick={() => void remove(author)}
                    >
                      ×
                    </button>
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
