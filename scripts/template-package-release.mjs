#!/usr/bin/env node

import { parse } from "@babel/parser";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultProjectRoot = process.cwd();
const manifestPath =
  "apps/web/template-packages/skinova/manifest.template.json";
const publicRoot = "apps/web/public/skinova";
const previewRoot = "apps/web/src/app/preview/[siteSlug]";
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
export const SKINOVA_RELEASE_ENTRYPOINTS = [
  "apps/web/src/proxy.ts",
  "apps/web/src/app/layout.tsx",
  "apps/web/src/app/banner-preview/page.tsx",
  "apps/web/src/app/skinova-banner-preview-frame.tsx",
  "apps/web/src/app/template-runtime-catalog.ts",
  "apps/web/src/app/template-runtime-registry.tsx",
];
const nextEntryPattern =
  /\/(?:page|route|layout|not-found|error|loading|template)\.(?:[cm]?[jt]sx?)$/;
const sourceExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
];
const dependencyScanExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const requestTimeoutMs = 2_000;
const operations = new Set(["register", "preflight", "report-deployed"]);

class SafeCliError extends Error {}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function addFramed(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

function gitBuffer(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    throw new SafeCliError("Не удалось прочитать Git tree релиза.");
  }
}

function gitOutput(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

function gitTree(root, revision) {
  const entries = new Map();
  const records = gitBuffer(root, [
    "ls-tree",
    "-r",
    "-z",
    revision,
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const record of records) {
    const match = /^(\d+) ([a-z]+) ([a-f0-9]+)\t(.+)$/.exec(record);
    if (match)
      entries.set(match[4], {
        mode: match[1],
        type: match[2],
        objectId: match[3],
      });
  }
  return entries;
}

function requireGitBlob(root, revision, tree, path) {
  const entry = tree.get(path);
  if (!entry)
    throw new SafeCliError(
      "Не найден обязательный файл Skinova release inputs в Git tree.",
    );
  if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
    throw new SafeCliError(
      "Release inputs содержат неподдерживаемый Git entry.",
    );
  return gitBuffer(root, ["cat-file", "blob", `${revision}:${path}`]);
}

function cssImportSpecifiers(source) {
  const values = [];
  const isQuote = (character) => character === "\"" || character === "'";
  const readQuoted = (start) => {
    const quote = source[start];
    let value = "";
    for (let index = start + 1; index < source.length; index += 1) {
      if (source[index] === "\\") {
        value += source[index + 1] ?? "";
        index += 1;
      } else if (source[index] === quote) return { value, end: index + 1 };
      else value += source[index];
    }
    return null;
  };
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (isQuote(source[index])) {
      const quoted = readQuoted(index);
      if (quoted) index = quoted.end - 1;
      continue;
    }
    if (source.slice(index, index + 7).toLowerCase() !== "@import") continue;
    const boundary = source[index + 7];
    if (boundary && !/\s|["']/.test(boundary)) continue;
    let cursor = index + 7;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    let value;
    if (source.slice(cursor, cursor + 4).toLowerCase() === "url(") {
      cursor += 4;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (isQuote(source[cursor])) {
        const quoted = readQuoted(cursor);
        if (!quoted) continue;
        value = quoted.value;
        cursor = quoted.end;
        while (/\s/.test(source[cursor] ?? "")) cursor += 1;
        if (source[cursor] !== ")") continue;
      } else {
        const end = source.indexOf(")", cursor);
        if (end === -1) continue;
        value = source.slice(cursor, end).trim();
        cursor = end;
      }
    } else if (isQuote(source[cursor])) {
      const quoted = readQuoted(cursor);
      if (!quoted) continue;
      value = quoted.value;
      cursor = quoted.end - 1;
    } else continue;
    if (value) values.push(value);
    index = cursor;
  }
  return values;
}

function localSpecifiers(source, path) {
  const values = new Set();
  if (path.endsWith(".css"))
    return cssImportSpecifiers(source).filter(
      (specifier) => specifier.startsWith(".") || specifier.startsWith("@/"),
    );
  if (!dependencyScanExtensions.has(posix.extname(path))) return [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      plugins: [
        "typescript",
        "jsx",
        "dynamicImport",
        "importAttributes",
        "decorators-legacy",
      ],
    });
  } catch {
    throw new SafeCliError(
      "Не удалось безопасно разобрать JavaScript/TypeScript release input.",
    );
  }
  const addLiteral = (node, dynamic = false) => {
    if (node?.type === "StringLiteral") {
      values.add(node.value);
      return;
    }
    if (dynamic)
      throw new SafeCliError(
        "Динамический import/require release input должен содержать статический строковый literal.",
      );
  };
  const stack = [ast.program];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    )
      addLiteral(node.source);
    else if (node.type === "ImportExpression")
      addLiteral(node.source, true);
    else if (node.type === "CallExpression") {
      const isRequire =
        node.callee?.type === "Identifier" && node.callee.name === "require";
      const isImport = node.callee?.type === "Import";
      if (isRequire || isImport) {
        if (node.arguments.length !== 1)
          throw new SafeCliError(
            "Динамический import/require release input должен содержать один строковый literal.",
          );
        addLiteral(node.arguments[0], true);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (["loc", "start", "end", "extra"].includes(key)) continue;
      if (Array.isArray(child)) stack.push(...child);
      else if (child && typeof child === "object") stack.push(child);
    }
  }
  return [...values].filter(
    (specifier) => specifier.startsWith(".") || specifier.startsWith("@/"),
  );
}

