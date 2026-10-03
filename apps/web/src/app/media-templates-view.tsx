"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteSettingsRevisionPanel } from "./site-settings-revision-panel";

type TemplateTarget =
  "homepage-template" | "articles" | "layout" | "404" | "privacy-policy";
type Page = {
  kind: "homepage" | "page";
  systemTemplateKey: string | null;
  systemTemplateVersion: string | null;
};
type ArticleSettings = {
  listTemplateKey: string;
  listTemplateVersion: string;
} | null;
type NotFoundState = { template: { name: string; version: string } };
type PrivacyState = {
  displayTemplate: { title: string; key: string; version: string };
};
type ContentTemplate = {
  kind: "articles_list" | "article" | "category" | "header" | "footer";
  key: string;
  version: string;
  name: string;
  config: Record<string, unknown>;
};
type LayoutSettings = {
  headerTemplateKey?: string;
  headerTemplateVersion?: string;
  headerTemplateConfig?: Record<string, unknown>;
  footerTemplateKey?: string;
  footerTemplateVersion?: string;
  footerTemplateConfig?: Record<string, unknown>;
  draftRevisionId: string | null;
};
type TemplateIdentity = {
  kind: string;
  key: string;
  version: string;
};
type TemplatePackageSummary = {
  packageId: string;
  packageVersion: string;
  sourceRevision: string;
  releaseDigest: string;
  artifactDigest: string | null;
  status: "ready" | "mismatch";
  reasons: string[];
  previewUrl: string | null;
  templates: TemplateIdentity[];
};
type CurrentTemplatePackage = {
  siteId: string;
  siteSlug: string;
  templatePackage: TemplatePackageSummary | null;
};
type TemplatePackageCandidate = {
  packageId: string;
  packageVersion: string;
  sourceRevision: string;
  releaseDigest: string;
  artifactDigest: string | null;
  status: "registered";
  isCurrent: boolean;
  previewUrl: string | null;
};

