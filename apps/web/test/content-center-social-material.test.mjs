import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(
  new URL(
    "../src/app/content-center/social-material-fields.tsx",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
});
const target = { exports: {} };
const require = createRequire(import.meta.url);
new Function("require", "module", "exports", compiled.outputText)(
  (id) => (id.endsWith(".css") ? { default: {} } : require(id)),
  target,
  target.exports,
);
const { SocialMaterialFields, socialNetworkForUrl, socialSourceUrl } =
  target.exports;
const props = {
  network: "vk",
  sourceUrl: "",
  onChange() {},
  onNetworkChange() {},
};

test("social form shows three networks and one URL field, without generic material fields", () => {
  const html = renderToStaticMarkup(
    React.createElement(SocialMaterialFields, props),
  );
  for (const label of ["ВКонтакте", "Telegram", "YouTube"])
    assert.ok(html.includes(label));
  assert.equal((html.match(/<input\b/g) ?? []).length, 1);
  assert.match(html, /type="url"/);
  assert.match(html, /required=""/);
  assert.match(html, /autofocus=""/);
  assert.match(html, /aria-pressed="true">ВКонтакте/);
  assert.doesNotMatch(
    html,
    /Название|Категория источника|<select|<textarea|>Текст<|>Ссылка</,
  );
});

test("each network has its own placeholder and honest collection status", () => {
  for (const [network, address] of [
    ["vk", "vk.com"],
    ["telegram", "t.me"],
    ["youtube", "youtube.com"],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(SocialMaterialFields, { ...props, network }),
    );
    assert.ok(html.includes(address));
    if (network === "vk") assert.match(html, /ключ заказчика не нужен/);
    else if (network === "telegram") assert.match(html, /100 последних публикаций за 180 дней/);
    else assert.match(html, /пока не подключён/);
  }
});

test("Telegram only accepts a public channel address", () => {
  assert.equal(socialSourceUrl("https://t.me/s/company", "telegram"), "https://t.me/s/company");
  for (const path of ["/+private", "/c/123/1", "/company/12", "/company?before=1", "/share", "/proxy", "/joinchat/secret"])
    assert.throws(() => socialSourceUrl(`https://t.me${path}`, "telegram"));
});

test("network and URL interactions update their separate draft fields", () => {
  let selected;
  let entered;
  const tree = SocialMaterialFields({
    ...props,
    onNetworkChange(value) {
      selected = value;
    },
    onChange(value) {
      entered = value;
    },
  });
  const [networks, field] = React.Children.toArray(tree.props.children);
  const youtube = React.Children.toArray(networks.props.children).find(
    (child) => child.props.children === "YouTube",
  );
  youtube.props.onClick();
  assert.equal(selected, "youtube");
  field.props.children.props.onChange({
    target: { value: "https://www.youtube.com/@company" },
  });
  assert.equal(entered, "https://www.youtube.com/@company");
});

test("existing sources select their own platform, with a fallback for older other networks", () => {
  for (const [address, network] of [
    ["https://m.vk.ru/company", "vk"],
    ["https://telegram.me/company", "telegram"],
    ["https://youtu.be/video", "youtube"],
    ["https://www.youtube.com/@company", "youtube"],
    ["https://example.org/profile", "other"],
  ])
    assert.equal(socialNetworkForUrl(address), network);
  const html = renderToStaticMarkup(
    React.createElement(SocialMaterialFields, {
      ...props,
      network: "other",
      sourceUrl: "https://example.org/profile",
    }),
  );
  assert.match(html, /Другая сеть/);
  assert.match(html, /value="https:\/\/example.org\/profile"/);
});

test("submission rejects mismatching, deceptive or credential-bearing links before saving", () => {
  assert.equal(
    socialSourceUrl(" https://vk.com/company ", "vk"),
    "https://vk.com/company",
  );
  assert.equal(
    socialSourceUrl("https://t.me/company", "telegram"),
    "https://t.me/company",
  );
  for (const value of [
    "https://youtube.com/@company",
    "https://vk.com.evil.test/company",
    "http://vk.com/company",
    "https://user:pass@vk.com/company",
    "https://vk.com:444/company",
    "bad address",
  ])
    assert.throws(() => socialSourceUrl(value, "vk"));
});
