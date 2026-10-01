import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as materials from "../src/app/content-center/materials.ts";

const require = createRequire(import.meta.url);
const iconSource = await readFile(new URL("../src/app/content-center/social-icon.tsx", import.meta.url), "utf8");
const iconCompiled = ts.transpileModule(iconSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const icons = { exports: {} };
new Function("require", "module", "exports", iconCompiled.outputText)(id => id.endsWith(".css") ? { default: {} } : require(id), icons, icons.exports);

const source = await readFile(new URL("../src/app/content-center/marketplace-material-fields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const target = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(id => id === "./social-icon" ? icons.exports : id === "./materials" ? materials : id.endsWith(".css") ? { default: {} } : require(id), target, target.exports);

const { MarketplaceMaterialFields, marketplaceForUrl, marketplaceSourceUrl } = target.exports;

test("marketplace form offers three brands and a single URL field", () => {
  const html = renderToStaticMarkup(React.createElement(MarketplaceMaterialFields, {
    marketplace: "ozon", sourceUrl: "", onMarketplaceChange() {}, onChange() {},
  }));
  for (const label of ["Ozon", "Wildberries", "Яндекс Маркет"])
    assert.ok(html.includes(label));
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.match(html, /aria-pressed="true"><img[^>]+>Ozon/);
  assert.match(html, /placeholder="ozon.ru\/seller\/nonton\/"/);
  assert.doesNotMatch(html, /<select|<textarea|>Название</);
});

test("marketplace links validate the selected domain without accepting lookalikes", () => {
  assert.equal(marketplaceForUrl("www.ozon.ru/seller/nonton/"), "ozon");
  assert.equal(marketplaceForUrl("wildberries.ru/seller/123"), "wildberries");
  assert.equal(marketplaceForUrl("market.yandex.ru/business/123"), "yandex-market");
  assert.equal(marketplaceForUrl("ozon.ru.evil.test/seller/123"), "other");
  assert.equal(marketplaceSourceUrl("ozon.ru/seller/nonton/", "ozon"), "https://ozon.ru/seller/nonton/");
  assert.throws(() => marketplaceSourceUrl("wildberries.ru/seller/123", "ozon"), /Ozon/);
});
