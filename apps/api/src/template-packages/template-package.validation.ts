import { BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import { isIP } from 'node:net';
import {
  TEMPLATE_PACKAGE_SITE_TYPES,
  TEMPLATE_PACKAGE_TEMPLATE_KINDS,
  TEMPLATE_RUNTIME_CONTEXT_KEYS,
  type TemplatePackageManifest,
} from './template-package.types';

export const CURRENT_CMS_API_SCHEMA_VERSION = '1.2';

const VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/;
const MACHINE_KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const FULL_GIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FULL_CASE_INSENSITIVE_GIT_SHA_PATTERN =
  /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/;
const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,159}$/;
const DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const DRAFT_07_SCHEMA = 'http://json-schema.org/draft-07/schema#';
const MAX_MANIFEST_DEPTH = 50;
const MAX_MANIFEST_NODES = 50_000;
const MAX_MANIFEST_STRING_LENGTH = 100_000;
const MAX_TEMPLATES = 200;
const MAX_SLOTS_PER_TEMPLATE = 100;
const FORBIDDEN_FIELD_NAMES = new Set([
  'code',
  'codesource',
  'html',
  'htmlcode',
  'htmlsource',
  'markup',
  'markupsource',
  'jsx',
  'jsxsource',
  'tsx',
  'tsxsource',
  'css',
  'csscode',
  'csssource',
  'stylesheet',
  'stylesheetsource',
  'javascript',
  'javascriptcode',
  'javascriptsource',
  'jscode',
  'jssource',
  'script',
  'scriptbody',
  'scriptcode',
  'scriptsource',
  'source',
  'sourcebody',
  'sourcecode',
  'templatesource',
  'componentsource',
  'executable',
  'function',
  'module',
  'bundle',
]);
const FORBIDDEN_FIELD_TOKENS = new Set([
  'code',
  'html',
  'jsx',
  'tsx',
  'css',
  'js',
  'javascript',
  'script',
  'markup',
  'stylesheet',
  'executable',
  'function',
  'module',
  'bundle',
]);
const EXECUTABLE_VALUE_PATTERNS = [
  /\b(?:javascript|vbscript)\s*:/i,
  /<\/?script(?:\s|>)/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/,
  /\breturn\s+(?:window|document|globalThis)(?:\s*\.|\s*\[)/,
];

const TOP_LEVEL_FIELDS = new Set([
  'manifestVersion',
  'packageId',
  'packageVersion',
  'title',
  'siteType',
  'cmsApi',
  'source',
  'build',
  'templates',
]);
const CMS_API_FIELDS = new Set(['minSchemaVersion', 'maxSchemaVersion']);
const SOURCE_FIELDS = new Set(['repository', 'revision']);
const BUILD_FIELDS = new Set([
  'releaseDigest',
  'artifactDigest',
  'builtAt',
  'runtimeMode',
  'runtimeUrl',
]);
const TEMPLATE_FIELDS = new Set([
  'kind',
  'key',
  'version',
  'title',
  'dataScope',
  'runtimeContext',
  'dataSchemaVersion',
  'dataSchema',
  'configSchema',
  'slots',
]);
const SLOT_FIELDS = new Set([
  'key',
  'title',
  'renderer',
  'placement',
  'maxItems',
]);

function invalid(reason: string): never {
  throw new BadRequestException(`Invalid template package manifest: ${reason}`);
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_.]/g, '');
  if (FORBIDDEN_FIELD_NAMES.has(normalized)) return true;

  const tokens = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  return tokens.some((token) => FORBIDDEN_FIELD_TOKENS.has(token));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as {
    constructor?: { name?: unknown };
  } | null;
  return (
    prototype === null ||
    (Object.prototype.toString.call(value) === '[object Object]' &&
      Object.prototype.hasOwnProperty.call(prototype, 'constructor') &&
      prototype.constructor?.name === 'Object')
  );
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path} must be a plain JSON object`);
  return value;
}

function requireString(
  value: unknown,
  path: string,
  maxLength = MAX_MANIFEST_STRING_LENGTH,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${path} must be a non-empty string`);
  }
  if (value.length > maxLength) invalid(`${path} exceeds its length limit`);
  return value;
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (isForbiddenFieldName(key)) {
      invalid('source code or executable fields are not allowed');
    }
    invalid(`${path} contains an unknown field`);
  }
}

