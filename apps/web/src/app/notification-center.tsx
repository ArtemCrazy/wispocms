"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Activity = {
  id: string;
  type: "updated" | "comment" | "status_changed";
  message: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
  article: { id: string; title: string };
  user: { id: string; fullName: string };
};

const statusNames: Record<string, string> = {
  draft: "черновик",
  review: "согласование",
  changes_requested: "нужны правки",
  published: "опубликовано",
};

export function NotificationCenter({
  siteId,
  onNavigate,
  variant = "default",
}: {
  siteId?: string;
  onNavigate: (articleId: string) => void;
  variant?: "default" | "sidebar";
}) {
  const [items, setItems] = useState<Activity[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/sites/${siteId}/content/activity`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Не удалось загрузить уведомления");
      const rows: Activity[] = await response.json();
      setItems(rows);
      const seenAt = window.localStorage.getItem(
        `wispo.notificationsSeen.${siteId}`,
      );
      setUnread(
        seenAt
          ? rows.filter((item) => new Date(item.createdAt) > new Date(seenAt))
              .length
          : rows.length,
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Ошибка уведомлений",
      );
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function markRead() {
    if (!siteId) return;
    window.localStorage.setItem(
      `wispo.notificationsSeen.${siteId}`,
      new Date().toISOString(),
    );
    setUnread(0);
  }

  function description(item: Activity) {
    if (item.type === "comment") return item.message || "Оставил комментарий";
    if (item.type === "status_changed")
      return `Изменил статус: ${statusNames[item.toStatus ?? ""] ?? item.toStatus}`;
    return item.message || "Обновил материал";
  }

  return (
    <div className="notifications-wrap" ref={wrapRef}>
      <button
        className={variant === "sidebar" ? "sidebar-tool-button" : "round-button"}
        aria-label="Уведомления"
        aria-expanded={open}
        onClick={() => {
          if (!open) void load();
          setOpen((current) => !current);
        }}
      >
        <span
          className="weeek-icon weeek-icon-notifications"
          aria-hidden="true"
        />
        {unread ? <i /> : null}
      </button>
      {open ? (
        <aside className="notifications-popover">
          <header>
            <div className="notifications-heading">
              <strong>Уведомления</strong>
              <small>{unread ? `Новых: ${unread}` : "Всё просмотрено"}</small>
            </div>
            <div className="notifications-header-actions">
              <button
                aria-label="Обновить уведомления"
                disabled={loading}
                onClick={() => void load()}
              >
                ↻
              </button>
              <button
                aria-label="Закрыть уведомления"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </header>
          <div className="notifications-list">
            {loading ? (
              <div className="notifications-state">Загружаем действия…</div>
            ) : message ? (
              <div className="notifications-state error">{message}</div>
            ) : items.length ? (
              items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setOpen(false);
                    onNavigate(item.article.id);
                  }}
                >
                  <span>
                    {item.type === "comment"
                      ? "☵"
                      : item.type === "status_changed"
                        ? "✓"
                        : "✎"}
                  </span>
                  <div>
                    <p>
                      <strong>{item.user.fullName}</strong> ·{" "}
                      {description(item)}
                    </p>
                    <b>{item.article.title}</b>
                    <small>
                      {new Intl.DateTimeFormat("ru", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.createdAt))}
                    </small>
                  </div>
                </button>
              ))
            ) : (
              <div className="notifications-state">
                <span>♢</span>
                <strong>Событий пока нет</strong>
                <small>Здесь появятся действия команды с материалами.</small>
              </div>
            )}
          </div>
          {items.length ? (
            <footer>
              <button onClick={markRead}>✓ Отметить всё прочитанным</button>
              <span>Последние {items.length} событий</span>
            </footer>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
