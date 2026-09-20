import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as materials from "../src/app/content-center/materials.ts";

const source = await readFile(
  new URL(
    "../src/app/content-center/site-material-fields.tsx",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
});
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function("require", "module", "exports", compiled.outputText)(
  (id) => (id === "./materials" ? materials : id.endsWith(".css") ? { default: {} } : require(id)),
  target,
  target.exports,
);
const { SiteMaterialFields, siteMaterialTitle } = target.exports;

test("website form asks only for its address and focuses the required URL field", () => {
  const html = renderToStaticMarkup(
    React.createElement(SiteMaterialFields, {
      sourceUrl: materials.displayMaterialUrl("https://example.ru/"),
      onChange() {},
    }),
  );
  assert.match(html, /aria-label="Адрес сайта"/);
  assert.doesNotMatch(html, />\s*Адрес сайта\s*</);
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.match(html, /autofocus=""/);
  assert.match(html, /type="text" inputMode="url"/);
  assert.match(html, /required=""/);
  assert.match(html, /value="example.ru\/"/);
  assert.match(html, /placeholder="example.ru"/);
  assert.doesNotMatch(
    html,
    /Название|Категория источника|Ссылка|Текст|<select|<textarea/,
  );
});

test("editing the site address passes the entered URL to the draft", () => {
  let entered;
  const field = SiteMaterialFields({
    sourceUrl: "",
    onChange(value) {
      entered = value;
    },
  });
  const input = React.Children.toArray(field.props.children).find(
    (child) => child.type === "input",
  );
  input.props.onChange({ target: { value: "https://example.ru/company" } });
  assert.equal(entered, "https://example.ru/company");
});

test("internal title comes from the address, omits credentials/query/fragment and fits the API contract", () => {
  assert.equal(siteMaterialTitle(" https://example.ru/ "), "example.ru");
  assert.equal(
    siteMaterialTitle("https://example.ru/skinova/#"),
    "example.ru/skinova",
  );
  assert.equal(siteMaterialTitle("example.ru/about?key=private#top"), "example.ru/about");
  assert.throws(() => siteMaterialTitle("https://user:password@example.ru/about"));
  assert.equal(
    siteMaterialTitle(`https://example.ru/${"a".repeat(300)}`).length,
    160,
  );
});

test("implicit HTTPS preserves paths, queries and fragments while explicit unsafe schemes stay rejected", () => {
  for (const [input, expected] of [
    [" example.ru/path?a=1#top ", "https://example.ru/path?a=1#top"],
    ["https://example.ru/path?a=1#top", "https://example.ru/path?a=1#top"],
    ["t.me/customer", "https://t.me/customer"],
  ]) assert.equal(materials.materialSourceUrl(input), expected);
  for (const input of ["", "example", "http://example.ru", "javascript:alert(1)", "data:text/html,hi", "ftp://example.ru", "//example.ru", "/example.ru", "example.ru bad", "user:pass@example.ru", "https://user:pass@example.ru", "https://example.ru:444", "example.ru\\path"])
    assert.throws(() => materials.materialSourceUrl(input));
  assert.equal(materials.displayMaterialUrl("https://example.ru/path"), "example.ru/path");
  assert.equal(materials.displayMaterialUrl("http://example.ru/path"), "http://example.ru/path");
});
