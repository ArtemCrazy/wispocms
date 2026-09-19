import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = await readFile(new URL('../src/app/content-center/source-registry.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', compiled.outputText)(id => id.endsWith('.css') ? { default: {} } : require(id), target, target.exports);

test('registry is optional, read-only and renders saved text as escaped data', () => {
  assert.equal(renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [] })), '');
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{ sourceId: 'S1', title: 'Компания', checkedAt: '2026-09-19T12:00:00Z', warnings: ['Не полный аудит'], pages: [
    { title: 'О компании', url: 'https://example.com/about', status: 'loaded', content: '<script>bad()</script>' },
    { title: 'Закрытая', url: 'https://example.com/private', status: 'failed', error: 'robots.txt' },
    { title: 'Архив', url: 'javascript:bad()', status: 'found' },
  ] }] }));
  assert.match(html, /Прочитано 1 из 3/);
  assert.match(html, /<details open="">/);
  assert.match(html, /<details>/);
  assert.match(html, /Недоступна/);
  assert.match(html, /Не включена/);
  assert.match(html, /robots\.txt/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:|<script|type="checkbox"/);
});

test('coverage distinguishes read pages from excluded, failed and duplicate pages without renumbering', () => {
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{
    sourceId: 'S2', title: 'Материалы сайта', checkedAt: '2026-09-19T12:00:00Z', warnings: ['Статьи отобраны выборочно'], pages: [
      { title: 'Архив', url: 'https://example.com/news', status: 'found' },
      { title: 'Компания', url: 'https://example.com/about', status: 'loaded', content: 'Сохранённая информация' },
      { title: 'Копия', url: 'https://example.com/copy', status: 'duplicate', duplicateOf: 'https://example.com/about' },
      { title: 'Ошибка', url: 'https://example.com/error', status: 'failed', error: 'Не удалось прочитать страницу' },
    ],
  }] }));
  assert.match(html, /<dt>Обнаружено страниц<\/dt><dd>4<\/dd>/);
  for (const [status, label] of [['loaded', 'Прочитано'], ['found', 'Не включено'], ['failed', 'Недоступно'], ['duplicate', 'Дубликаты']]) {
    assert.ok(html.includes(`data-status="${status}"><dt>${label}</dt><dd>1</dd>`));
  }
  assert.match(html, /\[S2\.1\]<\/span><h4>Архив/);
  assert.match(html, /\[S2\.2\]<\/span><h4>Компания/);
  assert.match(html, /Совпадает с https:\/\/example.com\/about/);
  assert.match(html, /Статьи отобраны выборочно/);
  assert.match(html, /не полный аудит сайта/);
  assert.equal((html.match(/<pre>/g) ?? []).length, 1);
});

test('an unread source stays visible and several sources can be expanded independently', () => {
  const source = { title: 'Источник', checkedAt: '2026-09-19T12:00:00Z', warnings: [], pages: [] };
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [
    { ...source, sourceId: 'S1' }, { ...source, sourceId: 'S2' },
  ] }));
  assert.equal((html.match(/<details>/g) ?? []).length, 2);
  assert.match(html, /Прочитано 0 из 0/);
  assert.match(html, /<dt>Прочитано<\/dt><dd>0<\/dd>/);
  assert.doesNotMatch(html, /<details open|Недоступно|Дубликаты/);
});
