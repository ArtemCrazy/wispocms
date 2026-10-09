type ChunkRuntimeManifest = Readonly<{
  packageId: string;
  packageVersion: string;
  chunkDefinitions: ReadonlyArray<
    Readonly<{
      key: string;
      schemaVersion: string;
      rendererKey: string;
    }>
  >;
}>;

export type ChunkRuntimeIdentity = Readonly<{
  packageId: string;
  packageVersion: string;
  definitionKey: string;
  schemaVersion: string;
}>;

export type ChunkRuntimeEntry<Implementation> = Readonly<{
  identity: string;
  rendererKey: string;
  implementation: Implementation;
}>;

export function chunkRuntimeIdentity(value: ChunkRuntimeIdentity) {
  return JSON.stringify([
    value.packageId,
    value.packageVersion,
    value.definitionKey,
    value.schemaVersion,
  ]);
}

export function createChunkRuntimeCatalog<
  Implementation extends NonNullable<unknown>,
>(
  manifest: ChunkRuntimeManifest,
  bindings: Readonly<Record<string, Implementation>>,
) {
  const entries = new Map<string, ChunkRuntimeEntry<Implementation>>();
  const packageId = manifest.packageId;
  const packageVersion = manifest.packageVersion;

  for (const definition of manifest.chunkDefinitions) {
    const definitionKey = definition.key;
    const schemaVersion = definition.schemaVersion;
    const rendererKey = definition.rendererKey;
    const bindingDescriptor = Object.getOwnPropertyDescriptor(
      bindings,
      rendererKey,
    );
    if (!bindingDescriptor || !("value" in bindingDescriptor)) {
      throw new Error(`${rendererKey} has no trusted chunk runtime binding`);
    }

    const implementation = bindingDescriptor.value as
      Implementation | null | undefined;
    if (implementation === null || implementation === undefined) {
      throw new Error(`${rendererKey} has no trusted chunk runtime binding`);
    }
    const identity = chunkRuntimeIdentity({
      packageId,
      packageVersion,
      definitionKey,
      schemaVersion,
    });
    if (entries.has(identity)) {
      throw new Error(`Duplicate chunk runtime identity: ${identity}`);
    }

    entries.set(
      identity,
      Object.freeze({
        identity,
        rendererKey,
        implementation,
      }),
    );
  }

  return Object.freeze({
    resolve(identity: ChunkRuntimeIdentity) {
      return entries.get(chunkRuntimeIdentity(identity)) ?? null;
    },
  });
}
