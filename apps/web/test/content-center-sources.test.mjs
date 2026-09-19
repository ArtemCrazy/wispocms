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
  assert.match(html, /прочитано 1 из 3/);
  assert.match(html, /<details>/);
  assert.match(html, /Недоступна/);
  assert.match(html, /Не включена/);
  assert.match(html, /robots\.txt/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:|<script|type="checkbox"/);
});
