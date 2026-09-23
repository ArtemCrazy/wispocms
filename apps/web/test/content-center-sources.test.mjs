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

test('VK explains publication coverage without claiming website or AI page selection', () => {
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{
    mode: 'social-feed', sourceId: 'S2', title: 'VK', checkedAt: '2026-09-20T00:00:00Z', warnings: ['180 дней'],
    pages: [{ title: 'Пост', url: 'https://vk.com/wall-77_1', status: 'loaded', content: 'Текст' }],
  }] }));
  assert.match(html, /Период и ограничения/);
  assert.match(html, /Правила отбора публикаций/);
  assert.match(html, /Сбор VK/);
  assert.doesNotMatch(html, /Охват разделов|Сбор сайта|Как агент отбирал страницы|Найдено адресов/);
});

test('registry is optional, read-only and renders saved text as escaped data', () => {
  assert.equal(renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [] })), '');
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{ sourceId: 'S1', title: 'Компания', checkedAt: '2026-09-19T12:00:00Z', warnings: ['Не полный аудит'], pages: [
    { title: 'О компании', url: 'https://example.com/about', status: 'loaded', content: '<script>bad()</script>' },
    { title: 'Закрытая', url: 'https://example.com/private', status: 'failed', error: 'robots.txt' },
    { title: 'Архив', url: 'javascript:bad()', status: 'found' },
  ] }] }));
  assert.doesNotMatch(html, /Включено 1 из 3/);
  assert.match(html, /Включено <span>1<\/span>/);
  assert.match(html, /<section><header>/);
  assert.doesNotMatch(html, /<summary><span>/);
  assert.match(html, /<details open=""><summary>Как читать результаты<\/summary>/);
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
  assert.doesNotMatch(html, /<dl|<dt|<dd/);
  for (const label of ['Включено', 'Не включено', 'Недоступно', 'Дубликаты']) {
    assert.ok(html.includes(`${label} <span>1</span>`));
  }
  assert.match(html, /<h4>Архив<\/h4>/);
  assert.match(html, /<h4>Компания<\/h4>/);
  assert.doesNotMatch(html, /\[S\d+(?:\.\d+)?\]/);
  assert.match(html, /Совпадает с https:\/\/example.com\/about/);
  assert.match(html, /Статьи отобраны выборочно/);
  assert.doesNotMatch(html, /Это результат конкретного обхода|найдены все страницы сайта|Обновление сбора само/);
  assert.equal((html.match(/aria-label="Сохранённый исходный текст"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<pre/);
});

test('VK collection shows received count and exclusion reasons', () => {
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{
    sourceId: 'S1', title: 'VK', sourceUrl: 'https://vk.com/crazystudio', mode: 'social-feed',
    checkedAt: '2026-09-23T12:00:00Z', warnings: ['Проверены первые 200 записей. За пределами лимита осталось не менее 30 более ранних записей.'],
    pages: [
      { title: 'О сообществе', group: 'О сообществе', url: 'https://vk.com/club77', status: 'loaded' },
      { title: 'Пост', group: 'Публикации VK', url: 'https://vk.com/wall-77_1', status: 'loaded', publishedAt: '2025-03-21T00:00:00Z' },
      { title: 'Репост', group: 'Публикации VK', url: 'https://vk.com/wall-77_2', status: 'found', reason: 'Репост или запись другого автора — не включены' },
      { title: 'Вложение', group: 'Публикации VK', url: 'https://vk.com/wall-77_3', status: 'found', reason: 'Только вложения: текст отсутствует' },
      { title: 'Повтор', group: 'Публикации VK', url: 'https://vk.com/wall-77_4', status: 'duplicate', reason: 'Повтор текста другой публикации' },
    ],
  }] }));
  assert.match(html, /Получено записей: 4 · включено: 1 · не включено: 3/);
  assert.match(html, /репосты и чужие записи — 1, без текста — 1, повторы — 1/);
  assert.match(html, /За пределами лимита осталось не менее 30/);
});

