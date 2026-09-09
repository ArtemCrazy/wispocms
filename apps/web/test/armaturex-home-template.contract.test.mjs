import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../src/app/homepage-templates.ts", import.meta.url),
  "utf8",
);
const renderer = await readFile(
  new URL("../src/app/armaturex-home.tsx", import.meta.url),
  "utf8",
);
const editor = await readFile(
  new URL("../src/app/armaturex-home-editor.tsx", import.meta.url),
  "utf8",
);
const publicHome = await readFile(
  new URL("../src/app/preview/[siteSlug]/page.tsx", import.meta.url),
  "utf8",
);

test("Armaturex homepage is an allowlisted versioned renderer", () => {
  assert.match(template, /key: "armaturex-home-v1"/);
  assert.match(template, /version: "1"/);
  assert.match(template, /HOMEPAGE_TEMPLATE_REGISTRY/);
  assert.match(publicHome, /isArmaturexHomepage/);
  assert.match(publicHome, /<ArmaturexHome/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|eval\(|new Function/);
  assert.match(renderer, /function safeHref/);
});

test("CMS editor owns the required structured homepage fields", () => {
  for (const label of [
    "Первый экран и кнопки",
    "Показатели",
    "Каталог на главной",
    "Условия поставки",
    "Вопросы и ответы",
    "Заявка",
  ]) assert.match(editor, new RegExp(label));
  assert.match(editor, /imageMediaId/);
  assert.match(editor, /armaturexBlocks\(next\)/);
});

test("request form uses the existing contact endpoint without fake attachments", () => {
  assert.match(renderer, /\/api\/public\/sites\/\$\{encodeURIComponent\(siteSlug\)\}\/contact/);
  assert.match(renderer, /Файлы пока не принимаются/);
  assert.doesNotMatch(renderer, /type="file"|mailto:.*subject=/);
});

test("approved model and responsive assets are shipped with the template", async () => {
  for (const relative of [
    "../public/templates/armaturex-home-v1/model/zadvizhka.glb",
    "../public/templates/armaturex-home-v1/model/viewer.bundle.js",
    "../public/templates/armaturex-home-v1/img/hero-bg.webp",
    "../public/templates/armaturex-home-v1/img/hero-bg-sm.webp",
    "../public/templates/armaturex-home-v1/img/logo.webp",
  ]) await access(new URL(relative, import.meta.url));
});
