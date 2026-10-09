import { BadRequestException, ConflictException } from '@nestjs/common';
import Ajv from 'ajv';
import { types as nodeUtilTypes } from 'node:util';
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
import type {
  JsonSchema,
  TemplatePackageManifest,
} from './template-package.types';
import { assertValidTemplatePackageManifest } from './template-package.validation';

const MACHINE_KEY = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/;
const SELECT_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_JSON_DEPTH = 50;
const MAX_JSON_NODES = 50_000;
const MAX_JSON_CONTAINER_ENTRIES = 10_000;
const MAX_JSON_KEY_LENGTH = 512;
const MAX_JSON_PATH_LENGTH = 4_096;
const MAX_JSON_STRING_LENGTH = 100_000;
const TRUSTED_OBJECT_PROTOTYPES = new Set<object>([
  Object.prototype,
  Object.getPrototypeOf(structuredClone({})) as object,
]);
const TRUSTED_ARRAY_PROTOTYPES = new Set<object>([
  Array.prototype,
  Object.getPrototypeOf(structuredClone([])) as object,
]);
const COMMON_FIELD_KEYS = [
  'key',
  'label',
  'help',
  'required',
  'nullable',
  'widget',
];
const TOP_KEYS = new Set([
  'manifestVersion',
  'packageId',
  'packageVersion',
  'title',
  'siteType',
  'cmsApi',
  'source',
  'build',
  'templates',
  'chunkCategories',
  'chunkDefinitions',
]);
const CATEGORY_KEYS = new Set(['key', 'title', 'order', 'iconKey']);
const DEFINITION_KEYS = new Set([
  'key',
  'schemaVersion',
  'title',
  'categoryKey',
  'rendererKey',
  'contractDigest',
  'fields',
]);
const SLOT_KEYS = new Set([
  'key',
  'title',
  'placement',
  'maxItems',
  'allowedChunks',
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
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== null && !TRUSTED_OBJECT_PROTOTYPES.has(prototype)) {
    invalid(path, 'must be a plain JSON object');
  }
  return value as PlainRecord;
}

function childPath(parent: string, segment: string, isIndex = false): string {
  if (segment.length > MAX_JSON_KEY_LENGTH) {
    invalid(parent, `contains a key above key length ${MAX_JSON_KEY_LENGTH}`);
  }
  const result = isIndex ? `${parent}[${segment}]` : `${parent}.${segment}`;
  if (result.length > MAX_JSON_PATH_LENGTH) {
    invalid(parent, `exceeds JSON path length ${MAX_JSON_PATH_LENGTH}`);
  }
  return result;
}

function dataDescriptorValue(
  value: object,
  key: string,
  path: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || 'get' in descriptor || 'set' in descriptor) {
    invalid(path, 'must not be an accessor property');
  }
  if (descriptor.enumerable !== true) {
    invalid(path, 'must be an enumerable JSON property');
  }
  return descriptor.value;
}

type JsonContainer = PlainRecord | unknown[];
type JsonScanFrame = {
  value: unknown;
  path: string;
  depth: number;
  parent: JsonContainer | null;
  key: string | number | null;
};

