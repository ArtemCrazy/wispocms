import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as state from "../src/app/content-center/creation-state.ts";
import * as preparation from "../src/app/content-center/preparation-state.ts";
const require = createRequire(import.meta.url),
  cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const tsPath = new URL(
    `../src/app/content-center/${name}.ts`,
    import.meta.url,
  );
  const source = readFileSync(
    existsSync(tsPath)
      ? tsPath
      : new URL(`../src/app/content-center/${name}.tsx`, import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputText)(
    (id) =>
      id === "./creation-state"
        ? state
        : id === "./preparation-state"
          ? preparation
          : id.endsWith(".css")
            ? {}
            : id.startsWith("./") || id.startsWith("../")
              ? load(id.startsWith("../") ? id : id.slice(2))
              : require(id),
    module,
    module.exports,
  );
  cache.set(name, module.exports);
  return module.exports;
}
test("launcher renders instruction, local attachment and selection scope with explicit blocking reasons", () => {
  const { CreationLauncher, launchBlockReason } = load("creation-launcher");
  const props = { base: "/api/test", instruction: "Добавь примеры", setInstruction() {}, file: { name: "brief.txt", size: 80 }, setFile() {}, busy: false, running: false, voice: false, connected: true, clusterCount: 3, platformCount: 2, hasSelection: false, onVoice() {}, onLaunch() {} };
  const render = (overrides = {}) => renderToStaticMarkup(React.createElement(CreationLauncher, { ...props, ...overrides }));
  const html = render();
  for (const label of ["Запустить подготовку контента", "Список промптов", "Прикрепить файл", "Убрать файл", "brief.txt", "Добавь примеры", "Все актуальные кластеры", "Фильтры таблицы не ограничивают запуск.", "Голосовой ввод"])
    assert.ok(html.includes(label), label);
  assert.match(html, /maxLength="12000"/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /aria-describedby="creation-launch-blocked"/);
  assert.match(render({ hasSelection: true }), /Выбрано актуальных кластеров/);
  assert.doesNotMatch(render({ hasSelection: true }), /Фильтры таблицы не ограничивают запуск/);
  assert.match(render({ running: true }), /disabled="" aria-describedby="creation-launch-blocked"/);
  assert.match(render({ busy: true }), /type="file" hidden="" disabled=""/);
  assert.doesNotMatch(render({ file: null }), /Убрать файл/);
  assert.equal(launchBlockReason(props), "");
  for (const [override, message] of [
    [{ busy: true }, /текущего действия/], [{ running: true }, /текущего запуска/],
    [{ voice: true }, /диктовку/], [{ connected: false }, /подключите AI/],
    [{ clusterCount: 0 }, /кластер/], [{ platformCount: 0 }, /площадки/],
  ]) assert.match(launchBlockReason({ ...props, ...override }), message);
});

test("progress renders real outcomes, cluster details, empty state and retry only for production failures", () => {
  const { CreationProgress, RecentRunList } = load("creation-progress");
  const run = { id: "r", number: 4, kind: "production", status: "partial", cluster_count: 1, created_at: "2026-10-02T00:00:00Z", actor_name: "Редактор", operations: [
    { clusterId: "c", clusterTitle: "Уход за кожей", siteId: "s", siteName: "Сайт", status: "succeeded", message: "" },
    { clusterId: "c", clusterTitle: "Уход за кожей", siteId: "s2", siteName: "Площадка 2", status: "failed", message: "Не удалось сохранить" },
  ] };
  const render = (value) => renderToStaticMarkup(React.createElement(CreationProgress, { run: value, retryDisabled: false, onRetry() {} }));
  const html = render(run);
  for (const text of ["100%", "Завершён с ошибками", "Ошибок: 1", "Пропущено: 0", "Уход за кожей", "Площадка 2", "Не удалось сохранить", "Повторить операции с ошибкой"])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Осталось примерно|минуты/);
  assert.match(render(null), /Запусков пока нет/);
  assert.doesNotMatch(render({ ...run, kind: "correction" }), /Повторить операции/);
  assert.doesNotMatch(render({ ...run, status: "succeeded" }), /Повторить операции/);
  const history = renderToStaticMarkup(React.createElement(RecentRunList, { runs: [run], loading: false, error: "", onReload() {}, onHistory() {} }));
  assert.match(history, /Все запуски/);
  assert.match(history, /Запуск №4/);
  assert.match(history, /Кластеров: 1/);
  assert.doesNotMatch(history, /статьи|статей/);
});

