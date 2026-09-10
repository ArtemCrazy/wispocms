import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const renderer = await readFile(
  new URL("../src/app/skinova-site.tsx", import.meta.url),
  "utf8",
);
const registry = await readFile(
  new URL("../src/app/skinova-template.ts", import.meta.url),
  "utf8",
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
  assert.match(registry, /SKINOVA_HOME_TEMPLATE_KEY = "skinova-home"/);
  assert.match(registry, /SKINOVA_ARTICLE_TEMPLATE_KEY = "skinova-article"/);
  assert.match(registry, /SKINOVA_CATEGORY_TEMPLATE_KEY = "skinova-category"/);
  assert.match(publicHome, /from "\.\.\/\.\.\/skinova-template"/);
  assert.match(publicHome, /<SkinovaHome/);
  assert.doesNotMatch(renderer, /<iframe|dangerouslySetInnerHTML|eval\(/);
});

test("homepage and Media assignments override bundled fallback content", () => {
  assert.match(renderer, /homepageHero\?\.title \|\| hero\.title/);
  assert.match(renderer, /homepageHero\?\.text \|\| hero\.excerpt/);
  assert.match(renderer, /article\.previewMedia \|\| article\.coverMedia/);
  assert.match(renderer, /consultation\?\.media && mediaBaseUrl/);
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
  ]) await access(new URL(relative, import.meta.url));

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

test("Skinova privacy and 404 pages use the complete shared chrome", () => {
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
