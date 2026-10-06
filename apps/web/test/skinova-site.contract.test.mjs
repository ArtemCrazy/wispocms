import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(
  new URL("../src/app/skinova-site.tsx", import.meta.url),
  "utf8",
);
const compatibilityRegistry = await readFile(
  new URL("../src/app/skinova-template.ts", import.meta.url),
  "utf8",
);
const packageManifest = JSON.parse(
  await readFile(
    new URL(
      "../template-packages/skinova/manifest.template.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const publicHome = await readFile(
  new URL("../src/app/preview/[siteSlug]/page.tsx", import.meta.url),
  "utf8",
);
const publicArticle = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/articles/[articleSlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicCategory = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/categories/[categorySlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicPage = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/pages/[pageSlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicNotFound = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/pages/[pageSlug]/not-found.tsx",
    import.meta.url,
  ),
  "utf8",
);
const contentService = await readFile(
  new URL("../../api/src/content/content.service.ts", import.meta.url),
  "utf8",
);
const publicArticleService = contentService.slice(
  contentService.indexOf("async getPublicArticle"),
  contentService.indexOf("async getPublicCategory"),
);
const articlePreviewService = contentService.slice(
  contentService.indexOf("async getArticlePreview"),
  contentService.indexOf("async getPagePreview"),
);

test("Skinova uses versioned Media renderers instead of an iframe", () => {
  const templates = new Map(
    packageManifest.templates.map((template) => [template.kind, template]),
  );
  assert.equal(templates.get("homepage")?.key, "skinova-home");
  assert.equal(templates.get("article")?.key, "skinova-article");
  assert.equal(templates.get("category")?.key, "skinova-category");
  assert.match(
    compatibilityRegistry,
    /from "\.\/template-package-contract"/,
  );
  for (const route of [publicHome, publicArticle, publicCategory]) {
    assert.match(route, /resolveTemplateComponent/);
    assert.doesNotMatch(route, /from .*skinova-template/);
  }
  assert.match(publicHome, /kind:\s*"homepage"/);
  assert.match(publicArticle, /kind:\s*"article"/);
  assert.match(publicCategory, /kind:\s*"category"/);
  assert.doesNotMatch(renderer, /<iframe|dangerouslySetInnerHTML|eval\(/);
});

test("system pages resolve their own template identity instead of header chrome", () => {
  for (const route of [publicPage, publicNotFound]) {
    assert.match(route, /resolveTemplateComponent/);
    assert.match(route, /kind:\s*"system_page"/);
    assert.doesNotMatch(
      route,
      /headerTemplateKey\s*===\s*SKINOVA_HEADER_TEMPLATE_KEY/,
    );
  }
  assert.match(publicPage, /page\.systemTemplateKey/);
  assert.match(publicPage, /page\.systemTemplateVersion/);
  assert.match(publicNotFound, /data\.template\.key/);
  assert.match(publicNotFound, /data\.template\.version/);
});

test("homepage and Media assignments override bundled fallback content", () => {
  assert.match(renderer, /homepageHero\?\.title \|\| hero\.title/);
  assert.match(renderer, /homepageHero\?\.text \|\| hero\.excerpt/);
  assert.match(renderer, /article\.previewMedia \|\| article\.coverMedia/);
  assert.match(renderer, /consultation\?\.media && mediaBaseUrl/);
  assert.match(renderer, /consultation\?\.mobileMedia && mediaBaseUrl/);
  assert.match(renderer, /<picture className="consultation__media">/);
  assert.match(
    renderer,
    /resolvePublicBannerHref\(siteSlug, banner\.linkUrl\)/,
  );
  assert.match(renderer, /assigned\s*\?\s*banner\?\.title/);
  assert.match(renderer, /assigned\s*\?\s*banner\?\.subtitle/);
  assert.match(renderer, /assigned\s*\?\s*banner\?\.buttonText/);
  assert.match(renderer, /banner\?\.title/);
  assert.match(renderer, /mediaFileSuffix/);
  assert.match(renderer, /displayTemplateConfig\?\.dateLabel/);
});

test("consultation form uses the standard endpoint and explicit consent", () => {
  assert.match(
    renderer,
    /\/api\/public\/sites\/\$\{encodeURIComponent\(siteSlug\)\}\/contact/,
  );
  assert.match(renderer, /name="consent" required/);
  assert.match(renderer, /data\.get\("consent"\) === "on"/);
  assert.match(renderer, /name="website"/);
});

test("approved Skinova assets and responsive styles are shipped", async () => {
  for (const relative of [
    "../public/skinova/styles.css",
    "../public/skinova/assets/images/hero-bioprevitalization.webp",
    "../public/skinova/assets/images/article-biorevitalization-cover.webp",
    "../public/skinova/assets/icons/sprite.svg",
  ])
    await access(new URL(relative, import.meta.url));

  const styles = await readFile(
    new URL("../public/skinova/styles.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /@media \(max-width:\s*640px\)/);
  assert.match(
    styles,
    /\.skinova-site \.sidebar \.category-nav \{ display:flex; \}/,
  );
  assert.match(renderer, /family=Cormorant\+Garamond/);
  assert.match(renderer, /family=Onest/);
});

test("article preview receives the complete category tree from the API", () => {
  assert.match(publicArticleService, /categories\.find\(/);
  assert.match(publicArticleService, /categories:/);
  assert.match(articlePreviewService, /categories\.find\(/);
  assert.match(articlePreviewService, /categories,/);
  assert.match(publicArticle, /categories: SkinovaCategory\[\]/);
  assert.match(publicArticle, /categories=\{categories\}/);
  assert.doesNotMatch(publicArticle, /categoryRows|parentId: null/);
});

test("resolved Skinova system pages receive the complete shared chrome", () => {
  assert.match(renderer, /function SkinovaChrome/);
  assert.match(
    renderer,
    /export function SkinovaSystemPage[\s\S]*?<SkinovaChrome/,
  );
  for (const route of [publicPage, publicNotFound]) {
    assert.match(route, /categories=\{data\.categories\}/);
    assert.match(route, /banners=\{data\.banners\}/);
  }
});
