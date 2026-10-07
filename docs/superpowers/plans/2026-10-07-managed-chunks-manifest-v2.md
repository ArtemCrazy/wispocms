# Managed Chunks Manifest v2 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить изолированный, тестируемый контракт manifest v2 для Managed Chunks: закрытые типы полей, производную JSON Schema, canonical digest, fail-closed validation, чистую проверку совместимости и доверенный build-side runtime catalog, не меняя production-путь TemplatePackage v1.

**Architecture:** Phase 1 создаёт рядом с существующим реестром автономный SDK без wiring в DTO/service/controller/CLI и без хранения в БД. `fields` являются единственным источником истины: API-код выводит из них draft-07 schema и server-computed digest, а frontend-код связывает `rendererKey` только с доверенным локальным registry. Реальный Skinova manifest, баннеры, preflight и release lifecycle остаются v1 до следующих фаз.

**Tech Stack:** TypeScript 5.7, NestJS 11, Ajv 8/draft-07, Node `crypto`, Jest 30, Next.js 16.3/React 19, Node test runner с `--experimental-strip-types`.

---

## Границы Phase 1

- Работать только в `codex/managed-chunks-sdk-v1` и продолжать существующую верхнюю запись `docs/change-log.md`.
- Не менять `TemplatePackageManifest`, `assertValidTemplatePackageManifest`, `RegisterTemplatePackageDto`, `TemplatePackageService`, controllers, release CLI и `apps/web/template-packages/skinova/manifest.template.json`: production alias/register остаются v1.
- Не менять entities, migrations, `data-source.ts`, схему/данные/формат БД, banners API/UI, preview/public behavior и права.
- Не добавлять v2 в `register`, `preflight` или `report-deployed`; поведение CLI preflight не меняется.
- DB-backed published/draft compatibility, layout checks и runtime capability attestation явно отложены. В Phase 1 compatibility — чистая функция над переданным immutable inventory.
- Реальный Skinova v2 не создаётся. Тесты используют только `apps/api/test/fixtures/managed-chunks-v2.fixture.json`.
- `contractDigest` необязателен во входном manifest. Сервер всегда вычисляет digest; присланный digest только сверяется.
- Общая форма поля ровно `{ key, label, help?, required?, nullable? }`; defaults запрещены.
- `required` и `nullable` независимы: отсутствующее optional value не равно явному `null`.
- Widgets: `text`, `textarea`, `html`, `number`, `boolean`, `select`, `link`, `image`, `mediaFile`, `group`, `repeater`.
- Закрытый icon catalog: `banner`, `cards`, `content`, `media`, `layout`; iframe providers Phase 1: только `youtube`; новые providers добавляются только вместе с отдельным sanitizer adapter и security-тестами.
- Constraint keys закрыты по widget; неизвестное поле или constraint отклоняется.
- Digest включает `key`, `widget`, нормализованные `required/nullable`, storage constraints, select values и nested fields. Он исключает category, `rendererKey`, definition title, field label/help, option labels, icon и presentation order.
- Runtime binding находится только в trusted frontend registry. API принимает безопасный machine key и не содержит hardcoded renderer allowlist.

### Exact constraint matrix

| Widget | Допустимые descriptor-поля | Точные constraints |
|---|---|---|
| `text` | common + `widget`, `constraints?` | `minLength`, `maxLength`: integer `0..2000`, `minLength <= maxLength` |
| `textarea` | common + `widget`, `constraints?` | `minLength`, `maxLength`: integer `0..20000`, `minLength <= maxLength` |
| `html` | common + `widget`, `constraints?` | `minLength`, `maxLength`: integer `0..65536`, `minLength <= maxLength`; unique `iframeProviders`, в Phase 1 только `youtube` |
| `number` | common + `widget`, `constraints?` | finite `min`, `max`, positive finite `step`; `min <= max` |
| `boolean` | только common + `widget` | constraints запрещены |
| `select` | common + `widget`, `options` | 1–100 unique machine-safe string values; labels 1–160 chars; constraints запрещены |
| `link` | common + `widget`, `constraints?` | unique `protocols`/`targets` из закрытых catalogs; URL `1..2048`, label `0..500` |
| `image` | common + `widget`, `constraints?` | `minWidth`, `maxWidth`, `minHeight`, `maxHeight`: positive safe integer `1..100000`; min не выше max; это часть contract digest, фактические media dimensions проверяются platform media policy позднее |
| `mediaFile` | только common + `widget` | descriptor constraints запрещены; MIME/размер проверяет platform media policy в следующих фазах |
| `group` | common + `widget`, `fields` | constraints запрещены |
| `repeater` | common + `widget`, `fields`, `constraints?` | integer `minItems/maxItems` в `0..100`, `minItems <= maxItems` |

Common keys are exactly `key`, `label`, `help?`, `required?`, `nullable?`; key length `1..80`, label `1..160`, help `1..1000`, booleans must be actual booleans. Empty arrays where a definition needs at least one field/option/reference are rejected.

## Карта файлов

- Create `apps/api/src/template-packages/managed-chunk.types.ts` — закрытые constants/unions и v2 release type без изменения v1 alias.
- Create `apps/api/src/template-packages/managed-chunk.types.spec.ts` — catalogs/fixture contract.
- Create `apps/api/test/fixtures/managed-chunks-v2.fixture.json` — synthetic v2 fixture.
- Create `apps/api/src/template-packages/managed-chunk-schema.ts` and `.spec.ts` — derived schema, canonical form, digest.
- Create `apps/api/src/template-packages/managed-chunk-validation.ts` and `.spec.ts` — fail-closed parser.
- Create `apps/api/src/template-packages/managed-chunk-compatibility.ts` and `.spec.ts` — pure compatibility primitive.
- Create `apps/api/src/template-packages/managed-chunk-release-boundary.spec.ts` — v1 preservation gate.
- Create `apps/web/src/app/chunk-runtime-catalog.ts` and `apps/web/test/managed-chunk-runtime.test.mjs` — trusted build-side runtime binding.
- Modify `docs/change-log.md` — status/checks/commits; no release claim.

## Task 1: Закрытые типы manifest v2 и synthetic fixture

**Files:**

- Create: `apps/api/test/fixtures/managed-chunks-v2.fixture.json`
- Create: `apps/api/src/template-packages/managed-chunk.types.ts`
- Create: `apps/api/src/template-packages/managed-chunk.types.spec.ts`

- [ ] **Step 1: Write the failing catalog/fixture test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CMS_CHUNK_ICON_KEYS,
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_CHUNK_WIDGETS,
  type TemplatePackageManifestV2,
} from './managed-chunk.types';

const fixture = JSON.parse(readFileSync(resolve(
  __dirname,
  '../../test/fixtures/managed-chunks-v2.fixture.json',
), 'utf8')) as TemplatePackageManifestV2;

