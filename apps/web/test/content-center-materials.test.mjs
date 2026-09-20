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
const iconSource = await readFile(new URL('../src/app/content-center/social-icon.tsx', import.meta.url), 'utf8');
const iconCompiled = ts.transpileModule(iconSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const iconTarget = { exports: {} };
new Function('require', 'module', 'exports', iconCompiled.outputText)(id => id.endsWith('.css') ? { default: {} } : require(id), iconTarget, iconTarget.exports);
new Function('require', 'module', 'exports', compiled.outputText)(id => id === './social-icon' ? iconTarget.exports : id === './materials' ? materials : id.endsWith('.css') ? { default: {} } : require(id), target, target.exports);
const render = (items, props = {}) => renderToStaticMarkup(React.createElement(target.exports.ProjectMaterials, { materials: items, busy: false, base: '/api/workspaces/one/content-center', add() {}, edit() {}, remove() {}, upload() {}, ...props }));

test('social source chips show the matching brand without changing actions or lookalike domains', () => {
  for (const [source_url, brand] of [['https://vk.ru/company', 'vk'], ['https://t.me/company', 'telegram'], ['https://www.youtube.com/@company', 'youtube'], ['https://t.me.evil.org/company', null]]) {
    const html = render([{ id: 'social', title: 'Компания', kind: 'url', url_category: 'social', source_url }], { showSources() {} });
    if (brand) assert.ok(html.includes(`src="/icons/social/${brand}.svg"`));
    else assert.doesNotMatch(html, /<img/);
    assert.match(html, /Изменить ссылку/);
    assert.match(html, /Удалить ссылку/);
    assert.ok(html.includes(`>${materials.displaySourceChipUrl(source_url)}</span>`));
  }
});

test('YouTube handle chips omit the long host while retaining the full address in actions', () => {
  const source_url = 'https://www.youtube.com/@soundyogaschool';
  const html = render([{ id: 'youtube', title: 'Sound Yoga', kind: 'url', url_category: 'social', source_url }], { showSources() {} });
  assert.equal(materials.displaySourceChipUrl(source_url), '@soundyogaschool');
  assert.match(html, />@soundyogaschool<\/span>/);
  assert.match(html, /title="https:\/\/www\.youtube\.com\/@soundyogaschool"/);
  assert.doesNotMatch(html, />www\.youtube\.com\/@soundyogaschool<\/span>/);
});

test('checked website groups URL, source information icon and remove action in that order', () => {
  const html = render([{ id: 'site', kind: 'url', url_category: materials.SOURCE_CATEGORIES[0].id, title: 'Сайт компании', source_url: 'https://example.com/', site_checked_at: '2026-09-19T00:00:00Z' }], { showSources() {} });
  const edit = html.indexOf('aria-label="Изменить ссылку');
  const info = html.indexOf('aria-label="Информация об источнике');
  const remove = html.indexOf('aria-label="Удалить ссылку');
  const add = html.indexOf('aria-label="Добавить ссылку', remove);
  assert.ok(edit >= 0 && info > edit && remove > info && add > remove);
  assert.match(html, /title="Информация об источнике"/);
  assert.match(html, /src="\/globe\.svg"/);
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  assert.doesNotMatch(html, />Страницы</);
  assert.match(html.slice(info, remove), /<\/button><button type="button"/);
});

test('unchecked website exposes the source dialog to start collection without AI', () => {
  const html = render([{ id: 'site', kind: 'url', url_category: materials.SOURCE_CATEGORIES[0].id, title: 'Сайт', source_url: 'https://example.com/' }], { showSources() {} });
  assert.match(html, /src="\/globe\.svg"/);
  assert.match(html, /Изменить ссылку/);
  assert.match(html, /Удалить ссылку/);
  assert.match(html, /Информация об источнике/);
});

test('source information remains disabled during a pending operation', () => {
  const html = render([{ id: 'site', kind: 'url', url_category: materials.SOURCE_CATEGORIES[0].id, title: 'Сайт', source_url: 'https://example.com/', site_checked_at: '2026-09-19T00:00:00Z' }], { showSources() {}, busy: true });
  const buttons = html.match(/<button[^>]*>/g);
  for (const label of ['Изменить ссылку', 'Информация об источнике', 'Удалить ссылку']) {
    assert.match(buttons.find(button => button.includes(label)), /disabled=""/);
  }
});

test('source collection exposes categorized links and a real file input', () => {
  const html = render([]);
  for (const category of materials.SOURCE_CATEGORIES) assert.ok(html.includes(category.label));
  assert.match(html, /type="file"/);
  assert.ok(html.includes(materials.FILE_ACCEPT));
  assert.equal((html.match(/<article\b/g) ?? []).length, 1);
  assert.match(html, /<h3>Файлы и тексты проекта<\/h3>/);
  assert.doesNotMatch(html, /из 50 МБ/);
  assert.doesNotMatch(html, /Текст — UTF-8|40 000 символов/);
  assert.match(html, /Добавить текст/);
  assert.doesNotMatch(html, /Текстовые материалы/);
  assert.ok(html.indexOf('Другие источники') < html.indexOf('<h3>Файлы и тексты проекта'));
  assert.doesNotMatch(html, /Создать форму/);
});

test('files and typed materials share one table without losing their actions', () => {
  const html = render([
    { id: 'file-id', kind: 'file', title: 'Бриф', file_name: 'Бриф.pdf', file_size: 1024, characters: 12, created_at: '2026-09-19T00:00:00Z' },
    { id: 'text-id', kind: 'text', title: 'Заметки клиента', characters: 125, created_at: '2026-09-19T00:00:00Z' },
  ]);
  assert.equal((html.match(/<table\b/g) ?? []).length, 1);
  assert.match(html, /Бриф\.pdf/);
  assert.match(html, /Заметки клиента/);
  assert.match(html, /125 симв\./);
  assert.match(html, /Открыть и изменить/);
  assert.match(html, /Удалить материал «Заметки клиента»/);
  assert.match(html, /materials\/file-id\/file/);
  assert.doesNotMatch(html, /materials\/text-id\/file/);
});

test('text-only collection is not shown as empty', () => {
  const html = render([{ id: 'text-id', kind: 'text', title: 'Заметка', characters: 0, created_at: '2026-09-19T00:00:00Z' }]);
  assert.match(html, /<table/);
  assert.match(html, /0 симв\./);
  assert.doesNotMatch(html, /Файлов и текстов пока нет/);
});

test('empty collection keeps add actions without an empty-state banner or table', () => {
  const html = render([]);
  assert.doesNotMatch(html, /Файлов и текстов пока нет/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(source, /styles\.empty/);
  assert.match(html, /Загрузить файл/);
  assert.match(html, /Добавить текст/);
});

test('saved originals link to private downloads and never claim AI processing', () => {
  const html = render([{ id: 'file-id', kind: 'file', title: 'Бриф.pdf', file_name: 'Бриф.pdf', file_size: 24576, characters: 0, has_original: true, created_at: '2026-09-19T00:00:00Z' }]);
  assert.match(html, /href="\/api\/workspaces\/one\/content-center\/materials\/file-id\/file"/);
  assert.match(html, /24 КБ/);
  assert.doesNotMatch(html, /из 50 МБ/);
  assert.match(html, /Оригинал сохранён/);
  assert.match(html, /обработка после подключения AI/);
});

test('inaccessible source warning is visible and client supplied markup is inert', () => {
  const html = render([{ id: 'link', kind: 'url', url_category: 'social', title: '<script>bad</script>', source_url: 'https://example.com', source_error: 'Текст страницы недоступен' }]);
  assert.match(html, /Текст страницы недоступен/);
  assert.doesNotMatch(html, /<script>/);
});
