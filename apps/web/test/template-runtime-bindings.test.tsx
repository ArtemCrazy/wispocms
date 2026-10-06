import assert from "node:assert/strict";
import test from "node:test";
import {
  SkinovaArticleBanner,
  SkinovaArticlePage,
  SkinovaCategoryPage,
  SkinovaConsultationBanner,
  SkinovaHome,
  SkinovaPromoBanner,
  SkinovaSystemPage,
} from "../src/app/skinova-site";
import {
  resolveSlotComponent,
  resolveTemplateComponent,
} from "../src/app/template-runtime-registry";

const packageIdentity = {
  packageId: "skinova-media",
  packageVersion: "1",
};

test("component bindings preserve exact implementation and component identity", () => {
  const expectations = [
    ["homepage", "skinova-home", "skinova-home", SkinovaHome],
    ["article", "skinova-article", "skinova-article", SkinovaArticlePage],
    ["category", "skinova-category", "skinova-category", SkinovaCategoryPage],
    ["system_page", "skinova", "skinova-system-page", SkinovaSystemPage],
  ] as const;

  for (const [kind, key, implementationKey, component] of expectations) {
    const resolved = resolveTemplateComponent({
      ...packageIdentity,
      kind,
      key,
      templateVersion: "1",
    });
    assert.equal(resolved?.implementationKey, implementationKey);
    assert.equal(resolved?.renderer, component);
  }
});

test("integrated and foreign template capabilities never masquerade as components", () => {
  assert.equal(
    resolveTemplateComponent({
      ...packageIdentity,
      kind: "articles_list",
      key: "skinova-editorial",
      templateVersion: "1",
    }),
    null,
  );
  assert.equal(
    resolveTemplateComponent({
      ...packageIdentity,
      packageId: "foreign",
      kind: "homepage",
      key: "skinova-home",
      templateVersion: "1",
    }),
    null,
  );
  assert.equal(
    resolveTemplateComponent({
      ...packageIdentity,
      packageVersion: "2",
      kind: "homepage",
      key: "skinova-home",
      templateVersion: "1",
    }),
    null,
  );
});

test("slot bindings preserve package-aware component identity", () => {
  const expectations = [
    ["skinova-promo-strip", SkinovaPromoBanner],
    ["skinova-consultation", SkinovaConsultationBanner],
    ["skinova-article-sidebar", SkinovaArticleBanner],
  ] as const;

  for (const [rendererKey, component] of expectations) {
    const resolved = resolveSlotComponent({ ...packageIdentity, rendererKey });
    assert.equal(resolved?.implementationKey, rendererKey);
    assert.equal(resolved?.renderer, component);
  }
  assert.equal(
    resolveSlotComponent({
      ...packageIdentity,
      packageVersion: "2",
      rendererKey: "skinova-promo-strip",
    }),
    null,
  );
});