test("creation table groups platforms, keeps archives read-only and renders article links", () => {
  const clusters = [false, true].map((archived, i) => ({ id: `c${i}`, number: i + 1, title: archived ? "Архивный кластер" : "Уход за кожей", direction: "Косметология", queries: [{ text: "уход", general: 18400, exact: 7200, primary: true }], archived }));
  const html = renderToStaticMarkup(React.createElement(load("creation-table").CreationTable, {
    data: { clusters, settings: { platforms: [{ siteId: "site" }, { siteId: "second" }] }, sites: [{ id: "site", name: "Сайт" }, { id: "second", name: "Вторая площадка" }], articles: [{ id: "a", cluster_id: "c0", site_id: "site", title: "Практический гид", status: "published", recommendation: "keep", rationale: "Актуально" }] },
    filtered: clusters, selected: [], filters: { search: "", direction: "", status: "", recommendation: "" }, setSelected() {}, setFilter() {}, onAdd() {}, onCluster() {}, onArticle() {}, onMerge() {},
  }));
  assert.match(html, /colSpan="2" scope="colgroup"[^>]*>Сайт/);
  assert.match(html, /Практический гид/);
  assert.match(html, /Актуальные кластеры/);
  assert.match(html, /Архивные кластеры/);
  assert.match(html, /Выбрать кластер 1/);
  assert.doesNotMatch(html, /Выбрать кластер 2/);
  assert.match(html, /Не создана/);
  assert.match(html, /Страница 1 из 1/);
});
test("article exposes per-proposal decisions, unpublished current-version notice and separate publication", () => {
  const article = {
    id: "article",
    cluster_id: "cluster",
    site_id: "site",
    status: "published",
    recommendation: "update",
    rationale: "Reason",
    current_number: 2,
    published_number: 1,
    revision: 1,
    publication_url: "/preview/test/articles/one",
  };
  const version = {
    number: 2,
    snapshot: {
      title: "Title",
      excerpt: "Excerpt",
      document: {
        version: 1,
        blocks: [
          { id: "one", type: "paragraph", text: "<script>inert</script>" },
        ],
      },
    },
    changes: [],
  };
  const render = (canPublishDirectly) => renderToStaticMarkup(
    React.createElement(load("creation-article").CreationArticle, {
      base: "/api/test",
      parentBase: "/api/test",
      details: {
        canPublishDirectly,
        article,
        version,
        versions: [],
        sites: [{ id: "site", name: "Media", slug: "test" }],
        categories: [],
        templates: [],
        correction: {
          id: "correction",
          proposals: [
            {
              id: "p",
              target: "title",
              before: "Title",
              after: "New",
              reason: "Why",
              decision: "pending",
            },
          ],
        },
      },
      data: { ai: { connected: false }, run: null, articles: [] },
      location: { screen: "article" },
      navigate() {},
      async refresh() {},
      onDirtyChange() {},
    }),
  );
  const html = render(true);
  const restricted = render(false);
  assert.ok(!restricted.includes("Отправить в публикацию"));
  assert.ok(!restricted.includes("Снять с публикации"));
  assert.ok(restricted.includes("подтверждает владелец сайта"));
  for (const label of [
    "Есть изменения, не опубликованные на сайте",
    "Принять",
    "Отклонить",
    "Отправить в публикацию",
    "Снять с публикации",
    "Изменить с помощью AI",
    "Список промптов",
    "Прикрепить файл",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /type="file"/);
});
test("run history does not expand; history has all three specified tabs and filters", () => {
  const html = renderToStaticMarkup(
    React.createElement(load("creation-history").CreationHistory, {
      data: {
        runs: [
          {
            id: "r",
            number: 1,
            status: "succeeded",
            cluster_count: 2,
            actor_name: "Editor",
            created_at: "2026-09-19T00:00:00Z",
          },
        ],
        events: [],
      },
      location: { historyTab: "runs" },
      navigate() {},
    }),
  );
  for (const label of [
    "Запуски",
    "Кластеры",
    "Статьи",
    "Пользователь",
    "Результат",
    "С даты",
    "По дату",
  ])
    assert.ok(html.includes(label));
  assert.doesNotMatch(html, /<details/);
});

const event = (overrides = {}) => ({
  id: "event",
  kind: "cluster",
  type: "changed",
  cluster_id: "cluster",
  article_id: null,
  title: "Уход за кожей",
  before: null,
  after: null,
  related_ids: [],
  actor_name: "Редактор",
  created_at: "2026-09-19T00:00:00Z",
  ...overrides,
});
const cluster = (overrides = {}) => ({
  id: "cluster",
  workspace_id: "private-workspace-id",
  number: 42,
  title: "Уход за кожей",
  direction: "Косметология",
  archived: false,
  revision: 7,
  queries: [{ text: "Уход за кожей", primary: true, general: 120, exact: 35 }],
  ...overrides,
});
const historyHtml = (tab, events) =>
  renderToStaticMarkup(
    React.createElement(load("creation-history").CreationHistory, {
      data: { runs: [], events },
      location: { historyTab: tab },
      navigate() {},
    }),
  );

test("cluster history uses human-readable immutable snapshots, real numbers and only cluster event filters", () => {
  const html = historyHtml("clusters", [
    event({
      type: "split",
      before: [cluster()],
      after: [cluster({ id: "child", number: 57, title: "Уход за лицом" })],
      related_ids: ["cluster", "child"],
    }),
  ]);
  for (const label of [
    "Было",
    "Стало",
    "Направление",
    "Косметология",
    "основной",
    "120",
    "35",
    "№ 42",
    "№ 57",
    "Исходные кластеры перенесены в архив",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /workspace_id|private-workspace-id|revision|<pre/);
  assert.match(html, /<option value="split">/);
  assert.doesNotMatch(
    html,
    /<option value="published">|<option value="created">/,
  );
});

test("publication history shows version, platform and safe link, with article-only event filters", () => {
  const html = historyHtml("articles", [
    event({
      kind: "article",
      type: "published",
      article_id: "article",
      after: {
        version: 3,
        siteId: "private-site-id",
        siteName: "Skinova",
        url: "/preview/skinova/articles/care",
      },
    }),
  ]);
  for (const label of [
    "Опубликованная версия",
    "Версия 3",
    "Площадка",
    "Skinova",
    "Адрес публикации",
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /href="\/preview\/skinova\/articles\/care"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(
    html,
    /siteId|private-site-id|<pre|<option value="split">/,
  );
});

test("history presentation tolerates empty events and never turns unsafe publication URLs into links", () => {
  const { publicationDetails, clusterSnapshots, historyLabels } = load(
    "creation-history-state",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//outside.example/path",
    "/\\outside.example",
    "/\n/path",
    "not a url",
  ])
    assert.equal(publicationDetails({ url }).href, null, url);
  assert.equal(
    publicationDetails({ url: "https://example.com/article" }).href,
    "https://example.com/article",
  );
  assert.equal(publicationDetails(null).version, null);
  assert.deepEqual(clusterSnapshots(null), []);
  assert.deepEqual(clusterSnapshots({ unexpected: true }), []);
  assert.equal(historyLabels("clusters").published, undefined);
  assert.equal(historyLabels("articles").changed, undefined);
  assert.equal(historyLabels("runs").succeeded, "Завершён");
  assert.ok(
    historyHtml("clusters", [
      event({ type: "formed", after: cluster() }),
    ]).includes("Кластер ещё не создан."),
  );
});

test("article selection excludes surrounding controls and rejects selections outside the current article", () => {
  const { articleSelection } = load("creation-selection");
  const target = { dataset: { aiTarget: "block:intro" } };
  const textNode = { nodeType: 3, parentElement: { closest: () => target } };
  let removed = false;
  const root = {
    contains: (node) => node === textNode || node === target,
    ownerDocument: { createTreeWalker: () => {
      let index = -1;
      const texts = ['Первый "фрагмент"', 'на новой строке'];
      return { nextNode() { index++; return index < texts.length; }, get currentNode() { return {textContent:texts[index]}; } };
    } },
  };
  const range = { startContainer: textNode, endContainer: textNode, cloneContents: () => ({querySelectorAll: () => [{remove(){removed=true;}}]}) };
  const selected = { isCollapsed:false,rangeCount:1,getRangeAt:()=>range };
  assert.deepEqual(articleSelection(root,selected),{target:'block:intro',fragment:'Первый "фрагмент"\nна новой строке'});
  assert.equal(removed,true);
  assert.equal(articleSelection(root,{...selected,isCollapsed:true}),null);
  assert.equal(articleSelection(root,{...selected,getRangeAt:()=>({...range,endContainer:{}})}),null);
  assert.equal(articleSelection(root,null),null);
});
