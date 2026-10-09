import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";

const repo = resolve(import.meta.dirname, "..");
const script = join(repo, "scripts/template-package-release.mjs");
let releaseModulePromise;
function releaseModule() {
  releaseModulePromise ??= import("./template-package-release.mjs");
  return releaseModulePromise;
}
const secret = "release-token-that-must-never-be-printed";
const projects = [];
const servers = [];
const explicitReleaseRoots = [
  "apps/web/src/proxy.ts",
  "apps/web/src/app/layout.tsx",
  "apps/web/src/app/banner-preview/page.tsx",
  "apps/web/src/app/skinova-banner-preview-frame.tsx",
  "apps/web/src/app/template-runtime-catalog.ts",
  "apps/web/src/app/template-runtime-registry.tsx",
];
const discoveredRouteEntries = [
  "apps/web/src/app/preview/[siteSlug]/layout.tsx",
  "apps/web/src/app/preview/[siteSlug]/loading.tsx",
  "apps/web/src/app/preview/[siteSlug]/error.tsx",
  "apps/web/src/app/preview/[siteSlug]/not-found.tsx",
  "apps/web/src/app/preview/[siteSlug]/template.tsx",
  "apps/web/src/app/preview/[siteSlug]/page.tsx",
  "apps/web/src/app/preview/[siteSlug]/articles/[articleSlug]/page.tsx",
  "apps/web/src/app/preview/[siteSlug]/categories/[categorySlug]/page.tsx",
  "apps/web/src/app/preview/[siteSlug]/pages/[pageSlug]/not-found.tsx",
  "apps/web/src/app/preview/[siteSlug]/pages/[pageSlug]/page.tsx",
  "apps/web/src/app/preview/[siteSlug]/search/route.ts",
  "apps/web/src/app/preview/[siteSlug]/robots.txt/route.ts",
  "apps/web/src/app/preview/[siteSlug]/sitemap.xml/route.ts",
  "apps/web/src/app/preview/[siteSlug]/files/[...path]/route.ts",
];
const buildConventionInputs = [
  "apps/web/next.config.ts",
  "apps/web/postcss.config.mjs",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];
const manifestTemplate = {
  manifestVersion: 1,
  packageId: "skinova-media",
  packageVersion: "1",
  title: "Skinova Media",
  siteType: "media",
  cmsApi: { minSchemaVersion: "1.2" },
  source: { repository: "https://example.test/skinova.git" },
  build: { runtimeMode: "embedded-next" },
  templates: [
    {
      kind: "homepage",
      key: "skinova-home",
      version: "1",
      title: "Skinova home",
      dataScope: "cms-entity",
      runtimeContext: ["siteSlug"],
      dataSchemaVersion: "1",
      dataSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
      },
    },
  ],
};

test("release metadata defaults are deterministic", async () => {
  const { canonicalGitBuiltAt, releaseConfiguration } = await releaseModule();
  assert.deepEqual(releaseConfiguration({}), {
    apiUrl: "http://127.0.0.1:4300/api/",
    siteSlug: "skinova",
    requestTimeoutMs: 2_000,
  });
  assert.equal(
    canonicalGitBuiltAt("2026-10-02T12:30:00+03:00"),
    "2026-10-02T09:30:00.000Z",
  );
  assert.throws(
    () => canonicalGitBuiltAt("invalid-secret-timestamp"),
    (error) =>
      /Git metadata/.test(error.message) &&
      !error.message.includes("invalid-secret-timestamp"),
  );
});

test("release API uses HTTPS remotely and permits HTTP only on literal loopback", async () => {
  const { releaseConfiguration } = await releaseModule();
  for (const unsafe of [
    "http://example.com/api",
    "http://169.254.169.254/api",
    "http://localhost:4300/api",
  ])
    assert.throws(() => releaseConfiguration({ WISPO_API_URL: unsafe }));
  assert.equal(
    releaseConfiguration({ WISPO_API_URL: "https://cms.example.com/api" })
      .apiUrl,
    "https://cms.example.com/api/",
  );
  assert.equal(
    releaseConfiguration({ WISPO_API_URL: "http://[::1]:4300/api" }).apiUrl,
    "http://[::1]:4300/api/",
  );
});