describe('managed chunk v2 types', () => {
  it('exports the closed Phase 1 catalogs', () => {
    expect(MANAGED_CHUNK_WIDGETS).toEqual([
      'text', 'textarea', 'html', 'number', 'boolean', 'select',
      'link', 'image', 'mediaFile', 'group', 'repeater',
    ]);
    expect(CMS_CHUNK_ICON_KEYS).toEqual([
      'banner', 'cards', 'content', 'media', 'layout',
    ]);
    expect(CMS_IFRAME_PROVIDER_IDS).toEqual(['youtube']);
  });

  it('keeps the v2 fixture separate from production Skinova v1', () => {
    expect(fixture.manifestVersion).toBe(2);
    expect(fixture.chunkDefinitions[0]).toMatchObject({
      key: 'fixture-banner', schemaVersion: '1',
      rendererKey: 'fixture-banner-renderer',
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk.types
```

Expected: FAIL with `Cannot find module './managed-chunk.types'`.

- [ ] **Step 3: Add the fixture and minimal closed type contract**

Create the fixture directory first:

```powershell
New-Item -ItemType Directory -Force apps/api/test/fixtures
```

Create the exact synthetic fixture below; do not copy it over the Skinova manifest:

```json
{
  "manifestVersion": 2,
  "packageId": "managed-chunks-fixture",
  "packageVersion": "1",
  "title": "Managed Chunks Fixture",
  "siteType": "media",
  "cmsApi": { "minSchemaVersion": "1.2" },
  "source": {
    "repository": "https://example.com/wispo/managed-chunks-fixture.git",
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "build": {
    "releaseDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "artifactDigest": null,
    "builtAt": "2026-10-07T00:00:00Z",
    "runtimeMode": "embedded-next"
  },
  "chunkCategories": [
    { "key": "banners", "title": "Баннеры", "order": 10, "iconKey": "banner" }
  ],
  "chunkDefinitions": [
    {
      "key": "fixture-banner",
      "schemaVersion": "1",
      "title": "Тестовый баннер",
      "categoryKey": "banners",
      "rendererKey": "fixture-banner-renderer",
      "fields": [
        { "key": "headline", "label": "Заголовок", "widget": "text", "required": true },
        { "key": "picture", "label": "Изображение", "widget": "image", "nullable": true },
        {
          "key": "body",
          "label": "Текст",
          "widget": "html",
          "constraints": { "maxLength": 20000, "iframeProviders": ["youtube"] }
        }
      ]
    }
  ],
  "templates": [
    {
      "kind": "homepage",
      "key": "fixture-home",
      "version": "1",
      "title": "Fixture Home",
      "dataScope": "cms-entity",
      "runtimeContext": ["siteSlug"],
      "dataSchemaVersion": "1",
      "dataSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "additionalProperties": false,
        "properties": {}
      },
      "configSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "additionalProperties": false,
        "properties": {}
      },
      "slots": [
        {
          "key": "hero",
          "title": "Главный баннер",
          "placement": "homepage-hero",
          "maxItems": 3,
          "allowedChunks": [
            { "definitionKey": "fixture-banner", "schemaVersion": "1" }
          ]
        }
      ]
    }
  ]
}
```

Create `managed-chunk.types.ts` with these exact public shapes:

```ts
import type {
  TemplatePackageManifest,
  TemplatePackageTemplate,
} from './template-package.types';

export const MANAGED_CHUNK_WIDGETS = [
  'text', 'textarea', 'html', 'number', 'boolean', 'select',
  'link', 'image', 'mediaFile', 'group', 'repeater',
] as const;
export const CMS_CHUNK_ICON_KEYS = [
  'banner', 'cards', 'content', 'media', 'layout',
] as const;
export const CMS_IFRAME_PROVIDER_IDS = ['youtube'] as const;
export const MANAGED_LINK_PROTOCOLS = ['https', 'http', 'mailto', 'tel'] as const;
export const MANAGED_LINK_TARGETS = ['_self', '_blank'] as const;

export type CmsChunkIconKey = (typeof CMS_CHUNK_ICON_KEYS)[number];
export type CmsIframeProviderId = (typeof CMS_IFRAME_PROVIDER_IDS)[number];
export type ManagedLinkProtocol = (typeof MANAGED_LINK_PROTOCOLS)[number];
export type ManagedLinkTarget = (typeof MANAGED_LINK_TARGETS)[number];

export type ManagedChunkFieldBase = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
};
export type ManagedChunkTextField = ManagedChunkFieldBase & {
  widget: 'text' | 'textarea';
  constraints?: { minLength?: number; maxLength?: number };
};
export type ManagedChunkHtmlField = ManagedChunkFieldBase & {
  widget: 'html';
  constraints?: {
    minLength?: number;
    maxLength?: number;
    iframeProviders?: CmsIframeProviderId[];
  };
};
export type ManagedChunkNumberField = ManagedChunkFieldBase & {
  widget: 'number'; constraints?: { min?: number; max?: number; step?: number };
};
export type ManagedChunkBooleanField = ManagedChunkFieldBase & {
  widget: 'boolean';
};
export type ManagedChunkSelectField = ManagedChunkFieldBase & {
  widget: 'select'; options: Array<{ value: string; label: string }>;
};
export type ManagedChunkLinkField = ManagedChunkFieldBase & {
  widget: 'link';
  constraints?: {
    protocols?: ManagedLinkProtocol[];
    targets?: ManagedLinkTarget[];
    maxUrlLength?: number;
    maxLabelLength?: number;
  };
};
export type ManagedChunkImageField = ManagedChunkFieldBase & {
  widget: 'image';
  constraints?: {
    minWidth?: number; maxWidth?: number;
    minHeight?: number; maxHeight?: number;
  };
};
export type ManagedChunkMediaFileField = ManagedChunkFieldBase & {
  widget: 'mediaFile';
};
export type ManagedChunkGroupField = ManagedChunkFieldBase & {
  widget: 'group'; fields: ManagedChunkField[];
};
export type ManagedChunkRepeaterField = ManagedChunkFieldBase & {
  widget: 'repeater'; fields: ManagedChunkField[];
  constraints?: { minItems?: number; maxItems?: number };
};
export type ManagedChunkField =
  | ManagedChunkTextField | ManagedChunkHtmlField
  | ManagedChunkNumberField | ManagedChunkBooleanField
  | ManagedChunkSelectField | ManagedChunkLinkField
  | ManagedChunkImageField | ManagedChunkMediaFileField
  | ManagedChunkGroupField | ManagedChunkRepeaterField;

export type ManagedChunkCategory = {
  key: string; title: string; order: number; iconKey?: CmsChunkIconKey;
};
export type ManagedChunkDefinition = {
  key: string; schemaVersion: string; title: string;
  categoryKey: string; rendererKey: string;
  contractDigest?: string; fields: ManagedChunkField[];
};
export type ManagedChunkReference = {
  definitionKey: string; schemaVersion: string;
};
export type ManagedChunkSlot = {
  key: string; title: string; placement: string; maxItems: number;
  allowedChunks: ManagedChunkReference[];
};
export type TemplatePackageTemplateV2 = Omit<TemplatePackageTemplate, 'slots'> & {
  slots?: ManagedChunkSlot[];
};
export type TemplatePackageManifestV2 = Omit<
  TemplatePackageManifest,
  'manifestVersion' | 'templates'
> & {
  manifestVersion: 2;
  chunkCategories: ManagedChunkCategory[];
  chunkDefinitions: ManagedChunkDefinition[];
  templates: TemplatePackageTemplateV2[];
};
```

- [ ] **Step 4: Run test to verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk.types
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/test/fixtures/managed-chunks-v2.fixture.json apps/api/src/template-packages/managed-chunk.types.ts apps/api/src/template-packages/managed-chunk.types.spec.ts
git commit -m "feat(api): define managed chunk manifest v2 contract"
```

## Task 2: Производная JSON Schema и canonical digest

**Files:**

- Create: `apps/api/src/template-packages/managed-chunk-schema.ts`
- Create: `apps/api/src/template-packages/managed-chunk-schema.spec.ts`

- [ ] **Step 1: Write the failing derived-schema spec**

Create the complete initial spec:

```ts
import { deriveManagedChunkDataSchema } from './managed-chunk-schema';
import type { ManagedChunkField } from './managed-chunk.types';

const fields: ManagedChunkField[] = [
  { key: 'title', label: 'Title', widget: 'text', required: true },
  { key: 'subtitle', label: 'Subtitle', widget: 'text' },
  { key: 'note', label: 'Note', widget: 'textarea', nullable: true },
  {
    key: 'body', label: 'Body', widget: 'html',
    constraints: { iframeProviders: ['youtube'] },
  },
  {
    key: 'items', label: 'Items', widget: 'repeater',
    constraints: { minItems: 1, maxItems: 3 },
    fields: [{ key: 'enabled', label: 'Enabled', widget: 'boolean' }],
  },
];

describe('managed chunk derived schema', () => {
  it('keeps required and nullable independent without defaults', () => {
    const schema = deriveManagedChunkDataSchema(fields);
    expect(schema.required).toEqual(['title']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.subtitle).toEqual({
      type: 'string', minLength: 0, maxLength: 2000,
    });
    expect(schema.properties.note).toEqual({
      anyOf: [
        { type: 'string', minLength: 0, maxLength: 20000 },
        { type: 'null' },
      ],
    });
    expect(JSON.stringify(schema)).not.toContain('default');
  });

  it('enforces the fixed text and HTML security caps', () => {
    const schema = deriveManagedChunkDataSchema(fields);
    expect(schema.properties.title).toMatchObject({ maxLength: 2000 });
    expect(schema.properties.note).toMatchObject({ anyOf: [
      expect.objectContaining({ maxLength: 20000 }),
      { type: 'null' },
    ] });
    expect(schema.properties.body).toMatchObject({ maxLength: 65536 });
  });

  it('derives closed nested repeater items', () => {
    expect(deriveManagedChunkDataSchema(fields).properties.items).toEqual({
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
        additionalProperties: false,
      },
    });
  });

  it('keeps mediaFile schema free from manifest-controlled MIME and size policy', () => {
    const schema = deriveManagedChunkDataSchema([
      { key: 'download', label: 'Download', widget: 'mediaFile' },
    ]);
    expect(schema.properties.download).toEqual({
      type: 'object',
      properties: { mediaId: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['mediaId'],
      additionalProperties: false,
    });
  });
});
```

- [ ] **Step 2: Run the schema spec to verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-schema
```

Expected: FAIL with `Cannot find module './managed-chunk-schema'`.

- [ ] **Step 3: Write the complete minimal schema derivation**

Create `managed-chunk-schema.ts` with this complete content:

```ts
import type {
  ManagedChunkField,
  ManagedChunkHtmlField,
  ManagedChunkImageField,
  ManagedChunkLinkField,
  ManagedChunkNumberField,
  ManagedChunkRepeaterField,
  ManagedChunkTextField,
} from './managed-chunk.types';
import {
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_LINK_PROTOCOLS,
  MANAGED_LINK_TARGETS,
} from './managed-chunk.types';

export type ManagedChunkJsonSchema = { [key: string]: unknown };
export type ManagedChunkObjectSchema = ManagedChunkJsonSchema & {
  $schema?: string;
  type: 'object';
  properties: Record<string, ManagedChunkJsonSchema>;
  required?: string[];
  additionalProperties: false;
};

const TEXT_CAP = 2_000;
const TEXTAREA_CAP = 20_000;
const HTML_CAP = 65_536;
const REPEATER_CAP = 100;
const MEDIA_ID_SCHEMA = { type: 'string', minLength: 1, maxLength: 80 };

function lengthBounds(
  field: ManagedChunkTextField | ManagedChunkHtmlField,
  cap: number,
) {
  return {
    minLength: field.constraints?.minLength ?? 0,
    maxLength: field.constraints?.maxLength ?? cap,
  };
}

function nullable(
  schema: ManagedChunkJsonSchema,
  isNullable: boolean | undefined,
): ManagedChunkJsonSchema {
  return isNullable ? { anyOf: [schema, { type: 'null' }] } : schema;
}

function linkSchema(field: ManagedChunkLinkField): ManagedChunkJsonSchema {
  const protocols = field.constraints?.protocols ?? [...MANAGED_LINK_PROTOCOLS];
  const targets = field.constraints?.targets ?? [...MANAGED_LINK_TARGETS];
  const protocolPattern = `^(?:${protocols.map((value) => `${value}:`).join('|')})`;
  return {
    type: 'object',
    properties: {
      url: {
        type: 'string', minLength: 1,
        maxLength: field.constraints?.maxUrlLength ?? 2_048,
        pattern: protocolPattern,
      },
      label: {
        type: 'string', minLength: 0,
        maxLength: field.constraints?.maxLabelLength ?? 500,
      },
      target: { type: 'string', enum: [...targets].sort() },
    },
    required: ['url'],
    additionalProperties: false,
  };
}

function imageSchema(_field: ManagedChunkImageField): ManagedChunkJsonSchema {
  return {
    type: 'object',
    properties: {
      mediaId: MEDIA_ID_SCHEMA,
      alt: { type: 'string', maxLength: 500 },
      decorative: { type: 'boolean' },
    },
    required: ['mediaId', 'alt', 'decorative'],
    additionalProperties: false,
    oneOf: [
      {
        properties: {
          decorative: { const: true },
          alt: { type: 'string', maxLength: 0 },
        },
      },
      {
        properties: {
          decorative: { const: false },
          alt: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    ],
  };
}

function numberSchema(field: ManagedChunkNumberField): ManagedChunkJsonSchema {
  return {
    type: 'number',
    ...(field.constraints?.min === undefined
      ? {} : { minimum: field.constraints.min }),
    ...(field.constraints?.max === undefined
      ? {} : { maximum: field.constraints.max }),
    ...(field.constraints?.step === undefined
      ? {} : { multipleOf: field.constraints.step }),
  };
}

function repeaterSchema(field: ManagedChunkRepeaterField): ManagedChunkJsonSchema {
  return {
    type: 'array',
    minItems: field.constraints?.minItems ?? 0,
    maxItems: field.constraints?.maxItems ?? REPEATER_CAP,
    items: objectSchema(field.fields, false),
  };
}

function fieldSchema(field: ManagedChunkField): ManagedChunkJsonSchema {
  let schema: ManagedChunkJsonSchema;
  switch (field.widget) {
    case 'text':
      schema = { type: 'string', ...lengthBounds(field, TEXT_CAP) };
      break;
    case 'textarea':
      schema = { type: 'string', ...lengthBounds(field, TEXTAREA_CAP) };
      break;
    case 'html':
      schema = { type: 'string', ...lengthBounds(field, HTML_CAP) };
      break;
    case 'number':
      schema = numberSchema(field);
      break;
    case 'boolean':
      schema = { type: 'boolean' };
      break;
    case 'select':
      schema = {
        type: 'string',
        enum: field.options.map(({ value }) => value).sort(),
      };
      break;
    case 'link':
      schema = linkSchema(field);
      break;
    case 'image':
      schema = imageSchema(field);
      break;
    case 'mediaFile':
      schema = {
        type: 'object',
        properties: { mediaId: MEDIA_ID_SCHEMA },
        required: ['mediaId'],
        additionalProperties: false,
      };
      break;
    case 'group':
      schema = objectSchema(field.fields, false);
      break;
    case 'repeater':
      schema = repeaterSchema(field);
      break;
  }
  return nullable(schema, field.nullable);
}

function objectSchema(
  fields: readonly ManagedChunkField[],
  root: boolean,
): ManagedChunkObjectSchema {
  const properties = Object.fromEntries(
    fields.map((field) => [field.key, fieldSchema(field)]),
  );
  const required = fields
    .filter((field) => field.required === true)
    .map(({ key }) => key)
    .sort();
  return {
    ...(root
      ? { $schema: 'http://json-schema.org/draft-07/schema#' }
      : {}),
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export function deriveManagedChunkDataSchema(
  fields: readonly ManagedChunkField[],
): ManagedChunkObjectSchema {
  return objectSchema(fields, true);
}

export const MANAGED_CHUNK_SCHEMA_LIMITS = {
  text: TEXT_CAP,
  textarea: TEXTAREA_CAP,
  html: HTML_CAP,
  repeater: REPEATER_CAP,
  iframeProviders: [...CMS_IFRAME_PROVIDER_IDS],
} as const;
```

- [ ] **Step 4: Run the schema spec to verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-schema
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Extend the spec with failing canonical-digest tests**

Replace the first import with:

```ts
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
```

Append these tests inside the existing `describe`:

```ts
it('ignores presentation/order but includes storage semantics', () => {
  const left: ManagedChunkField[] = [
    { key: 'title', label: 'Заголовок', help: 'Подсказка', widget: 'text' },
    { key: 'kind', label: 'Тип', widget: 'select', options: [
      { value: 'a', label: 'А' }, { value: 'b', label: 'Б' },
    ] },
  ];
  const presentationOnly: ManagedChunkField[] = [
    { key: 'kind', label: 'Kind', widget: 'select', options: [
      { value: 'b', label: 'Bee' }, { value: 'a', label: 'Aye' },
    ] },
    { key: 'title', label: 'Title', widget: 'text' },
  ];
  const changed: ManagedChunkField[] = structuredClone(presentationOnly);
  changed[1] = { ...changed[1], required: true } as ManagedChunkField;

  expect(computeManagedChunkContractDigest(left)).toBe(
    computeManagedChunkContractDigest(presentationOnly),
  );
  expect(computeManagedChunkContractDigest(changed)).not.toBe(
    computeManagedChunkContractDigest(left),
  );
  expect(canonicalManagedChunkContract(left)).not.toContain('label');
});

it('uses a stable platform-default sentinel for omitted catalogs', () => {
  const implicit: ManagedChunkField[] = [
    { key: 'body', label: 'Body', widget: 'html' },
    { key: 'link', label: 'Link', widget: 'link' },
  ];
  const explicit: ManagedChunkField[] = [
    {
      key: 'body', label: 'Different label', widget: 'html',
      constraints: { iframeProviders: ['youtube'] },
    },
    {
      key: 'link', label: 'Different link', widget: 'link',
      constraints: {
        protocols: ['https', 'http', 'mailto', 'tel'],
        targets: ['_self', '_blank'],
      },
    },
  ];
  expect(canonicalManagedChunkContract(implicit)).toContain(
    'platform-default',
  );
  expect(computeManagedChunkContractDigest(implicit)).not.toBe(
    computeManagedChunkContractDigest(explicit),
  );
});
```

- [ ] **Step 6: Run the digest tests to verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-schema
```

Expected: FAIL because the two digest exports do not exist.

- [ ] **Step 7: Add the complete canonicalization/digest implementation**

Add `import { createHash } from 'node:crypto';` above the type imports and append this exact code to `managed-chunk-schema.ts`:

```ts
type CanonicalJson =
  | null | boolean | number | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function sorted<T extends string>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function semanticField(field: ManagedChunkField): CanonicalJson {
  const common: Record<string, CanonicalJson> = {
    key: field.key,
    widget: field.widget,
    required: field.required === true,
    nullable: field.nullable === true,
  };
  switch (field.widget) {
    case 'text':
      return { ...common, constraints: lengthBounds(field, TEXT_CAP) };
    case 'textarea':
      return { ...common, constraints: lengthBounds(field, TEXTAREA_CAP) };
    case 'html':
      return {
        ...common,
        constraints: {
          ...lengthBounds(field, HTML_CAP),
          iframeProviders: field.constraints?.iframeProviders === undefined
            ? { mode: 'platform-default' }
            : {
                mode: 'explicit',
                values: sorted(field.constraints.iframeProviders),
              },
        },
      };
    case 'number':
      return {
        ...common,
        constraints: {
          ...(field.constraints?.min === undefined
            ? {} : { min: field.constraints.min }),
          ...(field.constraints?.max === undefined
            ? {} : { max: field.constraints.max }),
          ...(field.constraints?.step === undefined
            ? {} : { step: field.constraints.step }),
        },
      };
    case 'boolean':
    case 'mediaFile':
      return common;
    case 'select':
      return {
        ...common,
        values: sorted(field.options.map(({ value }) => value)),
      };
    case 'link':
      return {
        ...common,
        constraints: {
          protocols: field.constraints?.protocols === undefined
            ? { mode: 'platform-default' }
            : { mode: 'explicit', values: sorted(field.constraints.protocols) },
          targets: field.constraints?.targets === undefined
            ? { mode: 'platform-default' }
            : { mode: 'explicit', values: sorted(field.constraints.targets) },
          maxUrlLength: field.constraints?.maxUrlLength ?? 2_048,
          maxLabelLength: field.constraints?.maxLabelLength ?? 500,
        },
      };
    case 'image':
      return {
        ...common,
        constraints: {
          ...(field.constraints?.minWidth === undefined
            ? {} : { minWidth: field.constraints.minWidth }),
          ...(field.constraints?.maxWidth === undefined
            ? {} : { maxWidth: field.constraints.maxWidth }),
          ...(field.constraints?.minHeight === undefined
            ? {} : { minHeight: field.constraints.minHeight }),
          ...(field.constraints?.maxHeight === undefined
            ? {} : { maxHeight: field.constraints.maxHeight }),
        },
      };
    case 'group':
      return { ...common, fields: semanticFields(field.fields) };
    case 'repeater':
      return {
        ...common,
        constraints: {
          minItems: field.constraints?.minItems ?? 0,
          maxItems: field.constraints?.maxItems ?? REPEATER_CAP,
        },
        fields: semanticFields(field.fields),
      };
  }
}

function semanticFields(fields: readonly ManagedChunkField[]): CanonicalJson[] {
  return fields
    .map(semanticField)
    .sort((left, right) => {
      const leftKey = (left as { key: string }).key;
      const rightKey = (right as { key: string }).key;
      return leftKey.localeCompare(rightKey);
    });
}

function stable(value: CanonicalJson): CanonicalJson {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  );
}

export function canonicalManagedChunkContract(
  fields: readonly ManagedChunkField[],
): string {
  return JSON.stringify(stable({ fields: semanticFields(fields) }));
}

export function computeManagedChunkContractDigest(
  fields: readonly ManagedChunkField[],
): string {
  const bytes = canonicalManagedChunkContract(fields);
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}
```

- [ ] **Step 8: Run all schema/digest tests to verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-schema
```

Expected: PASS, 6 tests.

- [ ] **Step 9: Commit schema and digest**

```powershell
git add apps/api/src/template-packages/managed-chunk-schema.ts apps/api/src/template-packages/managed-chunk-schema.spec.ts
git commit -m "feat(api): derive managed chunk schema and digest"
```
## Task 3: Fail-closed path-aware manifest v2 validator

**Files:**

- Create: `apps/api/src/template-packages/managed-chunk-validation.ts`
- Create: `apps/api/src/template-packages/managed-chunk-validation.spec.ts`
- Create: `apps/api/src/template-packages/managed-chunk-release-boundary.spec.ts`

- [ ] **Step 1: Write the complete failing validator spec**

Create `managed-chunk-validation.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import { assertValidManagedChunkManifestV2 } from './managed-chunk-validation';

const fixture = JSON.parse(readFileSync(resolve(
  __dirname,
  '../../test/fixtures/managed-chunks-v2.fixture.json',
), 'utf8')) as Record<string, any>;
const validFixture = () => structuredClone(fixture);
const textField = (index: number) => ({
  key: `field-${index}`, label: `Field ${index}`, widget: 'text',
});

describe('managed chunk manifest v2 validation', () => {
  it('computes every digest/schema and verifies an optional supplied digest', () => {
    const input = validFixture();
    const computed = computeManagedChunkContractDigest(
      input.chunkDefinitions[0].fields,
    );
    input.chunkDefinitions[0].contractDigest = computed;
    const validated = assertValidManagedChunkManifestV2(input);
    expect(validated.manifest).not.toBe(input);
    expect(validated.definitions[0]).toMatchObject({
      contractDigest: computed,
      dataSchema: deriveManagedChunkDataSchema(
        input.chunkDefinitions[0].fields,
      ),
    });
  });

  it('accepts an omitted digest but rejects a mismatch', () => {
    expect(assertValidManagedChunkManifestV2(validFixture())
      .definitions[0].contractDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    const mismatch = validFixture();
    mismatch.chunkDefinitions[0].contractDigest = `sha256:${'0'.repeat(64)}`;
    let error: unknown;
    try {
      assertValidManagedChunkManifestV2(mismatch);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
  });

  it('does not treat rendererKey as an API-side allowlist', () => {
    const input = validFixture();
    input.chunkDefinitions[0].rendererKey = 'unknown-but-safe-renderer';
    expect(assertValidManagedChunkManifestV2(input).manifest.manifestVersion)
      .toBe(2);
  });

  it.each([
    ['default', (m: any) => Object.assign(
      m.chunkDefinitions[0].fields[0], { default: 'x' },
    )],
    ['unknown widget', (m: any) => {
      m.chunkDefinitions[0].fields[0].widget = 'code';
    }],
    ['unknown constraint', (m: any) => Object.assign(
      m.chunkDefinitions[0].fields[0].constraints ??= {},
      { pattern: '.*' },
    )],
    ['arbitrary icon', (m: any) => {
      m.chunkCategories[0].iconKey = '<svg />';
    }],
    ['unknown provider', (m: any) => {
      m.chunkDefinitions[0].fields[2].constraints.iframeProviders = ['vimeo'];
    }],
    ['mediaFile policy', (m: any) => {
      m.chunkDefinitions[0].fields.push({
        key: 'file', label: 'File', widget: 'mediaFile',
        constraints: { maxBytes: 10 },
      });
    }],
    ['missing category', (m: any) => {
      m.chunkDefinitions[0].categoryKey = 'missing';
    }],
    ['missing allowed definition', (m: any) => {
      m.templates[0].slots[0].allowedChunks[0].definitionKey = 'missing';
    }],
  ])('rejects %s', (_label, mutate) => {
    const input = validFixture();
    mutate(input);
    expect(() => assertValidManagedChunkManifestV2(input)).toThrow();
  });

  it.each([
    ['text', 2001], ['textarea', 20001], ['html', 65537],
  ])('rejects %s maxLength above its fixed cap', (widget, maxLength) => {
    const input = validFixture();
    input.chunkDefinitions[0].fields = [{
      key: 'value', label: 'Value', widget, constraints: { maxLength },
    }];
    expect(() => assertValidManagedChunkManifestV2(input)).toThrow(/maxLength/);
  });

  it('rejects duplicate keys, values and references', () => {
    const category = validFixture();
    category.chunkCategories.push(structuredClone(category.chunkCategories[0]));
    expect(() => assertValidManagedChunkManifestV2(category)).toThrow(/duplicate/i);

    const fields = validFixture();
    fields.chunkDefinitions[0].fields.push(
      structuredClone(fields.chunkDefinitions[0].fields[0]),
    );
    expect(() => assertValidManagedChunkManifestV2(fields)).toThrow(/duplicate/i);

    const options = validFixture();
    options.chunkDefinitions[0].fields = [{
      key: 'kind', label: 'Kind', widget: 'select',
      options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'Again' }],
    }];
    expect(() => assertValidManagedChunkManifestV2(options)).toThrow(/duplicate/i);

    const allowed = validFixture();
    allowed.templates[0].slots[0].allowedChunks.push(
      structuredClone(allowed.templates[0].slots[0].allowedChunks[0]),
    );
    expect(() => assertValidManagedChunkManifestV2(allowed)).toThrow(/duplicate/i);
  });

  it('enforces package-wide and nested complexity budgets', () => {
    const categories = validFixture();
    categories.chunkCategories = Array.from({ length: 51 }, (_, index) => ({
      key: `category-${index}`, title: `Category ${index}`, order: index,
    }));
    expect(() => assertValidManagedChunkManifestV2(categories)).toThrow(/categories/);

    const definitions = validFixture();
    definitions.chunkDefinitions = Array.from({ length: 101 }, (_, index) => ({
      ...structuredClone(definitions.chunkDefinitions[0]),
      key: `definition-${index}`,
    }));
    expect(() => assertValidManagedChunkManifestV2(definitions)).toThrow(/definitions/);

    const oneDefinition = validFixture();
    oneDefinition.chunkDefinitions[0].fields = Array.from(
      { length: 257 }, (_, index) => textField(index),
    );
    expect(() => assertValidManagedChunkManifestV2(oneDefinition)).toThrow(/256/);

    const packageFields = validFixture();
    packageFields.chunkDefinitions = Array.from({ length: 10 }, (_, definition) => ({
      ...structuredClone(packageFields.chunkDefinitions[0]),
      key: `definition-${definition}`,
      fields: Array.from({ length: 201 }, (_, index) => textField(index)),
    }));
    expect(() => assertValidManagedChunkManifestV2(packageFields)).toThrow(/2000/);

    const siblings = validFixture();
    siblings.chunkDefinitions[0].fields = [{
      key: 'group', label: 'Group', widget: 'group',
      fields: Array.from({ length: 65 }, (_, index) => textField(index)),
    }];
    expect(() => assertValidManagedChunkManifestV2(siblings)).toThrow(/64/);

    const nestedGroup = (depth: number): Record<string, unknown> => depth === 0
      ? textField(depth)
      : {
          key: `group-${depth}`, label: `Group ${depth}`, widget: 'group',
          fields: [nestedGroup(depth - 1)],
        };
    const depth = validFixture();
    depth.chunkDefinitions[0].fields = [nestedGroup(7)];
    expect(() => assertValidManagedChunkManifestV2(depth)).toThrow(/depth 6/);

    const nestedRepeater = (depth: number): Record<string, unknown> => depth === 0
      ? textField(depth)
      : {
          key: `repeater-${depth}`, label: `Repeater ${depth}`,
          widget: 'repeater', fields: [nestedRepeater(depth - 1)],
        };
    const repeaters = validFixture();
    repeaters.chunkDefinitions[0].fields = [nestedRepeater(3)];
    expect(() => assertValidManagedChunkManifestV2(repeaters)).toThrow(
      /repeater depth 2/,
    );

    const select = validFixture();
    select.chunkDefinitions[0].fields = [{
      key: 'choice', label: 'Choice', widget: 'select',
      options: Array.from({ length: 101 }, (_, index) => ({
        value: `value-${index}`, label: `Value ${index}`,
      })),
    }];
    expect(() => assertValidManagedChunkManifestV2(select)).toThrow(/100/);

    const slots = validFixture();
    const baseSlot = slots.templates[0].slots[0];
    slots.templates[0].slots = Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(baseSlot), key: `slot-a-${index}`,
    }));
    const secondTemplate = structuredClone(slots.templates[0]);
    secondTemplate.key = 'fixture-home-second';
    secondTemplate.slots = Array.from({ length: 51 }, (_, index) => ({
      ...structuredClone(baseSlot), key: `slot-b-${index}`,
    }));
    slots.templates.push(secondTemplate);
    expect(() => assertValidManagedChunkManifestV2(slots)).toThrow(/100 slots/);
  });

  it('rejects unsafe non-JSON inputs before cloning or Ajv', () => {
    const customPrototype = validFixture();
    Object.setPrototypeOf(customPrototype, { polluted: true });
    expect(() => assertValidManagedChunkManifestV2(customPrototype))
      .toThrow(/plain JSON/i);

    const nonFinite = validFixture();
    nonFinite.chunkCategories[0].order = Number.NaN;
    expect(() => assertValidManagedChunkManifestV2(nonFinite)).toThrow(/finite/i);

    const executable = validFixture();
    executable.chunkDefinitions[0].fields[0].handler = () => true;
    expect(() => assertValidManagedChunkManifestV2(executable)).toThrow(/JSON/i);

    const cyclic = validFixture();
    cyclic.loop = cyclic;
    expect(() => assertValidManagedChunkManifestV2(cyclic)).toThrow(/cyclic/i);
  });
});
```

- [ ] **Step 2: Write the failing v1 release-boundary spec**

Create `managed-chunk-release-boundary.spec.ts`:

```ts
import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RegisterTemplatePackageDto } from './template-package.dto';
import { assertValidTemplatePackageManifest } from './template-package.validation';
import { assertValidManagedChunkManifestV2 } from './managed-chunk-validation';

const read = (path: string) => JSON.parse(
  readFileSync(resolve(__dirname, path), 'utf8'),
);

describe('Managed Chunks Phase 1 release boundary', () => {
  it('keeps production Skinova and production validator on v1', () => {
    const skinova = read('../../../web/template-packages/skinova/manifest.template.json');
    const release = {
      ...skinova,
      source: { ...skinova.source, revision: 'a'.repeat(40) },
      build: { ...skinova.build, releaseDigest: 'b'.repeat(64),
        artifactDigest: null, builtAt: '2026-10-07T00:00:00Z' },
    };
    expect(release.manifestVersion).toBe(1);
    expect(assertValidTemplatePackageManifest(release)).toBe(release);
  });

  it('keeps synthetic v2 behind the isolated SDK and outside production DTO', async () => {
    const v2 = read('../../test/fixtures/managed-chunks-v2.fixture.json');
    expect(assertValidManagedChunkManifestV2(v2).manifest.manifestVersion).toBe(2);
    expect(() => assertValidTemplatePackageManifest(v2)).toThrow(/manifestVersion/i);
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(pipe.transform(
      { manifest: v2 }, { type: 'body', metatype: RegisterTemplatePackageDto },
    )).rejects.toBeDefined();
  });
});
```

This characterization requires no production change and uses the synthetic v2 fixture. CLI behavior is covered by the existing unchanged `scripts/register-template-package.test.mjs` in Task 6.

- [ ] **Step 3: Run both specs to verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-validation managed-chunk-release-boundary
```

Expected: FAIL because both specs import the absent v2 validator.

- [ ] **Step 4: Implement the complete path-aware validator**

Create `managed-chunk-validation.ts` with this complete content:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import Ajv from 'ajv';
import {
  CMS_CHUNK_ICON_KEYS,
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_CHUNK_WIDGETS,
  MANAGED_LINK_PROTOCOLS,
  MANAGED_LINK_TARGETS,
  type ManagedChunkDefinition,
  type ManagedChunkField,
  type TemplatePackageManifestV2,
} from './managed-chunk.types';
import {
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
  type ManagedChunkObjectSchema,
} from './managed-chunk-schema';
import type { JsonSchema, TemplatePackageManifest } from './template-package.types';
import { assertValidTemplatePackageManifest } from './template-package.validation';

const MACHINE_KEY = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/;
const SELECT_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const COMMON_FIELD_KEYS = ['key', 'label', 'help', 'required', 'nullable', 'widget'];
const TOP_KEYS = new Set([
  'manifestVersion', 'packageId', 'packageVersion', 'title', 'siteType',
  'cmsApi', 'source', 'build', 'templates',
  'chunkCategories', 'chunkDefinitions',
]);
const CATEGORY_KEYS = new Set(['key', 'title', 'order', 'iconKey']);
const DEFINITION_KEYS = new Set([
  'key', 'schemaVersion', 'title', 'categoryKey', 'rendererKey',
  'contractDigest', 'fields',
]);
const SLOT_KEYS = new Set([
  'key', 'title', 'placement', 'maxItems', 'allowedChunks',
]);
const REFERENCE_KEYS = new Set(['definitionKey', 'schemaVersion']);

type PlainRecord = Record<string, unknown>;
type Budget = { fields: number; slots: number };

export type ValidatedManagedChunkDefinition = ManagedChunkDefinition & {
  contractDigest: string;
  dataSchema: JsonSchema;
};
export type ValidatedManagedChunkManifestV2 = {
  manifest: TemplatePackageManifestV2;
  definitions: ValidatedManagedChunkDefinition[];
};

function invalid(path: string, reason: string): never {
  throw new BadRequestException(
    `Invalid managed chunk manifest: ${path} ${reason}`,
  );
}

function conflict(path: string, reason: string): never {
  throw new ConflictException(
    `Managed chunk contract conflict: ${path} ${reason}`,
  );
}

function plainRecord(value: unknown, path: string): PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'must be a plain JSON object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'must be a plain JSON object');
  }
  return value as PlainRecord;
}

function assertPlainJson(
  value: unknown,
  path = 'manifest',
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'must contain finite numbers');
    return;
  }
  if (typeof value !== 'object') invalid(path, 'must contain JSON values only');
  if (seen.has(value)) invalid(path, 'contains a cyclic value');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlainJson(item, `${path}[${index}]`, seen));
    return;
  }
  const record = plainRecord(value, path);
  for (const [key, nested] of Object.entries(record)) {
    assertPlainJson(nested, `${path}.${key}`, seen);
  }
}