function assignSanitized(
  frame: JsonScanFrame,
  value: unknown,
  setRoot: (value: unknown) => void,
): void {
  if (frame.parent === null) {
    setRoot(value);
    return;
  }
  if (Array.isArray(frame.parent)) {
    frame.parent[frame.key as number] = value;
    return;
  }
  Object.defineProperty(frame.parent, frame.key as string, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function assertPlainJson(value: unknown, rootPath = 'manifest'): unknown {
  const seen = new WeakSet<object>();
  const stack: JsonScanFrame[] = [
    { value, path: rootPath, depth: 0, parent: null, key: null },
  ];
  let nodes = 0;
  let sanitized: unknown;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      invalid(rootPath, `exceeds JSON node budget ${MAX_JSON_NODES}`);
    }
    if (current.depth > MAX_JSON_DEPTH) {
      invalid(current.path, `exceeds JSON depth ${MAX_JSON_DEPTH}`);
    }

    const nested = current.value;
    if (nested === null || typeof nested === 'boolean') {
      assignSanitized(current, nested, (result) => (sanitized = result));
      continue;
    }
    if (typeof nested === 'string') {
      if (nested.length > MAX_JSON_STRING_LENGTH) {
        invalid(
          current.path,
          `must not exceed ${MAX_JSON_STRING_LENGTH} string characters`,
        );
      }
      assignSanitized(current, nested, (result) => (sanitized = result));
      continue;
    }
    if (typeof nested === 'number') {
      if (!Number.isFinite(nested)) {
        invalid(current.path, 'must contain finite numbers');
      }
      assignSanitized(current, nested, (result) => (sanitized = result));
      continue;
    }
    if (typeof nested !== 'object') {
      invalid(current.path, 'must contain JSON values only');
    }
    if (nodeUtilTypes.isProxy(nested)) {
      invalid(current.path, 'must not contain proxy objects');
    }
    if (seen.has(nested)) {
      invalid(current.path, 'contains a cyclic or repeated value');
    }
    seen.add(nested);

    const prototype = Object.getPrototypeOf(nested) as object | null;
    if (Array.isArray(nested)) {
      if (prototype === null || !TRUSTED_ARRAY_PROTOTYPES.has(prototype)) {
        invalid(current.path, 'must be a plain JSON array');
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(
        nested,
        'length',
      );
      const length: unknown = lengthDescriptor?.value;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        invalid(current.path, 'must have a valid JSON array length');
      }
      if (length > MAX_JSON_CONTAINER_ENTRIES) {
        invalid(
          current.path,
          `must not contain more than ${MAX_JSON_CONTAINER_ENTRIES} entries`,
        );
      }
      const ownKeys = Reflect.ownKeys(nested);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        invalid(current.path, 'must not contain symbol keys');
      }
      const keys = (ownKeys as string[]).filter((key) => key !== 'length');
      for (const key of keys) {
        if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
          invalid(
            childPath(current.path, key),
            'is an unsupported array property',
          );
        }
      }
      if (keys.length !== length) {
        invalid(current.path, 'must be a dense JSON array');
      }
      const output = new Array<unknown>(length);
      assignSanitized(current, output, (result) => (sanitized = result));
      for (const key of keys) {
        const itemPath = childPath(current.path, key, true);
        stack.push({
          value: dataDescriptorValue(nested, key, itemPath),
          path: itemPath,
          depth: current.depth + 1,
          parent: output,
          key: Number(key),
        });
      }
      continue;
    }

    if (prototype !== null && !TRUSTED_OBJECT_PROTOTYPES.has(prototype)) {
      invalid(current.path, 'must be a plain JSON object');
    }
    const ownKeys = Reflect.ownKeys(nested);
    if (ownKeys.length > MAX_JSON_CONTAINER_ENTRIES) {
      invalid(
        current.path,
        `must not contain more than ${MAX_JSON_CONTAINER_ENTRIES} entries`,
      );
    }
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      invalid(current.path, 'must not contain symbol keys');
    }
    const output = Object.create(null) as PlainRecord;
    assignSanitized(current, output, (result) => (sanitized = result));
    for (const key of ownKeys as string[]) {
      const nestedPath = childPath(current.path, key);
      stack.push({
        value: dataDescriptorValue(nested, key, nestedPath),
        path: nestedPath,
        depth: current.depth + 1,
        parent: output,
        key,
      });
    }
  }

  return sanitized;
}
function exact(
  record: PlainRecord,
  allowed: ReadonlySet<string>,
  path: string,
) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${path}.${key}`, 'is not allowed');
  }
}

function array(
  value: unknown,
  path: string,
  min: number,
  max: number,
): unknown[] {
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
  if (!MACHINE_KEY.test(result) || RESERVED.has(result))
    invalid(path, 'is invalid');
  return result;
}

function version(value: unknown, path: string): string {
  const result = string(value, path, 40);
  if (!VERSION.test(result)) invalid(path, 'must be a numeric version');
  return result;
}

function booleanIfPresent(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean')
    invalid(path, 'must be boolean');
}

function integer(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
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
  if (new Set(values).size !== values.length)
    invalid(path, 'contains a duplicate');
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
  const min =
    record.minLength === undefined
      ? 0
      : integer(record.minLength, `${path}.minLength`, 0, cap);
  const max =
    record.maxLength === undefined
      ? cap
      : integer(record.maxLength, `${path}.maxLength`, 0, cap);
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
  if (step !== undefined && step <= 0)
    invalid(`${path}.step`, 'must be positive');
}

function validateStringCatalog(
  value: unknown,
  path: string,
  catalog: readonly string[],
): void {
  if (value === undefined) return;
  const entries = array(value, path, 1, catalog.length).map((entry, index) => {
    const result = string(entry, `${path}[${index}]`, 20);
    if (!catalog.includes(result))
      invalid(`${path}[${index}]`, 'is unsupported');
    return result;
  });
  unique(entries, path);
}

function validateLinkConstraints(value: unknown, path: string): void {
  const record = constraints(value, path, [
    'protocols',
    'targets',
    'maxUrlLength',
    'maxLabelLength',
  ]);
  validateStringCatalog(
    record.protocols,
    `${path}.protocols`,
    MANAGED_LINK_PROTOCOLS,
  );
  validateStringCatalog(
    record.targets,
    `${path}.targets`,
    MANAGED_LINK_TARGETS,
  );
  if (record.maxUrlLength !== undefined) {
    integer(record.maxUrlLength, `${path}.maxUrlLength`, 1, 2_048);
  }
  if (record.maxLabelLength !== undefined) {
    integer(record.maxLabelLength, `${path}.maxLabelLength`, 0, 500);
  }
}

function validateImageConstraints(value: unknown, path: string): void {
  const record = constraints(value, path, [
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
  ]);
  const read = (key: string) =>
    record[key] === undefined
      ? undefined
      : integer(record[key], `${path}.${key}`, 1, 100_000);
  const minWidth = read('minWidth');
  const maxWidth = read('maxWidth');
  const minHeight = read('minHeight');
  const maxHeight = read('maxHeight');
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) {
    invalid(path, 'has minWidth above maxWidth');
  }
  if (
    minHeight !== undefined &&
    maxHeight !== undefined &&
    minHeight > maxHeight
  ) {
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
    const extraKeys =
      widget === 'select'
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
    if (field.help !== undefined)
      string(field.help, `${fieldPath}.help`, 1_000);
    booleanIfPresent(field.required, `${fieldPath}.required`);
    booleanIfPresent(field.nullable, `${fieldPath}.nullable`);

    switch (widget) {
      case 'text':
        validateLengthConstraints(
          field.constraints,
          `${fieldPath}.constraints`,
          2_000,
          false,
        );
        break;
      case 'textarea':
        validateLengthConstraints(
          field.constraints,
          `${fieldPath}.constraints`,
          20_000,
          false,
        );
        break;
      case 'html':
        validateLengthConstraints(
          field.constraints,
          `${fieldPath}.constraints`,
          65_536,
          true,
        );
        break;
      case 'number':
        validateNumberConstraints(
          field.constraints,
          `${fieldPath}.constraints`,
        );
        break;
      case 'boolean':
      case 'mediaFile':
        break;
      case 'select': {
        const optionValues = array(
          field.options,
          `${fieldPath}.options`,
          1,
          100,
        ).map((rawOption, optionIndex) => {
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
        validateFields(
          field.fields,
          `${fieldPath}.fields`,
          budget,
          depth + 1,
          repeaterDepth,
          64,
        );
        break;
      case 'repeater': {
        const nextRepeaterDepth = repeaterDepth + 1;
        if (nextRepeaterDepth > 2)
          invalid(fieldPath, 'exceeds repeater depth 2');
        const record = constraints(
          field.constraints,
          `${fieldPath}.constraints`,
          ['minItems', 'maxItems'],
        );
        const min =
          record.minItems === undefined
            ? 0
            : integer(
                record.minItems,
                `${fieldPath}.constraints.minItems`,
                0,
                100,
              );
        const max =
          record.maxItems === undefined
            ? 100
            : integer(
                record.maxItems,
                `${fieldPath}.constraints.maxItems`,
                0,
                100,
              );
        if (min > max)
          invalid(`${fieldPath}.constraints`, 'has minItems above maxItems');
        validateFields(
          field.fields,
          `${fieldPath}.fields`,
          budget,
          depth + 1,
          nextRepeaterDepth,
          64,
        );
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
  for (const rawTemplate of templates)
    delete plainRecord(rawTemplate, 'template').slots;
  return assertValidTemplatePackageManifest(projection);
}

export function assertValidManagedChunkManifestV2(
  input: unknown,
): ValidatedManagedChunkManifestV2 {
  const original = plainRecord(assertPlainJson(input), 'manifest');
  exact(original, TOP_KEYS, 'manifest');
  if (original.manifestVersion !== 2) invalid('manifestVersion', 'must be 2');
  v1Projection(original);
  const manifest = structuredClone(
    original,
  ) as unknown as TemplatePackageManifestV2;
  const categories = array(manifest.chunkCategories, 'chunkCategories', 1, 50);
  const categoryKeys = categories.map((rawCategory, index) => {
    const path = `chunkCategories[${index}]`;
    const category = plainRecord(rawCategory, path);
    exact(category, CATEGORY_KEYS, path);
    const key = machine(category.key, `${path}.key`, 80);
    string(category.title, `${path}.title`, 160);
    integer(category.order, `${path}.order`, -10_000, 10_000);
    if (
      category.iconKey !== undefined &&
      !CMS_CHUNK_ICON_KEYS.includes(category.iconKey as never)
    ) {
      invalid(`${path}.iconKey`, 'is unsupported');
    }
    return key;
  });
  unique(categoryKeys, 'chunkCategories');

  const budget: Budget = { fields: 0, slots: 0 };
  const ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true });
  const definitions = array(
    manifest.chunkDefinitions,
    'chunkDefinitions',
    1,
    100,
  ).map((rawDefinition, index) => {
    const path = `chunkDefinitions[${index}]`;
    const definition = plainRecord(rawDefinition, path);
    exact(definition, DEFINITION_KEYS, path);
    const key = machine(definition.key, `${path}.key`, 80);
    const schemaVersion = version(
      definition.schemaVersion,
      `${path}.schemaVersion`,
    );
    string(definition.title, `${path}.title`, 160);
    const categoryKey = machine(
      definition.categoryKey,
      `${path}.categoryKey`,
      80,
    );
    if (!categoryKeys.includes(categoryKey))
      invalid(`${path}.categoryKey`, 'does not exist');
    machine(definition.rendererKey, `${path}.rendererKey`, 100);
    const before = budget.fields;
    const fields = validateFields(
      definition.fields,
      `${path}.fields`,
      budget,
      1,
      0,
      256,
    );
    if (budget.fields - before > 256)
      invalid(`${path}.fields`, 'exceeds 256 descriptors');
    const contractDigest = computeManagedChunkContractDigest(fields);
    if (definition.contractDigest !== undefined) {
      const digestPath = `${path}.contractDigest`;
      const supplied = string(definition.contractDigest, digestPath, 71);
      if (!DIGEST.test(supplied)) invalid(digestPath, 'has invalid syntax');
      if (supplied !== contractDigest) {
        conflict(digestPath, 'contractDigest mismatch');
      }
    }
    const dataSchema: ManagedChunkObjectSchema =
      deriveManagedChunkDataSchema(fields);
    try {
      ajv.compile(dataSchema);
    } catch {
      invalid(`${path}.fields`, 'does not derive a valid schema');
    }
    return {
      ...(definition as unknown as ManagedChunkDefinition),
      key,
      schemaVersion,
      categoryKey,
      fields,
      contractDigest,
      dataSchema,
    };
  });
  unique(
    definitions.map(({ key, schemaVersion }) => `${key}:${schemaVersion}`),
    'chunkDefinitions',
  );
  const identities = new Set(
    definitions.map(({ key, schemaVersion }) => `${key}:${schemaVersion}`),
  );

  manifest.templates.forEach((rawTemplate, templateIndex) => {
    const template = plainRecord(rawTemplate, `templates[${templateIndex}]`);
    const slotKeys: string[] = [];
    const slots =
      template.slots === undefined
        ? []
        : array(template.slots, `templates[${templateIndex}].slots`, 0, 100);
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
      const references = array(
        slot.allowedChunks,
        `${path}.allowedChunks`,
        1,
        100,
      ).map((rawReference, referenceIndex) => {
        const referencePath = `${path}.allowedChunks[${referenceIndex}]`;
        const reference = plainRecord(rawReference, referencePath);
        exact(reference, REFERENCE_KEYS, referencePath);
        const identity = `${machine(
          reference.definitionKey,
          `${referencePath}.definitionKey`,
          80,
        )}:${version(
          reference.schemaVersion,
          `${referencePath}.schemaVersion`,
        )}`;
        if (!identities.has(identity))
          invalid(referencePath, 'references a missing definition');
        return identity;
      });
      unique(references, `${path}.allowedChunks`);
    });
    unique(slotKeys, `templates[${templateIndex}].slots`);
  });

  return { manifest, definitions };
}