afterEach(async () => {
  while (servers.length) await new Promise((done) => servers.pop().close(done));
  while (projects.length)
    await rm(projects.pop(), { recursive: true, force: true });
});

async function put(root, relative, contents) {
  const path = join(root, ...relative.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function fixture({ reverseAssets = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "wispo-release-"));
  projects.push(root);
  await put(
    root,
    "apps/web/template-packages/skinova/manifest.template.json",
    `${JSON.stringify(manifestTemplate, null, 2)}\n`,
  );
  await put(
    root,
    "apps/web/template-packages/skinova/manifest.v2.template.json",
    `${JSON.stringify(
      {
        ...manifestTemplate,
        manifestVersion: 2,
        packageVersion: "2",
        chunkCategories: [],
        chunkDefinitions: [],
      },
      null,
      2,
    )}\n`,
  );
  for (const path of buildConventionInputs)
    await put(
      root,
      path,
      path.endsWith(".json")
        ? `${JSON.stringify({ fixture: path }, null, 2)}\n`
        : path.endsWith(".yaml")
          ? "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"
          : path.endsWith("Dockerfile")
            ? "FROM node:22-alpine\nWORKDIR /app\nCOPY . .\n"
            : path.endsWith(".ts") || path.endsWith(".mjs")
              ? `export default ${JSON.stringify({ fixture: path })};\n`
              : `/* ${path} */\n`,
    );
  for (const [index, path] of [
    ...explicitReleaseRoots,
    ...discoveredRouteEntries,
  ].entries())
    await put(
      root,
      path,
      `export const fixture${index} = ${JSON.stringify(path)};\n`,
    );
  await put(
    root,
    explicitReleaseRoots[1],
    [
      'import "./fixture-side.css";',
      'import value from "./fixture-dependency";',
      'export { aliasValue } from "@/fixture-alias";',
      'export * as namespaceValue from "./fixture-namespace.cjs";',
      'const requiredValue = require("./fixture-required");',
      'export const loadFixture = () => import("./fixture-dynamic");',
      '// import "./comment-must-not-resolve";',
      'const sourceText = "require(\\\"./string-must-not-resolve\\\")";',
      "export default value;",
      "",
    ].join("\n"),
  );
  await put(
    root,
    "apps/web/src/app/fixture-side.css",
    [
      '@import url(./fixture-theme.css);',
      '@import url("./fixture-quoted.css");',
      '@import "./fixture-plain.css";',
      '/* @import url(./fixture-comment.css); */',
      ".fixture { color: red; }",
      "",
    ].join("\n"),
  );
  for (const path of [
    "apps/web/src/app/fixture-theme.css",
    "apps/web/src/app/fixture-quoted.css",
    "apps/web/src/app/fixture-plain.css",
  ])
    await put(root, path, `.fixture-import { content: ${JSON.stringify(path)}; }\n`);
  await put(
    root,
    "apps/web/src/app/fixture-dependency/index.ts",
    "export default 1;\n",
  );
  await put(
    root,
    "apps/web/src/fixture-alias.ts",
    "export const aliasValue = 2;\n",
  );
  await put(
    root,
    "apps/web/src/app/fixture-dynamic.mjs",
    "export default 3;\n",
  );
  await put(
    root,
    "apps/web/src/app/fixture-namespace.cjs",
    "exports.namespaceValue = 4;\n",
  );
  await put(
    root,
    "apps/web/src/app/fixture-required.js",
    "module.exports = 5;\n",
  );
  const assets = [
    ["apps/web/public/skinova/styles.css", ".skinova { color: #123456; }\n"],
    [
      "apps/web/public/skinova/assets/logo.svg",
      '<svg><path d="M0 0h1v1"/></svg>\n',
    ],
    [
      "apps/web/public/skinova/assets/fonts/site.woff2",
      Buffer.from([0, 1, 2, 255]),
    ],
  ];
  for (const [path, contents] of reverseAssets ? assets.reverse() : assets)
    await put(root, path, contents);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Wispo Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@wispo.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-10-02T09:30:00Z",
      GIT_COMMITTER_DATE: "2026-10-02T09:30:00Z",
    },
  });
  return root;
}

