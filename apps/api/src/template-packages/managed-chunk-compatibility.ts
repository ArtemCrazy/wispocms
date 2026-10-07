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

export type ManagedChunkPlacementRequirement =
  ManagedChunkDefinitionIdentity & {
    source: ManagedChunkContentSource;
    layoutKey: string;
    templateKey: string;
    templateVersion: string;
    slotKey: string;
    contractDigest: string;
    position: number;
  };

type ManagedChunkCompatibilityReasonData = {
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

export type ManagedChunkCompatibilityReason =
  Readonly<ManagedChunkCompatibilityReasonData>;

export type ManagedChunkCompatibilityResult = Readonly<{
  compatible: boolean;
  reasons: readonly ManagedChunkCompatibilityReason[];
}>;

const compareCodepoints = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const tupleIdentity = (values: readonly string[]): string =>
  JSON.stringify(values);

const definitionIdentity = (value: ManagedChunkDefinitionIdentity): string =>
  tupleIdentity([value.definitionKey, value.schemaVersion]);

const displayDefinitionIdentity = (
  value: ManagedChunkDefinitionIdentity,
): string => `${value.definitionKey}:${value.schemaVersion}`;

const slotIdentity = (value: {
  templateKey: string;
  templateVersion: string;
  slotKey: string;
}): string =>
  tupleIdentity([value.templateKey, value.templateVersion, value.slotKey]);

const displaySlotIdentity = (value: {
  templateKey: string;
  templateVersion: string;
  slotKey: string;
}): string => `${value.templateKey}:${value.templateVersion}:${value.slotKey}`;

const layoutSlotIdentity = (value: ManagedChunkPlacementRequirement): string =>
  tupleIdentity([
    value.source,
    value.layoutKey,
    value.templateKey,
    value.templateVersion,
    value.slotKey,
  ]);

const uniqueMap = <T>(
  values: readonly T[],
  key: (value: T) => string,
  displayKey: (value: T) => string,
  label: string,
): Map<string, T> => {
  const result = new Map<string, T>();
  for (const value of values) {
    const identity = key(value);
    if (result.has(identity)) {
      throw new Error(`Duplicate ${label}: ${displayKey(value)}`);
    }
    result.set(identity, value);
  }
  return result;
};

const requirementInventory = (
  packageId: string,
  contracts: readonly ManagedChunkContractRequirement[],
  placements: readonly ManagedChunkPlacementRequirement[],
): ManagedChunkContractRequirement[] => {
  const inventory = new Map<string, ManagedChunkContractRequirement>();

  const add = (requirement: ManagedChunkContractRequirement): void => {
    const identity = definitionIdentity(requirement);
    const existing = inventory.get(identity);
    if (
      existing !== undefined &&
      existing.contractDigest !== requirement.contractDigest
    ) {
      throw new Error(
        `Conflicting required digest: ${displayDefinitionIdentity(requirement)}`,
      );
    }

    inventory.set(identity, {
      ...requirement,
      sources: [
        ...new Set([...(existing?.sources ?? []), ...requirement.sources]),
      ].sort(compareCodepoints),
    });
  };

  contracts.forEach(add);
  placements.forEach((placement) =>
    add({
      packageId,
      definitionKey: placement.definitionKey,
      schemaVersion: placement.schemaVersion,
      contractDigest: placement.contractDigest,
      sources: [placement.source],
    }),
  );

  return [...inventory.values()];
};

const reasonSortKey = (reason: ManagedChunkCompatibilityReason): string =>
  Object.keys(reason)
    .sort(compareCodepoints)
    .map((key) => {
      const value = reason[key as keyof ManagedChunkCompatibilityReasonData];
      return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    })
    .join(',');

const sortReasons = (
  reasons: ManagedChunkCompatibilityReason[],
): ManagedChunkCompatibilityReason[] =>
  reasons
    .map((reason) => ({ reason, key: reasonSortKey(reason) }))
    .sort((left, right) => compareCodepoints(left.key, right.key))
    .map(({ reason }) => reason);

type PlacementGroup = {
  first: ManagedChunkPlacementRequirement;
  positions: Set<number>;
  count: number;
};

export const checkManagedChunkContractCompatibility = (
  candidate: ManagedChunkCompatibilityCandidate,
  trustedRendererKeys: ReadonlySet<string>,
  contracts: readonly ManagedChunkContractRequirement[],
  placements: readonly ManagedChunkPlacementRequirement[],
): ManagedChunkCompatibilityResult => {
  for (const requirement of contracts) {
    if (requirement.packageId !== candidate.packageId) {
      throw new Error(
        `Contract requirement package mismatch: ${requirement.packageId}`,
      );
    }
  }

  const definitions = uniqueMap<ManagedChunkCandidateDefinition>(
    candidate.definitions,
    definitionIdentity,
    displayDefinitionIdentity,
    'candidate definition',
  );
  const slots = uniqueMap<ManagedChunkCandidateSlot>(
    candidate.slots,
    slotIdentity,
    displaySlotIdentity,
    'candidate slot',
  );
  const reasons: ManagedChunkCompatibilityReason[] = [];

  for (const requirement of requirementInventory(
    candidate.packageId,
    contracts,
    placements,
  )) {
    const definition = definitions.get(definitionIdentity(requirement));
    if (definition === undefined) {
      reasons.push({
        code: 'missing_definition',
        packageId: requirement.packageId,
        definitionKey: requirement.definitionKey,
        schemaVersion: requirement.schemaVersion,
      });
      continue;
    }

    if (definition.contractDigest !== requirement.contractDigest) {
      reasons.push({
        code: 'contract_digest_mismatch',
        packageId: requirement.packageId,
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

  const placementGroups = new Map<string, PlacementGroup>();

  for (const placement of placements) {
    const slot = slots.get(slotIdentity(placement));
    const reasonContext = {
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
        code: 'invalid_layout_position',
        ...reasonContext,
        ...(Number.isFinite(placement.position)
          ? { position: placement.position }
          : {}),
      });
      continue;
    }

    if (slot === undefined) {
      reasons.push({ code: 'slot_missing', ...reasonContext });
      continue;
    }

    if (
      !slot.allowedChunks.some(
        (allowed) =>
          definitionIdentity(allowed) === definitionIdentity(placement),
      )
    ) {
      reasons.push({
        code: 'slot_disallows_definition',
        ...reasonContext,
      });
    }

    const groupKey = layoutSlotIdentity(placement);
    const existingGroup = placementGroups.get(groupKey);
    if (existingGroup?.positions.has(placement.position) === true) {
      reasons.push({
        code: 'invalid_layout_position',
        ...reasonContext,
        position: placement.position,
      });
      continue;
    }

    if (existingGroup === undefined) {
      placementGroups.set(groupKey, {
        first: placement,
        positions: new Set([placement.position]),
        count: 1,
      });
    } else {
      existingGroup.positions.add(placement.position);
      existingGroup.count += 1;
    }
  }

  for (const group of placementGroups.values()) {
    const slot = slots.get(slotIdentity(group.first));
    if (slot !== undefined && group.count > slot.maxItems) {
      reasons.push({
        code: 'slot_capacity_exceeded',
        packageId: candidate.packageId,
        source: group.first.source,
        layoutKey: group.first.layoutKey,
        templateKey: group.first.templateKey,
        templateVersion: group.first.templateVersion,
        slotKey: group.first.slotKey,
        actualItems: group.count,
        maxItems: slot.maxItems,
      });
    }
  }

  const sortedReasons = sortReasons(reasons);
  return {
    compatible: sortedReasons.length === 0,
    reasons: sortedReasons,
  };
};
