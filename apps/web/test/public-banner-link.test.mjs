import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicBannerHref } from "../src/app/public-banner-link.ts";

test("resolves canonical internal banner targets inside the selected preview", () => {
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/"),
    "/preview/wispo-media",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/pages/about"),
    "/preview/wispo-media/pages/about",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/articles/story"),
    "/preview/wispo-media/articles/story",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/categories/news"),
    "/preview/wispo-media/categories/news",
  );
});

test("preserves safe external targets and repairs legacy Media values", () => {
  assert.equal(
    resolvePublicBannerHref("wispo-media", "https://example.ru/a"),
    "https://example.ru/a",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "mailto:hello@example.ru"),
    "mailto:hello@example.ru",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/preview/about"),
    "/preview/wispo-media/pages/about",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "/articles/category/news"),
    "/preview/wispo-media/categories/news",
  );
});

test("rejects executable and protocol-relative targets", () => {
  assert.equal(
    resolvePublicBannerHref("wispo-media", "javascript:alert(1)"),
    "#articles",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "data:text/html,bad"),
    "#articles",
  );
  assert.equal(
    resolvePublicBannerHref("wispo-media", "//evil.example"),
    "#articles",
  );
});
