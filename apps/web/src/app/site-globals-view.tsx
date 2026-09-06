"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type SiteGlobals = {
  siteId: string;
  companyName?: string;
  organizationType?: string;
  legalName?: string;
  inn?: string;
  ogrn?: string;
  legalAddress?: string;
  phone?: string;
  email?: string;
  address?: string;
  telegramUrl?: string;
  vkUrl?: string;
};
type GlobalsDraft = Omit<SiteGlobals, "siteId">;

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

export function SiteGlobalsView({
  siteId,
  siteName,
  canEdit = true,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<SiteGlobals | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<GlobalsDraft>({});

  const load = useCallback(async () => {
    if (!siteId) return;
    const loaded = await request<SiteGlobals>(
      `/api/sites/${siteId}/content/globals`,
    );
    setData(loaded);
    setDraft({
      companyName: loaded.companyName ?? "",
      organizationType: loaded.organizationType ?? "",
      legalName: loaded.legalName ?? "",
      inn: loaded.inn ?? "",
      ogrn: loaded.ogrn ?? "",
      legalAddress: loaded.legalAddress ?? "",
      phone: loaded.phone ?? "",
      email: loaded.email ?? "",
      address: loaded.address ?? "",
      telegramUrl: loaded.telegramUrl ?? "",
      vkUrl: loaded.vkUrl ?? "",
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

  function updateDraft(field: keyof GlobalsDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !canEdit) return;
    if (!event.currentTarget.reportValidity()) return;
    const fields = [
      "companyName",
      "organizationType",
      "legalName",
      "inn",
      "ogrn",
      "legalAddress",
      "phone",
      "email",
      "address",
      "telegramUrl",
      "vkUrl",
    ];
    const payload = Object.fromEntries(
      fields.map((field) => {
        const value = String(draft[field as keyof GlobalsDraft] ?? "").trim();
        return [field, value];
      }),
    );
    setSaving(true);
    setMessage("");
    try {
      const updated = await request<SiteGlobals>(
        `/api/sites/${siteId}/content/globals`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      setData(updated);
      setDraft({
        companyName: updated.companyName ?? "",
        organizationType: updated.organizationType ?? "",
        legalName: updated.legalName ?? "",
        inn: updated.inn ?? "",
        ogrn: updated.ogrn ?? "",
        legalAddress: updated.legalAddress ?? "",
        phone: updated.phone ?? "",
        email: updated.email ?? "",
        address: updated.address ?? "",
        telegramUrl: updated.telegramUrl ?? "",
        vkUrl: updated.vkUrl ?? "",
      });
      setDirty(false);
      setMessage("Общие данные сохранены и будут использоваться на всём сайте");
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить данные",
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
            <h1>Общие данные</h1>
            <p>{siteName}</p>
          </div>
        </div>
        <div className="settings-loading">Загружаем данные…</div>
      </section>
    );

  return (
    <section className="directory-section globals-section">
      <div className="section-heading">
        <div>
          <h1>Общие данные</h1>
          <p>Единые контакты и реквизиты сайта {siteName}</p>
        </div>
      </div>
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      <form className="settings-form" onSubmit={save}>
        <div className="settings-card">
          <div className="settings-card-head">
            <span>⌘</span>
            <div>
              <h2>Организация и контакты</h2>
              <p>
                Эти значения можно использовать в шапке, подвале, формах и
                страницах
              </p>
            </div>
          </div>
          <div className="settings-fields two-columns">
            <label>
              <span>Название организации</span>
              <input
                name="companyName"
                maxLength={200}
                value={draft.companyName ?? ""}
                onChange={(event) =>
                  updateDraft("companyName", event.target.value)
                }
                placeholder="ООО «Компания»"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>Телефон</span>
              <input
                name="phone"
                type="tel"
                maxLength={40}
                value={draft.phone ?? ""}
                onChange={(event) => updateDraft("phone", event.target.value)}
                placeholder="+7 999 000-00-00"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>Тип организации</span>
              <select
                name="organizationType"
                value={draft.organizationType ?? ""}
                onChange={(event) =>
                  updateDraft("organizationType", event.target.value)
                }
                disabled={!canEdit}
              >
                <option value="">Выберите тип</option>
                <option value="ip">ИП</option>
                <option value="ooo">ООО</option>
                <option value="self_employed">Самозанятый</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label>
              <span>Полное юридическое наименование</span>
              <input
                name="legalName"
                maxLength={300}
                value={draft.legalName ?? ""}
                onChange={(event) => updateDraft("legalName", event.target.value)}
                placeholder="ООО «Название компании»"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>ИНН</span>
              <input
                name="inn"
                maxLength={20}
                value={draft.inn ?? ""}
                onChange={(event) => updateDraft("inn", event.target.value)}
                placeholder="Введите ИНН"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>ОГРН / ОГРНИП</span>
              <input
                name="ogrn"
                maxLength={30}
                value={draft.ogrn ?? ""}
                onChange={(event) => updateDraft("ogrn", event.target.value)}
                placeholder="Введите ОГРН или ОГРНИП"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>Юридический адрес</span>
              <input
                name="legalAddress"
                maxLength={500}
                value={draft.legalAddress ?? ""}
                onChange={(event) =>
                  updateDraft("legalAddress", event.target.value)
                }
                placeholder="Москва, ул. Примерная, 1"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>Публичная почта</span>
              <input
                name="email"
                type="email"
                maxLength={255}
                value={draft.email ?? ""}
                onChange={(event) => updateDraft("email", event.target.value)}
                placeholder="hello@company.ru"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>Адрес</span>
              <input
                name="address"
                maxLength={500}
                value={draft.address ?? ""}
                onChange={(event) =>
                  updateDraft("address", event.target.value)
                }
                placeholder="Москва, ул. Примерная, 1"
                readOnly={!canEdit}
              />
            </label>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card-head">
            <span>↗</span>
            <div>
              <h2>Социальные сети</h2>
              <p>Укажите полные ссылки, начиная с https://</p>
            </div>
          </div>
          <div className="settings-fields two-columns">
            <label>
              <span>Telegram</span>
              <input
                name="telegramUrl"
                type="url"
                maxLength={500}
                value={draft.telegramUrl ?? ""}
                onChange={(event) =>
                  updateDraft("telegramUrl", event.target.value)
                }
                placeholder="https://t.me/company"
                readOnly={!canEdit}
              />
            </label>
            <label>
              <span>ВКонтакте</span>
              <input
                name="vkUrl"
                type="url"
                maxLength={500}
                value={draft.vkUrl ?? ""}
                onChange={(event) => updateDraft("vkUrl", event.target.value)}
                placeholder="https://vk.com/company"
                readOnly={!canEdit}
              />
            </label>
          </div>
        </div>
        <div className="globals-preview">
          <small>ПРЕДПРОСМОТР ПОДВАЛА</small>
          <strong>{draft.companyName || siteName}</strong>
          <span>
            {[draft.phone, draft.email, draft.address]
              .filter(Boolean)
              .join(" · ") || "Контактные данные пока не заполнены"}
          </span>
          {draft.telegramUrl || draft.vkUrl ? (
            <div className="globals-social-preview">
              {draft.telegramUrl ? <b>Telegram ↗</b> : null}
              {draft.vkUrl ? <b>ВКонтакте ↗</b> : null}
            </div>
          ) : null}
        </div>
        {canEdit ? (
          <div className="settings-actions">
            <span className={dirty ? "unsaved-indicator" : ""}>
              {dirty
                ? "● Есть несохранённые общие данные"
                : "Пустые поля не выводятся на публичном сайте"}
            </span>
            <button disabled={saving || !dirty}>
              {saving ? "Сохраняем…" : "Сохранить общие данные"}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
