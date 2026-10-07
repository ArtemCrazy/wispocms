import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  chunkRuntimeIdentity,
  createChunkRuntimeCatalog,
} from "../src/app/chunk-runtime-catalog.ts";

const manifest = JSON.parse(
  await readFile(
    new URL(
      "../../api/test/fixtures/managed-chunks-v2.fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const FixtureBanner = Symbol("FixtureBanner");

test("resolves only the exact package and definition identity", () => {
  const catalog = createChunkRuntimeCatalog(manifest, {
    "fixture-banner-renderer": FixtureBanner,
  });
  const identity = {
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    definitionKey: "fixture-banner",
    schemaVersion: "1",
  };

  assert.equal(catalog.resolve(identity)?.implementation, FixtureBanner);
  assert.equal(catalog.resolve({ ...identity, packageId: "foreign" }), null);
  assert.equal(catalog.resolve({ ...identity, packageVersion: "999" }), null);
  assert.equal(
    catalog.resolve({ ...identity, definitionKey: "unknown" }),
    null,
  );
  assert.equal(catalog.resolve({ ...identity, schemaVersion: "999" }), null);
});

test("fails build catalog when renderer lacks an own trusted binding", () => {
  assert.throws(
    () => createChunkRuntimeCatalog(manifest, {}),
    /fixture-banner-renderer.*runtime binding/i,
  );

  const inheritedBindings = Object.create({
    "fixture-banner-renderer": FixtureBanner,
  });
  assert.throws(
    () => createChunkRuntimeCatalog(manifest, inheritedBindings),
    /fixture-banner-renderer.*runtime binding/i,
  );
});

test("rejects own bindings with a nullish implementation", () => {
  for (const implementation of [undefined, null]) {
    assert.throws(
      () =>
        createChunkRuntimeCatalog(manifest, {
          "fixture-banner-renderer": implementation,
        }),
      /fixture-banner-renderer.*runtime binding/i,
    );
  }
});

test("rejects accessor bindings without invoking them", () => {
  let getterCalls = 0;
  const bindings = {};
  Object.defineProperty(bindings, "fixture-banner-renderer", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return FixtureBanner;
    },
  });

  assert.throws(
    () => createChunkRuntimeCatalog(manifest, bindings),
    /fixture-banner-renderer.*runtime binding/i,
  );
  assert.equal(getterCalls, 0);
});

test("fails closed on a duplicate runtime identity", () => {
  const duplicate = {
    ...manifest,
    chunkDefinitions: [
      ...manifest.chunkDefinitions,
      { ...manifest.chunkDefinitions[0], rendererKey: "other-renderer" },
    ],
  };

  assert.throws(
    () =>
      createChunkRuntimeCatalog(duplicate, {
        "fixture-banner-renderer": FixtureBanner,
        "other-renderer": Symbol("OtherRenderer"),
      }),
    /duplicate chunk runtime identity/i,
  );
});

test("uses collision-safe tuple identities", () => {
  const collisionManifest = {
    packageId: "package:one",
    packageVersion: "1",
    chunkDefinitions: [
      { key: "banner", schemaVersion: "one:1", rendererKey: "first" },
      { key: "banner:one", schemaVersion: "1", rendererKey: "second" },
    ],
  };
  const First = Symbol("First");
  const Second = Symbol("Second");
  const catalog = createChunkRuntimeCatalog(collisionManifest, {
    first: First,
    second: Second,
  });
  const firstIdentity = {
    packageId: "package:one",
    packageVersion: "1",
    definitionKey: "banner",
    schemaVersion: "one:1",
  };
  const secondIdentity = {
    packageId: "package:one",
    packageVersion: "1",
    definitionKey: "banner:one",
    schemaVersion: "1",
  };

  assert.notEqual(
    chunkRuntimeIdentity(firstIdentity),
    chunkRuntimeIdentity(secondIdentity),
  );
  assert.equal(catalog.resolve(firstIdentity)?.implementation, First);
  assert.equal(catalog.resolve(secondIdentity)?.implementation, Second);
});

test("keeps resolved entries immutable and isolated from manifest changes", () => {
  const mutableManifest = structuredClone(manifest);
  const mutableBindings = {
    "fixture-banner-renderer": FixtureBanner,
  };
  const catalog = createChunkRuntimeCatalog(mutableManifest, mutableBindings);
  const identity = {
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    definitionKey: "fixture-banner",
    schemaVersion: "1",
  };
  const entry = catalog.resolve(identity);

  assert.ok(entry);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(entry), true);
  assert.throws(() => {
    catalog.resolve = () => null;
  }, TypeError);
  assert.throws(() => {
    entry.rendererKey = "changed";
  }, TypeError);
  mutableManifest.chunkDefinitions[0].rendererKey = "changed";
  mutableBindings["fixture-banner-renderer"] = Symbol("Changed");
  assert.equal(
    catalog.resolve(identity)?.rendererKey,
    "fixture-banner-renderer",
  );
  assert.equal(catalog.resolve(identity), entry);
});