function exact(record: PlainRecord, allowed: ReadonlySet<string>, path: string) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${path}.${key}`, 'is not allowed');
  }
}

function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(path, `must contain ${min}..${max} items`);
  }
  return value;
}

function string(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    invalid(path, `must be a non-empty string up to ${max} chars`);
  }
  return value;
}

function machine(value: unknown, path: string, max = 100): string {
  const result = string(value, path, max);
  if (!MACHINE_KEY.test(result) || RESERVED.has(result)) invalid(path, 'is invalid');
  return result;
}

function version(value: unknown, path: string): string {
  const result = string(value, path, 40);
  if (!VERSION.test(result)) invalid(path, 'must be a numeric version');
  return result;
}

function booleanIfPresent(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') invalid(path, 'must be boolean');
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(path, `must be an integer in ${min}..${max}`);
  }
  return Number(value);
}

function finiteIfPresent(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(path, 'must be a finite number');
  }
  return value;
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path, 'contains a duplicate');
}

function constraints(
  value: unknown,
  path: string,
  allowed: readonly string[],
): PlainRecord {
  if (value === undefined) return {};
  const result = plainRecord(value, path);
  exact(result, new Set(allowed), path);
  return result;
}

function validateLengthConstraints(
  value: unknown,
  path: string,
  cap: number,
  allowProviders: boolean,
): void {
  const allowed = allowProviders
    ? ['minLength', 'maxLength', 'iframeProviders']
    : ['minLength', 'maxLength'];
  const record = constraints(value, path, allowed);
  const min = record.minLength === undefined
    ? 0 : integer(record.minLength, `${path}.minLength`, 0, cap);
  const max = record.maxLength === undefined
    ? cap : integer(record.maxLength, `${path}.maxLength`, 0, cap);
  if (min > max) invalid(path, 'has minLength above maxLength');
  if (record.iframeProviders !== undefined) {
    const providers = array(
      record.iframeProviders,
      `${path}.iframeProviders`,
      1,
      CMS_IFRAME_PROVIDER_IDS.length,
    ).map((provider, index) => {
      const result = string(provider, `${path}.iframeProviders[${index}]`, 40);
      if (!CMS_IFRAME_PROVIDER_IDS.includes(result as never)) {
        invalid(`${path}.iframeProviders[${index}]`, 'is unsupported');
      }
      return result;
    });
    unique(providers, `${path}.iframeProviders`);
  }
}

function validateNumberConstraints(value: unknown, path: string): void {
  const record = constraints(value, path, ['min', 'max', 'step']);
  const min = finiteIfPresent(record.min, `${path}.min`);
  const max = finiteIfPresent(record.max, `${path}.max`);
  const step = finiteIfPresent(record.step, `${path}.step`);
  if (min !== undefined && max !== undefined && min > max) {
    invalid(path, 'has min above max');
  }
  if (step !== undefined && step <= 0) invalid(`${path}.step`, 'must be positive');
}

function validateStringCatalog(
  value: unknown,
  path: string,
  catalog: readonly string[],
): void {
  if (value === undefined) return;
  const entries = array(value, path, 1, catalog.length).map((entry, index) => {
    const result = string(entry, `${path}[${index}]`, 20);
    if (!catalog.includes(result)) invalid(`${path}[${index}]`, 'is unsupported');
    return result;
  });
  unique(entries, path);
}

function validateLinkConstraints(value: unknown, path: string): void {
  const record = constraints(value, path, [
    'protocols', 'targets', 'maxUrlLength', 'maxLabelLength',
  ]);
  validateStringCatalog(record.protocols, `${path}.protocols`, MANAGED_LINK_PROTOCOLS);
  validateStringCatalog(record.targets, `${path}.targets`, MANAGED_LINK_TARGETS);
  if (record.maxUrlLength !== undefined) {
    integer(record.maxUrlLength, `${path}.maxUrlLength`, 1, 2_048);
  }
  if (record.maxLabelLength !== undefined) {
    integer(record.maxLabelLength, `${path}.maxLabelLength`, 0, 500);
  }
}

function validateImageConstraints(value: unknown, path: string): void {
  const record = constraints(value, path, [
    'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  ]);
  const read = (key: string) => record[key] === undefined
    ? undefined : integer(record[key], `${path}.${key}`, 1, 100_000);
  const minWidth = read('minWidth');
  const maxWidth = read('maxWidth');
  const minHeight = read('minHeight');
  const maxHeight = read('maxHeight');
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) {
    invalid(path, 'has minWidth above maxWidth');
  }
  if (minHeight !== undefined && maxHeight !== undefined && minHeight > maxHeight) {
    invalid(path, 'has minHeight above maxHeight');
  }
}

function validateFields(
  raw: unknown,
  path: string,
  budget: Budget,
  depth: number,
  repeaterDepth: number,
  siblingLimit: number,
): ManagedChunkField[] {
  if (depth > 6) invalid(path, 'exceeds field depth 6');
  const values = array(raw, path, 1, siblingLimit);
  const keys: string[] = [];
  const result = values.map((rawField, index) => {
    budget.fields += 1;
    if (budget.fields > 2_000) invalid(path, 'exceeds 2000 descriptors');
    const fieldPath = `${path}[${index}]`;
    const field = plainRecord(rawField, fieldPath);
    const widget = string(field.widget, `${fieldPath}.widget`, 40);
    if (!MANAGED_CHUNK_WIDGETS.includes(widget as never)) {
      invalid(`${fieldPath}.widget`, 'is unsupported');
    }
    const extraKeys = widget === 'select'
      ? ['options']
      : widget === 'group'
        ? ['fields']
        : widget === 'repeater'
          ? ['fields', 'constraints']
          : widget === 'boolean' || widget === 'mediaFile'
            ? []
            : ['constraints'];
    exact(field, new Set([...COMMON_FIELD_KEYS, ...extraKeys]), fieldPath);
    const key = machine(field.key, `${fieldPath}.key`, 80);
    keys.push(key);
    string(field.label, `${fieldPath}.label`, 160);
    if (field.help !== undefined) string(field.help, `${fieldPath}.help`, 1_000);
    booleanIfPresent(field.required, `${fieldPath}.required`);
    booleanIfPresent(field.nullable, `${fieldPath}.nullable`);

    switch (widget) {
      case 'text':
        validateLengthConstraints(field.constraints, `${fieldPath}.constraints`, 2_000, false);
        break;
      case 'textarea':
        validateLengthConstraints(field.constraints, `${fieldPath}.constraints`, 20_000, false);
        break;
      case 'html':
        validateLengthConstraints(field.constraints, `${fieldPath}.constraints`, 65_536, true);
        break;
      case 'number':
        validateNumberConstraints(field.constraints, `${fieldPath}.constraints`);
        break;
      case 'boolean':
      case 'mediaFile':
        break;
      case 'select': {
        const optionValues = array(field.options, `${fieldPath}.options`, 1, 100)
          .map((rawOption, optionIndex) => {
            const optionPath = `${fieldPath}.options[${optionIndex}]`;
            const option = plainRecord(rawOption, optionPath);
            exact(option, new Set(['value', 'label']), optionPath);
            const value = string(option.value, `${optionPath}.value`, 80);
            if (!SELECT_VALUE.test(value) || RESERVED.has(value)) {
              invalid(`${optionPath}.value`, 'is invalid');
            }
            string(option.label, `${optionPath}.label`, 160);
            return value;
          });
        unique(optionValues, `${fieldPath}.options`);
        break;
      }
      case 'link':
        validateLinkConstraints(field.constraints, `${fieldPath}.constraints`);
        break;
      case 'image':
        validateImageConstraints(field.constraints, `${fieldPath}.constraints`);
        break;
      case 'group':
        validateFields(field.fields, `${fieldPath}.fields`, budget,
          depth + 1, repeaterDepth, 64);
        break;
      case 'repeater': {
        const nextRepeaterDepth = repeaterDepth + 1;
        if (nextRepeaterDepth > 2) invalid(fieldPath, 'exceeds repeater depth 2');
        const record = constraints(field.constraints, `${fieldPath}.constraints`, [
          'minItems', 'maxItems',
        ]);
        const min = record.minItems === undefined
          ? 0 : integer(record.minItems, `${fieldPath}.constraints.minItems`, 0, 100);
        const max = record.maxItems === undefined
          ? 100 : integer(record.maxItems, `${fieldPath}.constraints.maxItems`, 0, 100);
        if (min > max) invalid(`${fieldPath}.constraints`, 'has minItems above maxItems');
        validateFields(field.fields, `${fieldPath}.fields`, budget,
          depth + 1, nextRepeaterDepth, 64);
        break;
      }
    }
    return field as unknown as ManagedChunkField;
  });
  unique(keys, path);
  return result;
}

function v1Projection(manifest: PlainRecord): TemplatePackageManifest {
  const projection = structuredClone(manifest);
  projection.manifestVersion = 1;
  delete projection.chunkCategories;
  delete projection.chunkDefinitions;
  const templates = array(projection.templates, 'templates', 1, 200);
  for (const rawTemplate of templates) delete plainRecord(rawTemplate, 'template').slots;
  return assertValidTemplatePackageManifest(projection);
}

export function assertValidManagedChunkManifestV2(
  input: unknown,
): ValidatedManagedChunkManifestV2 {
  assertPlainJson(input);
  const original = plainRecord(input, 'manifest');
  exact(original, TOP_KEYS, 'manifest');
  if (original.manifestVersion !== 2) invalid('manifestVersion', 'must be 2');
  v1Projection(original);
  const manifest = structuredClone(original) as unknown as TemplatePackageManifestV2;
  const categories = array(manifest.chunkCategories, 'chunkCategories', 1, 50);
  const categoryKeys = categories.map((rawCategory, index) => {
    const path = `chunkCategories[${index}]`;
    const category = plainRecord(rawCategory, path);
    exact(category, CATEGORY_KEYS, path);
    const key = machine(category.key, `${path}.key`, 80);
    string(category.title, `${path}.title`, 160);
    integer(category.order, `${path}.order`, -10_000, 10_000);
    if (category.iconKey !== undefined
      && !CMS_CHUNK_ICON_KEYS.includes(category.iconKey as never)) {
      invalid(`${path}.iconKey`, 'is unsupported');
    }
    return key;
  });
  unique(categoryKeys, 'chunkCategories');

  const budget: Budget = { fields: 0, slots: 0 };
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true });
  const definitions = array(manifest.chunkDefinitions, 'chunkDefinitions', 1, 100)
    .map((rawDefinition, index) => {
      const path = `chunkDefinitions[${index}]`;
      const definition = plainRecord(rawDefinition, path);
      exact(definition, DEFINITION_KEYS, path);
      const key = machine(definition.key, `${path}.key`, 80);
      const schemaVersion = version(definition.schemaVersion, `${path}.schemaVersion`);
      string(definition.title, `${path}.title`, 160);
      const categoryKey = machine(definition.categoryKey, `${path}.categoryKey`, 80);
      if (!categoryKeys.includes(categoryKey)) invalid(`${path}.categoryKey`, 'does not exist');
      machine(definition.rendererKey, `${path}.rendererKey`, 100);
      const before = budget.fields;
      const fields = validateFields(definition.fields, `${path}.fields`, budget, 1, 0, 256);
      if (budget.fields - before > 256) invalid(`${path}.fields`, 'exceeds 256 descriptors');
      const contractDigest = computeManagedChunkContractDigest(fields);
      if (definition.contractDigest !== undefined) {
        const digestPath = `${path}.contractDigest`;
        const supplied = string(definition.contractDigest, digestPath, 71);
        if (!DIGEST.test(supplied)) invalid(digestPath, 'has invalid syntax');
        if (supplied !== contractDigest) {
          conflict(digestPath, 'contractDigest mismatch');
        }
      }
      const dataSchema: ManagedChunkObjectSchema = deriveManagedChunkDataSchema(fields);
      try { ajv.compile(dataSchema); } catch { invalid(`${path}.fields`, 'does not derive a valid schema'); }
      return {
        ...(definition as unknown as ManagedChunkDefinition),
        key, schemaVersion, categoryKey, fields, contractDigest,
        dataSchema: dataSchema as JsonSchema,
      };
    });
  unique(definitions.map(({ key, schemaVersion }) => `${key}:${schemaVersion}`),
    'chunkDefinitions');
  const identities = new Set(
    definitions.map(({ key, schemaVersion }) => `${key}:${schemaVersion}`),
  );

  manifest.templates.forEach((rawTemplate, templateIndex) => {
    const template = plainRecord(rawTemplate, `templates[${templateIndex}]`);
    const slotKeys: string[] = [];
    const slots = template.slots === undefined
      ? [] : array(template.slots, `templates[${templateIndex}].slots`, 0, 100);
    slots.forEach((rawSlot, slotIndex) => {
      budget.slots += 1;
      if (budget.slots > 100) invalid('templates.slots', 'exceeds 100 slots');
      const path = `templates[${templateIndex}].slots[${slotIndex}]`;
      const slot = plainRecord(rawSlot, path);
      exact(slot, SLOT_KEYS, path);
      slotKeys.push(machine(slot.key, `${path}.key`, 80));
      string(slot.title, `${path}.title`, 160);
      machine(slot.placement, `${path}.placement`, 80);
      integer(slot.maxItems, `${path}.maxItems`, 1, 100);
      const references = array(slot.allowedChunks, `${path}.allowedChunks`, 1, 100)
        .map((rawReference, referenceIndex) => {
          const referencePath = `${path}.allowedChunks[${referenceIndex}]`;
          const reference = plainRecord(rawReference, referencePath);
          exact(reference, REFERENCE_KEYS, referencePath);
          const identity = `${machine(reference.definitionKey,
            `${referencePath}.definitionKey`, 80)}:${version(reference.schemaVersion,
            `${referencePath}.schemaVersion`)}`;
          if (!identities.has(identity)) invalid(referencePath, 'references a missing definition');
          return identity;
        });
      unique(references, `${path}.allowedChunks`);
    });
    unique(slotKeys, `templates[${templateIndex}].slots`);
  });

  return { manifest, definitions };
}
```

