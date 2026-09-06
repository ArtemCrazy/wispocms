"use client";

import { useEffect, useState } from "react";

type AuditEntry = {
  id: string;
  actorUserId: string | null;
  actorName: string;
  entityType: string;
  action: string;
  description: string;
  changes: { submittedValues?: Record<string, unknown>; redactedFields?: string[] } | null;
  createdAt: string;
  workspace?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
};

const entityLabels: Record<string, string> = {
  article: "Материал", category: "Рубрика", author: "Автор", page: "Страница",
  banner: "Баннер", media: "Медиа", workspace: "Пространство", site: "Сайт", user: "Пользователь", section: "Раздел",
};

export function AuditLogView({ siteId }: { siteId?: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(siteId ? `/api/sites/${siteId}/audit` : "/api/platform/audit", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить журнал изменений");
        return response.json();
      })
      .then((rows: AuditEntry[]) => { if (active) setEntries(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Ошибка загрузки"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [siteId]);

  if (loading) return <div className="section-state">Загружаем журнал…</div>;
  return (
    <section className="platform-section audit-section">
      <div className="section-heading"><div><h1>{siteId ? "История сайта" : "Журнал изменений"}</h1><p>Кто, когда и что изменил в Wispo CMS</p></div></div>
      {error ? <div className="section-state error">{error}</div> : null}
      <div className="audit-list">
        {entries.map((entry) => {
          const fields = Object.keys(entry.changes?.submittedValues ?? {});
          return (
            <article key={entry.id} className="audit-entry">
              <time dateTime={entry.createdAt}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}</time>
              <div><strong>{entry.actorName}</strong><p>{entry.description}</p><small>{[entry.workspace?.name, entry.site?.name, entityLabels[entry.entityType] ?? entry.entityType].filter(Boolean).join(" · ")}</small>{fields.length ? <em>Переданы новые значения: {fields.join(", ")}</em> : null}{entry.changes?.redactedFields?.length ? <em>Секретные поля скрыты</em> : null}</div>
            </article>
          );
        })}
        {!entries.length && !error ? <div className="section-state">Изменений пока нет</div> : null}
      </div>
    </section>
  );
}
