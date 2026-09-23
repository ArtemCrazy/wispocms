import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("../src/app/content-center/content-center-breadcrumbs.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function("require", "module", "exports", compiled.outputText)(
  (id) => id.endsWith(".css") ? {} : require(id), target, target.exports,
);
const { ContentCenterBreadcrumbs } = target.exports;
const props = {
  workspaceName: "Crazy Studio", screen: "preparation", title: "Подготовка информации",
  onWorkspaceOpen() {}, onNavigate() {},
};

function elements(node, type) {
  if (!React.isValidElement(node)) return [];
  return [
    ...(node.type === type ? [node] : []),
    ...React.Children.toArray(node.props.children).flatMap((child) => elements(child, type)),
  ];
}

test("preparation breadcrumbs show the actual workspace, center and non-clickable current page", () => {
  const tree = ContentCenterBreadcrumbs(props);
  assert.equal(tree.props["aria-label"], "Хлебные крошки");
  assert.deepEqual(elements(tree, "button").map((button) => button.props.children), ["Crazy Studio", "Контент-центр"]);
  const current = elements(tree, "span").filter((span) => span.props["aria-current"] === "page");
  assert.equal(current.length, 1);
  assert.equal(current[0].props.children, "Подготовка информации");
  assert.equal(elements(tree, "li").length, 3);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /←|общее для сайтов/);
});

test("parent breadcrumbs call existing navigation handlers without bypassing them", () => {
  const calls = [];
  const tree = ContentCenterBreadcrumbs({ ...props,
    screen: "document", title: "Обработанная информация",
    onWorkspaceOpen: () => calls.push("workspace"), onNavigate: (screen) => calls.push(screen),
  });
  const buttons = elements(tree, "button");
  assert.deepEqual(buttons.map((button) => button.props.children), ["Crazy Studio", "Контент-центр", "Подготовка информации"]);
  for (const button of buttons) {
    assert.equal(button.props.type, "button");
    button.props.onClick();
  }
  assert.deepEqual(calls, ["workspace", "root", "preparation"]);
});

test("root, sibling sections and deeper preparation pages have consistent ancestry", () => {
  for (const [screen, title, count] of [
    ["root", "Контент-центр", 2], ["research", "Исследование и анализ", 3],
    ["creation", "Создание контента", 3], ["history", "История версий", 4],
  ]) {
    const tree = ContentCenterBreadcrumbs({ ...props, workspaceName: "ПАК <test>", screen, title });
    assert.equal(elements(tree, "li").length, count);
    assert.equal(elements(tree, "button")[0].props.children, "ПАК <test>");
    assert.match(renderToStaticMarkup(tree), /ПАК &lt;test&gt;/);
  }
});
