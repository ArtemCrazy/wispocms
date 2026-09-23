import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../src/app/site-settings-revision-panel.tsx", import.meta.url),
  "utf8",
);
const globalsView = await readFile(
  new URL("../src/app/site-globals-view.tsx", import.meta.url),
  "utf8",
);
const layoutView = await readFile(
  new URL("../src/app/site-layout-view.tsx", import.meta.url),
  "utf8",
);
const preview = await readFile(
  new URL("../src/app/preview/[siteSlug]/page.tsx", import.meta.url),
  "utf8",
);
const dashboard = await readFile(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);

test("site settings editors save with CAS and expose one revision workflow", () => {
  assert.match(globalsView, /expectedDraftRevisionId/);
  assert.match(layoutView, /expectedDraftRevisionId/);
  assert.match(layoutView, /content\/layout\/\$\{mode\}/);
  assert.match(workflow, /revisionActions/);
  assert.match(workflow, /Отправить владельцу на проверку/);
  assert.match(workflow, /Вернуть на доработку/);
  assert.match(workflow, /Одобрить версию/);
  assert.match(workflow, /Опубликовать одобренную версию/);
  assert.match(workflow, /История версий/);
  assert.match(workflow, /Восстановить как новый черновик/);
});

test("globals, header, and footer receive approval permission and exact preview", () => {
  assert.match(
    dashboard,
    /<SiteGlobalsView[\s\S]*?canApprove=\{canApprove\}/,
  );
  assert.match(
    dashboard,
    /<SiteLayoutView[\s\S]*?canApprove=\{canApprove\}/,
  );
  assert.match(preview, /cmsSiteSettings\?: string \| string\[\]/);
  assert.match(preview, /content\/\$\{settingsBase\}\/revisions\/\$\{encodeURIComponent\(settingsPreview\.revisionId\)\}\/preview/);
});
