import type { TemplatePackageManifestV2 } from './managed-chunk.types';
import {
  assertValidManagedChunkManifestV2,
  type ValidatedManagedChunkDefinition,
} from './managed-chunk-validation';
import type { TemplatePackageManifest } from './template-package.types';
import { assertValidTemplatePackageManifest } from './template-package.validation';

export type TemplatePackageReleaseManifest =
  TemplatePackageManifest | TemplatePackageManifestV2;

export type ValidatedTemplatePackageRelease = {
  manifest: TemplatePackageReleaseManifest;
  definitions: readonly ValidatedManagedChunkDefinition[];
};

export function assertValidTemplatePackageRelease(
  input: unknown,
): ValidatedTemplatePackageRelease {
  const manifestVersion =
    input !== null && typeof input === 'object'
      ? Object.getOwnPropertyDescriptor(input, 'manifestVersion')?.value
      : undefined;
  if (manifestVersion === 2) return assertValidManagedChunkManifestV2(input);
  return {
    manifest: assertValidTemplatePackageManifest(input),
    definitions: [],
  };
}
