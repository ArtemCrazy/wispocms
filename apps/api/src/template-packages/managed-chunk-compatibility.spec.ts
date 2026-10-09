import {
  checkManagedChunkContractCompatibility,
  type ManagedChunkCompatibilityCandidate,
  type ManagedChunkContractRequirement,
  type ManagedChunkPlacementRequirement,
} from './managed-chunk-compatibility';

const digest = `sha256:${'a'.repeat(64)}`;

const candidate = (): ManagedChunkCompatibilityCandidate => ({
  packageId: 'skinova-media',
  definitions: [
    {
      definitionKey: 'fixture-banner',
      schemaVersion: '1',
      contractDigest: digest,
      rendererKey: 'fixture-banner-renderer',
    },
  ],
  slots: [
    {
      templateKey: 'fixture-home',
      templateVersion: '1',
      slotKey: 'hero',
      maxItems: 1,
      allowedChunks: [{ definitionKey: 'fixture-banner', schemaVersion: '1' }],
    },
  ],
});

const contracts = (): ManagedChunkContractRequirement[] => [
  {
    packageId: 'skinova-media',
    definitionKey: 'fixture-banner',
    schemaVersion: '1',
    contractDigest: digest,
    sources: ['published', 'draft'],
  },
];

const placements = (): ManagedChunkPlacementRequirement[] => [
  {
    source: 'published',
    layoutKey: 'page:home',
    templateKey: 'fixture-home',
    templateVersion: '1',
    slotKey: 'hero',
    definitionKey: 'fixture-banner',
    schemaVersion: '1',
    contractDigest: digest,
    position: 0,
  },
];

const trustedRenderers = (): ReadonlySet<string> =>
  new Set(['fixture-banner-renderer']);