- [ ] **Step 5: Run both specs to verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-validation managed-chunk-release-boundary
```

Expected: both suites PASS.

- [ ] **Step 6: Run schema/type regression**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-validation managed-chunk-release-boundary managed-chunk-schema managed-chunk.types
```

Expected: all targeted suites PASS.

- [ ] **Step 7: Stage the validator files**

```powershell
git add apps/api/src/template-packages/managed-chunk-validation.ts apps/api/src/template-packages/managed-chunk-validation.spec.ts apps/api/src/template-packages/managed-chunk-release-boundary.spec.ts
```

Expected: only the three listed files are staged.

- [ ] **Step 8: Commit the validator phase**

```powershell
git commit -m "feat(api): validate managed chunk manifest v2"
```

Expected: one local commit; no push or deployment.
## Task 4: Pure compatibility across contracts, renderers, slots and placements

**Files:**

- Create: `apps/api/src/template-packages/managed-chunk-compatibility.ts`
- Create: `apps/api/src/template-packages/managed-chunk-compatibility.spec.ts`

The trusted renderer set is an explicit build/deployment seam supplied by the caller. It is not read from manifest and is not an API hardcoded allowlist. A later phase may populate the same seam through signed runtime capability attestation; Phase 1 performs no network/DB lookup.

