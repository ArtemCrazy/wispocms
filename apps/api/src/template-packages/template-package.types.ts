export const TEMPLATE_PACKAGE_SITE_TYPES = [
  'media',
  'corporate',
  'ecommerce',
  'landing',
] as const;

export const TEMPLATE_PACKAGE_TEMPLATE_KINDS = [
  'homepage',
  'articles_list',
  'article',
  'category',
  'header',
  'footer',
  'system_page',
] as const;

export const TEMPLATE_RUNTIME_CONTEXT_KEYS = [
  'siteSlug',
  'homepage',
  'articles',
  'related',
  'categories',
  'subcategories',
  'banners',
  'banner',
  'globals',
  'layout',
  'promo',
  'mediaBaseUrl',
  'mediaFileSuffix',
] as const;

export type TemplatePackageSiteType =
  (typeof TEMPLATE_PACKAGE_SITE_TYPES)[number];
export type TemplatePackageTemplateKind =
  (typeof TEMPLATE_PACKAGE_TEMPLATE_KINDS)[number];
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
  dataScope: 'cms-entity';
  runtimeContext: TemplateRuntimeContextKey[];
  dataSchemaVersion: string;
  dataSchema: JsonSchema;
  configSchema?: JsonSchema;
  slots?: TemplatePackageSlot[];
};

export type TemplatePackageManifest = {
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
    revision: string;
  };
  build: {
    releaseDigest: string;
    artifactDigest?: string | null;
    builtAt: string;
    runtimeMode: 'embedded-next' | 'external';
    runtimeUrl?: string;
  };
  templates: TemplatePackageTemplate[];
};
