import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as materials from '../src/app/content-center/materials.ts';

const require = createRequire(import.meta.url);
const compile = async (name, imports = {}) => {
  const source = await readFile(new URL(`../src/app/content-center/${name}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const target = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(id => imports[id] ?? (id.endsWith('.css') ? { default: {} } : require(id)), target, target.exports);
  return target.exports;
};
const component = await compile('source-refresh', { './source-registry': await compile('source-registry'), './materials': materials, './vk-connection': await compile('vk-connection'), './social-connection': await compile('social-connection'), './youtube-transcription-queue': { YoutubeTranscriptionQueue: () => null } });
const initial = { id: 'site', title: 'Сайт', url_category: 'site', revision: 1,
  site_pages: { sourceId: 'S1', title: 'Сохранённый снимок', checkedAt: '2026-09-20T00:00:00Z', warnings: [], pages: [] } };
const render = changes => renderToStaticMarkup(React.createElement(component.SourceRefresh, {
  initial: { ...initial, ...changes }, base: '/api/workspaces/one/content-center',
  request: () => { throw new Error('render must not start a request'); }, onUpdated: async () => {},
}));

test('refresh is available before the first crawl without rendering the obsolete collection hint', () => {
  const html = render({ site_pages: null });
  assert.match(html, /<button type="button">Обновить сбор<\/button>/);
  assert.doesNotMatch(html, /Только сбор|без AI и изменения версий/);
  assert.match(html, /Сохранённого сбора пока нет/);
});
test('queued and processing states disable resubmission and keep the previous snapshot readable', () => {
  for (const status of ['queued', 'processing']) {
    const html = render({ collection_run: { id: 'run', status, error: null, progress: { message: 'Найдено 100 страниц' } } });
    assert.match(html, /disabled="">Сбор выполняется/);
    assert.match(html, /role="status">Найдено 100 страниц/);
    assert.match(html, /Сохранённый снимок/);
  }
});
test('failed refresh can be retried without hiding the saved sources', () => {
  const html = render({ collection_run: { id: 'run', status: 'failed', error: 'Источник изменён' } });
  assert.match(html, /role="alert">Источник изменён/);
  assert.match(html, /<button type="button">Обновить сбор/);
  assert.match(html, /Сохранённый снимок/);
});
test('non-site source has no refresh action', () => {
  assert.doesNotMatch(render({ url_category: 'social' }), /Обновить сбор|Сбор выполняется/);
});

test('Telegram has an immediately available refresh without key, bot or connection step', () => {
  const html = render({ kind: 'url', url_category: 'social', source_url: 'https://t.me/customer_channel', site_pages: null });
  assert.match(html, /<button type="button">Обновить сбор<\/button>/);
  assert.match(html, /без ограничения по давности/);
  assert.doesNotMatch(html, /type="checkbox"|Подключить сообщество|Проверяем настройки VK/);
});

test('2GIS map cards expose refresh before the first collection', () => {
  const html = render({
    kind: 'url',
    url_category: 'maps',
    source_url: 'https://2gis.ru/khimki/firm/70000001080050161',
    site_pages: null,
  });
  assert.match(html, /<button type="button">Обновить сбор<\/button>/);
  assert.match(html, /Сохранённого сбора пока нет/);
});

test('VK waits only for common-key readiness and has no manual connection step', () => {
  const html = render({ kind: 'url', url_category: 'social', source_url: 'https://vk.com/club77', site_pages: null });
  assert.match(html, /ВКонтакте/);
  assert.doesNotMatch(html, /Подключить сообщество|type="checkbox"/);
  assert.match(html, /180 дней/);
  assert.match(html, /disabled="">Обновить сбор/);
  assert.match(html, /Проверяем настройки VK/);
});

test('Instagram and YouTube expose collection but wait for verified configuration readiness', () => {
  for (const [network, source_url] of [['Instagram', 'https://www.instagram.com/company/'], ['YouTube', 'https://www.youtube.com/@company']]) {
    const html = render({ kind: 'url', url_category: 'social', source_url, site_pages: null });
    assert.ok(html.includes(network));
    assert.match(html, /disabled="">Обновить сбор/);
    assert.match(html, /Проверяем подключение/);
  }
});

test('VK refresh is enabled once the shared key is ready, even without a previous collection', async () => {
  let state = 0;
  const readyReact = { ...React, useState: initial => [++state === 4 ? true : initial, () => {}] };
  const readyComponent = await compile('source-refresh', { react: readyReact, './source-registry': () => null, './materials': materials, './vk-connection': { VkConnection: () => null }, './social-connection': { SocialConnection: () => null }, './youtube-transcription-queue': { YoutubeTranscriptionQueue: () => null } });
  const html = renderToStaticMarkup(React.createElement(readyComponent.SourceRefresh, {
    initial: { ...initial, kind: 'url', url_category: 'social', source_url: 'https://vk.com/club77', site_pages: null },
    base: '/api/workspaces/one/content-center', request: async () => {}, onUpdated: async () => {},
  }));
  assert.match(html, /<button type="button">Обновить сбор<\/button>/);
});