- [ ] **Step 1: Write the complete failing compatibility spec**

Create `managed-chunk-compatibility.spec.ts`:

```ts
import {
  checkManagedChunkContractCompatibility,
  type ManagedChunkCompatibilityCandidate,
  type ManagedChunkContractRequirement,
  type ManagedChunkPlacementRequirement,
} from './managed-chunk-compatibility';

const digest = `sha256:${'a'.repeat(64)}`;
const candidate = (): ManagedChunkCompatibilityCandidate => ({
  packageId: 'skinova-media',
  definitions: [{
    definitionKey: 'fixture-banner', schemaVersion: '1',
    contractDigest: digest, rendererKey: 'fixture-banner-renderer',
  }],
  slots: [{
    templateKey: 'fixture-home', templateVersion: '1', slotKey: 'hero',
    maxItems: 1,
    allowedChunks: [{ definitionKey: 'fixture-banner', schemaVersion: '1' }],
  }],
});
const contracts = (): ManagedChunkContractRequirement[] => [{
  packageId: 'skinova-media', definitionKey: 'fixture-banner',
  schemaVersion: '1', contractDigest: digest,
  sources: ['published', 'draft'],
}];
const placements = (): ManagedChunkPlacementRequirement[] => [{
  source: 'published', layoutKey: 'page:home',
  templateKey: 'fixture-home', templateVersion: '1', slotKey: 'hero',
  definitionKey: 'fixture-banner', schemaVersion: '1',
  contractDigest: digest, position: 0,
}];

describe('managed chunk pure compatibility', () => {
  it('accepts exact contracts, trusted renderers and valid placements', () => {
    expect(checkManagedChunkContractCompatibility(
      candidate(),
      new Set(['fixture-banner-renderer']),
      contracts(),
      placements(),
    )).toEqual({ compatible: true, reasons: [] });
  });

  it('reports missing_definition', () => {
    const input = candidate();
    input.definitions = [];
    expect(checkManagedChunkContractCompatibility(
      input, new Set(['fixture-banner-renderer']), contracts(), placements(),
    ).reasons).toEqual([expect.objectContaining({ code: 'missing_definition' })]);
  });

  it('reports contract_digest_mismatch', () => {
    const input = candidate();
    input.definitions[0].contractDigest = `sha256:${'b'.repeat(64)}`;
    expect(checkManagedChunkContractCompatibility(
      input, new Set(['fixture-banner-renderer']), contracts(), placements(),
    ).reasons).toEqual([
      expect.objectContaining({ code: 'contract_digest_mismatch' }),
    ]);
  });

  it('reports renderer_unavailable from the trusted inventory seam', () => {
    expect(checkManagedChunkContractCompatibility(
      candidate(), new Set<string>(), contracts(), placements(),
    ).reasons).toEqual([
      expect.objectContaining({
        code: 'renderer_unavailable',
        rendererKey: 'fixture-banner-renderer',
      }),
    ]);
  });

  it('reports slot_missing', () => {
    const input = candidate();
    input.slots = [];
    expect(checkManagedChunkContractCompatibility(
      input, new Set(['fixture-banner-renderer']), contracts(), placements(),
    ).reasons).toEqual([expect.objectContaining({ code: 'slot_missing' })]);
  });

  it('reports slot_disallows_definition', () => {
    const input = candidate();
    input.slots[0].allowedChunks = [{
      definitionKey: 'other', schemaVersion: '1',
    }];
    expect(checkManagedChunkContractCompatibility(
      input, new Set(['fixture-banner-renderer']), contracts(), placements(),
    ).reasons).toEqual([
      expect.objectContaining({ code: 'slot_disallows_definition' }),
    ]);
  });

  it('reports invalid_layout_position for negative and duplicate positions', () => {
    const negative = placements();
    negative[0].position = -1;
    expect(checkManagedChunkContractCompatibility(
      candidate(), new Set(['fixture-banner-renderer']), contracts(), negative,
    ).reasons).toEqual([
      expect.objectContaining({ code: 'invalid_layout_position', position: -1 }),
    ]);

    const input = candidate();
    input.slots[0].maxItems = 3;
    const duplicate = { ...placements()[0] };
    expect(checkManagedChunkContractCompatibility(
      input, new Set(['fixture-banner-renderer']), contracts(),
      [...placements(), duplicate],
    ).reasons).toEqual([
      expect.objectContaining({ code: 'invalid_layout_position', position: 0 }),
    ]);
  });

  it('reports slot_capacity_exceeded independently for published/draft layouts', () => {
    const second = {
      ...placements()[0], source: 'published' as const, position: 1,
    };
    const draft = {
      ...placements()[0], source: 'draft' as const, position: 0,
    };
    expect(checkManagedChunkContractCompatibility(
      candidate(), new Set(['fixture-banner-renderer']), contracts(),
      [...placements(), second, draft],
    ).reasons).toEqual([
      expect.objectContaining({
        code: 'slot_capacity_exceeded', actualItems: 2, maxItems: 1,
      }),
    ]);
  });

  it('returns reasons in deterministic order without content payloads', () => {
    const input = candidate();
    input.definitions = [];
    input.slots = [];
    const forward = checkManagedChunkContractCompatibility(
      input, new Set(), contracts(), placements(),
    );
    const reverse = checkManagedChunkContractCompatibility(
      input, new Set(), [...contracts()].reverse(), [...placements()].reverse(),
    );
    expect(reverse).toEqual(forward);
    expect(JSON.stringify(forward)).not.toContain('payload');
  });
});
```

