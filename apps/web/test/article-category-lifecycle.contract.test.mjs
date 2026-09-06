import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const content = await readFile(
  new URL("../src/app/content-view.tsx", import.meta.url),
  "utf8",
);
const structuredEditor = await readFile(
  new URL("../src/app/structured-article-editor.tsx", import.meta.url),
  "utf8",
);
const publicArticle = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/articles/[articleSlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publicCategory = await readFile(
  new URL(
    "../src/app/preview/[siteSlug]/categories/[categorySlug]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("content tree searches article titles and category names without a fake root row", () => {
  assert.match(content, /placeholder="Поиск по рубрикам и статьям"/);
  assert.match(
    content,
    /article\.title\.toLocaleLowerCase\("ru"\)\.includes\(query\)/,
  );
  assert.match(
    content,
    /category\.name\.toLocaleLowerCase\("ru"\)\.includes\(query\)/,
  );
  assert.match(content, /includeWithParents/);
  assert.doesNotMatch(content, /<strong>Все материалы<\/strong>/);
  assert.match(content, /className="article-tree-toggle"/);
  assert.match(
    content,
    /onClick=\{\(\) => openCategory\(row\.category\.id\)\}/,
  );
});

test("category level has persistent URL state and five internal settings tabs", () => {
  assert.match(content, /searchParams\.set\("contentCategory", categoryId\)/);
  assert.match(content, /Настроить категорию/);
  for (const label of [
    "Основное",
    "Положение",
    "Отображение",
    "SEO",
    "История",
  ])
    assert.match(content, new RegExp(`\\["[a-z]+", "${label}"\\]`));
  assert.doesNotMatch(content, /category-panel-scrim/);
  assert.match(content, /delete-summary/);
  assert.match(content, /moveToCategoryId/);
});

test("visual document supports required blocks, arbitrary insertion, ordering and undo", () => {
  for (const type of [
    "heading",
    "paragraph",
    "image",
    "bullet_list",
    "numbered_list",
    "quote",
  ])
    assert.match(
      structuredEditor,
      new RegExp(`value="${type}"|type: "${type}"`),
    );
  assert.match(structuredEditor, /Добавить блок ниже/);
  assert.match(structuredEditor, /↶ Отменить/);
  assert.match(structuredEditor, /↷ Повторить/);
  assert.match(structuredEditor, /getData\("text\/plain"\)/);
  assert.match(content, /bodyDocument/);
  assert.match(content, /expectedRevision/);
});

test("public render uses typed React elements and category routes redirect permanently", () => {
  assert.match(publicArticle, /block\.type === "heading"/);
  assert.match(publicArticle, /block\.type === "image"/);
  assert.doesNotMatch(publicArticle, /dangerouslySetInnerHTML/);
  assert.match(publicCategory, /permanentRedirect/);
  assert.match(publicCategory, /result\.data\.redirectTo/);
});

test("hidden article lifecycle is exposed in CMS but not treated as published", () => {
  assert.match(content, /\["hidden", "Скрыто"\]/);
  assert.match(content, /changeStatus\(\s*"hidden"/);
  assert.match(content, /editor\.status === "hidden"/);
});
