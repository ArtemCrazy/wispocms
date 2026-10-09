/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RegisterTemplatePackageDto } from './template-package.dto';
import { assertValidTemplatePackageRelease } from './template-package-release-validation';
import { assertValidTemplatePackageManifest } from './template-package.validation';
import { assertValidManagedChunkManifestV2 } from './managed-chunk-validation';

const read = (path: string) =>
  JSON.parse(readFileSync(resolve(__dirname, path), 'utf8'));

describe('Managed Chunks Phase 1 release boundary', () => {
  it('keeps production Skinova and production validator on v1', () => {
    const skinova = read(
      '../../../web/template-packages/skinova/manifest.template.json',
    );
    const release = {
      ...skinova,
      source: { ...skinova.source, revision: 'a'.repeat(40) },
      build: {
        ...skinova.build,
        releaseDigest: 'b'.repeat(64),
        artifactDigest: null,
        builtAt: '2026-10-07T00:00:00Z',
      },
    };
    expect(release.manifestVersion).toBe(1);
    expect(assertValidTemplatePackageManifest(release)).toBe(release);
  });

  it('routes v2 through the managed validator while keeping the legacy validator v1-only', async () => {
    const v2 = read('../../test/fixtures/managed-chunks-v2.fixture.json');
    expect(assertValidManagedChunkManifestV2(v2).manifest.manifestVersion).toBe(
      2,
    );
    expect(assertValidTemplatePackageRelease(v2).manifest.manifestVersion).toBe(
      2,
    );
    expect(() => assertValidTemplatePackageManifest(v2)).toThrow(
      /(manifestVersion|chunkCategories|unknown field)/i,
    );
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        { manifest: v2 },
        { type: 'body', metatype: RegisterTemplatePackageDto },
      ),
    ).resolves.toBeDefined();
  });
});
