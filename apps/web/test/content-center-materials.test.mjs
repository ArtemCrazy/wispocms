import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as materials from '../src/app/content-center/materials.ts';

const source = await readFile(new URL('../src/app/content-center/project-materials.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function('require', 'module', 'exports', compiled.outputText)(id => id === './materials' ? materials : id.endsWith('.css') ? { default: {} } : require(id), target, target.exports);
const render = items => renderToStaticMarkup(React.createElement(target.exports.ProjectMaterials, { materials: items, busy: false, base: '/api/workspaces/one/content-center', add() {}, edit() {}, remove() {}, upload() {} }));

test('source collection exposes categorized links and a real file input', () => {
  const html = render([]);
  for (const category of materials.SOURCE_CATEGORIES) assert.ok(html.includes(category.label));
  assert.match(html, /type="file"/);
  assert.ok(html.includes(materials.FILE_ACCEPT));
  assert.match(html, /Файлы проекта/);
  assert.match(html, /Текстовые материалы/);
  assert.doesNotMatch(html, /Создать форму/);
});

test('saved originals link to private downloads and never claim AI processing', () => {
  const html = render([{ id: 'file-id', kind: 'file', title: 'Бриф.pdf', file_name: 'Бриф.pdf', file_size: 24576, characters: 0, has_original: true, created_at: '2026-09-19T00:00:00Z' }]);
  assert.match(html, /href="\/api\/workspaces\/one\/content-center\/materials\/file-id\/file"/);
  assert.match(html, /24 КБ/);
  assert.match(html, /Оригинал сохранён/);
  assert.match(html, /обработка после подключения AI/);
});

test('inaccessible source warning is visible and client supplied markup is inert', () => {
  const html = render([{ id: 'link', kind: 'url', url_category: 'social', title: '<script>bad</script>', source_url: 'https://example.com', source_error: 'Текст страницы недоступен' }]);
  assert.match(html, /Текст страницы недоступен/);
  assert.doesNotMatch(html, /<script>/);
});
