import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RegisterTemplatePackageDto } from './template-package.dto';
import {
  assertValidTemplatePackageManifest,
  CURRENT_CMS_API_SCHEMA_VERSION,
} from './template-package.validation';
import type { TemplatePackageManifest } from './template-package.types';

const manifestTemplate = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../web/template-packages/skinova/manifest.template.json',
    ),
    'utf8',
  ),
) as Record<string, unknown>;

function validSkinovaManifest(): TemplatePackageManifest {
  return structuredClone({
    ...manifestTemplate,
    source: {
      ...(manifestTemplate.source as Record<string, unknown>),
      revision: 'b'.repeat(40),
    },
    build: {
      ...(manifestTemplate.build as Record<string, unknown>),
      releaseDigest: 'a'.repeat(64),
      artifactDigest: null,
      builtAt: '2026-10-02T12:00:00.000Z',
    },
  }) as TemplatePackageManifest;
}

describe('template package manifest validation', () => {
  it('accepts the finalized Skinova manifest against CMS schema 1.2', () => {
    expect(CURRENT_CMS_API_SCHEMA_VERSION).toBe('1.2');
    const manifest = validSkinovaManifest();

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it('accepts an omitted optional artifact digest', () => {
    const manifest = validSkinovaManifest();
    delete manifest.build.artifactDigest;

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it('rejects duplicate template identities', () => {
    const manifest = validSkinovaManifest();
    manifest.templates.push(structuredClone(manifest.templates[0]));

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /identity/i,
    );
  });

  it('rejects duplicate renderer keys across slots', () => {
    const manifest = validSkinovaManifest();
    manifest.templates[2].slots = [
      {
        key: 'second_sidebar',
        title: 'Duplicate renderer',
        renderer: manifest.templates[0].slots![0].renderer,
        placement: 'article_sidebar',
        maxItems: 1,
      },
    ];

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /renderer/i,
    );
  });

  it('rejects duplicate slot keys within one template', () => {
    const manifest = validSkinovaManifest();
    manifest.templates[0].slots!.push({
      key: manifest.templates[0].slots![0].key,
      title: 'Duplicate slot',
      renderer: 'unique-renderer',
      placement: 'homepage_middle',
      maxItems: 1,
    });

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /slot key/i,
    );
  });

  it.each([
    [
      'package version',
      (value: TemplatePackageManifest) => (value.packageVersion = 'v1'),
    ],
    [
      'template version',
      (value: TemplatePackageManifest) =>
        (value.templates[0].version = '1.0-beta'),
    ],
    [
      'schema version',
      (value: TemplatePackageManifest) =>
        (value.templates[0].dataSchemaVersion = '01'),
    ],
    [
      'unsafe numeric version segment',
      (value: TemplatePackageManifest) =>
        (value.packageVersion = '99999999999999999999'),
    ],
  ])('rejects invalid %s syntax', (_label, mutate) => {
    const manifest = validSkinovaManifest();
    mutate(manifest);

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /version/i,
    );
  });

  it.each([
    ['2.0', undefined],
    ['1.0', '1.1'],
    ['1.2', '1.1'],
  ])(
    'rejects incompatible CMS schema range %s..%s',
    (minSchemaVersion, maxSchemaVersion) => {
      const manifest = validSkinovaManifest();
      manifest.cmsApi =
        maxSchemaVersion === undefined
          ? { minSchemaVersion }
          : { minSchemaVersion, maxSchemaVersion };

      expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
        /CMS API/i,
      );
    },
  );

  it('compares multi-digit CMS schema segments numerically', () => {
    const manifest = validSkinovaManifest();
    manifest.cmsApi = { minSchemaVersion: '1.2', maxSchemaVersion: '1.10' };

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it.each([
    [
      'source field',
      (value: TemplatePackageManifest) =>
        Object.assign(value.templates[0], { sourceCode: '<Hero />' }),
    ],
    [
      'nested HTML field',
      (value: TemplatePackageManifest) =>
        Object.assign(value.templates[0].dataSchema.properties as object, {
          html: { type: 'string' },
        }),
    ],
    [
      'executable string',
      (value: TemplatePackageManifest) =>
        Object.assign(value.templates[0].configSchema!, {
          description: 'javascript:alert(document.cookie)',
        }),
    ],
    [
      'function value',
      (value: TemplatePackageManifest) =>
        Object.assign(value.build, { task: () => true }),
    ],
  ])('rejects executable or source-code content: %s', (_label, mutate) => {
    const manifest = validSkinovaManifest();
    mutate(manifest);

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /source code|executable/i,
    );
  });

  it.each([
    'code',
    'source',
    'sourceBody',
    'codeSource',
    'htmlCode',
    'jsCode',
    'javascriptCode',
    'cssCode',
    'scriptBody',
    'scriptSource',
    'htmlSource',
    'jsSource',
    'javascriptSource',
    'cssSource',
    'rawHtml',
    'templateHtml',
    'componentJsx',
    'component_tsx',
    'inline-script',
    'cardMarkup',
  ])('rejects the executable/source field %s', (field) => {
    const manifest = validSkinovaManifest();
    const dataSchema = manifest.templates[0].dataSchema as Record<
      string,
      unknown
    >;
    const properties = (dataSchema.properties ??= {}) as Record<
      string,
      unknown
    >;
    properties[field] = { type: 'string' };

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /source code|executable/i,
    );
  });

  it.each([
    '<strong>Editorial emphasis</strong>',
    'The migration maps A => B.',
    'The documentation may mention require(packageName).',
  ])('accepts harmless prose in schema descriptions: %s', (description) => {
    const manifest = validSkinovaManifest();
    Object.assign(manifest.templates[0].dataSchema, { description });

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it('allows harmless sourceUrl and postcode data properties', () => {
    const manifest = validSkinovaManifest();
    manifest.templates[0].dataSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        sourceUrl: { type: 'string' },
        postcode: { type: 'string' },
      },
    };

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it.each([
    'javascript:alert(1)',
    'vbscript:msgbox(1)',
    '<script>alert(1)</script>',
    'eval(userInput)',
    'Function(userInput)',
    'return window.alert(1)',
  ])('rejects a high-confidence executable value: %s', (description) => {
    const manifest = validSkinovaManifest();
    Object.assign(manifest.templates[0].dataSchema, { description });

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /source code|executable/i,
    );
  });

  it.each([
    'git@github.com:ArtemCrazy/wispocms.git',
    'ftp://github.com/ArtemCrazy/wispocms.git',
    'https://user:secret@github.com/ArtemCrazy/wispocms.git',
    'https://github.com/ArtemCrazy/wispocms.git?access_token=secret',
    'https://github.com/ArtemCrazy/wispocms.git#access-token-secret',
  ])('rejects unsafe repository URL %s', (repository) => {
    const manifest = validSkinovaManifest();
    manifest.source.repository = repository;

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(/URL/i);
  });

  it.each([
    'http://localhost:3000/preview',
    'http://127.0.0.1/preview',
    'http://10.0.0.1/preview',
    'http://172.16.0.1/preview',
    'http://192.168.1.10/preview',
    'http://169.254.1.1/preview',
    'http://[::1]/preview',
    'http://[fe80::1]/preview',
    'http://[fc00::1]/preview',
    'http://8.8.8.8/preview',
    'http://2130706433/preview',
    'https://preview.internal/preview',
    'http://localhost.:3000/preview',
    'https://preview.internal./preview',
    'https://user:secret@example.com/preview',
    'https://preview.example.com/runtime?access_token=secret',
    'https://preview.example.com/runtime#access-token-secret',
  ])('rejects credentialed/private runtime URL %s', (runtimeUrl) => {
    const manifest = validSkinovaManifest();
    manifest.build = {
      ...manifest.build,
      runtimeMode: 'external',
      runtimeUrl,
    };

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(/URL/i);
  });

  it('accepts repository and external runtime URL paths with explicit ports', () => {
    const manifest = validSkinovaManifest();
    manifest.source.repository =
      'https://github.com:8443/ArtemCrazy/wispocms.git';
    manifest.build = {
      ...manifest.build,
      runtimeMode: 'external',
      runtimeUrl: 'https://preview.example.com:8443/releases/skinova',
    };

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it.each(['2026-10-02T12:00:00Z', '2026-10-02T12:00:00.123Z'])(
    'accepts canonical UTC build time %s',
    (builtAt) => {
      const manifest = validSkinovaManifest();
      manifest.build.builtAt = builtAt;

      expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
    },
  );

  it.each([
    '2026-02-30T12:00:00Z',
    '2026-10-02T24:00:00Z',
    '2026-10-02T12:00:00.12Z',
  ])('rejects non-canonical or impossible UTC build time %s', (builtAt) => {
    const manifest = validSkinovaManifest();
    manifest.build.builtAt = builtAt;

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /builtAt/i,
    );
  });

  it.each([
    'a'.repeat(40),
    'b'.repeat(64),
    'main',
    'refs/tags/v1.2.3',
    'release/2026-10-02',
  ])('accepts a full lowercase SHA or safe Git ref: %s', (revision) => {
    const manifest = validSkinovaManifest();
    manifest.source.revision = revision;

    expect(assertValidTemplatePackageManifest(manifest)).toBe(manifest);
  });

  it.each([
    'A'.repeat(40),
    'feature..branch',
    'feature//branch',
    'feature@{1}',
    'feature\\branch',
    'feature~1',
    'feature^1',
    'feature:one',
    'feature?one',
    'feature*one',
    'feature[one',
    'feature\u0001one',
    '/feature',
    'feature/',
    '.feature',
    'feature.',
    'feature.lock',
    'release/.',
    'release/..',
    'release/.hidden',
  ])('rejects an unsafe Git revision: %s', (revision) => {
    const manifest = validSkinovaManifest();
    manifest.source.revision = revision;

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /source\.revision/i,
    );
  });

  it('rejects remote JSON Schema references without attempting network access', () => {
    const manifest = validSkinovaManifest();
    manifest.templates[0].dataSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: 'https://attacker.example/schema.json',
    };

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /remote JSON Schema/i,
    );
  });

  it('rejects objects with a custom prototype as non-JSON input', () => {
    const manifest = validSkinovaManifest();
    Object.setPrototypeOf(manifest, { polluted: true });

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /plain JSON object/i,
    );
  });

  it.each([
    [
      'DB-sized package id',
      (value: TemplatePackageManifest) => (value.packageId = 'a'.repeat(101)),
    ],
    [
      'template count',
      (value: TemplatePackageManifest) =>
        (value.templates = Array.from({ length: 201 }, () =>
          structuredClone(value.templates[0]),
        )),
    ],
    [
      'individual string',
      (value: TemplatePackageManifest) => (value.title = 'a'.repeat(100_001)),
    ],
  ])('rejects manifests exceeding the %s bound', (_label, mutate) => {
    const manifest = validSkinovaManifest();
    mutate(manifest);

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /limit|length|count/i,
    );
  });

  it.each([
    { type: 'not-a-json-schema-type' },
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
    },
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      unknownKeyword: true,
    },
  ])('rejects a JSON Schema that does not compile as draft-07', (schema) => {
    const manifest = validSkinovaManifest();
    manifest.templates[0].dataSchema = schema;

    expect(() => assertValidTemplatePackageManifest(manifest)).toThrow(
      /JSON Schema/i,
    );
  });

  it('makes the opaque DTO reject unknown inner fields without echoing values', async () => {
    const manifest = Object.assign(validSkinovaManifest(), {
      releaseToken: 'must-never-be-returned',
    });
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    let error: unknown;
    try {
      await pipe.transform(
        { manifest },
        { type: 'body', metatype: RegisterTemplatePackageDto },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    expect(JSON.stringify(error)).not.toContain('must-never-be-returned');
  });
});