function resolveLocalImport(tree, importerPath, specifier) {
  const unresolved = specifier.startsWith("@/")
    ? posix.join("apps/web/src", specifier.slice(2))
    : posix.normalize(posix.join(posix.dirname(importerPath), specifier));
  if (unresolved === ".." || unresolved.startsWith("../"))
    throw new SafeCliError(
      "Локальный import Skinova выходит за пределы проекта.",
    );
  const candidates = posix.extname(unresolved)
    ? [unresolved]
    : [
        unresolved,
        ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
        ...sourceExtensions.map((extension) =>
          posix.join(unresolved, `index${extension}`),
        ),
      ];
  for (const candidate of candidates) {
    if (!tree.has(candidate)) continue;
    const path = candidate;
    if (
      /(^|\/)(?:node_modules|\.next|dist|build|test-results)(\/|$)/.test(
        path,
      ) ||
      /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
    )
      throw new SafeCliError(
        "Локальный import Skinova ведёт в исключённый путь.",
      );
    return path;
  }
  throw new SafeCliError("Не удалось разрешить локальный import Skinova.");
}

function assertCleanReleaseInputs(root, paths) {
  const dirty = gitBuffer(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ...paths,
  ]);
  if (dirty.length)
    throw new SafeCliError(
      "Frontend-релиз запрещён: release inputs содержат незакоммиченные изменения.",
    );
}

function assertSupportedReleaseEntries(tree) {
  const exact = new Set([
    manifestPath,
    ...SKINOVA_RELEASE_ENTRYPOINTS,
    ...buildConventionInputs,
  ]);
  for (const [path, entry] of tree) {
    const inDirectory =
      path.startsWith(`${publicRoot}/`) || path.startsWith(`${previewRoot}/`);
    if (!inDirectory && !exact.has(path)) continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new SafeCliError(
        "Release inputs содержат неподдерживаемый Git entry.",
      );
  }
}

