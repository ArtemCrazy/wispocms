import type { ManagedChunkField } from './managed-chunk.types';
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
  MANAGED_CHUNK_SCHEMA_LIMITS,
  type ManagedChunkObjectSchema,
} from './managed-chunk-schema';

const fields: ManagedChunkField[] = [
  { key: 'title', label: 'Title', widget: 'text', required: true },
  { key: 'subtitle', label: 'Subtitle', widget: 'text' },
  {
    key: 'note',
    label: 'Note',
    widget: 'textarea',
    nullable: true,
  },
  {
    key: 'body',
    label: 'Body',
    widget: 'html',
    constraints: { iframeProviders: ['youtube'] },
  },
  {
    key: 'items',
    label: 'Items',
    widget: 'repeater',
    fields: [
      {
        key: 'enabled',
        label: 'Enabled',
        widget: 'boolean',
        required: true,
      },
    ],
    constraints: { minItems: 1, maxItems: 3 },
  },
];

describe('managed chunk data schema', () => {
  it('derives a closed draft-07 object with independent required and nullable fields', () => {
    const schema: ManagedChunkObjectSchema =
      deriveManagedChunkDataSchema(fields);

    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['title']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.subtitle).toEqual({
      type: 'string',
      minLength: 0,
      maxLength: 2_000,
    });
    expect(schema.properties.note).toEqual({
      anyOf: [
        { type: 'string', minLength: 0, maxLength: 20_000 },
        { type: 'null' },
      ],
    });
  });

  it('applies fixed text caps, omits defaults, and closes nested repeater objects', () => {
    const schema: ManagedChunkObjectSchema =
      deriveManagedChunkDataSchema(fields);

    expect(MANAGED_CHUNK_SCHEMA_LIMITS).toEqual({
      text: 2_000,
      textarea: 20_000,
      html: 65_536,
      repeater: 100,
      iframeProviders: ['youtube'],
    });
    expect(schema.properties.body).toEqual({
      type: 'string',
      minLength: 0,
      maxLength: 65_536,
    });
    expect(schema.properties.items).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
        required: ['enabled'],
        additionalProperties: false,
      },
    });
    expect(JSON.stringify(schema)).not.toContain('default');
  });

  it('maps scalar, select, link, image, and group widgets to strict storage schemas', () => {
    const schema = deriveManagedChunkDataSchema([
      {
        key: 'score',
        label: 'Score',
        widget: 'number',
        constraints: { min: 0, max: 10, step: 0.5 },
      },
      {
        key: 'tone',
        label: 'Tone',
        widget: 'select',
        options: [
          { value: 'warm', label: 'Warm' },
          { value: 'calm', label: 'Calm' },
        ],
      },
      { key: 'cta', label: 'CTA', widget: 'link' },
      { key: 'cover', label: 'Cover', widget: 'image' },
      {
        key: 'settings',
        label: 'Settings',
        widget: 'group',
        fields: [{ key: 'visible', label: 'Visible', widget: 'boolean' }],
      },
    ]);

    expect(schema.properties.score).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 10,
      multipleOf: 0.5,
    });
    expect(schema.properties.tone).toEqual({
      type: 'string',
      enum: ['calm', 'warm'],
    });
    expect(schema.properties.cta).toMatchObject({
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 2_048 },
        label: { type: 'string', minLength: 0, maxLength: 500 },
        target: { type: 'string', enum: ['_blank', '_self'] },
      },
    });
    expect(schema.properties.cover).toMatchObject({
      type: 'object',
      required: ['alt', 'decorative', 'mediaId'],
      additionalProperties: false,
      oneOf: [
        {
          properties: {
            decorative: { const: true },
            alt: { const: '' },
          },
        },
        {
          properties: {
            decorative: { const: false },
            alt: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      ],
    });
    expect(schema.properties.settings).toEqual({
      type: 'object',
      properties: { visible: { type: 'boolean' } },
      additionalProperties: false,
    });
  });

  it('keeps media files manifest-agnostic and allocates independent media id schemas', () => {
    const schema = deriveManagedChunkDataSchema([
      { key: 'download', label: 'Download', widget: 'mediaFile' },
      { key: 'secondDownload', label: 'Second download', widget: 'mediaFile' },
    ]);
    const first = schema.properties.download as {
      properties: { mediaId: Record<string, unknown> };
    };
    const second = schema.properties.secondDownload as {
      properties: { mediaId: Record<string, unknown> };
    };

    expect(first).toEqual({
      type: 'object',
      properties: {
        mediaId: { type: 'string', minLength: 1, maxLength: 80 },
      },
      required: ['mediaId'],
      additionalProperties: false,
    });
    expect(JSON.stringify(first)).not.toMatch(/mime|size/i);
    expect(first.properties.mediaId).not.toBe(second.properties.mediaId);
  });

  it('hashes only sorted effective storage semantics', () => {
    const first: ManagedChunkField[] = [
      {
        key: 'tone',
        label: 'Tone shown first',
        help: 'Presentation only',
        widget: 'select',
        options: [
          { value: 'warm', label: 'Warm label' },
          { value: 'calm', label: 'Calm label' },
        ],
      },
      {
        key: 'title',
        label: 'Original title label',
        widget: 'text',
        required: true,
      },
      {
        key: 'rows',
        label: 'Rows',
        widget: 'repeater',
        fields: [
          {
            key: 'count',
            label: 'Count',
            widget: 'number',
            constraints: { min: 1, max: 5, step: 1 },
          },
          {
            key: 'photo',
            label: 'Photo',
            widget: 'image',
            constraints: { minWidth: 320, maxHeight: 800 },
          },
        ],
      },
    ];
    const presentationChanged: ManagedChunkField[] = [
      {
        key: 'rows',
        label: 'Renamed rows',
        widget: 'repeater',
        fields: [
          {
            key: 'photo',
            label: 'Renamed photo',
            widget: 'image',
            constraints: { maxHeight: 800, minWidth: 320 },
          },
          {
            key: 'count',
            label: 'Renamed count',
            help: 'Only help changed',
            widget: 'number',
            constraints: { step: 1, max: 5, min: 1 },
          },
        ],
      },
      {
        key: 'title',
        label: 'Renamed title',
        help: 'Renamed help',
        widget: 'text',
        required: true,
      },
      {
        key: 'tone',
        label: 'Renamed tone',
        widget: 'select',
        options: [
          { value: 'calm', label: 'Quiet' },
          { value: 'warm', label: 'Sunny' },
        ],
      },
    ];

    expect(computeManagedChunkContractDigest(presentationChanged)).toBe(
      computeManagedChunkContractDigest(first),
    );
    expect(computeManagedChunkContractDigest(first)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(canonicalManagedChunkContract(first)).not.toContain('label');

    const requiredChanged = structuredClone(first);
    requiredChanged[1].required = false;
    expect(computeManagedChunkContractDigest(requiredChanged)).not.toBe(
      computeManagedChunkContractDigest(first),
    );
  });

  it('distinguishes platform defaults from explicit html and link catalogs', () => {
    const defaults: ManagedChunkField[] = [
      { key: 'body', label: 'Body', widget: 'html' },
      { key: 'cta', label: 'CTA', widget: 'link' },
    ];
    const explicit: ManagedChunkField[] = [
      {
        key: 'body',
        label: 'Body',
        widget: 'html',
        constraints: { iframeProviders: ['youtube'] },
      },
      {
        key: 'cta',
        label: 'CTA',
        widget: 'link',
        constraints: {
          protocols: ['https', 'http', 'mailto', 'tel'],
          targets: ['_self', '_blank'],
        },
      },
    ];

    const defaultContract = canonicalManagedChunkContract(defaults);
    const explicitContract = canonicalManagedChunkContract(explicit);

    expect(defaultContract).toContain(`"mode":"platform-default"`);
    expect(explicitContract).toContain(
      `"mode":"explicit","values":["youtube"]`,
    );
    expect(explicitContract).toContain(
      `"mode":"explicit","values":["http","https","mailto","tel"]`,
    );
    expect(explicitContract).toContain(
      `"mode":"explicit","values":["_blank","_self"]`,
    );
    expect(computeManagedChunkContractDigest(explicit)).not.toBe(
      computeManagedChunkContractDigest(defaults),
    );
  });
});