function commitFixture(root, message = "fixture change") {
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: root });
}

test("collector discovers every preview route class and parses real local dependencies", async () => {
  const root = await fixture();
  const { collectReleaseInputs } = await releaseModule();
  const inputs = await collectReleaseInputs({ root });
  const paths = new Set(inputs.keys());
  for (const expected of [
    ...explicitReleaseRoots,
    ...discoveredRouteEntries,
    ...buildConventionInputs,
    "apps/web/src/app/fixture-side.css",
    "apps/web/src/app/fixture-theme.css",
    "apps/web/src/app/fixture-quoted.css",
    "apps/web/src/app/fixture-plain.css",
    "apps/web/src/app/fixture-dependency/index.ts",
    "apps/web/src/fixture-alias.ts",
    "apps/web/src/app/fixture-dynamic.mjs",
    "apps/web/src/app/fixture-namespace.cjs",
    "apps/web/src/app/fixture-required.js",
    "apps/web/public/skinova/assets/fonts/site.woff2",
  ])
    assert(paths.has(expected), `missing release input: ${expected}`);
  assert.equal(paths.has("apps/web/src/app/comment-must-not-resolve.ts"), false);
  assert.equal(paths.has("apps/web/src/app/string-must-not-resolve.ts"), false);
  assert.equal(paths.has("apps/web/src/app/fixture-comment.css"), false);
});

test("opaque YAML lock and Dockerfile build inputs are framed without Babel parsing", async () => {
  const root = await fixture();
  const { collectReleaseInputs } = await releaseModule();
  const inputs = await collectReleaseInputs({ root });
  assert.match(inputs.get("pnpm-lock.yaml").toString("utf8"), /lockfileVersion/);
  assert.match(
    inputs.get("apps/web/Dockerfile").toString("utf8"),
    /^FROM node:22-alpine/m,
  );
});

test("build convention inputs are dirty-gated and committed changes alter the digest", async () => {
  const { buildTemplatePackageManifest, collectReleaseInputs } =
    await releaseModule();
  for (const path of buildConventionInputs) {
    const root = await fixture();
    await writeFile(join(root, ...path.split("/")), `dirty ${path}\n`);
    await assert.rejects(
      collectReleaseInputs({ root }),
      /незакоммиченные изменения/,
      `dirty build input was accepted: ${path}`,
    );
  }

  const root = await fixture();
  const before = await buildTemplatePackageManifest({ root });
  const configPath = join(root, "apps/web/next.config.ts");
  await writeFile(configPath, "export default { output: 'standalone' };\n");
  commitFixture(root, "change next build config");
  const after = await buildTemplatePackageManifest({ root });
  assert.notEqual(after.build.releaseDigest, before.build.releaseDigest);
});

test("dirty convention config fails before any release request", async () => {
  const root = await fixture();
  const server = await api();
  await writeFile(join(root, "apps/web/tsconfig.json"), '{"dirty":true}\n');
  const result = await cli(root, "register", server.url);
  assert.notEqual(result.status, 0);
  assert.equal(server.requests.length, 0);
});

test("unresolved real local CSS import fails closed while comments are ignored", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "apps/web/src/app/fixture-side.css"),
    [
      '/* @import url(./comment-only.css); */',
      '@import url(./missing-theme.css);',
      "",
    ].join("\n"),
  );
  commitFixture(root, "missing css import");
  const { collectReleaseInputs } = await releaseModule();
  await assert.rejects(collectReleaseInputs({ root }), /разрешить локальный import/);
});