describe('managed chunk pure compatibility', () => {
  it('accepts exact contracts, trusted renderers and valid placements', () => {
    expect(
      checkManagedChunkContractCompatibility(
        candidate(),
        trustedRenderers(),
        contracts(),
        placements(),
      ),
    ).toEqual({ compatible: true, reasons: [] });
  });

  it('reports missing_definition', () => {
    const input = candidate();
    input.definitions = [];

    expect(
      checkManagedChunkContractCompatibility(
        input,
        trustedRenderers(),
        contracts(),
        placements(),
      ).reasons,
    ).toEqual([expect.objectContaining({ code: 'missing_definition' })]);
  });

  it('reports contract_digest_mismatch', () => {
    const input = candidate();
    input.definitions[0].contractDigest = `sha256:${'b'.repeat(64)}`;

    expect(
      checkManagedChunkContractCompatibility(
        input,
        trustedRenderers(),
        contracts(),
        placements(),
      ).reasons,
    ).toEqual([expect.objectContaining({ code: 'contract_digest_mismatch' })]);
  });

  it('reports renderer_unavailable from the trusted inventory seam', () => {
    expect(
      checkManagedChunkContractCompatibility(
        candidate(),
        new Set<string>(),
        contracts(),
        placements(),
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: 'renderer_unavailable',
        rendererKey: 'fixture-banner-renderer',
      }),
    ]);
  });

  it('reports slot_missing', () => {
    const input = candidate();
    input.slots = [];

    expect(
      checkManagedChunkContractCompatibility(
        input,
        trustedRenderers(),
        contracts(),
        placements(),
      ).reasons,
    ).toEqual([expect.objectContaining({ code: 'slot_missing' })]);
  });

  it('reports slot_disallows_definition', () => {
    const input = candidate();
    input.slots[0].allowedChunks = [
      { definitionKey: 'other', schemaVersion: '1' },
    ];

    expect(
      checkManagedChunkContractCompatibility(
        input,
        trustedRenderers(),
        contracts(),
        placements(),
      ).reasons,
    ).toEqual([expect.objectContaining({ code: 'slot_disallows_definition' })]);
  });

  it('reports invalid_layout_position for negative and duplicate positions', () => {
    const negative = placements();
    negative[0].position = -1;
    expect(
      checkManagedChunkContractCompatibility(
        candidate(),
        trustedRenderers(),
        contracts(),
        negative,
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: 'invalid_layout_position',
        position: -1,
      }),
    ]);

    const input = candidate();
    input.slots[0].maxItems = 3;
    const duplicate = { ...placements()[0] };
    expect(
      checkManagedChunkContractCompatibility(
        input,
        trustedRenderers(),
        contracts(),
        [...placements(), duplicate],
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: 'invalid_layout_position',
        position: 0,
      }),
    ]);
  });

  it('reports slot_capacity_exceeded independently for published and draft layouts', () => {
    const second = {
      ...placements()[0],
      source: 'published' as const,
      position: 1,
    };
    const draft = {
      ...placements()[0],
      source: 'draft' as const,
      position: 0,
    };

    expect(
      checkManagedChunkContractCompatibility(
        candidate(),
        trustedRenderers(),
        contracts(),
        [...placements(), second, draft],
      ).reasons,
    ).toEqual([
      expect.objectContaining({
        code: 'slot_capacity_exceeded',
        source: 'published',
        actualItems: 2,
        maxItems: 1,
      }),
    ]);
  });

  it('rejects package mismatches, conflicting digests and duplicate candidate identities', () => {
    const wrongPackage = contracts();
    wrongPackage[0].packageId = 'another-package';
    expect(() =>
      checkManagedChunkContractCompatibility(
        candidate(),
        trustedRenderers(),
        wrongPackage,
        placements(),
      ),
    ).toThrow('Contract requirement package mismatch: another-package');

    const conflicting = placements();
    conflicting[0].contractDigest = `sha256:${'b'.repeat(64)}`;
    expect(() =>
      checkManagedChunkContractCompatibility(
        candidate(),
        trustedRenderers(),
        contracts(),
        conflicting,
      ),
    ).toThrow('Conflicting required digest: fixture-banner:1');

    const duplicateDefinition = candidate();
    duplicateDefinition.definitions.push({
      ...duplicateDefinition.definitions[0],
    });
    expect(() =>
      checkManagedChunkContractCompatibility(
        duplicateDefinition,
        trustedRenderers(),
        contracts(),
        placements(),
      ),
    ).toThrow('Duplicate candidate definition: fixture-banner:1');

    const duplicateSlot = candidate();
    duplicateSlot.slots.push({ ...duplicateSlot.slots[0] });
    expect(() =>
      checkManagedChunkContractCompatibility(
        duplicateSlot,
        trustedRenderers(),
        contracts(),
        placements(),
      ),
    ).toThrow('Duplicate candidate slot: fixture-home:1:hero');
  });

  it('keeps delimiter-bearing candidate identities distinct', () => {
    const input: ManagedChunkCompatibilityCandidate = {
      packageId: 'skinova-media',
      definitions: [
        {
          definitionKey: 'a:b',
          schemaVersion: 'c',
          contractDigest: digest,
          rendererKey: 'renderer',
        },
        {
          definitionKey: 'a',
          schemaVersion: 'b:c',
          contractDigest: digest,
          rendererKey: 'renderer',
        },
      ],
      slots: [
        {
          templateKey: 'a:b',
          templateVersion: 'c',
          slotKey: 'd',
          maxItems: 1,
          allowedChunks: [],
        },
        {
          templateKey: 'a',
          templateVersion: 'b:c',
          slotKey: 'd',
          maxItems: 1,
          allowedChunks: [],
        },
      ],
    };

    expect(
      checkManagedChunkContractCompatibility(
        input,
        new Set(['renderer']),
        [],
        [],
      ),
    ).toEqual({ compatible: true, reasons: [] });
  });

  it('keeps non-finite positions JSON-safe without reflecting them', () => {
    const invalid = placements();
    invalid[0].position = Number.POSITIVE_INFINITY;

    const result = checkManagedChunkContractCompatibility(
      candidate(),
      trustedRenderers(),
      contracts(),
      invalid,
    );

    expect(result.reasons).toEqual([
      expect.objectContaining({ code: 'invalid_layout_position' }),
    ]);
    expect(result.reasons[0]).not.toHaveProperty('position');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('returns deterministic reasons without content payloads or input mutation', () => {
    const input = candidate();
    input.definitions = [];
    input.slots = [];
    const requirements = contracts();
    const layout = placements();
    const original = JSON.stringify({ input, requirements, layout });

    const forward = checkManagedChunkContractCompatibility(
      input,
      new Set(),
      requirements,
      layout,
    );
    const reverse = checkManagedChunkContractCompatibility(
      input,
      new Set(),
      [...requirements].reverse(),
      [...layout].reverse(),
    );

    expect(reverse).toEqual(forward);
    expect(JSON.stringify(forward)).not.toContain('payload');
    expect(JSON.stringify({ input, requirements, layout })).toBe(original);
  });
});
