import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
  (id) => (id.endsWith(".css") ? { default: {} } : require(id)),
  target,
  target.exports,
);
const { SiteMaterialFields, siteMaterialTitle } = target.exports;

test("website form asks only for its address and focuses the required URL field", () => {
  const html = renderToStaticMarkup(
    React.createElement(SiteMaterialFields, {
      sourceUrl: "https://example.ru/",
      onChange() {},
    }),
  );
  assert.match(html, /Адрес сайта/);
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.match(html, /autofocus=""/);
  assert.match(html, /type="url"/);
  assert.match(html, /required=""/);
  assert.match(html, /value="https:\/\/example.ru\/"/);
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
  assert.equal(
    siteMaterialTitle("https://user:password@example.ru/about?key=private#top"),
    "example.ru/about",
  );
  assert.equal(
    siteMaterialTitle(`https://example.ru/${"a".repeat(300)}`).length,
    160,
  );
});
