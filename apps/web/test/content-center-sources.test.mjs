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

test('coverage distinguishes page statuses without exposing internal source identifiers', () => {
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{
    sourceId: 'S2', title: 'Материалы сайта', checkedAt: '2026-09-19T12:00:00Z', warnings: ['Статьи отобраны выборочно'], pages: [
      { title: 'Архив', url: 'https://example.com/news', status: 'found' },
      { title: 'Компания', url: 'https://example.com/about', status: 'loaded', content: 'Сохранённая информация' },
      { title: 'Копия', url: 'https://example.com/copy', status: 'duplicate', duplicateOf: 'https://example.com/about' },
      { title: 'Ошибка', url: 'https://example.com/error', status: 'failed', error: 'Не удалось прочитать страницу' },
    ],
  }] }));
  assert.match(html, /<dt>Обнаружено<\/dt><dd>4<\/dd>/);
  for (const [status, label] of [['loaded', 'Прочитано'], ['found', 'Не включено'], ['failed', 'Недоступно'], ['duplicate', 'Дубликаты']]) {
    assert.ok(html.includes(`data-status="${status}"><dt>${label}</dt><dd>1</dd>`));
  }
  assert.match(html, /<h4>Архив<\/h4>/);
  assert.match(html, /<h4>Компания<\/h4>/);
  assert.doesNotMatch(html, /\[S\d+(?:\.\d+)?\]/);
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
  assert.doesNotMatch(html, /<details open|Дубликаты/);
});

test('filters show all, read, unread and exact statuses without changing source references', () => {
  const pages = [
    { title: 'Архив', status: 'found' },
    { title: 'Компания', status: 'loaded' },
    { title: 'Копия', status: 'duplicate' },
    { title: 'Ошибка', status: 'failed' },
    { title: 'Услуги', status: 'loaded' },
    { title: 'Не проверенная', status: 'pending' },
  ];
  const original = structuredClone(pages);
  const select = filter => target.exports.filterSourcePages(pages, filter);
  for (const [filter, expected] of [
    ['all', [0, 1, 2, 3, 4, 5]], ['loaded', [1, 4]], ['unread', [0, 2, 3, 5]],
    ['found', [0]], ['failed', [3]], ['duplicate', [2]], ['pending', [5]],
  ]) {
    assert.deepEqual(select(filter).map(item => item.index), expected);
    for (const item of select(filter)) assert.equal(item.page, pages[item.index]);
  }
  assert.deepEqual(pages, original);
  assert.deepEqual(target.exports.filterSourcePages([], 'loaded'), []);
});

test('coverage exposes incomplete traversal, missed sections and unchecked pages separately from failures', () => {
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{
    sourceId: 'S1', title: 'Сайт', checkedAt: '2026-09-20T00:00:00Z', warnings: [],
    coverage: { state: 'partial', selected: 2, read: 1, unread: 1, checkedPages: 1, pendingPages: 1, pendingSitemaps: 2,
      reasons: ['Осталось проверить карт сайта: 2.'],
      sections: [{ title: 'Услуги', found: 2, read: 1, unread: 1 }, { title: 'Контакты', found: 0, read: 0, unread: 0 }] },
    pages: [{ title: 'Услуга', url: 'https://example.com/service', status: 'loaded', content: 'Текст' },
      { title: 'Направление', url: 'https://example.com/deep', status: 'pending', reason: 'Достигнут предел времени обхода' }],
  }] }));
  assert.match(html, /Охват неполный/);
  assert.match(html, /Осталось проверить карт сайта: 2/);
  assert.match(html, /Контакты<\/strong>: не найдено в обходе/);
  assert.match(html, /учтено 1 из 2, не прочитано 1/);
  assert.match(html, /Не проверена/);
  assert.match(html, /Не проверено <span>1<\/span>/);
  assert.match(html, /Достигнут предел времени обхода/);
  assert.doesNotMatch(html, /Проверка найденной структуры завершена|<pre>[^<]*Достигнут/);
});

test('each source has labelled filter buttons and defaults to all pages', () => {
  const source = { title: 'Компания', checkedAt: '2026-09-19T12:00:00Z', warnings: [], pages: [
    { title: 'Услуги', url: 'https://example.com/services', status: 'loaded', content: 'Текст' },
    { title: 'Архив', url: 'https://example.com/news', status: 'found' },
    { title: 'Ошибка', url: 'https://example.com/error', status: 'failed' },
  ] };
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [
    { ...source, sourceId: 'S1' }, { ...source, sourceId: 'S2', title: 'Магазин' },
  ] }));
  assert.match(html, /role="group" aria-label="Фильтр страниц: Компания"/);
  assert.match(html, /role="group" aria-label="Фильтр страниц: Магазин"/);
  assert.equal((html.match(/aria-pressed="true">Все <span>3<\/span>/g) ?? []).length, 2);
  assert.match(html, /aria-pressed="false">Прочитано <span>1<\/span>/);
  assert.match(html, /aria-pressed="false">Не прочитано <span>2<\/span>/);
  assert.match(html, /aria-pressed="false">Не включено <span>1<\/span>/);
  assert.match(html, /aria-pressed="false">Недоступно <span>1<\/span>/);
  assert.match(html, /role="status">Показано 3 из 3/);
  assert.doesNotMatch(html, /Обнаружено страниц|Дубликаты/);
});
