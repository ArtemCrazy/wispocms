import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendDictation,
  collectDictation,
  preparationOperation,
  preparationRunLabel,
  preparationStageIndex,
  speechErrorMessage,
} from "../src/app/content-center/preparation-state.ts";
import {
  preparationDraftTitle,
  preparationVersionLabel,
} from "../src/app/content-center/preparation-version.ts";

test("preparation keeps materials left and the task and history right until the workspace narrows", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/app/content-center/content-center-view.module.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.preparationStack\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(380px, 0\.85fr\)/);
  assert.match(view, /<ProjectMaterials[\s\S]*?<div className=\{styles\.preparationSidebar\}>[\s\S]*?<h2>История версий<\/h2>/);
  assert.match(css, /\.preparationSidebar\s*\{[^}]*display:\s*grid/);
  assert.match(css, /@container\s*\(max-width:\s*1100px\)\s*\{\s*\.preparationStack\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("prompt selection supplies the saved name without a separate title or save button", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(view, /Название запроса|Сохранить задачу/);
  assert.match(view, /Выбрать промпт/);
  assert.match(view, /setPromptTitle\(title\)/);
  assert.match(view, /if \(dirty\) await saveDraft\(\)/);
  assert.match(view, /promptTitle,/);
});

test("preparation opens launch configuration with material selection and outcome instruction", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/app/content-center/content-center-view.module.css", import.meta.url),
    "utf8",
  );
  assert.match(view, /onClick=\{openRunDialog\}/);
  assert.match(view, /title="Запустить обработку материалов"/);
  assert.match(view, /aria-label="Источники обработки"/);
  assert.match(view, /aria-label="Результат обработки"/);
  assert.match(view, /materialIds: selectedMaterialIds/);
  assert.match(css, /\.runDialogGrid\s*\{[^}]*grid-template-columns/);
  assert.match(view, /Файл ·/);
  assert.match(view, /displayMaterialUrl\(item\.source_url\)/);
  assert.match(css, /\.runSourceList::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
});

