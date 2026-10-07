import { createHash } from 'node:crypto';
import {
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_LINK_PROTOCOLS,
  MANAGED_LINK_TARGETS,
  type ManagedChunkField,
} from './managed-chunk.types';

export const MANAGED_CHUNK_SCHEMA_LIMITS = {
  text: 2_000,
  textarea: 20_000,
  html: 65_536,
  repeater: 100,
  iframeProviders: [...CMS_IFRAME_PROVIDER_IDS],
} as const;

const MANAGED_LINK_MAX_URL_LENGTH = 2_048;
const MANAGED_LINK_MAX_LABEL_LENGTH = 500;
const MANAGED_IMAGE_ALT_MAX_LENGTH = 500;
const MANAGED_MEDIA_ID_MAX_LENGTH = 80;

type JsonSchemaType =
  'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';

export type ManagedChunkJsonSchema = {
  $schema?: 'http://json-schema.org/draft-07/schema#';
  type?: JsonSchemaType;
  properties?: Record<string, ManagedChunkJsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: ManagedChunkJsonSchema;
  anyOf?: ManagedChunkJsonSchema[];
  oneOf?: ManagedChunkJsonSchema[];
  enum?: string[];
  const?: string | boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
};

export type ManagedChunkObjectSchema = ManagedChunkJsonSchema & {
  $schema?: 'http://json-schema.org/draft-07/schema#';
  type: 'object';
  properties: Record<string, ManagedChunkJsonSchema>;
  additionalProperties: false;
};

const compareCodepoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const capped = (value: number | undefined, limit: number): number =>
  value === undefined ? limit : Math.min(value, limit);

const createMediaIdSchema = (): ManagedChunkJsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength: MANAGED_MEDIA_ID_MAX_LENGTH,
});

const createClosedObjectSchema = (
  properties: Record<string, ManagedChunkJsonSchema>,
  required: string[],
): ManagedChunkObjectSchema => {
  const schema: ManagedChunkObjectSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    schema.required = [...required].sort(compareCodepoints);
  }

  return schema;
};

const createFieldsObjectSchema = (
  fields: ManagedChunkField[],
): ManagedChunkObjectSchema => {
  const properties = Object.fromEntries(
    [...fields]
      .sort((left, right) => compareCodepoints(left.key, right.key))
      .map((field) => [field.key, createFieldSchema(field)]),
  );
  const required = fields
    .filter((field) => field.required === true)
    .map((field) => field.key);

  return createClosedObjectSchema(properties, required);
};

const createStringSchema = (
  minLength: number | undefined,
  maxLength: number | undefined,
  fixedCap: number,
): ManagedChunkJsonSchema => ({
  type: 'string',
  minLength: minLength ?? 0,
  maxLength: capped(maxLength, fixedCap),
});

const createLinkPattern = (protocols: readonly string[]): string => {
  const alternatives = [...protocols].sort(compareCodepoints).join('|');
  return `^(?:${alternatives}):`;
};