const compatibilityReasonLabels: Record<string, string> = {
  runtime_unavailable: "Среда предпросмотра недоступна",
  site_type_mismatch: "Тип сайта не совпадает",
  template_assignment_mismatch: "Назначения шаблонов не совпадают",
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

export function MediaTemplatesView({
  siteId,
  isWispoAdmin,
  canManageStructure,
  canApprove,
  canPublishDirectly,
  onOpen,
}: {
  siteId: string;
  isWispoAdmin: boolean;
  canManageStructure: boolean;
  canApprove: boolean;
  canPublishDirectly: boolean;
  onOpen: (target: TemplateTarget) => void;
}) {
  const [rows, setRows] = useState<
    Array<{ id: TemplateTarget; name: string; current: string; hint: string }>
  >([]);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [headerIdentity, setHeaderIdentity] = useState("");
  const [footerIdentity, setFooterIdentity] = useState("");
  const [savedHeaderIdentity, setSavedHeaderIdentity] = useState("");
  const [savedFooterIdentity, setSavedFooterIdentity] = useState("");
  const [layoutDraftRevisionId, setLayoutDraftRevisionId] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [currentPackage, setCurrentPackage] =
    useState<CurrentTemplatePackage | null>(null);
  const [packageCandidates, setPackageCandidates] = useState<
    TemplatePackageCandidate[]
  >([]);
  const [packageLoading, setPackageLoading] = useState(true);
  const [candidatesLoading, setCandidatesLoading] = useState(isWispoAdmin);
  const [packageMessage, setPackageMessage] = useState("");
  const [candidatesMessage, setCandidatesMessage] = useState("");
  const packageRequestSequence = useRef(0);

  const load = useCallback(async () => {
    const [pages, articles, notFound, privacy, contentTemplates, siteLayout] =
      await Promise.all([
        request<Page[]>(`/api/sites/${siteId}/content/pages`),
        request<ArticleSettings>(
          `/api/sites/${siteId}/content/articles/settings`,
        ),
        request<NotFoundState>(`/api/sites/${siteId}/content/not-found`),
        request<PrivacyState>(`/api/sites/${siteId}/content/privacy`),
        request<ContentTemplate[]>(`/api/sites/${siteId}/content/templates`),
        request<LayoutSettings>(`/api/sites/${siteId}/content/layout`),
      ]);
    const identity = (key?: string, version?: string) =>
      key && version ? `${key}::${version}` : "";
    const templateName = (
      kind: ContentTemplate["kind"],
      key?: string,
      version?: string,
    ) => {
      const template = contentTemplates.find(
        (candidate) =>
          candidate.kind === kind &&
          candidate.key === key &&
          candidate.version === version,
      );
      return template ? `${template.name} · ${template.version}` : "Не выбран";
    };
    setTemplates(contentTemplates);
    const nextHeaderIdentity = identity(
      siteLayout.headerTemplateKey,
      siteLayout.headerTemplateVersion,
    );
    const nextFooterIdentity = identity(
      siteLayout.footerTemplateKey,
      siteLayout.footerTemplateVersion,
    );
    setHeaderIdentity(nextHeaderIdentity);
    setFooterIdentity(nextFooterIdentity);
    setSavedHeaderIdentity(nextHeaderIdentity);
    setSavedFooterIdentity(nextFooterIdentity);
    setLayoutDraftRevisionId(siteLayout.draftRevisionId);
    const homepage = pages.find((page) => page.kind === "homepage");
    setRows([
      {
        id: "homepage-template",
        name: "Главная",
        current: homepage?.systemTemplateKey
          ? `${homepage.systemTemplateKey} · ${homepage.systemTemplateVersion}`
          : "Базовый шаблон Media",
        hint: "Структура и визуальное представление главной страницы",
      },
      {
        id: "articles",
        name: "Статьи",
        current: articles
          ? `${articles.listTemplateKey} · ${articles.listTemplateVersion}`
          : "Шаблон списка не подключён",
        hint: "Список материалов и шаблоны статьи/категории",
      },
      {
        id: "layout",
        name: "Шапка и подвал",
        current: `${templateName(
          "header",
          siteLayout.headerTemplateKey,
          siteLayout.headerTemplateVersion,
        )}; ${templateName(
          "footer",
          siteLayout.footerTemplateKey,
          siteLayout.footerTemplateVersion,
        )}`,
        hint: "Единые области, используемые всеми страницами",
      },
      {
        id: "404",
        name: "404",
        current: `${notFound.template.name} · ${notFound.template.version}`,
        hint: "Общая библиотека системных шаблонов",
      },
      {
        id: "privacy-policy",
        name: "Политика конфиденциальности",
        current: `${privacy.displayTemplate.title} · ${privacy.displayTemplate.version}`,
        hint: "Юридический документ и шаблон его отображения",
      },
    ]);
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadTemplatePackage = useCallback((
    signal: AbortSignal,
    sequence: number,
  ) => {
    const isCurrentRequest = () =>
      !signal.aborted && packageRequestSequence.current === sequence;
    const currentRequest = request<CurrentTemplatePackage>(
      `/api/sites/${siteId}/template-package/current`,
      { signal },
    );
    void currentRequest
      .then((current) => {
        if (!isCurrentRequest()) return;
        setCurrentPackage(current);
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        setCurrentPackage(null);
        setPackageMessage("Не удалось загрузить данные frontend-пакета");
      })
      .finally(() => {
        if (isCurrentRequest()) setPackageLoading(false);
      });

    if (!isWispoAdmin) {
      setCandidatesLoading(false);
      return;
    }
    const candidatesRequest = request<TemplatePackageCandidate[]>(
      `/api/platform/sites/${siteId}/template-package/candidates`,
      { signal },
    );
    void candidatesRequest
      .then((candidates) => {
        if (!isCurrentRequest()) return;
        setPackageCandidates(candidates);
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        setPackageCandidates([]);
        setCandidatesMessage("Не удалось загрузить совместимые версии");
      })
      .finally(() => {
        if (isCurrentRequest()) setCandidatesLoading(false);
      });
  }, [isWispoAdmin, siteId]);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++packageRequestSequence.current;
    const timer = window.setTimeout(() => {
      if (packageRequestSequence.current !== sequence) return;
      setCurrentPackage(null);
      setPackageCandidates([]);
      setPackageMessage("");
      setCandidatesMessage("");
      setPackageLoading(true);
      setCandidatesLoading(isWispoAdmin);
      void loadTemplatePackage(controller.signal, sequence);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (packageRequestSequence.current === sequence)
        packageRequestSequence.current += 1;
    };
  }, [isWispoAdmin, loadTemplatePackage]);

  const templateOptions = (kind: "header" | "footer") =>
    templates.filter((template) => template.kind === kind);
  const saveLayoutTemplates = async () => {
    const selected = (identity: string, kind: "header" | "footer") =>
      templates.find(
        (template) =>
          template.kind === kind &&
          `${template.key}::${template.version}` === identity,
      );
    const header = selected(headerIdentity, "header");
    const footer = selected(footerIdentity, "footer");
    if (!header || !footer) {
      setMessage("Выберите шаблоны шапки и подвала");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await request(`/api/sites/${siteId}/content/layout`, {
        method: "PATCH",
        body: JSON.stringify({
          headerTemplateKey: header.key,
          headerTemplateVersion: header.version,
          headerTemplateConfig: header.config,
          footerTemplateKey: footer.key,
          footerTemplateVersion: footer.version,
          footerTemplateConfig: footer.config,
          expectedDraftRevisionId: layoutDraftRevisionId,
        }),
      });
      await load();
      setMessage("Шаблоны шапки и подвала сохранены");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка запроса");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="media-module-shell media-templates-view">
      <header className="media-module-heading">
        <div>
          <small>САЙТ</small>
          <h1>Шаблоны</h1>
        </div>
        <p>Текущие шаблоны всех поддерживаемых поверхностей Media.</p>
      </header>
      <section
        className="template-package-panel"
        aria-labelledby="template-package-heading"
      >
        <div className="template-package-panel-heading">
          <div>
            <h2 id="template-package-heading">
              Текущая версия frontend-пакета
            </h2>
            <p>
              Версия интерфейса сайта, которая фактически развёрнута сейчас.
            </p>
          </div>
          {currentPackage?.templatePackage ? (
            <span
              className={`template-package-status ${
                currentPackage.templatePackage.status === "ready"
                  ? "is-ready"
                  : "is-mismatch"
              }`}
              role="status"
            >
              {currentPackage.templatePackage.status === "ready"
                ? "Готова"
                : "Требует внимания"}
            </span>
          ) : null}
        </div>

        {packageLoading ? (
          <p className="template-package-state" role="status">
            Загружаем данные frontend-пакета…
          </p>
        ) : packageMessage ? (
          <p className="template-package-state is-error" role="alert">
            {packageMessage}
          </p>
        ) : currentPackage?.templatePackage ? (
          <div className="template-package-current">
            <dl className="template-package-details">
              <div>
                <dt>Пакет</dt>
                <dd className="template-package-identifier">
                  {currentPackage.templatePackage.packageId}
                </dd>
              </div>
              <div>
                <dt>Версия</dt>
                <dd className="template-package-identifier">
                  {currentPackage.templatePackage.packageVersion}
                </dd>
              </div>
              <div>
                <dt>Git-ревизия</dt>
                <dd
                  className="template-package-source-revision"
                >
                  <code>{currentPackage.templatePackage.sourceRevision}</code>
                </dd>
              </div>
              <div>
                <dt>Release digest</dt>
                <dd className="template-package-digest">
                  {currentPackage.templatePackage.releaseDigest}
                </dd>
              </div>
            </dl>
            {currentPackage.templatePackage.reasons.length ? (
              <ul className="template-package-reasons">
                {currentPackage.templatePackage.reasons.map((reason) => (
                  <li key={reason}>
                    {compatibilityReasonLabels[reason] ?? reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {currentPackage.templatePackage.previewUrl ? (
              <a
                className="template-package-preview"
                href={currentPackage.templatePackage.previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть предпросмотр
              </a>
            ) : null}
          </div>
        ) : (
          <p className="template-package-state" role="status">
            Frontend-пакет ещё не зарегистрирован
          </p>
        )}

        {isWispoAdmin && !packageLoading ? (
          <section
            className="template-package-candidates"
            aria-labelledby="template-package-candidates-heading"
          >
            <div>
              <h3 id="template-package-candidates-heading">
                Совместимые версии
              </h3>
              <p>Зарегистрированные версии для этого сайта.</p>
            </div>
            {candidatesLoading ? (
              <p className="template-package-state" role="status">
                Загружаем совместимые версии…
              </p>
            ) : candidatesMessage ? (
              <p className="template-package-state is-error" role="alert">
                {candidatesMessage}
              </p>
            ) : packageCandidates.length ? (
              <ul>
                {packageCandidates.map((candidate) => (
                  <li
                    key={`${candidate.packageId}:${candidate.packageVersion}`}
                  >
                    <div>
                      <strong className="template-package-identifier">
                        {candidate.packageVersion}
                      </strong>
                      {candidate.isCurrent ? <span>Текущая</span> : null}
                    </div>
                    <p
                      className="template-package-candidate-meta"
                    >
                      Git{" "}
                      <code className="template-package-source-revision">
                        {candidate.sourceRevision}
                      </code>{" "}
                      · Digest{" "}
                      <code className="template-package-digest">
                        {candidate.releaseDigest}
                      </code>
                    </p>
                    {candidate.previewUrl ? (
                      <a
                        href={candidate.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Предпросмотр
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="template-package-state">
                Других совместимых версий пока нет
              </p>
            )}
          </section>
        ) : null}
      </section>
      {message ? <p className="inline-message">{message}</p> : null}
      <div className="media-template-manager">
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <small>{row.hint}</small>
              <h2>{row.name}</h2>
              <p>
                Текущий: <strong>{row.current}</strong>
              </p>
            </div>
            {row.id === "layout" ? (
              <div className="media-template-controls">
                <label>
                  Шапка
                  <select
                    value={headerIdentity}
                    disabled={!canManageStructure || saving}
                    onChange={(event) => setHeaderIdentity(event.target.value)}
                  >
                    <option value="">Не выбрана</option>
                    {templateOptions("header").map((template) => (
                      <option
                        key={`${template.key}:${template.version}`}
                        value={`${template.key}::${template.version}`}
                      >
                        {template.name} · {template.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Подвал
                  <select
                    value={footerIdentity}
                    disabled={!canManageStructure || saving}
                    onChange={(event) => setFooterIdentity(event.target.value)}
                  >
                    <option value="">Не выбран</option>
                    {templateOptions("footer").map((template) => (
                      <option
                        key={`${template.key}:${template.version}`}
                        value={`${template.key}::${template.version}`}
                      >
                        {template.name} · {template.version}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!canManageStructure || saving}
                  onClick={() => void saveLayoutTemplates()}
                >
                  {saving ? "Сохраняем…" : "Применить"}
                </button>
                <button type="button" onClick={() => onOpen("layout")}>
                  Настроить содержимое
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => onOpen(row.id)}>
                Открыть и изменить
              </button>
            )}
          </article>
        ))}
        {!rows.length && !message ? <p>Загружаем шаблоны…</p> : null}
      </div>
      <SiteSettingsRevisionPanel
        siteId={siteId}
        basePath={`metadata/layout-bindings/${siteId}`}
        label="Шаблоны шапки и подвала"
        canEdit={canManageStructure}
        canApprove={canApprove}
        canPublishDirectly={canPublishDirectly}
        dirty={
          headerIdentity !== savedHeaderIdentity ||
          footerIdentity !== savedFooterIdentity
        }
        refreshToken={layoutDraftRevisionId}
        onChanged={load}
      />
    </section>
  );
}