test("manual material input does not impose the old 40k character cap", () => {
  const view = readFileSync(new URL("../src/app/content-center/content-center-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(view, /maxLength=\{40000\}|40 000 символов/);
});

test("an empty material list is accepted without a separate confirmation", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(view, /У меня нет материалов|aria-pressed=\{withoutMaterials\}/);
  assert.doesNotMatch(
    view,
    /!data\.materials\.length && !withoutMaterials/,
  );
  assert.match(view, /withoutMaterials: !data\.materials\.length/);
  assert.match(view, /withoutMaterials: !data\?\.materials\.length/);
});

test("preparation opens saved results from history without a duplicate result card", () => {
  const view = readFileSync(
    new URL(
      "../src/app/content-center/content-center-view.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(view, /Открыть обработанную информацию ↗/);
  assert.doesNotMatch(view, /<h2>Обработанная информация<\/h2>/);
  assert.match(view, /<h2>История версий<\/h2>/);
  assert.match(view, /\{preparationVersionLabel\(version\)\} ↗/);
  assert.match(view, /onClick=\{\(\) => navigate\("document", version\.id\)\}/);
  assert.doesNotMatch(view, /<h2>Процесс обработки<\/h2>|className=\{styles\.processingHistory\}/);
  assert.match(view, /className=\{styles\.runInlineStatus\}/);
  assert.match(view, /Не удалось запустить: \$\{runRequestError\}/);
  assert.match(view, /false, setRunRequestError\)/);
});

test("version labels use the saved request name, not a current template or a guessed legacy name", () => {
  assert.equal(
    preparationVersionLabel({ number: 3, prompt_title: "Анализ компании" }),
    "Анализ компании · версия 3",
  );
  assert.equal(
    preparationVersionLabel({ number: 1, prompt_title: null }),
    "Запрос без сохранённого названия · версия 1",
  );
  assert.equal(
    preparationVersionLabel({ number: 2 }),
    "Запрос без сохранённого названия · версия 2",
  );
});

test("content center uses the breadcrumb bar instead of an empty help toolbar", () => {
  const root = new URL("../src/app/", import.meta.url);
  const page = readFileSync(new URL("page.tsx", root), "utf8");
  const view = readFileSync(
    new URL("content-center/content-center-view.tsx", root),
    "utf8",
  );
  const css = readFileSync(
    new URL("content-center/content-center-view.module.css", root),
    "utf8",
  );
  assert.match(
    page,
    /activeView !== "content-center" &&\s*!\(site && isSiteNavigationActive\) \? \(\s*<header className="topbar topbar-actions-only">/,
  );
  assert.ok(
    view.indexOf("<ContentCenterBreadcrumbs") <
      view.indexOf("<div className={styles.heading}>"),
  );
  assert.match(
    css,
    /\.breadcrumbs \{[^}]*border-bottom: 1px solid var\(--line,/,
  );
  assert.match(css, /\.view \{[^}]*padding: 0;/);
});

test("content center dialogs keep the header visible and close from the backdrop", () => {
  const root = new URL("../src/app/content-center/", import.meta.url);
  const view = readFileSync(new URL("content-center-view.tsx", root), "utf8");
  const css = readFileSync(new URL("content-center-view.module.css", root), "utf8");
  assert.match(view, /event\.target === event\.currentTarget && !busy/);
  assert.match(view, /className=\{styles\.dialogHeader\}/);
  assert.match(view, /className=\{styles\.dialogBody\}/);
  assert.match(css, /\.dialog \{[^}]*overflow: hidden;/);
  assert.match(css, /\.dialogBody \{[^}]*overflow-y: auto;/);
  assert.match(css, /\.dialogBody \{[^}]*scrollbar-width: none;/);
  assert.match(css, /\.dialogBody::-webkit-scrollbar \{[^}]*display: none;/);
});

test("shared prompt picker keeps padded header and scrollable body within the dialog", () => {
  const root = new URL("../src/app/content-center/", import.meta.url);
  const picker = readFileSync(new URL("global-prompt-picker.tsx", root), "utf8");
  const css = readFileSync(new URL("content-center-view.module.css", root), "utf8");
  assert.match(picker, /className=\{`\$\{styles\.dialog\} \$\{styles\.promptPicker\}`\}/);
  assert.match(picker, /className=\{styles\.dialogHeader\}/);
  assert.match(picker, /className=\{styles\.dialogBody\}/);
  assert.match(picker, /className=\{styles\.promptPreview\}/);
  assert.match(css, /\.promptPicker \.promptText \{[^}]*max-height: min\(32vh, 280px\);/);
  assert.match(picker, /onClick=\{\(\) => onSelect\(selected\.content, selected\.title\)\}/);
});

test("draft prefill preserves a snapshot and only matches unambiguous exact copied prompts", () => {
  const prompts = [{ title: "Анализ компании", content: "Task" }];
  assert.equal(
    preparationDraftTitle(
      { prompt_title: "Saved title", instruction: "Task" },
      prompts,
    ),
    "Saved title",
  );
  assert.equal(
    preparationDraftTitle({ instruction: "Task" }, prompts),
    "Анализ компании",
  );
  assert.equal(
    preparationDraftTitle({ instruction: "Different task" }, prompts),
    "",
  );
  assert.equal(
    preparationDraftTitle({ instruction: "Task" }, [
      ...prompts,
      { title: "Another name", content: "Task" },
    ]),
    "",
  );
});

test("dictation appends to the current instruction without replacing manual edits", () => {
  assert.deepEqual(appendDictation("Задача", " новая фраза "), {
    value: "Задача новая фраза",
    overflow: false,
  });
  assert.equal(appendDictation("Задача\n", "Фраза").value, "Задача\nФраза");
  assert.equal(appendDictation("", "Фраза").value, "Фраза");
  assert.equal(appendDictation("Ручная правка", " ").value, "Ручная правка");
});

test("dictation preserves entered text instead of silently truncating over the limit", () => {
  assert.deepEqual(appendDictation("12345", "67", 7), {
    value: "12345",
    overflow: true,
  });
  assert.deepEqual(appendDictation("12345", "6", 7), {
    value: "12345 6",
    overflow: false,
  });
});

test("inline run status reflects only server-confirmed states and preserves failure detail", () => {
  assert.equal(preparationRunLabel("queued"), "Задача в очереди");
  assert.equal(preparationRunLabel("processing"), "Обрабатываем материалы…");
  assert.equal(preparationRunLabel("succeeded"), "Готово — версия доступна в истории");
  assert.match(preparationRunLabel("failed", "DeepSeek вернул неполный результат"), /Не завершено: DeepSeek вернул неполный результат/);
  assert.match(preparationRunLabel("failed", null), /Последняя версия сохранена/);
});

test("live preparation shows real stages and a percentage only for a counted operation", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(preparationStageIndex("collecting"), 0);
  assert.equal(preparationStageIndex("analysing"), 1);
  assert.equal(preparationStageIndex("synthesizing"), 2);
  assert.equal(preparationStageIndex(), -1);
  assert.deepEqual(preparationOperation({ completed: 5, total: 22 }), {
    completed: 5,
    total: 22,
    percent: 22,
  });
  assert.equal(preparationOperation({ stage: "synthesizing" }), null);
  assert.equal(preparationOperation({ completed: 0, total: 0 }), null);
  assert.match(view, /aria-label="Ход обработки материалов"/);
  assert.match(view, /≈ \{currentOperation\.percent\}% текущей операции/);
  assert.match(view, /runProgress\?\.message/);
});

test("a failed run can be continued explicitly without silently starting a fresh paid run", () => {
  const view = readFileSync(
    new URL("../src/app/content-center/content-center-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(view, /data\.run\.resumable/);
  assert.match(view, /!dirty/);
  assert.match(view, /\/runs\/\$\{data\.run\.id\}\/resume/);
  assert.match(view, /Продолжить обработку/);
});

test("speech permission and service failures offer a text fallback", () => {
  assert.match(speechErrorMessage("not-allowed"), /разрешение микрофона/);
  assert.match(speechErrorMessage("network"), /текстом/);
  assert.match(speechErrorMessage("no-speech"), /Речь не распознана/);
  assert.match(speechErrorMessage("unknown"), /введённый текст сохранён/);
});

test("only finalized speech is appended, without duplicates across result events", () => {
  const seen = new Set();
  const result = (text, isFinal) => ({ 0: { transcript: text }, isFinal });
  assert.deepEqual(collectDictation([result("Первая", false)], seen), {
    final: "",
    interim: "Первая",
  });
  assert.deepEqual(
    collectDictation([result("Первая", true), result("вторая", false)], seen),
    { final: "Первая", interim: "вторая" },
  );
  assert.deepEqual(
    collectDictation([result("Первая", true), result("вторая", true)], seen),
    { final: "вторая", interim: "" },
  );
  assert.deepEqual(
    collectDictation([result("Первая", true), result("вторая", true)], seen),
    { final: "", interim: "" },
  );
});

test("microphone permission is scoped to the CMS shell, not public previews", () => {
  const nginx = readFileSync(
    new URL("../../../deploy/nginx.preview.conf", import.meta.url),
    "utf8",
  );
  // Each TLS hostname has its own server block and CMS root location.
  const tlsServers = nginx.split(/^server \{/m).filter((block) => /listen 443 ssl/.test(block));
  assert.equal(tlsServers.length, 2);
  for (const server of tlsServers) {
    const cms = /location = \/ \{([\s\S]*?)\n    \}/.exec(server)?.[1];
    assert.match(cms, /microphone=\(self\)/);
    assert.equal((server.match(/microphone=\(self\)/g) ?? []).length, 1);
    assert.match(server.slice(0, server.indexOf("location /api/")), /microphone=\(\)/);
  }
});
