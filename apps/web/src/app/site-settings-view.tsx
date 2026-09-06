"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type SiteSettings = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  domain: string | null;
  domainStatus: "not_configured" | "pending" | "verified" | "error";
  domainCheckedAt: string | null;
  domainStatusMessage: string | null;
  expectedDnsRecords: string[];
  siteType: "media" | "corporate" | "landing";
  linkedCommercialSiteId: string | null;
  linkedCommercialSite: CommercialSite | null;
  commercialSiteOptions: CommercialSite[];
  notificationEmail: string | null;
};

type CommercialSite = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  siteType: "corporate" | "landing";
};

type EmailStatus = {
  recipientConfigured: boolean;
  transportReady: boolean;
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
  return response.json();
}

export function SiteSettingsView({
  siteId,
  siteName,
  onSaved,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  onSaved?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [domainDraft, setDomainDraft] = useState("");
  const [notificationEmailDraft, setNotificationEmailDraft] = useState("");
  const [linkedCommercialSiteDraft, setLinkedCommercialSiteDraft] =
    useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    const loaded = await api<SiteSettings>(
      `/api/sites/${siteId}/content/settings`,
    );
    setSettings(loaded);
    setNameDraft(loaded.name);
    setDomainDraft(loaded.domain ?? "");
    setNotificationEmailDraft(loaded.notificationEmail ?? "");
    setLinkedCommercialSiteDraft(loaded.linkedCommercialSiteId ?? "");
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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId || !settings) return;
    const data = new FormData(event.currentTarget);
    const optional = (name: string) =>
      String(data.get(name) ?? "").trim() || null;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api<SiteSettings>(
        `/api/sites/${siteId}/content/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: String(data.get("name") ?? ""),
            domain: optional("domain"),
            notificationEmail: optional("notificationEmail"),
            linkedCommercialSiteId:
              settings.siteType === "media"
                ? optional("linkedCommercialSiteId")
                : undefined,
          }),
        },
      );
      setSettings(updated);
      setNameDraft(updated.name);
      setDomainDraft(updated.domain ?? "");
      setNotificationEmailDraft(updated.notificationEmail ?? "");
      setLinkedCommercialSiteDraft(updated.linkedCommercialSiteId ?? "");
      setDirty(false);
      await onSaved?.();
      setMessage("Настройки сайта сохранены");
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

  async function testEmail() {
    if (!siteId || !settings?.notificationEmail || !emailIsSaved) return;
    setTestingEmail(true);
    setMessage("");
    try {
      await api(`/api/sites/${siteId}/content/settings/test-email`, {
        method: "POST",
      });
      setMessage(`Тестовое письмо отправлено на ${settings.notificationEmail}`);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить тестовое письмо",
      );
    } finally {
      setTestingEmail(false);
    }
  }

  async function checkEmailStatus() {
    if (!siteId) return;
    setCheckingEmail(true);
    setEmailStatus(null);
    try {
      const status = await api<EmailStatus>(
        `/api/sites/${siteId}/content/settings/email-status`,
      );
      setEmailStatus(status);
    } catch {
      setEmailStatus({
        recipientConfigured: Boolean(settings?.notificationEmail),
        transportReady: false,
      });
    } finally {
      setCheckingEmail(false);
    }
  }

  async function checkDomain() {
    if (!siteId || !settings?.domain || dirty) return;
    setCheckingDomain(true);
    setMessage("");
    try {
      const updated = await api<SiteSettings>(
        `/api/sites/${siteId}/content/settings/verify-domain`,
        { method: "POST" },
      );
      setSettings(updated);
      setMessage(
        updated.domainStatus === "verified"
          ? "Домен подтверждён"
          : updated.domainStatusMessage || "DNS пока не подтверждён",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось проверить DNS",
      );
    } finally {
      setCheckingDomain(false);
    }
  }

  if (!settings)
    return (
      <section className="directory-section">
        <div className="section-heading">
          <div>
            <h1>Настройки сайта</h1>
            <p>{siteName}</p>
          </div>
        </div>
        <div className="settings-loading">Загружаем настройки…</div>
      </section>
    );

  const typeNames = {
    media: "Медиа-сайт",
    corporate: "Корпоративный сайт",
    landing: "Лендинг",
  };
  const normalizedEmailDraft = notificationEmailDraft.trim().toLowerCase();
  const emailIsSaved =
    normalizedEmailDraft === (settings.notificationEmail ?? "");
  const domainIsSaved = domainDraft.trim().toLowerCase() === (settings.domain ?? "");
  const domainStatusNames = {
    not_configured: "Не настроен",
    pending: "Ожидает проверки",
    verified: "Подтверждён",
    error: "Требует внимания",
  };

  return (
    <section className="directory-section settings-section">
      <div className="section-heading">
        <div>
          <h1>Настройки сайта</h1>
          <p>Основные параметры, SEO и получение заявок</p>
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
            <span>◇</span>
            <div>
              <h2>Основные данные</h2>
              <p>Название и адрес сайта</p>
            </div>
          </div>
          <div className="settings-fields two-columns">
            <label>
              <span>Название сайта</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                value={nameDraft}
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <label>
              <span>Тип сайта</span>
              <input value={typeNames[settings.siteType]} readOnly disabled />
              <small>Определяет стартовую структуру разделов</small>
            </label>
            <label>
              <span>Системный адрес</span>
              <input value={settings.slug} readOnly disabled />
              <small>Не меняется после создания сайта</small>
            </label>
            <label>
              <span>Домен</span>
              <input
                name="domain"
                maxLength={255}
                placeholder="example.ru"
                value={domainDraft}
                onChange={(event) => {
                  setDomainDraft(event.target.value);
                  setDirty(true);
                }}
              />
              <small>
                Можно вставить полный URL — будет сохранено только доменное имя.
              </small>
            </label>
          </div>
          <div className="settings-email-test">
            <div>
              <span className={settings.domainStatus === "verified" ? "ready" : ""}>
                DNS: {domainStatusNames[settings.domainStatus]}
              </span>
              <small
                className={settings.domainStatus === "error" ? "error" : ""}
              >
                {settings.domainStatusMessage ||
                  (settings.expectedDnsRecords.length
                    ? `Направьте A/AAAA или CNAME на: ${settings.expectedDnsRecords.join(" или ")}`
                    : "Целевую DNS-запись выдаёт администратор инфраструктуры Wispo")}
              </small>
            </div>
            <button
              type="button"
              disabled={
                checkingDomain || !settings.domain || !domainIsSaved || dirty
              }
              onClick={() => void checkDomain()}
            >
              {checkingDomain ? "Проверяем DNS…" : "Проверить DNS"}
            </button>
          </div>
          {settings.siteType === "media" ? (
            <div className="settings-fields">
              <label>
                <span>Связанный коммерческий сайт</span>
                <select
                  name="linkedCommercialSiteId"
                  value={linkedCommercialSiteDraft}
                  onChange={(event) => {
                    setLinkedCommercialSiteDraft(event.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="">Не выбран</option>
                  {settings.commercialSiteOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {typeNames[option.siteType]}
                    </option>
                  ))}
                </select>
                <small>
                  Используется для переходов из Media на Corporate или Landing
                  этого рабочего пространства.
                </small>
              </label>
            </div>
          ) : null}
        </div>

        <div className="settings-card">
          <div className="settings-card-head">
            <span>✉</span>
            <div>
              <h2>Заявки с сайта</h2>
              <p>Пока заявки отправляются на электронную почту</p>
            </div>
          </div>
          <div className="settings-fields">
            <label>
              <span>Почта для заявок</span>
              <input
                name="notificationEmail"
                type="email"
                maxLength={255}
                placeholder="requests@company.ru"
                value={notificationEmailDraft}
                onChange={(event) => {
                  setNotificationEmailDraft(event.target.value);
                  setDirty(true);
                }}
              />
              <small>
                Интеграцию с Telegram и сохранение заявок в CMS добавим на
                следующем этапе развития.
              </small>
            </label>
            <div className="settings-email-test">
              <div>
                <span
                  className={
                    normalizedEmailDraft && emailIsSaved ? "ready" : ""
                  }
                >
                  {!normalizedEmailDraft
                    ? "Получатель пока не настроен"
                    : !emailIsSaved
                      ? "Сначала сохраните новый адрес"
                      : settings.notificationEmail
                        ? `Получатель настроен: ${settings.notificationEmail}`
                        : "Получатель пока не настроен"}
                </span>
                {emailStatus ? (
                  <small className={emailStatus.transportReady ? "ready" : "error"}>
                    {emailStatus.transportReady
                      ? "Почтовый сервер доступен"
                      : "Почтовый сервер не подключён"}
                  </small>
                ) : null}
              </div>
              <div className="settings-email-actions">
                <button
                  type="button"
                  disabled={checkingEmail}
                  onClick={() => void checkEmailStatus()}
                >
                  {checkingEmail ? "Проверяем…" : "Проверить подключение"}
                </button>
                <button
                  type="button"
                  disabled={
                    !normalizedEmailDraft || !emailIsSaved || testingEmail
                  }
                  onClick={() => void testEmail()}
                >
                  {testingEmail ? "Отправляем…" : "Отправить тестовое письмо"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <span className={dirty ? "unsaved-indicator" : ""}>
            {dirty
              ? "● Есть несохранённые изменения"
              : `Изменения относятся только к сайту ${settings.name}`}
          </span>
          <button disabled={saving || !dirty}>
            {saving ? "Сохраняем…" : "Сохранить настройки"}
          </button>
        </div>
      </form>
    </section>
  );
}
