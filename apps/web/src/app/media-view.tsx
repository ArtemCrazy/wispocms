"use client";

import Image from "next/image";
import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type MediaItem = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  altText: string | null;
  createdAt: string;
  site: { id: string; name: string; slug: string } | null;
};

const acceptedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const maxFileSize = 8 * 1024 * 1024;

function fileError(file: File) {
  if (!acceptedTypes.has(file.type)) return "Разрешены JPG, PNG, WebP и GIF";
  if (file.size > maxFileSize)
    return "Размер изображения не должен превышать 8 МБ";
  return "";
}

function formatSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} МБ`
    : `${(size / 1024).toFixed(1)} КБ`;
}

export function MediaView({
  siteId,
  siteName,
  workspaceName,
  canEdit = true,
}: {
  siteId?: string;
  siteName?: string;
  workspaceName?: string;
  canEdit?: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [formatFilter, setFormatFilter] = useState("all");
  const [altFilter, setAltFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [sortOrder, setSortOrder] = useState<
    "newest" | "oldest" | "largest"
  >("newest");

  const previewUrl = useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : ""),
    [selectedFile],
  );

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const load = useCallback(async () => {
    if (!siteId) return;
    const response = await fetch(`/api/sites/${siteId}/content/media`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Не удалось загрузить медиатеку");
    setItems(await response.json());
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  function selectFile(file?: File) {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const error = fileError(file);
    if (error) {
      setSelectedFile(null);
      setMessage(error);
      return;
    }
    setMessage("");
    setSelectedFile(file);
  }

  function dropFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !selectedFile) {
      setMessage("Выберите файл изображения");
      return;
    }
    setUploading(true);
    setMessage("");
    const form = event.currentTarget;
    const payload = new FormData(form);
    payload.set("file", selectedFile, selectedFile.name);
    try {
      const response = await fetch(`/api/sites/${siteId}/content/media`, {
        method: "POST",
        credentials: "include",
        body: payload,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(
          Array.isArray(result?.message)
            ? result.message.join(", ")
            : (result?.message ?? "Не удалось загрузить файл"),
        );
      }
      form.reset();
      setSelectedFile(null);
      setMessage("Изображение добавлено в медиатеку");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить файл",
      );
    } finally {
      setUploading(false);
    }
  }

  async function updateAlt(item: MediaItem) {
    if (!siteId) return;
    setBusyId(item.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/sites/${siteId}/content/media/${item.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ altText: altDraft.trim() || null }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Не удалось сохранить описание");
      }
      setEditingId(null);
      setMessage("Описание изображения сохранено");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить описание",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: MediaItem) {
    if (!siteId || !window.confirm(`Удалить файл «${item.originalName}»?`))
      return;
    setBusyId(item.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/sites/${siteId}/content/media/${item.id}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Не удалось удалить файл");
      }
      setMessage("Изображение удалено");
      await load();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось удалить файл",
      );
    } finally {
      setBusyId(null);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => {
          const hasAlt = Boolean(item.altText?.trim());
          return (
            `${item.originalName} ${item.altText ?? ""}`
              .toLowerCase()
              .includes(normalizedQuery) &&
            (formatFilter === "all" || item.mimeType === formatFilter) &&
            (altFilter === "all" ||
              (altFilter === "with" ? hasAlt : !hasAlt))
          );
        })
        .sort((left, right) => {
          if (sortOrder === "largest") return right.size - left.size;
          const difference =
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime();
          return sortOrder === "newest" ? difference : -difference;
        }),
    [altFilter, formatFilter, items, normalizedQuery, sortOrder],
  );

  return (
    <section className="media-section">
      <div className="section-heading">
        <div>
          <h1>Контентный центр</h1>
          <p>
            Общая библиотека рабочего пространства {workspaceName ?? "не выбрано"}
            {siteName ? ` · загрузка из сайта ${siteName}` : ""}
          </p>
        </div>
      </div>
      {message ? <div className="inline-message">{message}</div> : null}
      {canEdit ? (
        <form className="media-upload" onSubmit={upload}>
          <label
            className={`media-dropzone ${dragActive ? "active" : ""} ${selectedFile ? "has-file" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={dropFile}
          >
            {previewUrl ? (
              <Image
                unoptimized
                width={68}
                height={52}
                src={previewUrl}
                alt="Предпросмотр выбранного изображения"
              />
            ) : (
              <span className="media-drop-icon">▧</span>
            )}
            <span>
              <strong>
                {selectedFile?.name ?? "Перетащите изображение сюда"}
              </strong>
              <small>
                {selectedFile
                  ? `${formatSize(selectedFile.size)} · нажмите, чтобы заменить`
                  : "или нажмите, чтобы выбрать файл"}
              </small>
            </span>
            <input
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Выбрать изображение"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
          <label className="media-alt-field">
            <span>Описание для доступности</span>
            <input
              name="altText"
              placeholder="Например: команда на конференции"
              maxLength={300}
            />
          </label>
          <button disabled={uploading || !siteId || !selectedFile}>
            {uploading ? "Загружаем…" : "＋ Добавить файл"}
          </button>
          <small className="media-upload-note">
            JPG, PNG, WebP или GIF · до 8 МБ
          </small>
        </form>
      ) : null}
      {items.length ? (
        <div className="media-toolbar">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти по имени или описанию"
              aria-label="Поиск изображений"
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить поиск изображений"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            ) : null}
          </label>
          <select
            aria-label="Фильтр изображений по формату"
            value={formatFilter}
            onChange={(event) => setFormatFilter(event.target.value)}
          >
            <option value="all">Все форматы</option>
            <option value="image/jpeg">JPG</option>
            <option value="image/png">PNG</option>
            <option value="image/webp">WebP</option>
            <option value="image/gif">GIF</option>
          </select>
          <select
            aria-label="Фильтр изображений по alt-описанию"
            value={altFilter}
            onChange={(event) =>
              setAltFilter(event.target.value as "all" | "with" | "without")
            }
          >
            <option value="all">Любое описание</option>
            <option value="with">Alt заполнен</option>
            <option value="without">Без alt</option>
          </select>
          <select
            aria-label="Сортировка изображений"
            value={sortOrder}
            onChange={(event) =>
              setSortOrder(
                event.target.value as "newest" | "oldest" | "largest",
              )
            }
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала старые</option>
            <option value="largest">Сначала крупные</option>
          </select>
          <small>
            Показано {visibleItems.length} из {items.length}
          </small>
        </div>
      ) : null}
      {visibleItems.length ? (
        <div className="media-grid">
          {visibleItems.map((item) => (
            <article key={item.id}>
              <Image
                unoptimized
                width={640}
                height={480}
                src={`/api/sites/${siteId}/content/media/${item.id}/file`}
                alt={item.altText ?? item.originalName}
              />
              <div>
                {editingId === item.id ? (
                  <div className="media-alt-editor">
                    <label>
                      <span>Alt-описание</span>
                      <input
                        autoFocus
                        value={altDraft}
                        onChange={(event) => setAltDraft(event.target.value)}
                        maxLength={300}
                      />
                    </label>
                    <div>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void updateAlt(item)}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setEditingId(null)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong>{item.altText || "Описание не задано"}</strong>
                    <span>{item.originalName}</span>
                    <small>
                      Источник: {item.site?.name ?? "исходный сайт удалён"}
                    </small>
                    <small>
                      {formatSize(item.size)} ·{" "}
                      {item.mimeType.replace("image/", "").toUpperCase()}
                    </small>
                    {canEdit ? (
                      <div className="media-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(item.id);
                            setAltDraft(item.altText ?? "");
                          }}
                        >
                          Изменить alt
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={busyId === item.id}
                          onClick={() => void remove(item)}
                        >
                          Удалить
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : items.length ? (
        <div className="empty-media compact">
          <span>⌕</span>
          <h2>Ничего не найдено</h2>
          <p>Измените запрос или сбросьте выбранные фильтры.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFormatFilter("all");
              setAltFilter("all");
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <div className="empty-media">
          <span>▧</span>
          <h2>Медиатека пока пуста</h2>
          <p>
            Загрузите первое изображение — его можно будет выбрать как обложку
            статьи.
          </p>
        </div>
      )}
    </section>
  );
}
