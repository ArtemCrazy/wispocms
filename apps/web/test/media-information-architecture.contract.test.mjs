import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shell = await readFile(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const home = await readFile(
  new URL("../src/app/media-home-view.tsx", import.meta.url),
  "utf8",
);
const articles = await readFile(
  new URL("../src/app/media-articles-view.tsx", import.meta.url),
  "utf8",
);
const editor = await readFile(
  new URL("../src/app/content-view.tsx", import.meta.url),
  "utf8",
);
const publicHome = await readFile(
  new URL("../src/app/preview/[siteSlug]/page.tsx", import.meta.url),
  "utf8",
);
const publicArticle = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/articles/[articleSlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Media Home owns only Template, Banners, and homepage SEO", () => {
  assert.match(shell, /<MediaHomeView/);
  assert.match(home, /\["template", "Шаблон"\]/);
  assert.match(home, /\["banners", "Баннеры"\]/);
  assert.match(home, /\["seo", "SEO"\]/);
  assert.doesNotMatch(home, /Категории|Рубрики|Авторы/);
  assert.match(home, /kind: "homepage"/);
});

test("Articles starts with Template and Content and preserves the nested URL", () => {
  assert.match(shell, /<MediaArticlesView/);
  assert.match(articles, /<strong>Шаблон<\/strong>/);
  assert.match(articles, /<strong>Контент<\/strong>/);
  assert.match(articles, /searchParams\.set\("subview", next\)/);
  assert.match(articles, /window\.addEventListener\("popstate", restore\)/);
  assert.match(
    articles,
    /Детальная настройка шаблона будет добавлена\s+отдельной спецификацией/,
  );
});

test("article settings are internal tabs and editor text autosaves safely", () => {
  for (const label of [
    "Редактор",
    "Главное",
    "Публикация",
    "Отображение",
    "SEO",
    "История",
  ])
    assert.match(editor, new RegExp(`\\["[a-z]+", "${label}"\\]`));
  assert.match(editor, /setTimeout\(\(\) =>/);
  assert.match(editor, /while \(autosavePendingBody\.current !== null\)/);
  assert.match(editor, /expectedRevision/);
  assert.match(editor, /await flushAutosave\(\)/);
  assert.match(editor, /Ошибка — повторить/);
  assert.match(
    editor,
    /reason instanceof RequestError && reason\.status === 409/,
  );
  assert.match(editor, /setAutosaveStatus\("conflict"\)/);
  assert.match(
    editor,
    /autosaveStatus === "conflict"[\s\S]*Конфликт версий — скопируйте текст и перезагрузите/,
  );
  assert.match(
    editor,
    /autosaveStatus === "conflict" \? \(\s*"Конфликт версий — скопируйте текст и перезагрузите"\s*\) : autosaveStatus === "error" \? \(\s*<button/,
  );
  assert.doesNotMatch(editor, /AbortController/);
  assert.match(editor, /name="previewMediaId"/);
  assert.match(editor, /name="publishedAt"/);
  assert.match(editor, /name="sortOrder"/);
});

test("public cards prefer preview images and legacy slugs issue a real redirect", () => {
  assert.match(publicHome, /article\.previewMedia \?\? article\.coverMedia/);
  assert.match(publicArticle, /item\.previewMedia \?\? item\.coverMedia/);
  assert.match(publicArticle, /permanentRedirect\(/);
});