type JsonScanState = { seen: WeakSet<object>; nodes: number };

function assertSafeJson(
  value: unknown,
  state?: JsonScanState,
  depth = 0,
): void {
  const scan = state ?? { seen: new WeakSet<object>(), nodes: 0 };
  scan.nodes += 1;
  if (scan.nodes > MAX_MANIFEST_NODES)
    invalid('manifest exceeds its node count limit');
  if (depth > MAX_MANIFEST_DEPTH) invalid('manifest exceeds its depth limit');
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_MANIFEST_STRING_LENGTH) {
      invalid('manifest string exceeds its length limit');
    }
    if (EXECUTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      invalid('source code or executable values are not allowed');
    }
    return;
  }
  if (typeof value !== 'object') {
    invalid('source code or executable values are not allowed');
  }
  if (scan.seen.has(value))
    invalid('source code or executable values are not allowed');
  scan.seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertSafeJson(item, scan, depth + 1);
    return;
  }
  if (!isRecord(value)) invalid('manifest values must be plain JSON objects');
  for (const [key, nested] of Object.entries(value)) {
    const isRequiredManifestSource = depth === 0 && key === 'source';
    if (isForbiddenFieldName(key) && !isRequiredManifestSource) {
      invalid('source code or executable fields are not allowed');
    }
    if (
      key === '$ref' &&
      (typeof nested !== 'string' || !nested.startsWith('#'))
    ) {
      invalid('remote JSON Schema references are not allowed');
    }
    assertSafeJson(nested, scan, depth + 1);
  }
}

function parseVersion(value: unknown, path: string, maxLength = 40): number[] {
  const version = requireString(value, path, maxLength);
  if (!VERSION_PATTERN.test(version))
    invalid(`${path} has invalid version syntax`);
  const segments = version.split('.').map(Number);
  if (segments.some((segment) => !Number.isSafeInteger(segment))) {
    invalid(`${path} has invalid version syntax`);
  }
  return segments;
}

function compareVersions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isSafeSourceRevision(revision: string): boolean {
  if (FULL_GIT_SHA_PATTERN.test(revision)) return true;
  if (FULL_CASE_INSENSITIVE_GIT_SHA_PATTERN.test(revision)) return false;
  if (!SAFE_GIT_REF_PATTERN.test(revision)) return false;
  if (
    revision.includes('..') ||
    revision.includes('//') ||
    revision.includes('@{')
  ) {
    return false;
  }
  const segments = revision.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      !segment.startsWith('.') &&
      !segment.endsWith('.') &&
      !segment.toLowerCase().endsWith('.lock'),
  );
}

function assertCanonicalUtcDateTime(value: unknown, path: string): void {
  const dateTime = requireString(value, path, 40);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{3})?Z$/.exec(
    dateTime,
  );
  if (!match) invalid(`${path} is invalid`);
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) invalid(`${path} is invalid`);
  const canonical = match[2]
    ? parsed.toISOString()
    : parsed.toISOString().replace('.000Z', 'Z');
  if (canonical !== dateTime) invalid(`${path} is invalid`);
}

function assertMachineKey(
  value: unknown,
  path: string,
  maxLength: number,
): string {
  const key = requireString(value, path, maxLength);
  if (!MACHINE_KEY_PATTERN.test(key)) invalid(`${path} is invalid`);
  return key;
}

function parseSafeUrl(
  value: unknown,
  path: string,
  protocols: readonly string[],
  maxLength: number,
): URL {
  const raw = requireString(value, path, maxLength);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalid(`${path} URL is invalid`);
  }
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    invalid(`${path} URL is unsafe`);
  }
  return parsed;
}

