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
const viewerFrame = await readFile(
  new URL(
    "../public/templates/armaturex-home-v1/model/viewer-frame.html",
    import.meta.url,
  ),
  "utf8",
);
const viewerBundle = await readFile(
  new URL(
    "../public/templates/armaturex-home-v1/model/viewer.bundle.js",
    import.meta.url,
  ),
  "utf8",
);
const rendererStyles = await readFile(
  new URL("../src/app/armaturex-home.module.css", import.meta.url),
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
  assert.match(renderer, /pages\/privacy-policy/);
  assert.doesNotMatch(renderer, /type="file"|mailto:.*subject=/);
});

test("3D viewer uses a React-owned disposable browsing context", () => {
  assert.match(renderer, /viewerEnabled \? \(/);
  assert.match(renderer, /viewer-frame\.html/);
  assert.match(renderer, /removeEventListener\("change", sync\)/);
  assert.doesNotMatch(renderer, /document\.createElement\("script"\)/);
  assert.match(viewerFrame, /viewer\.bundle\.js/);
  assert.doesNotMatch(viewerFrame, /color-scheme:\s*dark/);
  assert.match(viewerFrame, /background:\s*transparent\s*!important/);
  assert.match(viewerBundle, /setClearColor\(0,0\)/);
});

test("preview sizing and responsive gutters stay scoped to Armaturex", () => {
  assert.match(renderer, /cmsSiteId \? "armaturex-home-v1--preview" : ""/);
  assert.match(publicHome, /cms-preview-bar cms-preview-bar--armaturex/);
  assert.match(rendererStyles, /\.armaturex-home-v1--preview \.header/);
  assert.match(rendererStyles, /height:\s*calc\(100vh - 2\.5rem\)/);
  assert.doesNotMatch(rendererStyles, /@media \(max-width: 40rem\)[\s\S]*?:root\s*\{/);
});

test("versioned local fonts cover the template typography", () => {
  assert.match(rendererStyles, /@font-face[\s\S]*font-family: "Mulish"/);
  assert.match(rendererStyles, /font-family: "Istok Web"/);
  assert.match(rendererStyles, /font-family: "IBM Plex Mono"/);
  assert.doesNotMatch(rendererStyles, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test("approved model and responsive assets are shipped with the template", async () => {
  for (const relative of [
    "../public/templates/armaturex-home-v1/model/zadvizhka.glb",
    "../public/templates/armaturex-home-v1/model/viewer.bundle.js",
    "../public/templates/armaturex-home-v1/model/viewer-frame.html",
    "../public/templates/armaturex-home-v1/img/hero-bg.webp",
    "../public/templates/armaturex-home-v1/img/hero-bg-sm.webp",
    "../public/templates/armaturex-home-v1/img/logo.webp",
    "../public/templates/armaturex-home-v1/fonts/mulish-cyrillic.woff2",
    "../public/templates/armaturex-home-v1/fonts/mulish-latin.woff2",
    "../public/templates/armaturex-home-v1/fonts/istok-web-400-cyrillic.woff2",
    "../public/templates/armaturex-home-v1/fonts/ibm-plex-mono-400-cyrillic.woff2",
    "../public/templates/armaturex-home-v1/fonts/OFL-Mulish.txt",
    "../public/templates/armaturex-home-v1/fonts/OFL-Istok-Web.txt",
    "../public/templates/armaturex-home-v1/fonts/OFL-IBM-Plex-Mono.txt",
  ]) await access(new URL(relative, import.meta.url));
});
