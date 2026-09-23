import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/app/privacy-policy-view.tsx", import.meta.url),
  "utf8",
);

test("privacy publication uses the shared approved-revision workflow", () => {
  assert.match(source, /content\/versioned\/privacy/);
  assert.match(source, /resource="privacy"/);
  assert.doesNotMatch(
    source,
    /content\/pages\/\$\{state\.pageId\}\/status/,
  );
});

test("privacy commands send CAS and receive the server-side draft checkpoint", () => {
  assert.match(source, /expectedDraftRevisionId: draftRevisionId/);
  assert.match(source, /setDraftRevisionId\(next\.draftRevisionId\)/);
  assert.doesNotMatch(source, /snapshot: next/);
  assert.match(source, /Создана новая версия черновика/);
});
