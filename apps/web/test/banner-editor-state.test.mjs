import assert from "node:assert/strict";
import test from "node:test";
import {
  bannerCompatibilityError,
  bannerLinkSelectValue,
} from "../src/app/banner-slot.ts";
import { LatestValueQueue } from "../src/app/latest-value-queue.ts";

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