function assertPublicRuntimeUrl(value: unknown): void {
  const parsed = parseSafeUrl(
    value,
    'build.runtimeUrl',
    ['http:', 'https:'],
    500,
  );
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
  const ipVersion = isIP(hostname);
  if (
    hostname.length === 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    (!ipVersion && !hostname.includes('.')) ||
    ipVersion !== 0
  ) {
    invalid('build.runtimeUrl URL must be public');
  }
}

function assertDraft07Schema(value: unknown, path: string, ajv: Ajv): void {
  const schema = requireRecord(value, path);
  if (schema.$schema !== DRAFT_07_SCHEMA) {
    invalid(`${path} JSON Schema must declare draft-07`);
  }
  try {
    ajv.compile(schema);
  } catch {
    invalid(`${path} JSON Schema does not compile as draft-07`);
  }
}

export function assertValidTemplatePackageManifest(
  input: unknown,
): TemplatePackageManifest {
  assertSafeJson(input);
  const manifest = requireRecord(input, 'manifest');
  assertExactFields(manifest, TOP_LEVEL_FIELDS, 'manifest');

  if (manifest.manifestVersion !== 1) invalid('manifestVersion must be 1');
  assertMachineKey(manifest.packageId, 'packageId', 100);
  parseVersion(manifest.packageVersion, 'packageVersion', 100);
  requireString(manifest.title, 'title', 160);
  if (!TEMPLATE_PACKAGE_SITE_TYPES.includes(manifest.siteType as never)) {
    invalid('siteType is invalid');
  }

  const cmsApi = requireRecord(manifest.cmsApi, 'cmsApi');
  assertExactFields(cmsApi, CMS_API_FIELDS, 'cmsApi');
  const minSchemaVersion = parseVersion(
    cmsApi.minSchemaVersion,
    'cmsApi.minSchemaVersion',
  );
  const maxSchemaVersion =
    cmsApi.maxSchemaVersion === undefined
      ? undefined
      : parseVersion(cmsApi.maxSchemaVersion, 'cmsApi.maxSchemaVersion');
  const currentSchemaVersion = parseVersion(
    CURRENT_CMS_API_SCHEMA_VERSION,
    'current CMS API schema',
  );
  if (
    (maxSchemaVersion &&
      compareVersions(minSchemaVersion, maxSchemaVersion) > 0) ||
    compareVersions(minSchemaVersion, currentSchemaVersion) > 0 ||
    (maxSchemaVersion &&
      compareVersions(currentSchemaVersion, maxSchemaVersion) > 0)
  ) {
    invalid('CMS API schema range is incompatible');
  }

  const source = requireRecord(manifest.source, 'source');
  assertExactFields(source, SOURCE_FIELDS, 'source');
  parseSafeUrl(source.repository, 'source.repository', ['https:'], 500);
  const revision = requireString(source.revision, 'source.revision', 160);
  if (!isSafeSourceRevision(revision)) invalid('source.revision is invalid');

  const build = requireRecord(manifest.build, 'build');
  assertExactFields(build, BUILD_FIELDS, 'build');
  const releaseDigest = requireString(
    build.releaseDigest,
    'build.releaseDigest',
    128,
  );
  if (!DIGEST_PATTERN.test(releaseDigest))
    invalid('build.releaseDigest is invalid');
  if (build.artifactDigest !== undefined && build.artifactDigest !== null) {
    const artifactDigest = requireString(
      build.artifactDigest,
      'build.artifactDigest',
      128,
    );
    if (!DIGEST_PATTERN.test(artifactDigest)) {
      invalid('build.artifactDigest is invalid');
    }
  }
  assertCanonicalUtcDateTime(build.builtAt, 'build.builtAt');
  if (
    build.runtimeMode !== 'embedded-next' &&
    build.runtimeMode !== 'external'
  ) {
    invalid('build.runtimeMode is invalid');
  }
  if (build.runtimeMode === 'embedded-next' && build.runtimeUrl !== undefined) {
    invalid('embedded-next build cannot declare a runtime URL');
  }
  if (build.runtimeUrl !== undefined) assertPublicRuntimeUrl(build.runtimeUrl);

  if (
    !Array.isArray(manifest.templates) ||
    manifest.templates.length === 0 ||
    manifest.templates.length > MAX_TEMPLATES
  ) {
    invalid('templates must satisfy the count limit');
  }
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    validateSchema: true,
    allowUnionTypes: true,
  });
  const identities = new Set<string>();
  const renderers = new Set<string>();
  for (const [index, rawTemplate] of manifest.templates.entries()) {
    const path = `templates[${index}]`;
    const template = requireRecord(rawTemplate, path);
    assertExactFields(template, TEMPLATE_FIELDS, path);
    if (!TEMPLATE_PACKAGE_TEMPLATE_KINDS.includes(template.kind as never)) {
      invalid(`${path}.kind is invalid`);
    }
    const key = assertMachineKey(template.key, `${path}.key`, 80);
    const version = requireString(template.version, `${path}.version`, 40);
    parseVersion(version, `${path}.version`);
    requireString(template.title, `${path}.title`, 160);
    if (template.dataScope !== 'cms-entity')
      invalid(`${path}.dataScope is invalid`);
    const identity = `${String(template.kind)}:${key}:${version}`;
    if (identities.has(identity)) invalid('duplicate template identity');
    identities.add(identity);

    if (
      !Array.isArray(template.runtimeContext) ||
      template.runtimeContext.length > TEMPLATE_RUNTIME_CONTEXT_KEYS.length
    ) {
      invalid(`${path}.runtimeContext must be an array`);
    }
    const contextKeys = new Set<string>();
    for (const contextKey of template.runtimeContext) {
      if (!TEMPLATE_RUNTIME_CONTEXT_KEYS.includes(contextKey as never)) {
        invalid(`${path}.runtimeContext is invalid`);
      }
      if (contextKeys.has(String(contextKey))) {
        invalid(`${path}.runtimeContext contains a duplicate`);
      }
      contextKeys.add(String(contextKey));
    }
    parseVersion(template.dataSchemaVersion, `${path}.dataSchemaVersion`, 40);
    assertDraft07Schema(template.dataSchema, `${path}.dataSchema`, ajv);
    if (template.configSchema !== undefined) {
      assertDraft07Schema(template.configSchema, `${path}.configSchema`, ajv);
    }

    if (template.slots === undefined) continue;
    if (
      !Array.isArray(template.slots) ||
      template.slots.length > MAX_SLOTS_PER_TEMPLATE
    ) {
      invalid(`${path}.slots exceeds its count limit`);
    }
    const slotKeys = new Set<string>();
    for (const [slotIndex, rawSlot] of template.slots.entries()) {
      const slotPath = `${path}.slots[${slotIndex}]`;
      const slot = requireRecord(rawSlot, slotPath);
      assertExactFields(slot, SLOT_FIELDS, slotPath);
      const slotKey = assertMachineKey(slot.key, `${slotPath}.key`, 80);
      if (slotKeys.has(slotKey)) invalid('duplicate slot key');
      slotKeys.add(slotKey);
      requireString(slot.title, `${slotPath}.title`, 160);
      const renderer = assertMachineKey(
        slot.renderer,
        `${slotPath}.renderer`,
        100,
      );
      assertMachineKey(slot.placement, `${slotPath}.placement`, 80);
      if (renderers.has(renderer)) invalid('duplicate renderer key');
      renderers.add(renderer);
      if (
        slot.maxItems !== undefined &&
        (!Number.isSafeInteger(slot.maxItems) || Number(slot.maxItems) < 1)
      ) {
        invalid(`${slotPath}.maxItems is invalid`);
      }
    }
  }

  return manifest as TemplatePackageManifest;
}
