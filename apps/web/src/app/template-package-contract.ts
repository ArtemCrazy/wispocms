import skinovaManifestTemplate from "../../template-packages/skinova/manifest.template.json" with { type: "json" };

export const TEMPLATE_PACKAGE_TEMPLATE_KINDS = [
  "homepage",
  "articles_list",
  "article",
  "category",
  "header",
  "footer",
  "system_page",
] as const;

export type TemplatePackageTemplateKind =
  (typeof TEMPLATE_PACKAGE_TEMPLATE_KINDS)[number];

export type TemplatePackageSiteType =
  | "media"
  | "corporate"
  | "ecommerce"
  | "landing";

export const TEMPLATE_RUNTIME_CONTEXT_KEYS = [
  "siteSlug",
  "homepage",
  "articles",
  "related",
  "categories",
  "subcategories",
  "banners",
  "banner",
  "globals",
  "layout",
  "promo",
  "mediaBaseUrl",
  "mediaFileSuffix",
] as const;

export type TemplateRuntimeContextKey =
  (typeof TEMPLATE_RUNTIME_CONTEXT_KEYS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = JsonObject;

export type TemplatePackageSlot = {
  key: string;
  title: string;
  renderer: string;
  placement: string;
  maxItems?: number;
};

export type TemplatePackageTemplate = {
  kind: TemplatePackageTemplateKind;
  key: string;
  version: string;
  title: string;
  dataScope: "cms-entity";
  runtimeContext: TemplateRuntimeContextKey[];
  dataSchemaVersion: string;
  dataSchema: JsonSchema;
  configSchema?: JsonSchema;
  slots?: TemplatePackageSlot[];
};

export type TemplatePackageManifestTemplate = {
  manifestVersion: 1;
  packageId: string;
  packageVersion: string;
  title: string;
  siteType: TemplatePackageSiteType;
  cmsApi: {
    minSchemaVersion: string;
    maxSchemaVersion?: string;
  };
  source: {
    repository: string;
  };
  build: {
    runtimeMode: "embedded-next" | "external";
    runtimeUrl?: string;
  };
  templates: TemplatePackageTemplate[];
};

export type TemplatePackageManifest = Omit<
  TemplatePackageManifestTemplate,
  "source" | "build"
> & {
  source: TemplatePackageManifestTemplate["source"] & {
    revision: string;
  };
  build: TemplatePackageManifestTemplate["build"] & {
    releaseDigest: string;
    artifactDigest: string | null;
    builtAt: string;
  };
};

export type TemplateRuntimeIdentity = {
  packageId: string;
  packageVersion: string;
  kind: TemplatePackageTemplateKind;
  key: string;
  templateVersion: string;
};

export const SKINOVA_TEMPLATE_PACKAGE_MANIFEST =
  skinovaManifestTemplate as unknown as TemplatePackageManifestTemplate;

function requireSkinovaTemplate(kind: TemplatePackageTemplateKind) {
  const template = SKINOVA_TEMPLATE_PACKAGE_MANIFEST.templates.find(
    (candidate) => candidate.kind === kind,
  );
  if (!template)
    throw new Error(`Skinova manifest does not declare ${kind} template`);
  return template;
}

export const SKINOVA_HOME_TEMPLATE = requireSkinovaTemplate("homepage");
export const SKINOVA_ARTICLES_LIST_TEMPLATE =
  requireSkinovaTemplate("articles_list");
export const SKINOVA_ARTICLE_TEMPLATE = requireSkinovaTemplate("article");
export const SKINOVA_CATEGORY_TEMPLATE = requireSkinovaTemplate("category");
export const SKINOVA_HEADER_TEMPLATE = requireSkinovaTemplate("header");
export const SKINOVA_FOOTER_TEMPLATE = requireSkinovaTemplate("footer");
export const SKINOVA_SYSTEM_PAGE_TEMPLATE =
  requireSkinovaTemplate("system_page");

export const SKINOVA_HOME_TEMPLATE_KEY = SKINOVA_HOME_TEMPLATE.key;
export const SKINOVA_HOME_TEMPLATE_VERSION = SKINOVA_HOME_TEMPLATE.version;
export const SKINOVA_ARTICLES_LIST_TEMPLATE_KEY =
  SKINOVA_ARTICLES_LIST_TEMPLATE.key;
export const SKINOVA_ARTICLES_LIST_TEMPLATE_VERSION =
  SKINOVA_ARTICLES_LIST_TEMPLATE.version;
export const SKINOVA_ARTICLE_TEMPLATE_KEY = SKINOVA_ARTICLE_TEMPLATE.key;
export const SKINOVA_ARTICLE_TEMPLATE_VERSION =
  SKINOVA_ARTICLE_TEMPLATE.version;
export const SKINOVA_CATEGORY_TEMPLATE_KEY = SKINOVA_CATEGORY_TEMPLATE.key;
export const SKINOVA_CATEGORY_TEMPLATE_VERSION =
  SKINOVA_CATEGORY_TEMPLATE.version;
export const SKINOVA_HEADER_TEMPLATE_KEY = SKINOVA_HEADER_TEMPLATE.key;
export const SKINOVA_HEADER_TEMPLATE_VERSION = SKINOVA_HEADER_TEMPLATE.version;
export const SKINOVA_FOOTER_TEMPLATE_KEY = SKINOVA_FOOTER_TEMPLATE.key;
export const SKINOVA_FOOTER_TEMPLATE_VERSION = SKINOVA_FOOTER_TEMPLATE.version;
export const SKINOVA_SYSTEM_PAGE_TEMPLATE_KEY =
  SKINOVA_SYSTEM_PAGE_TEMPLATE.key;
export const SKINOVA_SYSTEM_PAGE_TEMPLATE_VERSION =
  SKINOVA_SYSTEM_PAGE_TEMPLATE.version;
export const SKINOVA_TEMPLATE_VERSION = SKINOVA_HOME_TEMPLATE_VERSION;
