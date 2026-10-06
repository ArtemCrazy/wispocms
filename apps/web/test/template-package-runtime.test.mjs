import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import {
  SKINOVA_SLOT_RUNTIME_CATALOG,
  SKINOVA_TEMPLATE_RUNTIME_CATALOG,
  resolveSlotRuntime,
  resolveTemplateRuntime,
} from "../src/app/template-runtime-catalog.ts";

const manifestText = await readFile(
  new URL("../template-packages/skinova/manifest.template.json", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(manifestText);
const registrySource = await readFile(
  new URL("../src/app/template-runtime-registry.tsx", import.meta.url),
  "utf8",
);
const compatibilitySource = await readFile(
  new URL("../src/app/skinova-template.ts", import.meta.url),
  "utf8",
);
const homepageRegistrySource = await readFile(
  new URL("../src/app/homepage-templates.ts", import.meta.url),
  "utf8",
);

const expectedTemplates = new Map([
  ["homepage", "skinova-home@1"],
  ["articles_list", "skinova-editorial@1"],
  ["article", "skinova-article@1"],
  ["category", "skinova-category@1"],
  ["header", "skinova-header@1"],
  ["footer", "skinova-footer@1"],
  ["system_page", "skinova@1"],
]);

const expectedImplementations = new Map([
  ["homepage", ["skinova-home", "component"]],
  ["articles_list", ["skinova-home", "integrated"]],
  ["article", ["skinova-article", "component"]],
  ["category", ["skinova-category", "component"]],
  ["header", ["skinova-chrome", "integrated"]],
  ["footer", ["skinova-chrome", "integrated"]],
  ["system_page", ["skinova-system-page", "component"]],
]);

const expectedRuntimeContext = new Map([
  [
    "homepage",
    [
      "siteSlug",
      "categories",
      "articles",
      "banners",
      "globals",
      "layout",
      "mediaBaseUrl",
      "mediaFileSuffix",
    ],
  ],
  [
    "articles_list",
    [
      "siteSlug",
      "homepage",
      "articles",
      "categories",
      "banners",
      "globals",
      "layout",
      "mediaBaseUrl",
      "mediaFileSuffix",
    ],
  ],
  [
    "article",
    [
      "siteSlug",
      "related",
      "categories",
      "banner",
      "globals",
      "layout",
      "mediaBaseUrl",
      "mediaFileSuffix",
    ],
  ],
  [
    "category",
    [
      "siteSlug",
      "articles",
      "subcategories",
      "globals",
      "layout",
      "mediaBaseUrl",
      "mediaFileSuffix",
    ],
  ],
  ["header", ["siteSlug", "categories", "promo"]],
  ["footer", ["siteSlug"]],
  ["system_page", ["siteSlug", "categories", "banners", "globals", "layout"]],
]);

function assertSerializableJson(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value))
    return;
  assert.notEqual(typeof value, "function");
  assert.notEqual(typeof value, "symbol");
  assert.notEqual(typeof value, "undefined");
  if (Array.isArray(value)) {
    for (const item of value) assertSerializableJson(item);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  for (const item of Object.values(value)) assertSerializableJson(item);
}

test("Skinova manifest is serializable and owns every stable template identity", () => {
  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.packageId, "skinova-media");
  assert.equal(manifest.packageVersion, "1");
  assert.equal(manifest.siteType, "media");
  assert.equal(manifest.build.runtimeMode, "embedded-next");

  assert.equal("revision" in manifest.source, false);
  assert.equal("releaseDigest" in manifest.build, false);
  assert.equal("artifactDigest" in manifest.build, false);
  assert.equal("builtAt" in manifest.build, false);
  assert.doesNotMatch(manifestText, /React|component|function|=>/);
  assertSerializableJson(manifest);

  const identities = manifest.templates.map(
    (template) => `${template.kind}:${template.key}@${template.version}`,
  );
  assert.equal(new Set(identities).size, identities.length);
  assert.deepEqual(
    new Map(
      manifest.templates.map((template) => [
        template.kind,
        `${template.key}@${template.version}`,
      ]),
    ),
    expectedTemplates,
  );

  for (const template of manifest.templates) {
    assert.equal(template.dataScope, "cms-entity");
    assert.equal(Array.isArray(template.runtimeContext), true);
    assert.equal(
      new Set(template.runtimeContext).size,
      template.runtimeContext.length,
    );
    assert.deepEqual(
      template.runtimeContext,
      expectedRuntimeContext.get(template.kind),
    );
    assert.equal(template.dataSchemaVersion, "1");
    assert.equal(
      template.dataSchema.$schema,
      "http://json-schema.org/draft-07/schema#",
    );
    assert.equal(template.dataSchema.type, "object");
  }
});

