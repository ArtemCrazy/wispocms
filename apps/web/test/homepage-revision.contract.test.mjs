import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editor = await readFile(
  new URL("../src/app/pages-view.tsx", import.meta.url),
  "utf8",
);
const homepagePreview = await readFile(
  new URL("../src/app/preview/[siteSlug]/page.tsx", import.meta.url),
  "utf8",
);

test("homepage editor uses the same exact-revision workflow as content pages", () => {
  assert.match(editor, /const isVersionedPage =/);
  assert.match(editor, /editor\.kind === "homepage"/);
  assert.match(
    editor,
    /editor\.kind === "homepage"[\s\S]*?cmsRevisionId=\$\{revisionCurrent\.draft\.id\}/,
  );
});

test("homepage CMS preview pins the requested revision id", () => {
  assert.match(homepagePreview, /cmsRevisionId\?: string \| string\[\]/);
  assert.match(homepagePreview, /const revisionId = queryValue\(query\.cmsRevisionId\)/);
  assert.match(
    homepagePreview,
    /revisions\/\$\{encodeURIComponent\(pagePreview\.revisionId\)\}\/preview/,
  );
});
