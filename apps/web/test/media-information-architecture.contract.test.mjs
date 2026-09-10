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
const mediaSite = await readFile(
  new URL("../src/app/media-site-view.tsx", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const bannerLibrary = await readFile(
  new URL("../src/app/media-banner-library-view.tsx", import.meta.url),
  "utf8",
);
const assignments = await readFile(
  new URL("../src/app/page-banner-assignments-view.tsx", import.meta.url),
  "utf8",
);
const bannerSlots = await readFile(
  new URL("../../api/src/content/banner-slot-registry.ts", import.meta.url),
  "utf8",
);
const variables = await readFile(
  new URL("../src/app/site-variables-view.tsx", import.meta.url),
  "utf8",
);
const layout = await readFile(
  new URL("../src/app/media-layout-view.tsx", import.meta.url),
  "utf8",
);
const templates = await readFile(
  new URL("../src/app/media-templates-view.tsx", import.meta.url),
  "utf8",
);

test("Media Site is a root with template, banner, and variable cards", () => {
  assert.match(shell, /id: "site"/);
  assert.match(shell, /<MediaSiteView/);
  assert.match(mediaSite, /title: "Шаблоны"/);
  assert.match(mediaSite, /title: "Библиотека баннеров"/);
  assert.match(mediaSite, /title: "Библиотека переменных"/);
  assert.match(mediaSite, /\["privacy-policy", "ПК"/);
  assert.match(shell, /slug: "privacy-policy"[\s\S]*?label: "ПК"/);
  assert.match(shell, /id: "header", icon: "header", label: "Шапка"/);
  assert.match(shell, /id: "footer", icon: "footer", label: "Подвал"/);
  assert.match(
    globalStyles,
    /\.media-site-cards\s*\{[^}]*grid-template-columns: 1fr;/,
  );
  assert.match(
    globalStyles,
    /\.media-site-card\s*\{[^}]*grid-template-columns: 44px minmax\(0, 1fr\) auto;/,
  );
  assert.match(shell, /activeView === "templates"/);
  assert.match(shell, /activeView === "homepage-template"/);
  assert.match(templates, /Текущий:/);
  assert.match(templates, /Открыть и изменить/);
  assert.match(templates, /content\/templates/);
  assert.match(templates, /content\/layout/);
  assert.match(templates, /method: "PATCH"/);
  assert.match(templates, /headerTemplateKey/);
  assert.match(templates, /footerTemplateKey/);
  assert.doesNotMatch(templates, /current: "Общий шаблон сайта"/);
  for (const label of ["Главная", "Статьи", "Шапка и подвал", "404", "ПК"])
    assert.match(mediaSite, new RegExp(label));
});

test("Media Home owns exactly banner assignments, SEO, and page history", () => {
  assert.match(shell, /<MediaHomeView/);
  assert.match(home, /\["banners", "Баннеры"\]/);
  assert.match(home, /\["seo", "SEO"\]/);
  assert.match(home, /\["history", "История"\]/);
  assert.doesNotMatch(home, /\["template", "Шаблон"\]|<PagesView/);
  assert.doesNotMatch(home, /Категории|Рубрики|Авторы/);
  assert.match(home, /kind: "homepage"/);
  assert.match(assignments, /homepage\?\.bannerSlots \?\? \[\]/);
  assert.doesNotMatch(assignments, /const zones/);
  assert.match(bannerSlots, /id: 'homepage_top'/);
  assert.match(bannerSlots, /id: 'homepage_middle'/);
  assert.match(bannerSlots, /minWidth: 1800/);
  assert.match(bannerSlots, /minHeight: 480/);
  assert.match(home, /ogImageMediaId/);
  assert.match(home, /structuredData/);
  assert.match(home, /redirects/);
});

test("Media libraries expose universal autosaved banners, protected variables, and search contract", () => {
  assert.match(bannerLibrary, /Автосохранение включено/);
  assert.doesNotMatch(bannerLibrary, /name="placement"/);
  assert.match(bannerLibrary, /mobileMediaId/);
  assert.match(bannerLibrary, /buttonText/);
  assert.match(bannerLibrary, /Зоны текущего шаблона/);
  assert.match(bannerLibrary, /Предпросмотр содержимого/);
  assert.doesNotMatch(bannerLibrary, /Сохранить/);
  assert.match(variables, /usageCount/);
  assert.match(variables, /\{\{\$\{item\.identifier\}\}\}/);
  assert.match(layout, /\["search", "Поиск"\]/);
  assert.match(layout, /analyticsAvailable/);
  assert.match(layout, /recommendations\/confirm/);
});

test("Articles owns its inline template and Content preserves the nested URL", () => {
  assert.match(shell, /<MediaArticlesView/);
  assert.match(articles, />Шаблон списка<\/span>/);
  assert.match(articles, /<strong>Контент<\/strong>/);
  assert.match(articles, /searchParams\.set\("subview", next\)/);
  assert.match(articles, /window\.addEventListener\("popstate", restore\)/);
  assert.match(articles, /content\/templates/);
  assert.match(articles, /content\/articles\/settings/);
});

test("article settings are internal tabs and editor text autosaves safely", () => {
  for (const label of ["Редактор", "Параметры", "SEO", "История изменений"])
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
