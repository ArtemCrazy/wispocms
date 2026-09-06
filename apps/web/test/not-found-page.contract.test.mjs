import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../src/app/preview/[siteSlug]/pages/[pageSlug]/page.tsx", import.meta.url),
  "utf8",
);
const shell = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const pages = await readFile(
  new URL("../src/app/pages-view.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("missing public pages call the Next notFound boundary before rendering", () => {
  assert.match(route, /if \(result\.status === 404\) notFound\(\);/);
});

test("404 has a dedicated shell view and cannot enter the generic page editor", () => {
  assert.match(shell, /activeView === "404"/);
  assert.match(shell, /<NotFoundPageView/);
  assert.match(pages, /page\.slug !== "404"/);
  assert.match(pages, /page\.slug === "404"/);
  assert.match(shell, /item\.id === "404"/);
});

test("site navigation keeps utilities visible independently of central content", () => {
  assert.match(styles, /\.site-secondary-sidebar\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.site-nav-utilities\s*\{[^}]*position:\s*sticky;/s);
  assert.match(styles, /\.site-nav-utilities\s*\{[^}]*bottom:\s*0;/s);
});
