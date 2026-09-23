import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function render(file, exportName, states, props = {}, effects = []) {
  const source = await readFile(new URL(`../src/app/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  let index = 0;
  const react = { ...React, useState: initial => [index < states.length ? states[index++] : initial, () => {}], useEffect: effect => effects.push(effect), useRef: initial => ({ current: initial }) };
  const target = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(id => id === 'react' ? react : id.endsWith('.css') ? { default: {} } : require(id), target, target.exports);
  return renderToStaticMarkup(React.createElement(target.exports[exportName], props));
}

test('platform VK setup has a single password field and a read-only API check, with no misleading connected state', async () => {
  const html = await render('platform-vk-settings', 'PlatformVkSettings', [{ configured: false, hasKey: false, storageReady: true, revision: 0, verifiedAt: null }]);
  assert.match(html, /Сервисный ключ приложения VK/);
  assert.match(html, /Одно приложение VK для всей CMS/);
  assert.match(html, /type="password"/);
  assert.match(html, /Не подключён/);
  assert.match(html, /<fieldset disabled=""><label for="vk-check-community"/);
  assert.match(html, /без AI и сохранения материалов/);
});

test('customer VK source has no consent, connection or secret controls', async () => {
  const props = { path: '/api/source', revision: 1, disabled: false, request() { throw new Error('No requests during render'); }, onUpdated: async () => {}, onConnectionChange() {} };
  for (const configured of [false, true]) {
    const html = await render('content-center/vk-connection', 'VkConnection', [{ connected: false, ready: false, platformConfigured: configured }], props);
    assert.doesNotMatch(html, /type="password"|Пользовательский ключ|type="checkbox"|<form|Подключить сообщество|Отключить VK/);
    if (!configured) assert.match(html, /Администратор CMS должен настроить/);
  }
  const html = await render('content-center/vk-connection', 'VkConnection', [{ connected: true, ready: false, platformConfigured: false, groupName: 'Компания' }], props);
  assert.match(html, /VK · Компания/);
  assert.match(html, /Сохранённые материалы остаются доступны/);
});

test('saved platform key enables first collection via read-only status, with no implicit consent request', async () => {
  const effects = [];
  const requests = [];
  const ready = [];
  await render('content-center/vk-connection', 'VkConnection', [], {
    path: '/api/source',
    request: async (...args) => { requests.push(args); return { connected: false, ready: true, platformConfigured: true }; },
    onConnectionChange: value => ready.push(value),
  }, effects);
  const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [['/api/source/vk']]);
  assert.deepEqual(ready, [false, true]);
  cleanup();
});
