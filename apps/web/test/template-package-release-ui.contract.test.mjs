import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const templatesView = await readFile(
  new URL("../src/app/media-templates-view.tsx", import.meta.url),
  "utf8",
);

test("template package access uses the existing structure guard and a separate Wispo-admin capability", () => {
  assert.match(
    shell,
    /item\.id !== "templates" \|\| canManageStructure/,
    "content managers must not receive the Templates navigation item",
  );
  assert.match(
    shell,
    /activeView === "templates"[\s\S]{0,160}canManageStructure \? \(/,
    "content managers must not render the Templates view",
  );
  assert.match(
    shell,
    /<MediaTemplatesView[\s\S]{0,260}isWispoAdmin=\{isWispoAdmin\}/,
    "the view must receive platform role separately from structure permission",
  );
  assert.match(templatesView, /isWispoAdmin: boolean/);
  assert.doesNotMatch(
    templatesView,
    /const isWispoAdmin\s*=\s*canManageStructure/,
  );
});

test("owner and admin read current release while candidates stay admin-only", () => {
  assert.match(
    templatesView,
    /`\/api\/sites\/\$\{siteId\}\/template-package\/current`/,
  );
  assert.match(
    templatesView,
    /isWispoAdmin[\s\S]{0,500}`\/api\/platform\/sites\/\$\{siteId\}\/template-package\/candidates`/,
  );
  assert.match(templatesView, /Текущая версия frontend-пакета/);
  assert.match(templatesView, /Совместимые версии/);
  assert.match(templatesView, /Frontend-пакет ещё не зарегистрирован/);
  assert.match(templatesView, /Не удалось загрузить данные frontend-пакета/);
});

test("release UI remains read-only and preview comes only from server payload", () => {
  assert.match(
    templatesView,
    /currentPackage\.templatePackage\.previewUrl[\s\S]{0,320}href=\{currentPackage\.templatePackage\.previewUrl\}/,
  );
  assert.match(templatesView, /target="_blank"/);
  assert.match(templatesView, /rel="noreferrer"/);
  assert.doesNotMatch(templatesView, /href=\{`\/preview\//);
  assert.doesNotMatch(templatesView, /type="file"|release token|manifest upload/i);
  assert.doesNotMatch(templatesView, />\s*(?:Активировать|Откатить)\s*</);
  assert.doesNotMatch(
    templatesView,
    /template-package[^`"']*[`"'][\s\S]{0,120}method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/,
  );
});

test("release errors are panel-local and do not replace the existing template catalogue state", () => {
  assert.match(templatesView, /packageMessage/);
  assert.match(templatesView, /setRows\(/);
  assert.match(templatesView, /className="template-package-panel"/);
  assert.match(templatesView, /role="status"/);
  assert.match(templatesView, /role="alert"/);
  assert.match(templatesView, /className="template-package-digest"/);
});