const createNonNullableFieldSchema = (
  field: ManagedChunkField,
): ManagedChunkJsonSchema => {
  switch (field.widget) {
    case 'text':
      return createStringSchema(
        field.constraints?.minLength,
        field.constraints?.maxLength,
        MANAGED_CHUNK_SCHEMA_LIMITS.text,
      );
    case 'textarea':
      return createStringSchema(
        field.constraints?.minLength,
        field.constraints?.maxLength,
        MANAGED_CHUNK_SCHEMA_LIMITS.textarea,
      );
    case 'html':
      return createStringSchema(
        field.constraints?.minLength,
        field.constraints?.maxLength,
        MANAGED_CHUNK_SCHEMA_LIMITS.html,
      );
    case 'number': {
      const schema: ManagedChunkJsonSchema = { type: 'number' };
      if (field.constraints?.min !== undefined) {
        schema.minimum = field.constraints.min;
      }
      if (field.constraints?.max !== undefined) {
        schema.maximum = field.constraints.max;
      }
      if (field.constraints?.step !== undefined) {
        schema.multipleOf = field.constraints.step;
      }
      return schema;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'select':
      return {
        type: 'string',
        enum: field.options
          .map((option) => option.value)
          .sort(compareCodepoints),
      };
    case 'link': {
      const protocols = field.constraints?.protocols ?? MANAGED_LINK_PROTOCOLS;
      const targets = field.constraints?.targets ?? MANAGED_LINK_TARGETS;
      return createClosedObjectSchema(
        {
          url: {
            type: 'string',
            minLength: 1,
            maxLength: capped(
              field.constraints?.maxUrlLength,
              MANAGED_LINK_MAX_URL_LENGTH,
            ),
            pattern: createLinkPattern(protocols),
          },
          label: {
            type: 'string',
            minLength: 0,
            maxLength: capped(
              field.constraints?.maxLabelLength,
              MANAGED_LINK_MAX_LABEL_LENGTH,
            ),
          },
          target: {
            type: 'string',
            enum: [...targets].sort(compareCodepoints),
          },
        },
        ['url'],
      );
    }
    case 'image': {
      const schema = createClosedObjectSchema(
        {
          mediaId: createMediaIdSchema(),
          alt: {
            type: 'string',
            minLength: 0,
            maxLength: MANAGED_IMAGE_ALT_MAX_LENGTH,
          },
          decorative: { type: 'boolean' },
        },
        ['mediaId', 'alt', 'decorative'],
      );
      schema.oneOf = [
        {
          properties: {
            decorative: { const: true },
            alt: { const: '' },
          },
        },
        {
          properties: {
            decorative: { const: false },
            alt: {
              type: 'string',
              minLength: 1,
              maxLength: MANAGED_IMAGE_ALT_MAX_LENGTH,
            },
          },
        },
      ];
      return schema;
    }
    case 'mediaFile':
      return createClosedObjectSchema({ mediaId: createMediaIdSchema() }, [
        'mediaId',
      ]);
    case 'group':
      return createFieldsObjectSchema(field.fields);
    case 'repeater': {
      const schema: ManagedChunkJsonSchema = {
        type: 'array',
        minItems: field.constraints?.minItems ?? 0,
        maxItems: capped(
          field.constraints?.maxItems,
          MANAGED_CHUNK_SCHEMA_LIMITS.repeater,
        ),
        items: createFieldsObjectSchema(field.fields),
      };
      return schema;
    }
  }
};

const createFieldSchema = (
  field: ManagedChunkField,
): ManagedChunkJsonSchema => {
  const schema = createNonNullableFieldSchema(field);
  return field.nullable === true
    ? { anyOf: [schema, { type: 'null' }] }
    : schema;
};

export const deriveManagedChunkDataSchema = (
  fields: ManagedChunkField[],
): ManagedChunkObjectSchema => ({
  ...createFieldsObjectSchema(fields),
  $schema: 'http://json-schema.org/draft-07/schema#',
});
type ContractValue =
  | boolean
  | number
  | string
  | ContractValue[]
  | { [key: string]: ContractValue };

type ContractObject = { [key: string]: ContractValue };

const catalogContract = (
  values: readonly string[] | undefined,
): ContractObject =>
  values === undefined
    ? { mode: 'platform-default' }
    : { mode: 'explicit', values: [...values].sort(compareCodepoints) };

const explicitNumberConstraints = (
  constraints:
    | {
        min?: number;
        max?: number;
        step?: number;
      }
    | undefined,
): ContractObject | undefined => {
  if (constraints === undefined) {
    return undefined;
  }

  const result: ContractObject = {};
  if (constraints.min !== undefined) {
    result.min = constraints.min;
  }
  if (constraints.max !== undefined) {
    result.max = constraints.max;
  }
  if (constraints.step !== undefined) {
    result.step = constraints.step;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const explicitImageConstraints = (
  constraints:
    | {
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
      }
    | undefined,
): ContractObject | undefined => {
  if (constraints === undefined) {
    return undefined;
  }

  const result: ContractObject = {};
  if (constraints.minWidth !== undefined) {
    result.minWidth = constraints.minWidth;
  }
  if (constraints.maxWidth !== undefined) {
    result.maxWidth = constraints.maxWidth;
  }
  if (constraints.minHeight !== undefined) {
    result.minHeight = constraints.minHeight;
  }
  if (constraints.maxHeight !== undefined) {
    result.maxHeight = constraints.maxHeight;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const projectContractFields = (fields: ManagedChunkField[]): ContractValue[] =>
  [...fields]
    .sort((left, right) => compareCodepoints(left.key, right.key))
    .map(projectContractField);

const projectContractField = (field: ManagedChunkField): ContractObject => {
  const common: ContractObject = {
    key: field.key,
    widget: field.widget,
    required: field.required === true,
    nullable: field.nullable === true,
  };

  switch (field.widget) {
    case 'text':
      return {
        ...common,
        constraints: {
          minLength: field.constraints?.minLength ?? 0,
          maxLength: capped(
            field.constraints?.maxLength,
            MANAGED_CHUNK_SCHEMA_LIMITS.text,
          ),
        },
      };
    case 'textarea':
      return {
        ...common,
        constraints: {
          minLength: field.constraints?.minLength ?? 0,
          maxLength: capped(
            field.constraints?.maxLength,
            MANAGED_CHUNK_SCHEMA_LIMITS.textarea,
          ),
        },
      };
    case 'html':
      return {
        ...common,
        constraints: {
          minLength: field.constraints?.minLength ?? 0,
          maxLength: capped(
            field.constraints?.maxLength,
            MANAGED_CHUNK_SCHEMA_LIMITS.html,
          ),
          iframeProviders: catalogContract(field.constraints?.iframeProviders),
        },
      };
    case 'number': {
      const constraints = explicitNumberConstraints(field.constraints);
      return constraints === undefined ? common : { ...common, constraints };
    }
    case 'boolean':
    case 'mediaFile':
      return common;
    case 'select':
      return {
        ...common,
        values: field.options
          .map((option) => option.value)
          .sort(compareCodepoints),
      };
    case 'link':
      return {
        ...common,
        constraints: {
          maxUrlLength: capped(
            field.constraints?.maxUrlLength,
            MANAGED_LINK_MAX_URL_LENGTH,
          ),
          maxLabelLength: capped(
            field.constraints?.maxLabelLength,
            MANAGED_LINK_MAX_LABEL_LENGTH,
          ),
          protocols: catalogContract(field.constraints?.protocols),
          targets: catalogContract(field.constraints?.targets),
        },
      };
    case 'image': {
      const constraints = explicitImageConstraints(field.constraints);
      return constraints === undefined ? common : { ...common, constraints };
    }
    case 'group':
      return { ...common, fields: projectContractFields(field.fields) };
    case 'repeater':
      return {
        ...common,
        constraints: {
          minItems: field.constraints?.minItems ?? 0,
          maxItems: capped(
            field.constraints?.maxItems,
            MANAGED_CHUNK_SCHEMA_LIMITS.repeater,
          ),
        },
        fields: projectContractFields(field.fields),
      };
  }
};

const stableStringify = (value: ContractValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareCodepoints)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const canonicalManagedChunkContract = (
  fields: ManagedChunkField[],
): string => stableStringify({ fields: projectContractFields(fields) });

export const computeManagedChunkContractDigest = (
  fields: ManagedChunkField[],
): string =>
  `sha256:${createHash('sha256')
    .update(canonicalManagedChunkContract(fields), 'utf8')
    .digest('hex')}`;
