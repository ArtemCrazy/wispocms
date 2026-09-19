import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendDictation,
  collectDictation,
  preparationSteps,
  speechErrorMessage,
} from "../src/app/content-center/preparation-state.ts";

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
  assert.match(view, /Открыть версию \{version\.number\} ↗/);
  assert.match(view, /onClick=\{\(\) => navigate\("document", version\.id\)\}/);
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

test("run steps only report saved result after server success", () => {
  assert.deepEqual(
    preparationSteps("queued").map((s) => s.state),
    ["done", "waiting", "waiting"],
  );
  assert.deepEqual(
    preparationSteps("processing").map((s) => s.state),
    ["done", "active", "waiting"],
  );
  assert.deepEqual(
    preparationSteps("failed").map((s) => s.state),
    ["done", "failed", "waiting"],
  );
  assert.deepEqual(
    preparationSteps("succeeded").map((s) => s.state),
    ["done", "done", "done"],
  );
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
  const cms = /location = \/ \{([\s\S]*?)\n    \}/.exec(nginx)?.[1];
  assert.match(cms, /microphone=\(self\)/);
  assert.equal((nginx.match(/microphone=\(self\)/g) ?? []).length, 1);
  assert.match(
    nginx.slice(0, nginx.indexOf("location /api/")),
    /microphone=\(\)/,
  );
});
