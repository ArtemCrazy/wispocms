"use client";

import { useCallback, useEffect, useState } from "react";
import { CodeResourcesEditor } from "./code-resources-editor";
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
  canEdit,
  canApprove,
  onOpen,
}: {
  siteId: string;
  canEdit: boolean;
  canApprove: boolean;
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
                    disabled={!canEdit || saving}
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
                    disabled={!canEdit || saving}
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
                  disabled={!canEdit || saving}
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
        canEdit={canEdit}
        canApprove={canApprove}
        dirty={
          headerIdentity !== savedHeaderIdentity ||
          footerIdentity !== savedFooterIdentity
        }
        refreshToken={layoutDraftRevisionId}
        onChanged={load}
      />
      <CodeResourcesEditor
        siteId={siteId}
        canEdit={canEdit}
        canApprove={canApprove}
      />
    </section>
  );
}
