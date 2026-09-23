import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = Object.fromEntries(
  await Promise.all(
    [
      "site-seo-view.tsx",
      "site-variables-view.tsx",
      "media-layout-view.tsx",
      "not-found-page-view.tsx",
      "privacy-policy-view.tsx",
      "media-templates-view.tsx",
      "media-articles-view.tsx",
      "media-view.tsx",
      "content-view.tsx",
      "site-settings-revision-panel.tsx",
      "code-resources-editor.tsx",
      "page.tsx",
    ].map(async (name) => [
      name,
      await readFile(new URL(`../src/app/${name}`, import.meta.url), "utf8"),
    ]),
  ),
);

test("all remaining public settings use the shared staged resource endpoints", () => {
  assert.match(files["site-seo-view.tsx"], /content\/versioned\/seo/);
  assert.match(files["site-variables-view.tsx"], /content\/versioned\/variables/);
  assert.match(files["media-layout-view.tsx"], /content\/versioned\/search/);
  assert.match(files["not-found-page-view.tsx"], /content\/versioned\/not-found/);
  assert.match(files["privacy-policy-view.tsx"], /content\/versioned\/privacy/);
  for (const name of [
    "site-seo-view.tsx",
    "site-variables-view.tsx",
    "media-layout-view.tsx",
    "not-found-page-view.tsx",
    "privacy-policy-view.tsx",
  ])
    assert.match(files[name], /SiteSettingsRevisionPanel/);
});

test("the shared workflow accepts an explicit API base for settings and code", () => {
  assert.match(files["site-settings-revision-panel.tsx"], /basePath\?: string/);
  assert.match(files["site-settings-revision-panel.tsx"], /basePath \?\?/);
});

test("template screen exposes HTML-only template and chunk editors", () => {
  assert.match(files["media-templates-view.tsx"], /CodeResourcesEditor/);
  assert.match(files["code-resources-editor.tsx"], /code-resources\/\$\{kind\}/);
  assert.match(files["code-resources-editor.tsx"], /HTML-код/);
  assert.doesNotMatch(files["code-resources-editor.tsx"], /CSS-код|JavaScript-код/);
  assert.match(files["page.tsx"], /canApprove=\{canApprove\}/);
});

test("404 preview renders the selected draft template instead of the live page", () => {
  assert.match(files["not-found-page-view.tsx"], /template=\{previewTemplate\}/);
  assert.doesNotMatch(files["not-found-page-view.tsx"], /<iframe/);
});

test("layout bindings and article-list settings expose code approval panels with CAS", () => {
  assert.match(files["media-templates-view.tsx"], /metadata\/layout-bindings\/\$\{siteId\}/);
  assert.match(files["media-templates-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["media-articles-view.tsx"], /metadata\/article-list\/\$\{siteId\}/);
  assert.match(files["media-articles-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["media-articles-view.tsx"], /canEditCode: boolean/);
  assert.match(
    files["media-articles-view.tsx"],
    /label="Шаблон списка статей"[\s\S]*canEdit=\{canEditCode\}/,
  );
  assert.match(
    files["page.tsx"],
    /<MediaArticlesView[\s\S]*canEditCode=\{canEditCode\}/,
  );
});

test("media alt edits carry decorative state, CAS and the approval workflow", () => {
  assert.match(files["media-view.tsx"], /isDecorative/);
  assert.match(files["media-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["media-view.tsx"], /metadata\/media-alt\/\$\{item\.id\}/);
  assert.match(files["media-view.tsx"], /SiteSettingsRevisionPanel/);
});

test("related article edits advance the existing article draft instead of writing live rows", () => {
  assert.match(files["content-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["content-view.tsx"], /saveRelatedArticles[\s\S]*reloadRevision/);
});