test("rejects gitlink entries inside release scopes", async () => {
  const root = await fixture();
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const path = "apps/web/public/skinova/vendor-submodule";
  execFileSync(
    "git",
    ["update-index", "--add", "--cacheinfo", `160000,${revision},${path}`],
    { cwd: root },
  );
  execFileSync("git", ["commit", "--quiet", "-m", "gitlink input"], {
    cwd: root,
  });
  const server = await api();
  const result = await cli(root, "register", server.url);
  assert.notEqual(result.status, 0);
  assert.equal(server.requests.length, 0);
  assert.match(result.stderr, /неподдерживаем|Git entry/i);
});

test("pre-network body failure never schedules the request timeout", async () => {
  const { sendReleaseRequest } = await releaseModule();
  let scheduled = 0;
  await assert.rejects(
    sendReleaseRequest({
      operation: "register",
      request: {
        method: "POST",
        url: new URL("http://127.0.0.1:1/api"),
        body: {
          then: (_resolve, reject) => reject(new Error("body-build-failure")),
        },
      },
      token: "test-token",
      requestTimeoutMs: 2_000,
      scheduleTimeout: () => {
        scheduled += 1;
        return 1;
      },
      cancelTimeout: () => undefined,
    }),
    /body-build-failure/,
  );
  assert.equal(scheduled, 0);
});

test("rejects non-literal require and dynamic import instead of under-hashing", async () => {
  for (const expression of ["require(localPath);", "import(`./${name}.js`);"]) {
    const root = await fixture();
    await put(root, explicitReleaseRoots[1], expression);
    commitFixture(root);
    const result = await cli(root, "register", "http://127.0.0.1:1/api");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /динамический|literal|статическ/i);
  }
});

test("fails closed before networking for dirty tracked and untracked release inputs", async () => {
  const trackedRoot = await fixture();
  const trackedServer = await api();
  await writeFile(
    join(trackedRoot, ...explicitReleaseRoots[1].split("/")),
    "export default 'dirty';\n",
  );
  const tracked = await cli(trackedRoot, "register", trackedServer.url);
  assert.notEqual(tracked.status, 0);
  assert.equal(trackedServer.requests.length, 0);

  const untrackedRoot = await fixture();
  const untrackedServer = await api();
  await put(
    untrackedRoot,
    "apps/web/src/app/preview/[siteSlug]/new/page.tsx",
    "export default function NewPage() {}\n",
  );
  const untracked = await cli(untrackedRoot, "register", untrackedServer.url);
  assert.notEqual(untracked.status, 0);
  assert.equal(untrackedServer.requests.length, 0);
});

async function api(options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: raw ? JSON.parse(raw) : null,
    });
    response.writeHead(options.status ?? 200, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(
        options.response ?? {
          packageId: "skinova-media",
          packageVersion: "1",
          status: "registered",
          reasons: [],
        },
      ),
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  const address = server.address();
  assert(address && typeof address === "object");
  return { requests, url: `http://127.0.0.1:${address.port}/api` };
}

function cli(root, operation, apiUrl, overrides = {}, extraArgs = []) {
  const env = {
    ...process.env,
    WISPO_RELEASE_TOKEN: secret,
    WISPO_API_URL: apiUrl,
    WISPO_SITE_SLUG: "skinova",
    ...overrides,
  };
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete env[key];
  return new Promise((resolveResult) => {
    const child = spawn(
      process.execPath,
      [
        script,
        operation,
        ...extraArgs,
      ],
      { cwd: root, env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill(), 8_000);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolveResult({ status, signal, stdout, stderr });
    });
  });
}