export async function collectReleaseInputs({
  root = defaultProjectRoot,
  revision = gitIdentity(root).revision,
} = {}) {
  const tree = gitTree(root, revision);
  assertSupportedReleaseEntries(tree);
  const inputs = new Map();
  const discoveredEntries = [...tree.keys()].filter(
    (path) => path.startsWith(`${previewRoot}/`) && nextEntryPattern.test(path),
  );
  const queue = [
    ...SKINOVA_RELEASE_ENTRYPOINTS,
    ...buildConventionInputs,
    ...discoveredEntries,
  ];
  const queued = new Set(queue);
  while (queue.length) {
    const path = queue.shift();
    const bytes = requireGitBlob(root, revision, tree, path);
    inputs.set(path, bytes);
    const source = bytes.toString("utf8");
    for (const specifier of localSpecifiers(source, path)) {
      const importedPath = resolveLocalImport(tree, path, specifier);
      if (!queued.has(importedPath)) {
        queued.add(importedPath);
        queue.push(importedPath);
      }
    }
  }
  const publicFiles = [...tree.keys()].filter((path) =>
    path.startsWith(`${publicRoot}/`),
  );
  if (!publicFiles.length)
    throw new SafeCliError(
      "Каталог public/skinova не содержит release inputs.",
    );
  for (const path of publicFiles)
    inputs.set(path, requireGitBlob(root, revision, tree, path));
  assertCleanReleaseInputs(root, [
    manifestPath,
    publicRoot,
    previewRoot,
    ...SKINOVA_RELEASE_ENTRYPOINTS,
    ...buildConventionInputs,
    ...inputs.keys(),
  ]);
  if (gitIdentity(root).revision !== revision)
    throw new SafeCliError("Git HEAD изменился во время сборки manifest.");
  return new Map(
    [...inputs.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

async function readManifestTemplate(
  root = defaultProjectRoot,
  revision = gitIdentity(root).revision,
) {
  try {
    const tree = gitTree(root, revision);
    return JSON.parse(
      requireGitBlob(root, revision, tree, manifestPath).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof SafeCliError) throw error;
    throw new SafeCliError(
      "Manifest template Skinova содержит некорректный JSON.",
    );
  }
}

export function canonicalGitBuiltAt(value) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()))
    throw new SafeCliError("Git metadata релиза имеет некорректный формат.");
  return timestamp.toISOString();
}

function gitIdentity(root) {
  const revision = gitOutput(root, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40,64}$/.test(revision))
    throw new SafeCliError("Git metadata релиза имеет некорректный формат.");
  const committedAt = gitOutput(root, [
    "show",
    "-s",
    "--format=%cI",
    revision,
  ]);
  return { revision, builtAt: canonicalGitBuiltAt(committedAt) };
}

function manifestBeforeDigest(template, revision) {
  const source = { ...template.source };
  const build = { ...template.build };
  delete source.revision;
  delete build.releaseDigest;
  delete build.artifactDigest;
  delete build.builtAt;
  return {
    ...template,
    source: { ...source, revision },
    build: { ...build, artifactDigest: null },
  };
}

