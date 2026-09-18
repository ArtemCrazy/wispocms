import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../src/app/content-center/prepared-document.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const target = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputText)(createRequire(import.meta.url), target, target.exports);
const render = content => renderToStaticMarkup(React.createElement(target.exports.PreparedDocument, { content }));

test('prepared document renders headings, lists and tables as readable markup', () => {
  const html = render('# Компания\nОписание\n\n- Первый факт\n- Второй факт\n\n1. Вопрос клиенту\n\n| Поле | Значение |\n| --- | --- |\n| Продукт | Косметика |');
  assert.match(html, /<h2>Компания<\/h2>/);
  assert.match(html, /<ul><li>Первый факт<\/li><li>Второй факт<\/li><\/ul>/);
  assert.match(html, /<ol><li>Вопрос клиенту<\/li><\/ol>/);
  assert.match(html, /<th>Поле<\/th>/);
  assert.match(html, /<td>Косметика<\/td>/);
});

test('AI-supplied HTML and executable links remain inert text', () => {
  const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[кнопка](javascript:alert(1))\n# <svg onload=alert(1)>');
  assert.doesNotMatch(html, /<(script|img|svg|a)\b/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /javascript:alert/);
});
