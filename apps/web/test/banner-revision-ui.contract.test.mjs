import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/media-banner-library-view.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);

test("banner editor saves with CAS and exposes the approval workflow", () => {
  assert.match(source, /expectedDraftRevisionId/);
  assert.match(source, /\$\{revisionBase\}\/current/);
  assert.ok(
    source.includes(
      "${revisionBase}/${encodeURIComponent(openedRevisionId)}/${action}",
    ),
  );
  assert.match(source, /Отправить владельцу на проверку/);
  assert.match(source, /Вернуть на доработку/);
  assert.match(source, /Одобрить версию/);
  assert.match(source, /Опубликовать одобренную версию/);
  assert.match(source, /История версий/);
  assert.match(source, /Восстановить как новый черновик/);
});

test("banner workflow receives the separate approval permission", () => {
  assert.match(
    pageSource,
    /<MediaBannerLibraryView[\s\S]*?canApprove=\{canApprove\}/,
  );
});