test('source cards always remain open, including when a generation contains several sources', () => {
  const source = { title: 'Источник', checkedAt: '2026-09-19T12:00:00Z', warnings: [], pages: [] };
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [
    { ...source, sourceId: 'S1' }, { ...source, sourceId: 'S2' },
  ] }));
  assert.equal((html.match(/<section><header>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Включено 0 из 0/);
  assert.match(html, /Включено <span>0<\/span>/);
  assert.equal((html.match(/<details open="">/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Дубликаты/);
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
  assert.doesNotMatch(html, /Охват неполный/);
  assert.match(html, /aria-label="Пояснение об охвате: Сайт" aria-expanded="false"/);
  assert.match(html, /<div id="[^"]+" hidden="">/);
  assert.match(html, /Осталось проверить карт сайта: 2/);
  assert.match(html, /Контакты<\/strong>: не найдено в обходе/);
  assert.match(html, /собрано 1 из 2, не удалось собрать 1/);
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
  assert.match(html, /aria-pressed="false">Включено <span>1<\/span>/);
  assert.doesNotMatch(html, /aria-pressed="false">Не прочитано/);
  assert.match(html, /aria-pressed="false">Не включено <span>1<\/span>/);
  assert.match(html, /aria-pressed="false">Недоступно <span>1<\/span>/);
  assert.match(html, /role="status">Показано 3 из 3/);
  assert.doesNotMatch(html, /Обнаружено страниц|Дубликаты/);
});

test('110 found addresses are partitioned once, with coverage details collapsed behind an accessible information button', () => {
  const pages = ['loaded', 'found', 'failed'].flatMap((status, group) =>
    Array.from({ length: [81, 25, 4][group] }, (_, index) => ({ title: `${status}-${index}`, url: `https://example.com/${status}/${index}`, status })));
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{ sourceId: 'S1', title: 'Сайт', checkedAt: '2026-09-20T00:00:00Z', warnings: [], pages }] }));
  assert.doesNotMatch(html, /Включено 81 из 110/);
  assert.doesNotMatch(html, /Страницы источника|<h3/);
  assert.match(html, /<div><div role="group" aria-label="Фильтр страниц: Сайт">/);
  assert.match(html, /<span>Снимок от [^<]+<\/span><button type="button" aria-label="Пояснение об охвате: Сайт"/);
  assert.match(html, /<\/button><\/span><\/span><\/header>/);
  assert.equal((html.match(/aria-label="Пояснение об охвате: Сайт"/g) ?? []).length, 1);
  for (const [label, count] of [['Все', 110], ['Включено', 81], ['Не включено', 25], ['Недоступно', 4]])
    assert.ok(html.includes(`${label} <span>${count}</span>`));
  assert.doesNotMatch(html, /<dl|Охват неполный|Прочитано 110/);
  const panel = html.match(/aria-controls="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${panel}" hidden=""`));
  assert.doesNotMatch(html, /Даже если включены все найденные страницы/);
  assert.match(html, /«Недоступно» — страницы, текст которых получить не удалось/);
});

test('information button toggles only its explanation while source cards remain non-collapsible', () => {
  const state = [];
  let cursor = 0;
  const hooks = { ...React, useId: () => 'hint-test', useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(id => id === 'react' ? hooks : id.endsWith('.css') ? { default: {} } : require(id), module, module.exports);
  const sources = ['S1', 'S2'].map(sourceId => ({ sourceId, title: sourceId, checkedAt: '2026-09-20T00:00:00Z', warnings: ['Пояснение'], pages: [] }));
  const render = () => { cursor = 0; return module.exports.SourceRegistry({ sources }); };
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node) && predicate(node)) return node;
    const children = Array.isArray(node) ? node : React.Children.toArray(node.props?.children);
    for (const child of children) { const match = find(child, predicate); if (match) return match; }
  }
  const click = tree => find(tree, node => node.type === 'button' && node.props['aria-controls'] === 'hint-test-S1').props.onClick();
  click(render());
  let tree = render();
  assert.equal(find(tree, node => node.type === 'details').props.open, true);
  assert.equal(find(tree, node => node.type === 'section').props.open, undefined);
  assert.equal(find(tree, node => node.props?.id === 'hint-test-S1').props.hidden, false);
  assert.equal(find(tree, node => node.props?.id === 'hint-test-S2').props.hidden, true);
  click(tree);
  tree = render();
  assert.equal(find(tree, node => node.props?.id === 'hint-test-S1').props.hidden, true);
  assert.equal(find(tree, node => node.type === 'details').props.open, true);
});

test('saved original is shown directly in one readable layout without mode controls', () => {
  const content = '  Цены\r\n\r\n \t\r\nАкции\r\n\r\n\r\nОтзывы\r\n\r\nСанкт-Петербург, Казанская 43\r\n\r\n10:00 - 20:00\r\n\r\nПриём врача — 3 500 ₽.\nДополнительные условия сохраняются.\n\n<script>bad()</script>  ';
  assert.deepEqual(target.exports.sourceTextParagraphs(content), [
    'Цены', 'Акции', 'Отзывы', 'Санкт-Петербург, Казанская 43', '10:00 - 20:00',
    'Приём врача — 3 500 ₽.\nДополнительные условия сохраняются.', '<script>bad()</script>',
  ]);
  assert.deepEqual(target.exports.sourceTextParagraphs(' \r\n\t\r\n '), []);
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceTextPreview, { content }));
  assert.match(html, /tabindex="0" aria-label="Сохранённый исходный текст"/);
  assert.match(html, /<p>Цены<\/p><p>Акции<\/p><p>Отзывы<\/p>/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<pre|Для чтения|Оригинал|aria-pressed/);
});

test('source help contains three accordions with only the instructions initially expanded', () => {
  const source = { sourceId: 'S1', title: 'Сайт', checkedAt: '2026-09-20T00:00:00Z', warnings: ['Ограничение обхода'], pages: [] };
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [source] }));
  const sections = [...html.matchAll(/<details( open="")?><summary>([^<]+)<\/summary>/g)];
  assert.deepEqual(sections.map(match => [match[2], Boolean(match[1])]), [
    ['Как читать результаты', true], ['Охват разделов', false], ['Как агент отбирал страницы', false],
  ]);
  assert.match(html, /Для этого снимка охват разделов не сохранён/);
  assert.match(html, /Ограничение обхода/);
  assert.match(html, /В этом снимке нет сохранённых решений AI/);
  assert.match(html, /В снимке пока нет страниц/);
});

test('selection explanations preserve recorded reasons and put omissions before included pages', () => {
  const pages = [
    { title: 'Основная', url: 'https://example.com/main', status: 'loaded', reason: 'Включена программно' },
    { title: 'Сомнение', url: 'https://example.com/uncertain', status: 'loaded', reason: 'AI — недостаточно данных для исключения, включён полный текст: Нужно учесть методику' },
    { title: 'Новость', url: 'https://example.com/news', status: 'found', reason: 'AI — не включена: Общая новость без сведений о компании' },
    { title: 'Ошибка', url: 'https://example.com/error', status: 'failed', error: 'Нет доступа', reason: 'Ранее найдена' },
    { title: 'Не проверена', url: 'https://example.com/pending', status: 'pending', reason: 'Лимит времени обхода' },
    { title: 'Копия', url: 'https://example.com/copy', status: 'duplicate', duplicateOf: 'https://example.com/main' },
    { title: 'Архивная', url: 'https://example.com/old', status: 'found' },
    { title: 'Включена AI', url: 'javascript:bad()', status: 'loaded', reason: 'AI — включена: <script>bad()</script>' },
  ];
  const original = structuredClone(pages);
  const entries = target.exports.sourceSelectionEntries(pages);
  assert.deepEqual(entries.map(entry => entry.index), [2, 6, 3, 4, 5, 0, 1, 7]);
  assert.equal(entries[0].explanation, pages[2].reason);
  assert.equal(entries[0].byAi, true);
  assert.equal(entries[1].explanation, 'Причина отбора для этой страницы не сохранена.');
  assert.equal(entries[2].explanation, 'Нет доступа');
  assert.equal(entries[2].byAi, false);
  assert.equal(entries[4].explanation, 'Совпадает с https://example.com/main');
  assert.equal(entries[6].byAi, true);
  assert.deepEqual(pages, original);
  const html = renderToStaticMarkup(React.createElement(target.exports.SourceRegistry, { sources: [{ sourceId: 'S1', title: 'Сайт', checkedAt: '2026-09-20T00:00:00Z', warnings: [], pages }] }));
  assert.match(html, /tabindex="0" aria-label="Причины отбора страниц: Сайт"/);
  assert.match(html, /Решение AI/);
  assert.match(html, /Сбор сайта/);
  assert.match(html, /Общая новость без сведений о компании/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|href="javascript:|В этом снимке нет сохранённых решений AI/);
  assert.ok(html.indexOf('<strong>Новость</strong>') < html.indexOf('<strong>Основная</strong>'));
});