- [ ] **Step 2: Run the spec to verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-compatibility
```

Expected: FAIL with missing `managed-chunk-compatibility`.

- [ ] **Step 3: Implement the complete pure compatibility primitive**

Create `managed-chunk-compatibility.ts`:

```ts
export type ManagedChunkContentSource = 'published' | 'draft';
export type ManagedChunkDefinitionIdentity = {
  definitionKey: string;
  schemaVersion: string;
};
export type ManagedChunkCandidateDefinition = ManagedChunkDefinitionIdentity & {
  contractDigest: string;
  rendererKey: string;
};
export type ManagedChunkCandidateSlot = {
  templateKey: string;
  templateVersion: string;
  slotKey: string;
  maxItems: number;
  allowedChunks: ManagedChunkDefinitionIdentity[];
};
export type ManagedChunkCompatibilityCandidate = {
  packageId: string;
  definitions: ManagedChunkCandidateDefinition[];
  slots: ManagedChunkCandidateSlot[];
};
export type ManagedChunkContractRequirement = ManagedChunkDefinitionIdentity & {
  packageId: string;
  contractDigest: string;
  sources: readonly ManagedChunkContentSource[];
};
export type ManagedChunkPlacementRequirement = ManagedChunkDefinitionIdentity & {
  source: ManagedChunkContentSource;
  layoutKey: string;
  templateKey: string;
  templateVersion: string;
  slotKey: string;
  contractDigest: string;
  position: number;
};

