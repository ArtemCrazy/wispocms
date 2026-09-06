"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

export type SiteLayoutSettings = {
  siteId: string;
  logoText?: string;
  showPages?: boolean;
  showArticles?: boolean;
  ctaLabel?: string;
  ctaUrl?: string;
  footerDescription?: string;
  showContacts?: boolean;
  showSocials?: boolean;
};
type LayoutDraft = Omit<SiteLayoutSettings, "siteId">;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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

export function SiteLayoutView({
  siteId,
  siteName,
  mode,
  canEdit = true,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  mode: "header" | "footer";
  canEdit?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<SiteLayoutSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<LayoutDraft>({});

  const load = useCallback(async () => {
    if (!siteId) return;
    const loaded = await request<SiteLayoutSettings>(
      `/api/sites/${siteId}/content/layout`,
    );
    setData(loaded);
    setDraft({
      logoText: loaded.logoText ?? "",
      showPages: loaded.showPages ?? true,
      showArticles: loaded.showArticles ?? true,
      ctaLabel: loaded.ctaLabel ?? "",
      ctaUrl: loaded.ctaUrl ?? "",
      footerDescription: loaded.footerDescription ?? "",
      showContacts: loaded.showContacts ?? true,
      showSocials: loaded.showSocials ?? true,
    });
    setDirty(false);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

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

  function updateDraft<K extends keyof LayoutDraft>(
    field: K,
    value: LayoutDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !canEdit) return;
    if (!event.currentTarget.reportValidity()) return;
    const text = (value?: string) => value?.trim() ?? "";
    const payload =
      mode === "header"
        ? {
            logoText: text(draft.logoText),
            showPages: draft.showPages,
            showArticles: draft.showArticles,
            ctaLabel: text(draft.ctaLabel),
            ctaUrl: text(draft.ctaUrl),
          }
        : {
            footerDescription: text(draft.footerDescription),
            showContacts: draft.showContacts,
            showSocials: draft.showSocials,
          };
    setSaving(true);
    setMessage("");
    try {
      const updated = await request<SiteLayoutSettings>(
        `/api/sites/${siteId}/content/layout`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      setData(updated);
      setDraft({
        logoText: updated.logoText ?? "",
        showPages: updated.showPages ?? true,
        showArticles: updated.showArticles ?? true,
        ctaLabel: updated.ctaLabel ?? "",
        ctaUrl: updated.ctaUrl ?? "",
        footerDescription: updated.footerDescription ?? "",
        showContacts: updated.showContacts ?? true,
        showSocials: updated.showSocials ?? true,
      });
      setDirty(false);
      setMessage(`${mode === "header" ? "Шапка" : "Подвал"} сайта сохранён`);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить настройки",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!data)
    return (
      <section className="directory-section">
        <div className="section-heading">
          <div>
            <h1>{mode === "header" ? "Шапка" : "Подвал"}</h1>
            <p>{siteName}</p>
          </div>
        </div>
        <div className="settings-loading">Загружаем настройки…</div>
      </section>
    );

  const showPages = draft.showPages ?? true;
  const showArticles = draft.showArticles ?? true;
  const showContacts = draft.showContacts ?? true;
  const showSocials = draft.showSocials ?? true;

  return (
    <section className="directory-section layout-section">
      <div className="section-heading">
        <div>
          <h1>{mode === "header" ? "Шапка" : "Подвал"}</h1>
          <p>
            {mode === "header"
              ? "Логотип, навигация и основная кнопка"
              : "Описание, контакты и социальные ссылки"}
          </p>
        </div>
      </div>
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      <form className="settings-form" onSubmit={save}>
        {mode === "header" ? (
          <div className="settings-card">
            <div className="settings-card-head">
              <span>▔</span>
              <div>
                <h2>Содержимое шапки</h2>
                <p>
                  Пункты страниц формируются из опубликованных страниц сайта
                </p>
              </div>
            </div>
            <div className="settings-fields two-columns">
              <label>
                <span>Текст логотипа</span>
                <input
                  name="logoText"
                  maxLength={120}
                  value={draft.logoText ?? ""}
                  onChange={(event) =>
                    updateDraft("logoText", event.target.value)
                  }
                  placeholder={siteName}
                  readOnly={!canEdit}
                />
              </label>
              <label>
                <span>Текст кнопки</span>
                <input
                  name="ctaLabel"
                  maxLength={80}
                  value={draft.ctaLabel ?? ""}
                  onChange={(event) =>
                    updateDraft("ctaLabel", event.target.value)
                  }
                  placeholder="Связаться"
                  readOnly={!canEdit}
                />
              </label>
              <label className="full-width">
                <span>Ссылка кнопки</span>
                <input
                  name="ctaUrl"
                  maxLength={500}
                  value={draft.ctaUrl ?? ""}
                  onChange={(event) =>
                    updateDraft("ctaUrl", event.target.value)
                  }
                  placeholder="#contact или https://example.ru"
                  readOnly={!canEdit}
                />
              </label>
              <label className="settings-check">
                <input
                  name="showPages"
                  type="checkbox"
                  checked={showPages}
                  onChange={(event) =>
                    updateDraft("showPages", event.target.checked)
                  }
                  disabled={!canEdit}
                />
                <span>Показывать опубликованные страницы в меню</span>
              </label>
              <label className="settings-check">
                <input
                  name="showArticles"
                  type="checkbox"
                  checked={showArticles}
                  onChange={(event) =>
                    updateDraft("showArticles", event.target.checked)
                  }
                  disabled={!canEdit}
                />
                <span>Показывать ссылку «Статьи»</span>
              </label>
            </div>
          </div>
        ) : (
          <div className="settings-card">
            <div className="settings-card-head">
              <span>▁</span>
              <div>
                <h2>Содержимое подвала</h2>
                <p>Контакты и соцсети берутся из раздела «Общие данные»</p>
              </div>
            </div>
            <div className="settings-fields">
              <label>
                <span>Короткое описание</span>
                <textarea
                  name="footerDescription"
                  rows={4}
                  maxLength={500}
                  value={draft.footerDescription ?? ""}
                  onChange={(event) =>
                    updateDraft("footerDescription", event.target.value)
                  }
                  placeholder="Коротко о компании или проекте"
                  readOnly={!canEdit}
                />
              </label>
              <div className="layout-checks">
                <label className="settings-check">
                  <input
                    name="showContacts"
                    type="checkbox"
                    checked={showContacts}
                    onChange={(event) =>
                      updateDraft("showContacts", event.target.checked)
                    }
                    disabled={!canEdit}
                  />
                  <span>Показывать телефон, email и адрес</span>
                </label>
                <label className="settings-check">
                  <input
                    name="showSocials"
                    type="checkbox"
                    checked={showSocials}
                    onChange={(event) =>
                      updateDraft("showSocials", event.target.checked)
                    }
                    disabled={!canEdit}
                  />
                  <span>Показывать социальные сети</span>
                </label>
              </div>
            </div>
          </div>
        )}
        <div className={`layout-preview ${mode}`}>
          <small>ПРЕДПРОСМОТР</small>
          {mode === "header" ? (
            <div>
              <strong>{draft.logoText || siteName}</strong>
              <span>
                {showPages ? "Страницы" : null}
                {showArticles ? "Статьи" : null}
              </span>
              {draft.ctaLabel ? <b>{draft.ctaLabel}</b> : null}
            </div>
          ) : (
            <div>
              <strong>{siteName}</strong>
              <span>{draft.footerDescription || "Описание не задано"}</span>
              <b>
                {[showContacts && "Контакты", showSocials && "Соцсети"]
                  .filter(Boolean)
                  .join(" · ")}
              </b>
            </div>
          )}
        </div>
        {canEdit ? (
          <div className="settings-actions">
            <span className={dirty ? "unsaved-indicator" : ""}>
              {dirty
                ? `● Есть несохранённые изменения ${mode === "header" ? "шапки" : "подвала"}`
                : "Изменения применяются ко всем страницам сайта"}
            </span>
            <button disabled={saving || !dirty}>
              {saving
                ? "Сохраняем…"
                : `Сохранить ${mode === "header" ? "шапку" : "подвал"}`}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