test("manifest schemas accept current Skinova payloads and reject incompatible data", () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const templates = new Map(
    manifest.templates.map((template) => [template.kind, template]),
  );
  const validate = (kind, part, value) => {
    const validator = ajv.compile(templates.get(kind)[part]);
    return validator(value);
  };
  for (const template of manifest.templates) {
    ajv.compile(template.dataSchema);
    ajv.compile(template.configSchema);
  }
  assert.equal(
    validate("homepage", "dataSchema", {
      blocks: [
        {
          id: "hero",
          type: "hero",
          title: "Заголовок",
          text: "Текст",
          buttonLabel: "Читать",
          buttonUrl: "/articles/example",
          mediaId: "media-id",
        },
      ],
    }),
    true,
  );
  assert.equal(validate("homepage", "dataSchema", { blocks: [], html: "<p>" }), false);

  assert.equal(
    validate("articles_list", "dataSchema", {}),
    true,
  );
  assert.equal(
    validate("articles_list", "dataSchema", { articles: [] }),
    false,
  );

  assert.equal(
    validate("article", "dataSchema", {
      title: "Материал",
      slug: "material",
      excerpt: null,
      body: "Текст",
      bodyDocument: null,
      categoryId: null,
      authorId: null,
      coverMediaId: null,
      previewMediaId: null,
    }),
    true,
  );
  assert.equal(
    validate("article", "dataSchema", {
      title: "Материал",
      slug: "material",
      body: "Текст",
      bodyDocument: {
        version: 1,
        blocks: [{ id: "heading", type: "heading", text: "Раздел", level: 5 }],
      },
    }),
    false,
  );
  assert.equal(
    validate("article", "configSchema", { readMinutes: 7, tags: ["уход"] }),
    true,
  );
  assert.equal(validate("article", "configSchema", { html: "<script>" }), false);

  assert.equal(
    validate("category", "dataSchema", {
      name: "Уход",
      slug: "care",
      parentId: null,
      description: "Материалы об уходе",
    }),
    true,
  );
  assert.equal(
    validate("category", "dataSchema", {
      name: 42,
      slug: "care",
    }),
    false,
  );

  for (const kind of ["header", "footer"]) {
    assert.equal(
      validate(kind, "dataSchema", {
        globals: { companyName: "Skinova", telegramUrl: "https://t.me/skinova" },
        layout: { logoText: "Skinova", showArticles: true },
      }),
      true,
    );
    assert.equal(
      validate(kind, "dataSchema", {
        globals: { companyName: "Skinova", unknown: true },
        layout: {},
      }),
      false,
    );
  }

  assert.equal(
    validate("system_page", "dataSchema", {
      title: "Политика",
      slug: "privacy-policy",
      blocks: [{ id: "policy", type: "text", text: "Текст документа" }],
    }),
    true,
  );
  assert.equal(
    validate("system_page", "dataSchema", {
      title: "Политика",
      slug: "privacy-policy",
      blocks: [{ id: "policy", type: "html", text: "Текст документа" }],
    }),
    false,
  );

  for (const template of manifest.templates.filter(
    (candidate) => candidate.kind !== "article",
  )) {
    assert.equal(validate(template.kind, "configSchema", {}), true);
    assert.equal(
      validate(template.kind, "configSchema", { unknown: true }),
      false,
    );
  }
});

