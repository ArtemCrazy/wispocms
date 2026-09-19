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
const render = (content, hideSourceReferences = false) => renderToStaticMarkup(React.createElement(target.exports.PreparedDocument, { content, hideSourceReferences }));

test('preparation presentation hides internal citations without altering stored content', () => {
  const content = '# Компания [S1.1]\nЦена: **3 500 ₽** [S1.3, S1.11].\nОхват ([S1.1–S1.16, S1.17–S1.27, S1.83]).\n- Услуга [S1.2; S2] доступна.\n1. Факт [S1.2-S1.3].\n| Поле | Значение |\n| --- | --- |\n| Цена | 100 [S1.3] |';
  const html = render(content, true);
  assert.doesNotMatch(html, /\[S\d|\(\)/);
  assert.match(html, /<h2>Компания<\/h2>/);
  assert.match(html, /Цена: <strong>3 500 ₽<\/strong>\./);
  assert.match(html, /<li>Услуга доступна\.<\/li>/);
  assert.match(html, /<td>100<\/td>/);
  assert.match(content, /\[S1\.1\]/);
  assert.match(render(content), /\[S1\.1\]/); // Other document types retain their citations.
});

test('citation cleanup preserves business URLs, uncertainty, numbers, brackets and escaping', () => {
  const html = render('Сайт: https://example.com/\n[Сайт](https://example.com/)\n[Нет данных] [S1 неизвестно] Цена от 50 до 150 ₽ [S1.2].\n<script>alert(1)</script> [S2.1]', true);
  assert.match(html, /https:\/\/example\.com\//);
  assert.match(html, /\[Сайт\]\(https:\/\/example\.com\/\)/);
  assert.match(html, /\[Нет данных\] \[S1 неизвестно\] Цена от 50 до 150 ₽\./);
  assert.doesNotMatch(html, /<script|\[S2\.1\]/);
  assert.match(html, /&lt;script&gt;/);
});

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

test('prepared document renders bold labels and keeps surrounding text', () => {
  const html = render('**Подтверждено (главная страница сайта):**\nОбычный текст, **важный факт** и __нет данных__.\n**А**');
  assert.match(html, /<p><strong>Подтверждено \(главная страница сайта\):<\/strong><\/p>/);
  assert.match(html, /<p>Обычный текст, <strong>важный факт<\/strong> и <strong>нет данных<\/strong>\.<\/p>/);
  assert.match(html, /<p><strong>А<\/strong><\/p>/);
  assert.doesNotMatch(html, /\*\*|__/);
});

test('bold formatting works in every supported document block', () => {
  const html = render('# **Компания**\n- **Факт:** описание\n1. **Вопрос**\n| **Поле** | Значение |\n| --- | --- |\n| Название | **Клиника** |');
  assert.match(html, /<h2><strong>Компания<\/strong><\/h2>/);
  assert.match(html, /<ul><li><strong>Факт:<\/strong> описание<\/li><\/ul>/);
  assert.match(html, /<ol><li><strong>Вопрос<\/strong><\/li><\/ol>/);
  assert.match(html, /<th><strong>Поле<\/strong><\/th>/);
  assert.match(html, /<td><strong>Клиника<\/strong><\/td>/);
});

test('incomplete and whitespace-only bold markers remain readable text', () => {
  const html = render('Незакрытый **текст\n____\n** **\nОбычный *текст*');
  assert.doesNotMatch(html, /<strong>/);
  assert.match(html, /Незакрытый \*\*текст/);
  assert.match(html, /____/);
  assert.match(html, /\*\* \*\*/);
});

test('bold AI text is escaped and cannot inject HTML', () => {
  const html = render('**<script>alert(1)</script>**\n- __<img src=x onerror=alert(1)>__');
  assert.doesNotMatch(html, /<(script|img)\b/);
  assert.match(html, /<strong>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/strong>/);
  assert.match(html, /<strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
});