test("register sends one complete manifest and never calls lifecycle endpoints", async () => {
  const root = await fixture();
  const server = await api();
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const result = await cli(root, "register", server.url);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(server.requests.length, 1);
  const [request] = server.requests;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/internal/template-packages/register");
  assert.equal(request.headers["x-wispo-release-token"], secret);
  assert.deepEqual(Object.keys(request.body), ["manifest"]);
  assert.equal(request.body.manifest.source.revision, revision);
  assert.equal(request.body.manifest.build.artifactDigest, null);
  assert.match(request.body.manifest.build.releaseDigest, /^[a-f0-9]{64}$/);
  assert.match(
    request.body.manifest.build.builtAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  );
  assert.deepEqual(request.body.manifest.templates, manifestTemplate.templates);

  const repeated = await cli(root, "register", server.url);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(server.requests.length, 2);
  assert.deepEqual(
    server.requests[1].body.manifest,
    server.requests[0].body.manifest,
  );
});

test("register v2 requires an explicit allowlisted manifest", async () => {
  const root = await fixture();
  const server = await api();

  const result = await cli(root, "register", server.url, {}, [
    "--manifest",
    "apps/web/template-packages/skinova/manifest.v2.template.json",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].body.manifest.manifestVersion, 2);
  assert.equal(server.requests[0].body.manifest.packageVersion, "2");

  const unsafe = await cli(root, "register", server.url, {}, [
    "--manifest",
    "../outside.json",
  ]);
  assert.notEqual(unsafe.status, 0);
  assert.equal(server.requests.length, 1);
});

