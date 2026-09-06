import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/app/privacy-policy-view.tsx", import.meta.url),
  "utf8",
);

test("privacy publication uses the canonical page-status POST route", () => {
  assert.match(
    source,
    /content\/pages\/\$\{state\.pageId\}\/status`,\s*\{ method: "POST", body: JSON\.stringify\(\{ status \}\) \}/,
  );
  assert.doesNotMatch(
    source,
    /content\/pages\/\$\{state\.pageId\}\/status`,\s*\{ method: "PATCH"/,
  );
});

test("privacy publication reloads state and only accepts canonical statuses", () => {
  assert.match(
    source,
    /changePublication\(status: "draft" \| "published"\)/,
  );
  assert.match(
    source,
    /return request\(`\/api\/sites\/\$\{siteId\}\/content\/privacy`\);/,
  );
});
