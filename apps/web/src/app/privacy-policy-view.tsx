"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type SectionDiff = {
  key: string;
  status: "added" | "removed" | "changed" | "unchanged";
  sourceTitle: string | null;
  targetTitle: string | null;
};

type LegalModel = {
  id: string;
  version: string;
  status: "draft" | "approved";
  sections: Array<{ key: string; title: string; body?: string }>;
  rules?: Array<{
    sectionKey: string;
    when?: {
      setting?: string;
      hasAny?: string[];
      boolean?: string;
    };
  }>;
  approvedAt?: string | null;
  approvedBy?: { email?: string; firstName?: string; lastName?: string } | null;
  changeSummary?: string | null;
};

type PrivacyState = {
  siteId: string;
  pageId: string;
  pageStatus: "draft" | "published";
  company: {
    organizationType: string;
    legalName: string;
    inn: string;
    ogrn: string;
    legalAddress: string;
  };
  settings: {
    dataCategories?: string[];
    purposes?: string[];
    services?: string[];
    collectionMethods?: string[];
    otherServiceDescription?: string;
    thirdPartyTransfer?: boolean;
    thirdPartyDescription?: string;
    cookies?: boolean;
  };
  legalModel: LegalModel;
  latestApprovedModel: Pick<
    LegalModel,
    "id" | "version" | "approvedAt" | "changeSummary"
  > | null;
  availableUpdate: {
    deferred: boolean;
    sourceModelId: string;
    sourceVersion: string;
    targetModelId: string;
    targetVersion: string;
    changeSummary: string | null;
    comparison: SectionDiff[];
  } | null;
  manualModelReview: {
    sourceVersion: string;
    targetVersion: string;
    comparison: SectionDiff[];
  } | null;
  displayTemplate: {
    key: string;
    version: string;
    title: string;
    status: string;
    config: { showSectionNumbers?: boolean; accentTone?: "neutral" | "violet" };
  };
  displayTemplates: Array<{
    key: string;
    version: string;
    title: string;
    description: string;
  }>;
  mode: "automatic" | "manual";
  status:
    | "not_configured"
    | "draft"
    | "current"
    | "attention_required"
    | "manual_changes";
  missingFields: string[];
  document: string | null;
  automaticSnapshot: string | null;
  publishedSnapshot: string | null;
  generatedAt: string | null;
  publicationAvailable: boolean;
  publicationBlockedReason: string | null;
  published: {
    status: "draft" | "published";
    at: string | null;
    legalModelVersion: string | null;
    templateKey: string | null;
    templateVersion: string | null;
  };
  draftNotice: string | null;
};

type Tab = "template" | "settings" | "document";

const statusLabels: Record<PrivacyState["status"], string> = {
  not_configured: "Не настроена",
  draft: "Черновик",
  current: "Актуальна",
  attention_required: "Требует внимания",
  manual_changes: "Изменена вручную",
};

const dataOptions = [
  ["name", "Имя"],
  ["phone", "Телефон"],
  ["email", "Email"],
  ["address", "Адрес"],
  ["birth_date", "Дата рождения"],
] as const;
const purposeOptions = [
  ["process_inquiries", "Обработка обращений"],
  ["respond_to_request", "Ответ на заявку пользователя"],
  ["order_processing", "Оформление заказа"],
  ["newsletter", "Рассылка"],
  ["account_registration", "Регистрация личного кабинета"],
] as const;
const serviceOptions = [
  ["analytics", "Система аналитики"],
  ["crm", "CRM"],
  ["email_service", "Email-сервис"],
  ["advertising", "Рекламные системы"],
  ["other", "Другие внешние сервисы"],
] as const;
const collectionOptions = [
  ["web_forms", "Веб-формы"],
  ["account", "Личный кабинет"],
  ["cookies", "Cookie и локальное хранилище"],
  ["analytics_systems", "Системы аналитики"],
  ["direct_contact", "Прямое обращение по телефону или email"],
  ["file_uploads", "Загрузка файлов пользователем"],
] as const;
const privacyTabs = [
  ["template", "Шаблон"],
  ["settings", "Данные и настройки"],
  ["document", "Готовый документ"],
] as const;
const diffLabels: Record<SectionDiff["status"], string> = {
  added: "Добавлен",
  removed: "Удалён",
  changed: "Изменён",
  unchanged: "Без изменений",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  return payload as T;
}