type ReasonBase = {
  code:
    | 'missing_definition'
    | 'contract_digest_mismatch'
    | 'renderer_unavailable'
    | 'slot_missing'
    | 'slot_disallows_definition'
    | 'slot_capacity_exceeded'
    | 'invalid_layout_position';
  packageId: string;
  definitionKey?: string;
  schemaVersion?: string;
  source?: ManagedChunkContentSource;
  layoutKey?: string;
  templateKey?: string;
  templateVersion?: string;
  slotKey?: string;
  rendererKey?: string;
  expectedDigest?: string;
  candidateDigest?: string;
  actualItems?: number;
  maxItems?: number;
  position?: number;
};
export type ManagedChunkCompatibilityReason = Readonly<ReasonBase>;
export type ManagedChunkCompatibilityResult = {
  compatible: boolean;
  reasons: ManagedChunkCompatibilityReason[];
};

function definitionIdentity(value: ManagedChunkDefinitionIdentity): string {
  return `${value.definitionKey}:${value.schemaVersion}`;
}

function slotIdentity(value: {
  templateKey: string; templateVersion: string; slotKey: string;
}): string {
  return `${value.templateKey}:${value.templateVersion}:${value.slotKey}`;
}

function layoutSlotIdentity(value: ManagedChunkPlacementRequirement): string {
  return [value.source, value.layoutKey, slotIdentity(value)].join(':');
}

function uniqueMap<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = key(value);
    if (result.has(identity)) throw new Error(`Duplicate ${label}: ${identity}`);
    result.set(identity, value);
  }
  return result;
}

function requirementInventory(
  packageId: string,
  contracts: readonly ManagedChunkContractRequirement[],
  placements: readonly ManagedChunkPlacementRequirement[],
): ManagedChunkContractRequirement[] {
  const inventory = new Map<string, ManagedChunkContractRequirement>();
  const add = (requirement: ManagedChunkContractRequirement) => {
    const key = definitionIdentity(requirement);
    const existing = inventory.get(key);
    if (existing && existing.contractDigest !== requirement.contractDigest) {
      throw new Error(`Conflicting required digest: ${key}`);
    }
    inventory.set(key, {
      ...requirement,
      sources: [...new Set([
        ...(existing?.sources ?? []), ...requirement.sources,
      ])].sort(),
    });
  };
  contracts.forEach(add);
  placements.forEach((placement) => add({
    packageId,
    definitionKey: placement.definitionKey,
    schemaVersion: placement.schemaVersion,
    contractDigest: placement.contractDigest,
    sources: [placement.source],
  }));
  return [...inventory.values()];
}

function sortReasons(
  reasons: ManagedChunkCompatibilityReason[],
): ManagedChunkCompatibilityReason[] {
  return reasons.sort((left, right) => {
    const leftKey = JSON.stringify(left);
    const rightKey = JSON.stringify(right);
    return leftKey.localeCompare(rightKey);
  });
}