test("every manifest template has one executable package-aware capability", () => {
  assert.equal(SKINOVA_TEMPLATE_RUNTIME_CATALOG.length, expectedTemplates.size);
  assert.equal(
    new Set(SKINOVA_TEMPLATE_RUNTIME_CATALOG.map((entry) => entry.identity)).size,
    SKINOVA_TEMPLATE_RUNTIME_CATALOG.length,
  );
  for (const [kind, [implementationKey, bindingKind]] of expectedImplementations) {
    const template = manifest.templates.find((candidate) => candidate.kind === kind);
    const resolved = resolveTemplateRuntime({
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      kind,
      key: template.key,
      templateVersion: template.version,
    });
    assert.equal(resolved?.implementationKey, implementationKey);
    assert.equal(resolved?.bindingKind, bindingKind);
  }
  const homepageIdentity = {
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    kind: "homepage",
    key: "skinova-home",
    templateVersion: "1",
  };
  assert.equal(
    resolveTemplateRuntime({ ...homepageIdentity, packageId: "foreign" }),
    null,
  );
  assert.equal(
    resolveTemplateRuntime({ ...homepageIdentity, packageVersion: "2" }),
    null,
  );
  assert.equal(resolveTemplateRuntime({ ...homepageIdentity, key: "unknown" }), null);
  assert.equal(
    resolveTemplateRuntime({ ...homepageIdentity, templateVersion: "2" }),
    null,
  );

  assert.match(registrySource, /"skinova-home":\s*SkinovaHome/);
  assert.match(registrySource, /"skinova-article":\s*SkinovaArticlePage/);
  assert.match(registrySource, /"skinova-category":\s*SkinovaCategoryPage/);
  assert.match(registrySource, /"skinova-system-page":\s*SkinovaSystemPage/);
  assert.doesNotMatch(registrySource, /articles_list:\s*SkinovaHome/);
  assert.doesNotMatch(registrySource, /(?:header|footer):\s*SkinovaHome/);
});

test("every manifest slot renderer has one package-aware runtime capability", () => {
  const slotRenderers = manifest.templates.flatMap((template) =>
    (template.slots ?? []).map((slot) => slot.renderer),
  );
  assert.equal(new Set(slotRenderers).size, slotRenderers.length);
  assert.deepEqual(new Set(slotRenderers), new Set([
    "skinova-promo-strip",
    "skinova-consultation",
    "skinova-article-sidebar",
  ]));
  assert.equal(SKINOVA_SLOT_RUNTIME_CATALOG.length, slotRenderers.length);
  assert.equal(
    new Set(SKINOVA_SLOT_RUNTIME_CATALOG.map((entry) => entry.identity)).size,
    SKINOVA_SLOT_RUNTIME_CATALOG.length,
  );
  for (const rendererKey of slotRenderers) {
    assert.equal(
      resolveSlotRuntime({
        packageId: manifest.packageId,
        packageVersion: manifest.packageVersion,
        rendererKey,
      })?.implementationKey,
      rendererKey,
    );
  }
  const promoIdentity = {
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    rendererKey: "skinova-promo-strip",
  };
  assert.equal(
    resolveSlotRuntime({ ...promoIdentity, packageId: "foreign" }),
    null,
  );
  assert.equal(
    resolveSlotRuntime({ ...promoIdentity, packageVersion: "2" }),
    null,
  );
  assert.equal(
    resolveSlotRuntime({ ...promoIdentity, rendererKey: "unknown" }),
    null,
  );
  assert.match(registrySource, /"skinova-promo-strip":\s*SkinovaPromoBanner/);
  assert.match(
    registrySource,
    /"skinova-consultation":\s*SkinovaConsultationBanner/,
  );
  assert.match(
    registrySource,
    /"skinova-article-sidebar":\s*SkinovaArticleBanner/,
  );
});

test("legacy constants and homepage catalogue are derived from the manifest", () => {
  assert.match(
    compatibilitySource,
    /from "\.\/template-package-contract"/,
  );
  assert.doesNotMatch(compatibilitySource, /"skinova-(?:home|article|category|header)"/);
  for (const versionConstant of [
    "SKINOVA_HOME_TEMPLATE_VERSION",
    "SKINOVA_ARTICLES_LIST_TEMPLATE_VERSION",
    "SKINOVA_ARTICLE_TEMPLATE_VERSION",
    "SKINOVA_CATEGORY_TEMPLATE_VERSION",
    "SKINOVA_HEADER_TEMPLATE_VERSION",
    "SKINOVA_FOOTER_TEMPLATE_VERSION",
    "SKINOVA_SYSTEM_PAGE_TEMPLATE_VERSION",
  ])
    assert.match(compatibilitySource, new RegExp(versionConstant));
  assert.match(homepageRegistrySource, /SKINOVA_HOME_TEMPLATE/);
  assert.match(
    homepageRegistrySource,
    /HOMEPAGE_TEMPLATE_REGISTRY\s*=\s*\[\s*ARMATUREX_HOME_TEMPLATE,\s*SKINOVA_HOME_TEMPLATE/,
  );
});
