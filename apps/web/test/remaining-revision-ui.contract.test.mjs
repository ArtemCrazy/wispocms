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

test("the shared workflow accepts an explicit API base for settings", () => {
  assert.match(files["site-settings-revision-panel.tsx"], /basePath\?: string/);
  assert.match(files["site-settings-revision-panel.tsx"], /basePath \?\?/);
});

test("template screen only assigns predefined site templates", () => {
  assert.doesNotMatch(files["media-templates-view.tsx"], /CodeResourcesEditor/);
  assert.doesNotMatch(files["media-templates-view.tsx"], /code-resources/);
  assert.doesNotMatch(files["page.tsx"], /canEditCode|canViewCode/);
  assert.match(files["page.tsx"], /canApprove=\{canApprove\}/);
});

test("404 preview renders the selected draft template instead of the live page", () => {
  assert.match(files["not-found-page-view.tsx"], /template=\{previewTemplate\}/);
  assert.doesNotMatch(files["not-found-page-view.tsx"], /<iframe/);
});

test("layout bindings and article-list settings use structural access with CAS", () => {
  assert.match(files["media-templates-view.tsx"], /metadata\/layout-bindings\/\$\{siteId\}/);
  assert.match(files["media-templates-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["media-articles-view.tsx"], /metadata\/article-list\/\$\{siteId\}/);
  assert.match(files["media-articles-view.tsx"], /expectedDraftRevisionId/);
  assert.match(files["media-articles-view.tsx"], /canManageStructure: boolean/);
  assert.match(
    files["media-articles-view.tsx"],
    /label="Шаблон списка статей"[\s\S]*canEdit=\{canManageStructure\}/,
  );
  assert.match(
    files["page.tsx"],
    /<MediaArticlesView[\s\S]*canManageStructure=\{canManageStructure\}/,
  );
});

test("article, category and privacy template controls require structural access", () => {
  assert.match(files["content-view.tsx"], /canManageStructure\?: boolean/);
  assert.match(
    files["content-view.tsx"],
    /\{canManageStructure\s*\?\s*\([\s\S]{0,500}Шаблон рубрики/,
  );
  assert.match(
    files["content-view.tsx"],
    /\{canManageStructure\s*\?\s*\([\s\S]{0,500}Шаблон статьи/,
  );
  assert.equal(
    (
      files["content-view.tsx"].match(
        /\.\.\.\(canManageStructure\s*\?\s*\{\s*displayTemplateKey,/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    files["media-articles-view.tsx"],
    /<ContentView[\s\S]*canManageStructure=\{canManageStructure\}/,
  );
  assert.match(
    files["page.tsx"],
    /<ContentView[\s\S]*canManageStructure=\{canManageStructure\}/,
  );
  assert.match(
    files["page.tsx"],
    /<PrivacyPolicyView[\s\S]*canManageStructure=\{canManageStructure\}/,
  );
  assert.match(files["privacy-policy-view.tsx"], /canManageStructure\?: boolean/);
  assert.match(
    files["privacy-policy-view.tsx"],
    /privacyTabs\.filter\(\s*\(\[id\]\) => canManageStructure \|\| id !== "template",?\s*\)/,
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