export function checkManagedChunkContractCompatibility(
  candidate: ManagedChunkCompatibilityCandidate,
  trustedRendererKeys: ReadonlySet<string>,
  contracts: readonly ManagedChunkContractRequirement[],
  placements: readonly ManagedChunkPlacementRequirement[],
): ManagedChunkCompatibilityResult {
  for (const requirement of contracts) {
    if (requirement.packageId !== candidate.packageId) {
      throw new Error(
        `Contract requirement package mismatch: ${requirement.packageId}`,
      );
    }
  }
  const definitions = uniqueMap(
    candidate.definitions, definitionIdentity, 'candidate definition',
  );
  const slots = uniqueMap(candidate.slots, slotIdentity, 'candidate slot');
  const reasons: ManagedChunkCompatibilityReason[] = [];

  for (const requirement of requirementInventory(candidate.packageId, contracts, placements)) {
    const packageId = requirement.packageId;
    const definition = definitions.get(definitionIdentity(requirement));
    if (!definition) {
      reasons.push({
        code: 'missing_definition', packageId,
        definitionKey: requirement.definitionKey,
        schemaVersion: requirement.schemaVersion,
      });
      continue;
    }
    if (definition.contractDigest !== requirement.contractDigest) {
      reasons.push({
        code: 'contract_digest_mismatch', packageId,
        definitionKey: requirement.definitionKey,
        schemaVersion: requirement.schemaVersion,
        expectedDigest: requirement.contractDigest,
        candidateDigest: definition.contractDigest,
      });
    }
  }

  for (const definition of candidate.definitions) {
    if (!trustedRendererKeys.has(definition.rendererKey)) {
      reasons.push({
        code: 'renderer_unavailable',
        packageId: candidate.packageId,
        definitionKey: definition.definitionKey,
        schemaVersion: definition.schemaVersion,
        rendererKey: definition.rendererKey,
      });
    }
  }

  const placementGroups = new Map<string, ManagedChunkPlacementRequirement[]>();
  for (const placement of placements) {
    const slot = slots.get(slotIdentity(placement));
    const base = {
      packageId: candidate.packageId,
      definitionKey: placement.definitionKey,
      schemaVersion: placement.schemaVersion,
      source: placement.source,
      layoutKey: placement.layoutKey,
      templateKey: placement.templateKey,
      templateVersion: placement.templateVersion,
      slotKey: placement.slotKey,
    };
    if (!Number.isSafeInteger(placement.position) || placement.position < 0) {
      reasons.push({
        code: 'invalid_layout_position', ...base,
        position: placement.position,
      });
      continue;
    }
    if (!slot) {
      reasons.push({ code: 'slot_missing', ...base });
      continue;
    }
    if (!slot.allowedChunks.some((allowed) =>
      definitionIdentity(allowed) === definitionIdentity(placement))) {
      reasons.push({ code: 'slot_disallows_definition', ...base });
    }
    const groupKey = layoutSlotIdentity(placement);
    const group = placementGroups.get(groupKey) ?? [];
    if (group.some(({ position }) => position === placement.position)) {
      reasons.push({
        code: 'invalid_layout_position', ...base,
        position: placement.position,
      });
      continue;
    }
    placementGroups.set(groupKey, [...group, placement]);
  }

  for (const group of placementGroups.values()) {
    const first = group[0];
    const slot = slots.get(slotIdentity(first));
    if (slot && group.length > slot.maxItems) {
      reasons.push({
        code: 'slot_capacity_exceeded',
        packageId: candidate.packageId,
        source: first.source,
        layoutKey: first.layoutKey,
        templateKey: first.templateKey,
        templateVersion: first.templateVersion,
        slotKey: first.slotKey,
        actualItems: group.length,
        maxItems: slot.maxItems,
      });
    }
  }

  const sorted = sortReasons(reasons);
  return { compatible: sorted.length === 0, reasons: sorted };
}
```

- [ ] **Step 4: Run the compatibility spec to verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-compatibility
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit the pure compatibility primitive**

```powershell
git add apps/api/src/template-packages/managed-chunk-compatibility.ts apps/api/src/template-packages/managed-chunk-compatibility.spec.ts
git commit -m "feat(api): compare managed chunk package compatibility"
```
## Task 5: Trusted frontend runtime catalog

**Files:**

- Create: `apps/web/src/app/chunk-runtime-catalog.ts`
- Create: `apps/web/test/managed-chunk-runtime.test.mjs`

- [ ] **Step 1: Write failing build-side test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createChunkRuntimeCatalog } from "../src/app/chunk-runtime-catalog.ts";

const manifest = JSON.parse(await readFile(new URL(
  "../../api/test/fixtures/managed-chunks-v2.fixture.json",
  import.meta.url,
), "utf8"));
const FixtureBanner = Symbol("FixtureBanner");

test("resolves exact package/definition identity", () => {
  const catalog = createChunkRuntimeCatalog(manifest, {
    "fixture-banner-renderer": FixtureBanner,
  });
  assert.equal(catalog.resolve({
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    definitionKey: "fixture-banner",
    schemaVersion: "1",
  })?.implementation, FixtureBanner);
  assert.equal(catalog.resolve({
    packageId: manifest.packageId, packageVersion: "999",
    definitionKey: "fixture-banner", schemaVersion: "1",
  }), null);
});

test("fails build catalog when renderer lacks a trusted binding", () => {
  assert.throws(() => createChunkRuntimeCatalog(manifest, {}),
    /fixture-banner-renderer.*runtime binding/i);
});

test("fails closed on a duplicate runtime identity", () => {
  const duplicate = {
    ...manifest,
    chunkDefinitions: [
      ...manifest.chunkDefinitions,
      { ...manifest.chunkDefinitions[0], rendererKey: "other-renderer" },
    ],
  };
  assert.throws(() => createChunkRuntimeCatalog(duplicate, {
    "fixture-banner-renderer": FixtureBanner,
    "other-renderer": Symbol("OtherRenderer"),
  }), /duplicate chunk runtime identity/i);
});
```

- [ ] **Step 2: Run test to verify RED**

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/managed-chunk-runtime.test.mjs
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement generic trusted catalog**

```ts
type ChunkRuntimeManifest = {
  packageId: string;
  packageVersion: string;
  chunkDefinitions: Array<{
    key: string; schemaVersion: string; rendererKey: string;
  }>;
};
export type ChunkRuntimeIdentity = {
  packageId: string; packageVersion: string;
  definitionKey: string; schemaVersion: string;
};
export function chunkRuntimeIdentity(value: ChunkRuntimeIdentity) {
  return [value.packageId, value.packageVersion,
    value.definitionKey, value.schemaVersion].join(':');
}
export function createChunkRuntimeCatalog<Implementation>(
  manifest: ChunkRuntimeManifest,
  bindings: Readonly<Record<string, Implementation>>,
) {
  const entries = new Map<string, {
    identity: string;
    rendererKey: string;
    implementation: Implementation;
  }>();
  for (const definition of manifest.chunkDefinitions) {
    if (!Object.prototype.hasOwnProperty.call(bindings, definition.rendererKey)) {
      throw new Error(`${definition.rendererKey} has no trusted chunk runtime binding`);
    }
    const identity = chunkRuntimeIdentity({
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      definitionKey: definition.key,
      schemaVersion: definition.schemaVersion,
    });
    if (entries.has(identity)) {
      throw new Error(`Duplicate chunk runtime identity: ${identity}`);
    }
    entries.set(identity, {
      identity,
      rendererKey: definition.rendererKey,
      implementation: bindings[definition.rendererKey],
    });
  }
  return {
    resolve(identity: ChunkRuntimeIdentity) {
      return entries.get(chunkRuntimeIdentity(identity)) ?? null;
    },
  };
}
```

Do not import API source or modify current `template-runtime-catalog.ts`. Manifest keys never become module paths/dynamic imports. No API allowlist, network attestation or real Skinova wiring.

- [ ] **Step 4: Run test and typecheck**

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/managed-chunk-runtime.test.mjs
pnpm --dir apps/web exec tsc --noEmit
```

Expected: test PASS; TypeScript exits 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/app/chunk-runtime-catalog.ts apps/web/test/managed-chunk-runtime.test.mjs
git commit -m "feat(web): add managed chunk runtime catalog"
```

## Task 6: Preserve v1 release boundary and finish evidence

**Files:**

- Modify: `docs/change-log.md`

- [ ] **Step 1: Re-run the v1/v2 boundary characterization created in Task 3**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk-release-boundary
```

Expected: PASS. Any failure means Phase 1 crossed its approved boundary and must be corrected; do not weaken production code to make it pass.

- [ ] **Step 2: Run complete focused Phase 1 verification**

```powershell
pnpm --dir apps/api test --runInBand -- managed-chunk
pnpm --dir apps/web exec node --experimental-strip-types --test test/managed-chunk-runtime.test.mjs test/template-package-runtime.test.mjs
node --test scripts/register-template-package.test.mjs
pnpm --dir apps/api build
pnpm --dir apps/web exec tsc --noEmit
```

Expected: all tests PASS and compile commands exit 0. Existing release CLI tests prove `register/preflight/report-deployed` behavior is unchanged.

- [ ] **Step 3: Verify forbidden production and DB files are untouched**

```powershell
git diff --name-only origin/main...HEAD
git diff origin/main...HEAD -- apps/api/src/database apps/api/src/template-packages/template-package.types.ts apps/api/src/template-packages/template-package.validation.ts apps/api/src/template-packages/template-package.dto.ts apps/api/src/template-packages/template-package.service.ts apps/web/template-packages/skinova/manifest.template.json scripts/template-package-release.mjs
```

Expected: second command has no output. No migration/entity/data change, Skinova v2, banner behavior, DTO/register wiring or CLI preflight change exists.

- [ ] **Step 4: Self-review against spec/no placeholders/type consistency**

```powershell
rg -n "[T]BD|[T]ODO|[i]mplement later|[s]imilar to|[f]ill in" docs/superpowers/plans/2026-10-07-managed-chunks-manifest-v2.md apps/api/src/template-packages/managed-chunk* apps/web/src/app/chunk-runtime-catalog.ts apps/web/test/managed-chunk-runtime.test.mjs
git diff --check
```

Expected: no placeholder match and `git diff --check` exits 0. Re-read spec sections Manifest v2, Fields, Compatibility, Implementation Phases; map each Phase 1 requirement to a test and confirm all DB/UI/publication work is deferred.

- [ ] **Step 5: Update existing journal entry**

Record exact changed files, commits and verification. Explicitly state:

- schema/data/saved-value format/migrations did not change;
- production TemplatePackage v1, real Skinova manifest, banners and CLI preflight did not change;
- no shared DB, Docker, VDS, Registry, push, merge or deployment was used;
- DB-backed published/draft compatibility, runtime attestation and release wiring remain later phases.

- [ ] **Step 6: Commit documentation**

```powershell
git add docs/change-log.md
git commit -m "docs: record managed chunks phase one verification"
```

- [ ] **Step 7: Final clean-state evidence**

```powershell
git status --short --branch
git log --oneline --decorate -8
```

Expected: clean `codex/managed-chunks-sdk-v1`, local commits only. Do not push, merge, deploy or call the feature released without separate owner instruction.

## Explicitly deferred to later plans

- TypeORM migrations/tables for contracts, instances and placements.
- Contract materialization during package registration and DB `manifest_version` constraint change.
- Production union/alias, DTO/controller/service/register wiring and CLI preflight changes.
- DB-backed published/draft/layout inventory and runtime capability attestation.
- Real Skinova v2, banner backfill, shadow read, dual write and banner behavior.
- TinyMCE, sanitizer, media and instance-payload validation.
- Site navigation/forms, approval workflow, public/preview rendering and immutable SiteRelease integration.