export function PrivacyPolicyView({
  siteId,
  siteName,
  canEdit = true,
  canApprove = false,
  canManageLegalModels = false,
  onDirtyChange,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
  canApprove?: boolean;
  canManageLegalModels?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("settings");
  const [state, setState] = useState<PrivacyState | null>(null);
  const [company, setCompany] = useState<PrivacyState["company"] | null>(null);
  const [settings, setSettings] = useState<PrivacyState["settings"]>({});
  const [manualText, setManualText] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [templateConfig, setTemplateConfig] = useState<
    PrivacyState["displayTemplate"]["config"]
  >({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [manualDirty, setManualDirty] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draftRevisionId, setDraftRevisionId] = useState<string | null>(null);

  const applyState = useCallback((next: PrivacyState) => {
    setState(next);
    setCompany(next.company);
    setSettings(next.settings);
    setManualText(next.document ?? next.automaticSnapshot ?? "");
    setTemplateKey(next.displayTemplate.key);
    setTemplateConfig(next.displayTemplate.config ?? {});
    setSettingsDirty(false);
    setManualDirty(false);
    setTemplateDirty(false);
  }, []);

  const load = useCallback(async () => {
    if (!siteId) return;
    const [live, revision] = await Promise.all([
      request<PrivacyState>(`/api/sites/${siteId}/content/privacy`),
      request<{
        draft: { id: string; snapshot: PrivacyState } | null;
      } | null>(
        `/api/sites/${siteId}/content/versioned/privacy/revisions/current`,
      ),
    ]);
    applyState(revision?.draft?.snapshot ?? live);
    setDraftRevisionId(revision?.draft?.id ?? null);
  }, [applyState, siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = settingsDirty || manualDirty || templateDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const progress = useMemo(() => {
    if (!state) return 0;
    const total = 9;
    return Math.round(
      ((total - Math.min(total, state.missingFields.length)) / total) * 100,
    );
  }, [state]);

  function updateCompany(field: keyof PrivacyState["company"], value: string) {
    setCompany((current) =>
      current ? { ...current, [field]: value } : current,
    );
    setSettingsDirty(true);
  }

  function updateList(
    field: "dataCategories" | "purposes" | "services" | "collectionMethods",
    key: string,
  ) {
    setSettings((current) => {
      const values = current[field] ?? [];
      return {
        ...current,
        [field]: values.includes(key)
          ? values.filter((value) => value !== key)
          : [...values, key],
      };
    });
    setSettingsDirty(true);
  }

  async function run(
    action: () => Promise<PrivacyState & { draftRevisionId: string }>,
    success: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const next = await action();
      setDraftRevisionId(next.draftRevisionId);
      applyState(next);
      setMessage(`${success}. Создана новая версия черновика`);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!siteId || !company || !canEdit) return;
    setBusy(true);
    setMessage("");
    try {
      const companyDraft = await request<
        PrivacyState & { draftRevisionId: string }
      >(
        `/api/sites/${siteId}/content/privacy/company`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...company,
            expectedDraftRevisionId: draftRevisionId,
          }),
        },
      );
      const next = await request<PrivacyState & { draftRevisionId: string }>(
        `/api/sites/${siteId}/content/privacy/settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...settings,
            expectedDraftRevisionId: companyDraft.draftRevisionId,
          }),
        },
      );
      setDraftRevisionId(next.draftRevisionId);
      applyState(next);
      setMessage("Данные и настройки сохранены как новая версия");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось сохранить настройки",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!siteId || !state || !canEdit) return;
    const template = state.displayTemplates.find(
      (candidate) => candidate.key === templateKey,
    );
    if (!template) return;
    await run(
      () =>
        request(`/api/sites/${siteId}/content/privacy/template`, {
          method: "PUT",
          body: JSON.stringify({
            key: template.key,
            version: template.version,
            config: templateConfig,
            expectedDraftRevisionId: draftRevisionId,
          }),
        }),
      "Шаблон отображения сохранён",
    );
  }

  async function generate() {
    if (!siteId || !state) return;
    if (settingsDirty || templateDirty) {
      setMessage("Сначала сохраните данные, настройки и шаблон");
      return;
    }
    const replacingManual = state.mode === "manual" && Boolean(state.document);
    if (
      replacingManual &&
      !window.confirm("Перегенерация удалит ручную версию документа. Продолжить?")
    )
      return;
    await run(
      () =>
        request(`/api/sites/${siteId}/content/privacy/regenerate`, {
          method: "POST",
          body: JSON.stringify({
            confirmManualReset: replacingManual,
            expectedDraftRevisionId: draftRevisionId,
          }),
        }),
      "Документ сформирован из сохранённых данных",
    );
    setTab("document");
  }

  async function saveManual() {
    if (!siteId) return;
    await run(
      () =>
        request(`/api/sites/${siteId}/content/privacy/manual-document`, {
          method: "PUT",
          body: JSON.stringify({
            text: manualText,
            expectedDraftRevisionId: draftRevisionId,
          }),
        }),
      "Ручная версия сохранена и сверка завершена",
    );
  }

  async function resetAutomatic() {
    if (
      !siteId ||
      !window.confirm(
        "Удалить ручные изменения и вернуться к автоматической версии?",
      )
    )
      return;
    await run(
      () =>
        request(`/api/sites/${siteId}/content/privacy/reset-to-automatic`, {
          method: "POST",
          body: JSON.stringify({
            confirm: true,
            expectedDraftRevisionId: draftRevisionId,
          }),
        }),
      "Восстановлена автоматическая версия",
    );
  }

  async function selectLegalModel(action: "accept" | "defer") {
    if (!siteId || !state?.availableUpdate) return;
    await run(
      () =>
        request(`/api/sites/${siteId}/content/privacy/legal-model/${action}`, {
          method: "POST",
          body: JSON.stringify({
            modelId: state.availableUpdate!.targetModelId,
            expectedDraftRevisionId: draftRevisionId,
          }),
        }),
      action === "accept"
        ? state.mode === "manual"
          ? "Модель принята. Сверьте и сохраните ручной документ"
          : "Юридическая модель принята, документ обновлён"
        : "Обновление отложено",
    );
  }

  if (!state || !company)
    return (
      <section className="directory-section privacy-section">
        <div className="section-heading">
          <div>
            <h1>Политика конфиденциальности</h1>
            <p>{siteName}</p>
          </div>
        </div>
        <div className="settings-loading">
          {message || "Загружаем настройки политики…"}
        </div>
      </section>
    );

  const isSelfEmployed = company.organizationType === "self_employed";
  const legalNameLabel =
    company.organizationType === "ip"
      ? "ФИО индивидуального предпринимателя"
      : isSelfEmployed
        ? "ФИО самозанятого"
        : company.organizationType === "other"
          ? "Наименование оператора"
          : "Полное юридическое наименование";
  const registrationLabel =
    company.organizationType === "ip"
      ? "ОГРНИП"
      : company.organizationType === "other"
        ? "Регистрационный номер (если есть)"
        : "ОГРН";

  return (
    <section className="directory-section privacy-section">
      <div className="section-heading">
        <div>
          <h1>Политика конфиденциальности</h1>
          <p>Системный документ сайта {siteName}</p>
        </div>
        <span className={`privacy-status ${state.status}`}>
          {statusLabels[state.status]}
        </span>
      </div>

      <div
        className={`privacy-draft-notice ${state.legalModel.status === "approved" ? "approved" : ""}`}
        role="note"
      >
        <strong>
          {state.legalModel.status === "draft"
            ? "Юридическая основа — черновик"
            : "Юридическая модель утверждена"}
        </strong>
        <span>
          {state.legalModel.status === "draft"
            ? state.draftNotice
            : `Используется юридическая модель ${state.legalModel.version}.`}
        </span>
      </div>

      {state.availableUpdate ? (
        <LegalUpdateCard
          update={state.availableUpdate}
          canEdit={canEdit}
          busy={busy}
          onAccept={() => void selectLegalModel("accept")}
          onDefer={() => void selectLegalModel("defer")}
        />
      ) : null}

      <div className="privacy-tabs" role="tablist" aria-label="Разделы политики">
        {privacyTabs.map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls={`privacy-panel-${id}`}
            id={`privacy-tab-${id}`}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? privacyTabs.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % privacyTabs.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + privacyTabs.length) % privacyTabs.length
                        : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              const next = privacyTabs[nextIndex][0];
              setTab(next);
              document.getElementById(`privacy-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}

      {tab === "template" ? (
        <div
          className="privacy-panel"
          role="tabpanel"
          id="privacy-panel-template"
          aria-labelledby="privacy-tab-template"
        >
          <div className="settings-card">
            <h2>Шаблон отображения</h2>
            <p>Юридический текст не меняется — меняется только его оформление.</p>
            <div className="privacy-template-grid">
              {state.displayTemplates.map((template) => (
                <label
                  className={`privacy-template-option ${templateKey === template.key ? "selected" : ""}`}
                  key={`${template.key}-${template.version}`}
                >
                  <input
                    type="radio"
                    name="privacy-template"
                    value={template.key}
                    checked={templateKey === template.key}
                    disabled={!canEdit}
                    onChange={() => {
                      setTemplateKey(template.key);
                      setTemplateDirty(true);
                    }}
                  />
                  <strong>{template.title}</strong>
                  <span>{template.description}</span>
                </label>
              ))}
            </div>
            <div className="privacy-template-config">
              <label className="privacy-option-row">
                <input
                  type="checkbox"
                  checked={Boolean(templateConfig.showSectionNumbers)}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setTemplateConfig((current) => ({
                      ...current,
                      showSectionNumbers: event.target.checked,
                    }));
                    setTemplateDirty(true);
                  }}
                />
                <span>Показывать номера разделов</span>
              </label>
              <label>
                <span>Акцент</span>
                <select
                  value={templateConfig.accentTone ?? "violet"}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setTemplateConfig((current) => ({
                      ...current,
                      accentTone: event.target.value as "neutral" | "violet",
                    }));
                    setTemplateDirty(true);
                  }}
                >
                  <option value="violet">Фиолетовый</option>
                  <option value="neutral">Нейтральный</option>
                </select>
              </label>
            </div>
            <div
              className={`privacy-template-preview ${templateKey} ${templateConfig.accentTone ?? "violet"}`}
              aria-label="Предпросмотр шаблона"
            >
              <small>ПРЕДПРОСМОТР</small>
              <h3>Политика конфиденциальности</h3>
              <h4>{templateConfig.showSectionNumbers ? "1. " : ""}Общие положения</h4>
              <p>Так будет выглядеть структура документа на публичной странице.</p>
            </div>
            {canEdit ? (
              <div className="settings-actions">
                <span className={templateDirty ? "unsaved-indicator" : ""}>
                  {templateDirty ? "● Шаблон не сохранён" : "Шаблон сохранён"}
                </span>
                <button
                  type="button"
                  disabled={busy || !templateDirty}
                  onClick={() => void saveTemplate()}
                >
                  Сохранить шаблон
                </button>
              </div>
            ) : null}
          </div>
          <div className="settings-card">
            <h2>Структура юридической модели</h2>
            <p>
              Версия {state.legalModel.version}
              {state.legalModel.changeSummary
                ? ` · ${state.legalModel.changeSummary}`
                : ""}
            </p>
            <ol className="privacy-section-list">
              {state.legalModel.sections.map((section) => (
                <li key={section.key}>{section.title}</li>
              ))}
            </ol>
          </div>
          {canManageLegalModels ? <LegalModelsAdmin /> : null}
        </div>
      ) : null}

      {tab === "settings" ? (
        <div
          className="privacy-panel"
          role="tabpanel"
          id="privacy-panel-settings"
          aria-labelledby="privacy-tab-settings"
        >
          <div className="privacy-progress-card">
            <div>
              <strong>Заполнение данных</strong>
              <span>{progress}%</span>
            </div>
            <div className="privacy-progress">
              <i style={{ width: `${progress}%` }} />
            </div>
            {state.missingFields.length ? (
              <p>Не хватает: {state.missingFields.join(", ")}.</p>
            ) : (
              <p>Обязательные данные заполнены.</p>
            )}
          </div>
          <div className="settings-card">
            <h2>Данные организации</h2>
            <p>Сохраняются в общих данных сайта и используются без дублирования.</p>
            <div className="settings-fields two-columns">
              <label>
                <span>Тип оператора *</span>
                <select
                  value={company.organizationType}
                  onChange={(event) =>
                    updateCompany("organizationType", event.target.value)
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
                <span>{legalNameLabel} *</span>
                <input
                  value={company.legalName}
                  maxLength={300}
                  onChange={(event) => updateCompany("legalName", event.target.value)}
                  readOnly={!canEdit}
                />
              </label>
              <label>
                <span>ИНН *</span>
                <input
                  value={company.inn}
                  maxLength={20}
                  onChange={(event) => updateCompany("inn", event.target.value)}
                  readOnly={!canEdit}
                />
              </label>
              {!isSelfEmployed ? (
                <label>
                  <span>
                    {registrationLabel}
                    {company.organizationType === "other" ? "" : " *"}
                  </span>
                  <input
                    value={company.ogrn}
                    maxLength={30}
                    onChange={(event) => updateCompany("ogrn", event.target.value)}
                    readOnly={!canEdit}
                  />
                </label>
              ) : null}
              <label className="privacy-wide">
                <span>
                  {isSelfEmployed ? "Адрес регистрации" : "Юридический адрес"} *
                </span>
                <input
                  value={company.legalAddress}
                  maxLength={500}
                  onChange={(event) =>
                    updateCompany("legalAddress", event.target.value)
                  }
                  readOnly={!canEdit}
                />
              </label>
            </div>
          </div>
          <PrivacyChecklist title="Какие данные собираются?" options={dataOptions} values={settings.dataCategories ?? []} onToggle={(key) => updateList("dataCategories", key)} disabled={!canEdit} />
          <PrivacyChecklist title="Как данные поступают на сайт?" options={collectionOptions} values={settings.collectionMethods ?? []} onToggle={(key) => updateList("collectionMethods", key)} disabled={!canEdit} />
          <PrivacyChecklist title="Как сайт использует данные?" options={purposeOptions} values={settings.purposes ?? []} onToggle={(key) => updateList("purposes", key)} disabled={!canEdit} />
          <PrivacyChecklist title="Какие сервисы используются?" options={serviceOptions} values={settings.services ?? []} onToggle={(key) => updateList("services", key)} disabled={!canEdit} />
          {settings.services?.includes("other") ? (
            <div className="settings-card">
              <label>
                <span>Другие внешние сервисы</span>
                <textarea value={settings.otherServiceDescription ?? ""} maxLength={1000} onChange={(event) => { setSettings((current) => ({ ...current, otherServiceDescription: event.target.value })); setSettingsDirty(true); }} readOnly={!canEdit} />
              </label>
            </div>
          ) : null}
          <div className="settings-card privacy-switches">
            <h2>Дополнительные условия</h2>
            <div className="privacy-option-block">
              <label className={`privacy-option-row ${settings.thirdPartyTransfer ? "selected" : ""}`}>
                <input type="checkbox" checked={Boolean(settings.thirdPartyTransfer)} onChange={(event) => { setSettings((current) => ({ ...current, thirdPartyTransfer: event.target.checked })); setSettingsDirty(true); }} disabled={!canEdit} />
                <span>Данные передаются третьим лицам</span>
              </label>
              {settings.thirdPartyTransfer ? <textarea value={settings.thirdPartyDescription ?? ""} maxLength={2000} placeholder="Получатели и цель передачи" onChange={(event) => { setSettings((current) => ({ ...current, thirdPartyDescription: event.target.value })); setSettingsDirty(true); }} readOnly={!canEdit} /> : null}
            </div>
            <label className={`privacy-option-row ${settings.cookies ? "selected" : ""}`}>
              <input type="checkbox" checked={Boolean(settings.cookies)} onChange={(event) => { setSettings((current) => ({ ...current, cookies: event.target.checked })); setSettingsDirty(true); }} disabled={!canEdit} />
              <span>Сайт использует файлы cookie</span>
            </label>
          </div>
          {canEdit ? (
            <div className="settings-actions">
              <span className={settingsDirty ? "unsaved-indicator" : ""}>{settingsDirty ? "● Есть несохранённые данные" : "Все изменения сохранены"}</span>
              <button type="button" disabled={busy || !settingsDirty} onClick={() => void saveSettings()}>{busy ? "Сохраняем…" : "Сохранить данные и настройки"}</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "document" ? (
        <div className="privacy-panel" role="tabpanel" id="privacy-panel-document" aria-labelledby="privacy-tab-document">
          {state.manualModelReview ? (
            <div className="settings-card privacy-review-card" role="alert">
              <h2>Нужна сверка ручной версии</h2>
              <p>Модель обновлена с {state.manualModelReview.sourceVersion} до {state.manualModelReview.targetVersion}. Ручной текст сохранён без изменений. Проверьте отмеченные разделы и сохраните его снова.</p>
              <DiffList items={state.manualModelReview.comparison} />
            </div>
          ) : null}
          <div className="privacy-document-actions">
            <div>
              <strong>{state.mode === "manual" ? "В документ внесены ручные изменения" : "Автоматическая версия"}</strong>
              <span>{state.generatedAt ? `Сформирована ${new Date(state.generatedAt).toLocaleString("ru-RU")}` : "Документ ещё не сформирован"}</span>
            </div>
            {canEdit ? (
              <div>
                <button type="button" disabled={busy || settingsDirty || templateDirty || state.missingFields.length > 0} title={dirty ? "Сначала сохраните данные, настройки и шаблон" : undefined} onClick={() => void generate()}>{state.document ? "Перегенерировать" : "Сформировать документ"}</button>
                {state.mode === "manual" ? <button type="button" className="secondary" disabled={busy || settingsDirty || templateDirty} onClick={() => void resetAutomatic()}>Вернуться к автоматической</button> : null}
              </div>
            ) : null}
          </div>
          {state.automaticSnapshot ? (
            <div className="settings-card privacy-document-card">
              {state.mode === "manual" ? <textarea aria-label="Текст политики" value={manualText} onChange={(event) => { setManualText(event.target.value); setManualDirty(true); }} readOnly={!canEdit} /> : <pre>{state.document}</pre>}
              {canEdit && state.mode === "automatic" ? <button type="button" className="secondary" onClick={() => { setManualText(state.document ?? ""); setState((current) => current ? { ...current, mode: "manual" } : current); setManualDirty(true); }}>Редактировать вручную</button> : null}
              {canEdit && state.mode === "manual" ? <button type="button" disabled={busy || !manualDirty || settingsDirty || templateDirty} onClick={() => void saveManual()}>{busy ? "Сохраняем…" : "Сохранить ручную версию"}</button> : null}
            </div>
          ) : <div className="privacy-empty">Заполните обязательные данные и сформируйте документ.</div>}

          <div className="settings-card privacy-publication-card">
            <div>
              <small>ПУБЛИКАЦИЯ</small>
              <h2>{state.pageStatus === "published" ? "Политика опубликована" : "Политика не опубликована"}</h2>
              {state.pageStatus === "published" ? (
                <p>{state.published.at ? `Опубликована ${new Date(state.published.at).toLocaleString("ru-RU")}. ` : ""}Модель {state.published.legalModelVersion ?? "—"}, шаблон {state.published.templateKey ?? "—"}.</p>
              ) : <p>{state.publicationBlockedReason ?? "Документ готов к публикации."}</p>}
            </div>
            <p>Публикация выполняется ниже после одобрения конкретной версии.</p>
          </div>
        </div>
      ) : null}
      {siteId ? (
        <SiteSettingsRevisionPanel
          siteId={siteId}
          resource="privacy"
          label="Политика конфиденциальности"
          canEdit={canEdit}
          canApprove={canApprove}
          dirty={dirty}
          refreshToken={draftRevisionId}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}

function LegalUpdateCard({ update, canEdit, busy, onAccept, onDefer }: { update: NonNullable<PrivacyState["availableUpdate"]>; canEdit: boolean; busy: boolean; onAccept: () => void; onDefer: () => void }) {
  return (
    <div className="privacy-update-card" role="status">
      <div>
        <strong>Доступна юридическая модель {update.targetVersion}</strong>
        <span>{update.changeSummary || "Описание изменений не указано."}</span>
        <DiffList items={update.comparison} compact />
      </div>
      {canEdit ? <div><button type="button" disabled={busy} onClick={onAccept}>Принять обновление</button><button type="button" className="secondary" disabled={busy} onClick={onDefer}>{update.deferred ? "Отложено" : "Отложить"}</button></div> : null}
    </div>
  );
}

function DiffList({ items, compact = false }: { items: SectionDiff[]; compact?: boolean }) {
  const visible = compact ? items.filter((item) => item.status !== "unchanged") : items;
  return visible.length ? (
    <ul className="privacy-diff-list">
      {visible.map((item) => <li key={`${item.key}-${item.status}`} className={item.status}><span>{item.targetTitle ?? item.sourceTitle ?? item.key}</span><small>{diffLabels[item.status]}</small></li>)}
    </ul>
  ) : <p>Структурных изменений в разделах нет.</p>;
}

function LegalModelsAdmin() {
  const emptySections = JSON.stringify([{ key: "general", title: "Общие положения", body: "" }], null, 2);
  const [models, setModels] = useState<LegalModel[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [version, setVersion] = useState("");
  const [sectionsText, setSectionsText] = useState(emptySections);
  const [rulesText, setRulesText] = useState("[]");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setModels(await request<LegalModel[]>("/api/platform/privacy-legal-models"));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function selectModel(model: LegalModel) {
    setSelectedId(model.id);
    setVersion(model.version);
    setSectionsText(JSON.stringify(model.sections, null, 2));
    setRulesText(JSON.stringify(model.rules ?? [], null, 2));
    setSummary(model.changeSummary ?? "");
    setMessage("");
  }
  function newModel() {
    setSelectedId("");
    setVersion("");
    setSectionsText(emptySections);
    setRulesText("[]");
    setSummary("");
    setMessage("");
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const sections = JSON.parse(sectionsText);
      const rules = JSON.parse(rulesText);
      const url = selectedId ? `/api/platform/privacy-legal-models/${selectedId}` : "/api/platform/privacy-legal-models";
      const saved = await request<LegalModel>(url, { method: selectedId ? "PUT" : "POST", body: JSON.stringify({ ...(selectedId ? {} : { version }), sections, rules }) });
      await load();
      selectModel(saved);
      setMessage("Черновик юридической модели сохранён");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось сохранить модель");
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!selectedId) return;
    setBusy(true);
    setMessage("");
    try {
      const approved = await request<LegalModel>(`/api/platform/privacy-legal-models/${selectedId}/approve`, { method: "POST", body: JSON.stringify({ changeSummary: summary }) });
      await load();
      selectModel(approved);
      setMessage("Юридическая модель утверждена и теперь неизменяема");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось утвердить модель");
    } finally {
      setBusy(false);
    }
  }

  const selected = models.find((model) => model.id === selectedId);
  const editable = !selected || selected.status === "draft";
  return (
    <div className="settings-card privacy-legal-admin">
      <div className="privacy-admin-heading"><div><small>ТОЛЬКО WISPO ADMIN</small><h2>Юридические модели</h2><p>Создайте или отредактируйте черновик. Утверждённые версии неизменяемы.</p></div><button type="button" className="secondary" onClick={newModel}>Новая модель</button></div>
      <div className="privacy-model-list" aria-label="Юридические модели">
        {models.map((model) => <button type="button" className={selectedId === model.id ? "selected" : ""} key={model.id} onClick={() => selectModel(model)}><strong>{model.version}</strong><span>{model.status === "approved" ? "Утверждена" : "Черновик"}</span></button>)}
      </div>
      <div className="settings-fields">
        <label><span>Версия *</span><input value={version} maxLength={80} readOnly={Boolean(selectedId)} onChange={(event) => setVersion(event.target.value)} /></label>
        <label><span>Разделы (JSON: key, title, body) *</span><textarea className="privacy-json-editor" value={sectionsText} readOnly={!editable} onChange={(event) => setSectionsText(event.target.value)} /></label>
        <label><span>Правила включения разделов (JSON)</span><textarea className="privacy-json-editor" value={rulesText} readOnly={!editable} onChange={(event) => setRulesText(event.target.value)} /></label>
        {selected?.status === "draft" ? <label><span>Краткое описание юридических изменений *</span><textarea value={summary} maxLength={2000} onChange={(event) => setSummary(event.target.value)} /></label> : null}
      </div>
      {message ? <div className="inline-message" role="status">{message}</div> : null}
      <div className="settings-actions">
        <span>{selected?.status === "approved" && selected.approvedAt ? `Утверждена ${new Date(selected.approvedAt).toLocaleString("ru-RU")}` : "Утверждение требует полного юридического текста"}</span>
        {editable ? <div><button type="button" className="secondary" disabled={busy || !version.trim()} onClick={() => void save()}>Сохранить черновик</button>{selectedId ? <button type="button" disabled={busy || !summary.trim()} onClick={() => void approve()}>Утвердить неизменяемую версию</button> : null}</div> : null}
      </div>
    </div>
  );
}

function PrivacyChecklist({ title, options, values, onToggle, disabled }: { title: string; options: ReadonlyArray<readonly [string, string]>; values: string[]; onToggle: (key: string) => void; disabled: boolean }) {
  const headingId = useId();
  return (
    <section className="settings-card privacy-checklist" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <div>{options.map(([key, label]) => <label key={key}><input type="checkbox" checked={values.includes(key)} onChange={() => onToggle(key)} disabled={disabled} /><span>{label}</span></label>)}</div>
    </section>
  );
}