test("managed backfill requires a site UUID and sends one protected request", async () => {
  const root = await fixture();
  const server = await api();
  const siteId = "11111111-1111-4111-8111-111111111111";

  const missing = await cli(root, "backfill-managed-content", server.url);
  assert.notEqual(missing.status, 0);
  assert.equal(server.requests.length, 0);

  const result = await cli(root, "backfill-managed-content", server.url, {}, [
    "--site-id",
    siteId,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(server.requests.length, 1);
  assert.equal(
    server.requests[0].url,
    "/api/internal/template-packages/skinova/backfill-managed-content",
  );
  assert.equal(server.requests[0].method, "POST");
  assert.equal(server.requests[0].headers["x-wispo-release-token"], secret);
  assert.deepEqual(server.requests[0].body, { siteId });
});

test("preflight and report-deployed are separate one-request operations", async () => {
  const root = await fixture();
  const server = await api({ response: { status: "ready", reasons: [] } });
  const preflight = await cli(root, "preflight", server.url, {
    WISPO_SITE_SLUG: undefined,
  });
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.deepEqual(
    server.requests.map(({ method, url }) => ({ method, url })),
    [
      {
        method: "POST",
        url: "/api/internal/sites/skinova/template-package/preflight",
      },
    ],
  );
  assert.equal(server.requests[0].headers["x-wispo-release-token"], secret);
  assert.deepEqual(server.requests[0].body, {
    packageId: "skinova-media",
    packageVersion: "1",
  });
  server.requests.length = 0;
  const report = await cli(root, "report-deployed", server.url);
  assert.equal(report.status, 0, report.stderr);
  assert.deepEqual(
    server.requests.map(({ method, url }) => ({ method, url })),
    [
      {
        method: "PUT",
        url: "/api/internal/sites/skinova/template-package/deployed",
      },
    ],
  );
  assert.equal(server.requests[0].headers["x-wispo-release-token"], secret);
  assert.deepEqual(server.requests[0].body, {
    packageId: "skinova-media",
    packageVersion: "1",
  });
});

test("release digest is stable for the same Git tree and changes for committed bytes and paths", async () => {
  const first = await fixture();
  const second = await fixture({ reverseAssets: true });
  const server = await api();
  assert.equal((await cli(first, "register", server.url)).status, 0);
  const digest = server.requests.at(-1).body.manifest.build.releaseDigest;
  const css = join(first, "apps/web/public/skinova/styles.css");
  const info = await stat(css);
  await utimes(css, info.atime, new Date(info.mtimeMs + 60_000));
  assert.equal((await cli(first, "register", server.url)).status, 0);
  assert.equal(
    server.requests.at(-1).body.manifest.build.releaseDigest,
    digest,
  );
  assert.equal((await cli(second, "register", server.url)).status, 0);
  assert.equal(server.requests.at(-1).body.manifest.build.releaseDigest, digest);

  const dependency = join(
    first,
    "apps/web/src/app/fixture-dependency/index.ts",
  );
  await writeFile(dependency, "export default 99;\n");
  commitFixture(first, "change dependency bytes");
  assert.equal((await cli(first, "register", server.url)).status, 0);
  const changedBytesDigest =
    server.requests.at(-1).body.manifest.build.releaseDigest;
  assert.notEqual(
    changedBytesDigest,
    digest,
  );
  const entrypoint = join(first, ...explicitReleaseRoots[1].split("/"));
  const entrypointSource = await readFile(entrypoint, "utf8");
  const movedDependency = join(
    first,
    "apps/web/src/app/fixture-dependency/moved.ts",
  );
  await rename(dependency, movedDependency);
  await writeFile(
    entrypoint,
    entrypointSource.replace(
      '"./fixture-dependency"',
      '"./fixture-dependency/moved"',
    ),
  );
  commitFixture(first, "move dependency path");
  assert.equal((await cli(first, "register", server.url)).status, 0);
  assert.notEqual(
    server.requests.at(-1).body.manifest.build.releaseDigest,
    changedBytesDigest,
  );
});

test("reads canonical Git blobs even when a clean checkout uses CRLF", async () => {
  const source = await fixture();
  const checkout = await mkdtemp(join(tmpdir(), "wispo-release-crlf-"));
  projects.push(checkout);
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", source, checkout]);
  execFileSync(
    "git",
    ["-c", "core.autocrlf=true", "checkout-index", "-f", "-a"],
    { cwd: checkout },
  );
  const layoutPath = join(checkout, ...explicitReleaseRoots[1].split("/"));
  assert.match(await readFile(layoutPath, "utf8"), /\r\n/);
  const { collectReleaseInputs, buildTemplatePackageManifest } =
    await releaseModule();
  const [sourceInputs, checkoutInputs] = await Promise.all([
    collectReleaseInputs({ root: source }),
    collectReleaseInputs({ root: checkout }),
  ]);
  assert.deepEqual([...checkoutInputs], [...sourceInputs]);
  assert.deepEqual(
    await buildTemplatePackageManifest({ root: checkout }),
    await buildTemplatePackageManifest({ root: source }),
  );
});

test("rejects a symlink recorded in the release Git tree", async () => {
  const root = await fixture();
  const path = "apps/web/public/skinova/assets/logo.svg";
  const index = execFileSync("git", ["ls-files", "-s", "--", path], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const objectId = index.split(/\s+/)[1];
  execFileSync(
    "git",
    ["update-index", "--add", "--cacheinfo", `120000,${objectId},${path}`],
    { cwd: root },
  );
  execFileSync("git", ["commit", "--quiet", "-m", "symlink mode"], {
    cwd: root,
  });
  const server = await api();
  const result = await cli(root, "register", server.url);
  assert.notEqual(result.status, 0);
  assert.equal(server.requests.length, 0);
  assert.match(result.stderr, /неподдерживаем|Git entry/i);
});

test("fails closed when a local transitive import cannot be resolved", async () => {
  const root = await fixture();
  const server = await api();
  const entrypoint = join(root, ...explicitReleaseRoots[1].split("/"));
  await writeFile(entrypoint, 'import "./missing-local-module";\n');
  commitFixture(root, "broken local import");
  const result = await cli(root, "register", server.url);
  assert.notEqual(result.status, 0);
  assert.equal(server.requests.length, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("requires an env token and neither accepts nor leaks a CLI token", async () => {
  const root = await fixture();
  const server = await api();
  for (const value of [undefined, "   "]) {
    const result = await cli(root, "register", server.url, {
      WISPO_RELEASE_TOKEN: value,
    });
    assert.notEqual(result.status, 0);
    assert.equal(server.requests.length, 0);
  }
  const cliSecret = "cli-secret-must-not-appear";
  const result = await cli(
    root,
    "register",
    server.url,
    { WISPO_RELEASE_TOKEN: undefined },
    [cliSecret],
  );
  assert.notEqual(result.status, 0);
  assert.equal(server.requests.length, 0);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    new RegExp(cliSecret),
  );
});

test("allowlists success output and sanitizes conflict and network errors", async () => {
  const root = await fixture();
  const text = await readFile(
    join(root, "apps/web/template-packages/skinova/manifest.template.json"),
    "utf8",
  );
  const successApi = await api({
    response: {
      packageId: "skinova-media",
      packageVersion: "1",
      status: "registered",
      token: secret,
      manifest: JSON.parse(text),
    },
  });
  const success = await cli(root, "register", successApi.url);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /skinova-media@1/);
  assert.doesNotMatch(success.stdout, new RegExp(secret));
  assert.doesNotMatch(success.stdout, /templates|repository/);
  const conflictApi = await api({
    status: 409,
    response: { message: `conflict ${secret}`, manifest: manifestTemplate },
  });
  const conflict = await cli(root, "register", conflictApi.url);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /packageVersion/i);
  assert.doesNotMatch(
    `${conflict.stdout}${conflict.stderr}`,
    new RegExp(secret),
  );
  assert.doesNotMatch(conflict.stderr, /templates|repository/);
  const closed = createServer();
  await new Promise((done) => closed.listen(0, "127.0.0.1", done));
  const address = closed.address();
  assert(address && typeof address === "object");
  await new Promise((done) => closed.close(done));
  const network = await cli(
    root,
    "register",
    `http://127.0.0.1:${address.port}/api`,
  );
  assert.notEqual(network.status, 0);
  assert.doesNotMatch(`${network.stdout}${network.stderr}`, new RegExp(secret));
  assert.doesNotMatch(network.stderr, /manifest|templates|repository/);
});

test("does not follow redirects that could forward the release token", async () => {
  const root = await fixture();
  const forwarded = [];
  const target = createServer((request, response) => {
    forwarded.push(request.headers);
    response.end("{}");
  });
  await new Promise((done) => target.listen(0, "127.0.0.1", done));
  servers.push(target);
  const targetAddress = target.address();
  assert(targetAddress && typeof targetAddress === "object");
  const redirect = createServer((_request, response) => {
    response.writeHead(307, {
      location: `http://127.0.0.1:${targetAddress.port}/captured`,
    });
    response.end();
  });
  await new Promise((done) => redirect.listen(0, "127.0.0.1", done));
  servers.push(redirect);
  const redirectAddress = redirect.address();
  assert(redirectAddress && typeof redirectAddress === "object");

  const result = await cli(
    root,
    "register",
    `http://127.0.0.1:${redirectAddress.port}/api`,
  );

  assert.notEqual(result.status, 0);
  assert.equal(forwarded.length, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});

test("aborts a server that accepts the request but never responds", async () => {
  const root = await fixture();
  const hanging = createServer(() => undefined);
  await new Promise((done) => hanging.listen(0, "127.0.0.1", done));
  servers.push(hanging);
  const address = hanging.address();
  assert(address && typeof address === "object");
  const startedAt = Date.now();

  const result = await cli(
    root,
    "register",
    `http://127.0.0.1:${address.port}/api`,
  );

  assert.notEqual(result.status, 0);
  assert.equal(
    result.signal,
    null,
    "CLI must abort itself before the harness kill",
  );
  assert(Date.now() - startedAt < 6_000, "CLI timeout took too long");
  assert.match(result.stderr, /Не удалось выполнить запрос/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
});
