/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import { assertValidManagedChunkManifestV2 } from './managed-chunk-validation';

const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../test/fixtures/managed-chunks-v2.fixture.json'),
    'utf8',
  ),
) as Record<string, any>;
const validFixture = () => structuredClone(fixture);
const textField = (index: number) => ({
  key: `field-${index}`,
  label: `Field ${index}`,
  widget: 'text',
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
    expect(
      assertValidManagedChunkManifestV2(validFixture()).definitions[0]
        .contractDigest,
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
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
    expect(
      assertValidManagedChunkManifestV2(input).manifest.manifestVersion,
    ).toBe(2);
  });

  it.each([
    [
      'default',
      (m: any) =>
        Object.assign(m.chunkDefinitions[0].fields[0], { default: 'x' }),
    ],
    [
      'unknown widget',
      (m: any) => {
        m.chunkDefinitions[0].fields[0].widget = 'code';
      },
    ],
    [
      'unknown constraint',
      (m: any) =>
        Object.assign((m.chunkDefinitions[0].fields[0].constraints ??= {}), {
          pattern: '.*',
        }),
    ],
    [
      'arbitrary icon',
      (m: any) => {
        m.chunkCategories[0].iconKey = '<svg />';
      },
    ],
    [
      'unknown provider',
      (m: any) => {
        m.chunkDefinitions[0].fields[2].constraints.iframeProviders = ['vimeo'];
      },
    ],
    [
      'mediaFile policy',
      (m: any) => {
        m.chunkDefinitions[0].fields.push({
          key: 'file',
          label: 'File',
          widget: 'mediaFile',
          constraints: { maxBytes: 10 },
        });
      },
    ],
    [
      'missing category',
      (m: any) => {
        m.chunkDefinitions[0].categoryKey = 'missing';
      },
    ],
    [
      'missing allowed definition',
      (m: any) => {
        m.templates[0].slots[0].allowedChunks[0].definitionKey = 'missing';
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const input = validFixture();
    mutate(input);
    expect(() => assertValidManagedChunkManifestV2(input)).toThrow();
  });

  it.each([
    ['text', 2001],
    ['textarea', 20001],
    ['html', 65537],
  ])('rejects %s maxLength above its fixed cap', (widget, maxLength) => {
    const input = validFixture();
    input.chunkDefinitions[0].fields = [
      {
        key: 'value',
        label: 'Value',
        widget,
        constraints: { maxLength },
      },
    ];
    expect(() => assertValidManagedChunkManifestV2(input)).toThrow(/maxLength/);
  });

  it('rejects duplicate keys, values and references', () => {
    const category = validFixture();
    category.chunkCategories.push(structuredClone(category.chunkCategories[0]));
    expect(() => assertValidManagedChunkManifestV2(category)).toThrow(
      /duplicate/i,
    );

    const fields = validFixture();
    fields.chunkDefinitions[0].fields.push(
      structuredClone(fields.chunkDefinitions[0].fields[0]),
    );
    expect(() => assertValidManagedChunkManifestV2(fields)).toThrow(
      /duplicate/i,
    );

    const options = validFixture();
    options.chunkDefinitions[0].fields = [
      {
        key: 'kind',
        label: 'Kind',
        widget: 'select',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'Again' },
        ],
      },
    ];
    expect(() => assertValidManagedChunkManifestV2(options)).toThrow(
      /duplicate/i,
    );

    const allowed = validFixture();
    allowed.templates[0].slots[0].allowedChunks.push(
      structuredClone(allowed.templates[0].slots[0].allowedChunks[0]),
    );
    expect(() => assertValidManagedChunkManifestV2(allowed)).toThrow(
      /duplicate/i,
    );
  });

  it('enforces package-wide and nested complexity budgets', () => {
    const categories = validFixture();
    categories.chunkCategories = Array.from({ length: 51 }, (_, index) => ({
      key: `category-${index}`,
      title: `Category ${index}`,
      order: index,
    }));
    expect(() => assertValidManagedChunkManifestV2(categories)).toThrow(
      /categories/i,
    );

    const definitions = validFixture();
    definitions.chunkDefinitions = Array.from({ length: 101 }, (_, index) => ({
      ...structuredClone(definitions.chunkDefinitions[0]),
      key: `definition-${index}`,
    }));
    expect(() => assertValidManagedChunkManifestV2(definitions)).toThrow(
      /definitions/i,
    );

    const oneDefinition = validFixture();
    oneDefinition.chunkDefinitions[0].fields = Array.from(
      { length: 257 },
      (_, index) => textField(index),
    );
    expect(() => assertValidManagedChunkManifestV2(oneDefinition)).toThrow(
      /256/,
    );

    const packageFields = validFixture();
    packageFields.chunkDefinitions = Array.from(
      { length: 10 },
      (_, definition) => ({
        ...structuredClone(packageFields.chunkDefinitions[0]),
        key: `definition-${definition}`,
        fields: Array.from({ length: 201 }, (_, index) => textField(index)),
      }),
    );
    expect(() => assertValidManagedChunkManifestV2(packageFields)).toThrow(
      /2000/,
    );

    const siblings = validFixture();
    siblings.chunkDefinitions[0].fields = [
      {
        key: 'group',
        label: 'Group',
        widget: 'group',
        fields: Array.from({ length: 65 }, (_, index) => textField(index)),
      },
    ];
    expect(() => assertValidManagedChunkManifestV2(siblings)).toThrow(/64/);

    const nestedGroup = (depth: number): Record<string, unknown> =>
      depth === 0
        ? textField(depth)
        : {
            key: `group-${depth}`,
            label: `Group ${depth}`,
            widget: 'group',
            fields: [nestedGroup(depth - 1)],
          };
    const depth = validFixture();
    depth.chunkDefinitions[0].fields = [nestedGroup(7)];
    expect(() => assertValidManagedChunkManifestV2(depth)).toThrow(/depth 6/);

    const nestedRepeater = (depth: number): Record<string, unknown> =>
      depth === 0
        ? textField(depth)
        : {
            key: `repeater-${depth}`,
            label: `Repeater ${depth}`,
            widget: 'repeater',
            fields: [nestedRepeater(depth - 1)],
          };
    const repeaters = validFixture();
    repeaters.chunkDefinitions[0].fields = [nestedRepeater(3)];
    expect(() => assertValidManagedChunkManifestV2(repeaters)).toThrow(
      /repeater depth 2/,
    );

    const select = validFixture();
    select.chunkDefinitions[0].fields = [
      {
        key: 'choice',
        label: 'Choice',
        widget: 'select',
        options: Array.from({ length: 101 }, (_, index) => ({
          value: `value-${index}`,
          label: `Value ${index}`,
        })),
      },
    ];
    expect(() => assertValidManagedChunkManifestV2(select)).toThrow(/100/);

    const slots = validFixture();
    const baseSlot = slots.templates[0].slots[0];
    slots.templates[0].slots = Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(baseSlot),
      key: `slot-a-${index}`,
    }));
    const secondTemplate = structuredClone(slots.templates[0]);
    secondTemplate.key = 'fixture-home-second';
    secondTemplate.slots = Array.from({ length: 51 }, (_, index) => ({
      ...structuredClone(baseSlot),
      key: `slot-b-${index}`,
    }));
    slots.templates.push(secondTemplate);
    expect(() => assertValidManagedChunkManifestV2(slots)).toThrow(/100 slots/);
  });

  it('rejects unsafe non-JSON inputs before cloning or Ajv', () => {
    const customPrototype = validFixture();
    Object.setPrototypeOf(customPrototype, { polluted: true });
    expect(() => assertValidManagedChunkManifestV2(customPrototype)).toThrow(
      /plain JSON/i,
    );

    const nonFinite = validFixture();
    nonFinite.chunkCategories[0].order = Number.NaN;
    expect(() => assertValidManagedChunkManifestV2(nonFinite)).toThrow(
      /finite/i,
    );

    const executable = validFixture();
    executable.chunkDefinitions[0].fields[0].handler = () => true;
    expect(() => assertValidManagedChunkManifestV2(executable)).toThrow(
      /JSON/i,
    );

    const cyclic = validFixture();
    cyclic.loop = cyclic;
    expect(() => assertValidManagedChunkManifestV2(cyclic)).toThrow(/cyclic/i);
  });
  it('rejects structural JSON hazards without invoking accessors', () => {
    const sparse = validFixture();
    sparse.chunkDefinitions[0].fields = new Array(1);
    expect(() => assertValidManagedChunkManifestV2(sparse)).toThrow(
      /dense JSON array/i,
    );

    const extendedArray = validFixture();
    extendedArray.chunkDefinitions[0].fields.extra = true;
    expect(() => assertValidManagedChunkManifestV2(extendedArray)).toThrow(
      /array property/i,
    );

    const symbolKey = validFixture();
    Object.defineProperty(symbolKey, Symbol('hidden'), {
      value: true,
      enumerable: true,
    });
    expect(() => assertValidManagedChunkManifestV2(symbolKey)).toThrow(
      /symbol/i,
    );

    let invoked = false;
    const accessor = validFixture();
    Object.defineProperty(accessor.chunkDefinitions[0], 'trap', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 'unsafe';
      },
    });
    expect(() => assertValidManagedChunkManifestV2(accessor)).toThrow(
      /accessor/i,
    );
    expect(invoked).toBe(false);

    let inheritedGetterInvoked = false;
    let constructorTrapInvoked = false;
    const spoofedPrototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(spoofedPrototype, 'constructor', {
      value: new Proxy(function FakeObject() {}, {
        get: () => {
          constructorTrapInvoked = true;
          return 'Object';
        },
      }),
      enumerable: false,
    });
    Object.defineProperty(spoofedPrototype, 'manifestVersion', {
      get: () => {
        inheritedGetterInvoked = true;
        return 2;
      },
    });
    const spoofed = validFixture();
    Object.setPrototypeOf(spoofed, spoofedPrototype);
    expect(() => assertValidManagedChunkManifestV2(spoofed)).toThrow(
      /plain JSON object/i,
    );
    expect(inheritedGetterInvoked).toBe(false);
    expect(constructorTrapInvoked).toBe(false);
    const hidden = validFixture();
    Object.defineProperty(hidden.chunkDefinitions[0], 'hidden', {
      value: true,
      configurable: true,
      enumerable: false,
    });
    expect(() => assertValidManagedChunkManifestV2(hidden)).toThrow(
      /enumerable/i,
    );
  });

  it('bounds structural traversal before semantic validation', () => {
    const oversizedArray = validFixture();
    oversizedArray.unexpected = Array.from({ length: 10_001 }, () => null);
    expect(() => assertValidManagedChunkManifestV2(oversizedArray)).toThrow(
      /10000 entries/i,
    );

    const excessiveDepth = validFixture();
    let cursor = excessiveDepth;
    for (let index = 0; index < 51; index += 1) {
      cursor.unexpected = {};
      cursor = cursor.unexpected;
    }
    expect(() => assertValidManagedChunkManifestV2(excessiveDepth)).toThrow(
      /JSON depth 50/i,
    );

    const excessiveNodes = validFixture();
    excessiveNodes.unexpected = Array.from({ length: 10_000 }, () => ({
      one: null,
      two: null,
      three: null,
      four: null,
      five: null,
    }));
    expect(() => assertValidManagedChunkManifestV2(excessiveNodes)).toThrow(
      /JSON node budget 50000/i,
    );

    const oversizedString = validFixture();
    oversizedString.unexpected = 'x'.repeat(100_001);
    expect(() => assertValidManagedChunkManifestV2(oversizedString)).toThrow(
      /100000 string characters/i,
    );
    const amplifiedPath = validFixture();
    amplifiedPath['x'.repeat(513)] = true;
    expect(() => assertValidManagedChunkManifestV2(amplifiedPath)).toThrow(
      /key length 512/i,
    );
  });
});
