import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bannerCompatibilityError,
  bannerLinkSelectValue,
} from "../src/app/banner-slot.ts";
import { LatestValueQueue } from "../src/app/latest-value-queue.ts";
import {
  SKINOVA_ARTICLE_BANNER_RENDERER,
  assignedSkinovaPreviewContexts,
  chooseSkinovaPreviewContext,
  skinovaBannerPreviewContexts,
} from "../src/app/skinova-banner-preview-context.ts";

test("autosave serializes requests and keeps only the latest queued draft", async () => {
  const calls = [];
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const queue = new LatestValueQueue(async (value) => {
    calls.push(value);
    if (value === "first") await first;
  });

  queue.enqueue("first");
  queue.enqueue("second");
  queue.enqueue("latest");
  await Promise.resolve();
  assert.deepEqual(calls, ["first"]);
  releaseFirst();
  await queue.idle();
  assert.deepEqual(calls, ["first", "latest"]);
});

test("empty links select the explicit no-link option", () => {
  const internal = ["/", "/articles/example"];
  assert.equal(bannerLinkSelectValue(null, internal), "");
  assert.equal(bannerLinkSelectValue("", internal), "");
  assert.equal(bannerLinkSelectValue("/articles/example", internal), "/articles/example");
  assert.equal(bannerLinkSelectValue("https://example.ru", internal), "external");
});

test("assignment UI mirrors slot content compatibility", () => {
  const promo = {
    supports: {
      desktopImage: false,
      mobileImage: false,
      title: true,
      subtitle: true,
      button: true,
    },
    required: { desktopImage: false },
  };
  assert.match(bannerCompatibilityError(promo, {}), /нет отображаемого/);
  assert.match(
    bannerCompatibilityError(promo, { mediaId: "image-id" }),
    /не поддерживает изображение/,
  );
  assert.equal(bannerCompatibilityError(promo, { title: "Акция" }), null);
});

test("Skinova preview contexts follow assignments without becoming banner content", () => {
  const slots = [
    {
      id: "homepage_top",
      name: "Верхняя промо-полоса",
      renderer: "skinova-promo-strip",
      supports: {
        desktopImage: false,
        mobileImage: false,
      },
    },
    {
      id: "homepage_middle",
      name: "Баннер консультации",
      renderer: "skinova-consultation",
      supports: {
        desktopImage: true,
        mobileImage: true,
      },
    },
  ];
  const contexts = skinovaBannerPreviewContexts(slots);
  assert.deepEqual(
    contexts.map((context) => context.renderer),
    [
      "skinova-promo-strip",
      "skinova-consultation",
      SKINOVA_ARTICLE_BANNER_RENDERER,
    ],
  );
  assert.equal(contexts[0].mobileHint, null);

  const assigned = assignedSkinovaPreviewContexts(
    { id: "banner-id", placement: null },
    [{ bannerId: "banner-id", zone: "homepage_middle" }],
    contexts,
  );
  assert.equal(assigned.length, 1);
  assert.equal(
    chooseSkinovaPreviewContext(contexts, assigned)?.renderer,
    "skinova-consultation",
  );
  assert.equal(
    chooseSkinovaPreviewContext(
      contexts,
      [],
      SKINOVA_ARTICLE_BANNER_RENDERER,
    )?.renderer,
    SKINOVA_ARTICLE_BANNER_RENDERER,
  );
  assert.deepEqual(
    assignedSkinovaPreviewContexts(
      { id: "legacy-id", placement: "article_sidebar" },
      [],
      contexts,
    ).map((context) => context.renderer),
    [SKINOVA_ARTICLE_BANNER_RENDERER],
  );
});

test("banner library uses the shared Skinova renderers and omits the technical guide", async () => {
  const [library, publicRenderers, previewPage] = await Promise.all([
    readFile(
      new URL("../src/app/media-banner-library-view.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/skinova-site.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/app/banner-preview/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(library, /Зоны текущего шаблона/);
  assert.doesNotMatch(library, /Нет изображения/);
  assert.doesNotMatch(library, /Предпросмотр содержимого/);
  for (const renderer of [
    "SkinovaPromoBanner",
    "SkinovaConsultationBanner",
    "SkinovaArticleBanner",
  ]) {
    assert.match(publicRenderers, new RegExp(`export function ${renderer}`));
    assert.match(previewPage, new RegExp(renderer));
  }
});
