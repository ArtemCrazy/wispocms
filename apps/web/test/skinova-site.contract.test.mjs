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
  assert.match(renderer, /family=Cormorant\+Garamond/);
  assert.match(renderer, /family=Onest/);
});