async function releaseDigest(root, revision, manifest) {
  const inputs = await collectReleaseInputs({ root, revision });
  inputs.set(
    manifestPath,
    Buffer.from(JSON.stringify(canonicalize(manifest)), "utf8"),
  );
  const hash = createHash("sha256");
  hash.update("wispo-template-package-release-v1\0", "utf8");
  for (const [path, bytes] of [...inputs.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    addFramed(hash, path);
    addFramed(hash, bytes);
  }
  return hash.digest("hex");
}

async function completeManifest(root, template, { revision, builtAt }) {
  const withoutFinalBuildFields = manifestBeforeDigest(template, revision);
  return {
    ...withoutFinalBuildFields,
    build: {
      ...withoutFinalBuildFields.build,
      releaseDigest: await releaseDigest(
        root,
        revision,
        withoutFinalBuildFields,
      ),
      builtAt,
    },
  };
}

export async function buildTemplatePackageManifest({
  root = defaultProjectRoot,
} = {}) {
  const identity = gitIdentity(root);
  return completeManifest(
    root,
    await readManifestTemplate(root, identity.revision),
    identity,
  );
}

function releaseToken() {
  const token = process.env.WISPO_RELEASE_TOKEN?.trim();
  if (!token)
    throw new SafeCliError(
      "WISPO_RELEASE_TOKEN должен быть задан в окружении.",
    );
  return token;
}

function apiBaseUrl(env) {
  let url;
  try {
    url = new URL(env.WISPO_API_URL?.trim() || "http://127.0.0.1:4300/api");
  } catch {
    throw new SafeCliError("WISPO_API_URL содержит некорректный URL.");
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new SafeCliError(
      "WISPO_API_URL должен быть безопасным HTTP(S) URL без credentials, query и fragment.",
    );
  if (
    url.protocol === "http:" &&
    !["127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  )
    throw new SafeCliError(
      "WISPO_API_URL разрешает HTTP только для точного loopback-адреса.",
    );
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function siteSlug(env) {
  const slug = env.WISPO_SITE_SLUG?.trim() || "skinova";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new SafeCliError("WISPO_SITE_SLUG содержит небезопасное значение.");
  return slug;
}

export function releaseConfiguration(env = process.env) {
  return {
    apiUrl: apiBaseUrl(env).href,
    siteSlug: siteSlug(env),
    requestTimeoutMs,
  };
}

function operationRequest(
  operation,
  template,
  baseUrl,
  slugValue,
  root,
  identity,
) {
  const reference = {
    packageId: template.packageId,
    packageVersion: template.packageVersion,
  };
  if (operation === "register") {
    return {
      method: "POST",
      url: new URL("internal/template-packages/register", baseUrl),
      body: completeManifest(root, template, identity).then((manifest) => ({
        manifest,
      })),
    };
  }
  const slug = encodeURIComponent(slugValue);
  return {
    method: operation === "preflight" ? "POST" : "PUT",
    url: new URL(
      `internal/sites/${slug}/template-package/${operation === "preflight" ? "preflight" : "deployed"}`,
      baseUrl,
    ),
    body: Promise.resolve(reference),
  };
}

export async function sendReleaseRequest({
  operation,
  request,
  token,
  requestTimeoutMs,
  fetchImpl = fetch,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}) {
  const body = JSON.stringify(await request.body);
  const controller = new AbortController();
  const timeout = scheduleTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: {
        "content-type": "application/json",
        "x-wispo-release-token": token,
      },
      body,
      redirect: "error",
      signal: controller.signal,
    });
    await response.body?.cancel();
  } catch {
    throw new SafeCliError("Не удалось выполнить запрос к Wispo API.");
  } finally {
    cancelTimeout(timeout);
  }
  if (response.status === 409 && operation === "register")
    throw new SafeCliError(
      "packageVersion уже зарегистрирована с другим содержимым; увеличьте packageVersion в manifest template.",
    );
  if (!response.ok)
    throw new SafeCliError(
      `Wispo API отклонил операцию (HTTP ${response.status}).`,
    );
}

async function send(operation, template, token, root, identity) {
  const config = releaseConfiguration();
  return sendReleaseRequest({
    operation,
    request: operationRequest(
      operation,
      template,
      new URL(config.apiUrl),
      config.siteSlug,
      root,
      identity,
    ),
    token,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

export async function runCli({ root = defaultProjectRoot } = {}) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !operations.has(args[0]))
    throw new SafeCliError(
      "Использование: template-package-release.mjs <register|preflight|report-deployed>.",
    );
  const operation = args[0];
  const token = releaseToken();
  const identity = gitIdentity(root);
  const template = await readManifestTemplate(root, identity.revision);
  if (operation !== "register")
    await collectReleaseInputs({ root, revision: identity.revision });
  await send(operation, template, token, root, identity);
  process.stdout.write(
    `${operation}: ${template.packageId}@${template.packageVersion}\n`,
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await runCli();
  } catch (error) {
    const message =
      error instanceof SafeCliError
        ? error.message
        : "Операция frontend-релиза завершилась ошибкой.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
