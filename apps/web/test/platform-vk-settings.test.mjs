import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function render(file, exportName, states, props = {}) {
  const source = await readFile(new URL(`../src/app/${file}.tsx`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  let index = 0;
  const react = { ...React, useState: initial => [index < states.length ? states[index++] : initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }) };
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

test('customer VK setup never asks for a secret, and only enables consent when the platform is configured', async () => {
  const props = { path: '/api/source', revision: 1, disabled: false, request() { throw new Error('No requests during render'); }, onUpdated: async () => {}, onConnectionChange() {} };
  for (const configured of [false, true]) {
    const html = await render('content-center/vk-connection', 'VkConnection', [{ connected: false, ready: false, platformConfigured: configured }], props);
    assert.doesNotMatch(html, /type="password"|Пользовательский ключ/);
    assert.match(html, /[Кк]люч заказчика не нужен/);
    if (configured) assert.match(html, /type="checkbox" required=""/);
    else { assert.match(html, /Администратор CMS должен настроить/); assert.doesNotMatch(html, /type="submit"/); }
  }
  const html = await render('content-center/vk-connection', 'VkConnection', [{ connected: true, ready: false, platformConfigured: false, groupName: 'Компания' }], props);
  assert.match(html, /VK · Компания/);
  assert.match(html, /Сохранённые материалы остаются доступны/);
});
