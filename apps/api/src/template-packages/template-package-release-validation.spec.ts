import { ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RegisterTemplatePackageDto } from './template-package.dto';
import { assertValidTemplatePackageRelease } from './template-package-release-validation';

const release = (path: string) => {
  const template = JSON.parse(
    readFileSync(resolve(__dirname, path), 'utf8'),
  ) as Record<string, unknown>;
  return {
    ...template,
    source: {
      ...(template.source as Record<string, unknown>),
      revision: 'a'.repeat(40),
    },
    build: {
      ...(template.build as Record<string, unknown>),
      releaseDigest: 'b'.repeat(64),
      artifactDigest: null,
      builtAt: '2026-10-08T00:00:00Z',
    },
  };
};

describe('template package release validation', () => {
  it('accepts the unchanged production Skinova v1 manifest', async () => {
    const manifest = release(
      '../../../web/template-packages/skinova/manifest.template.json',
    );
    const validated = assertValidTemplatePackageRelease(manifest);

    expect(validated.manifest.manifestVersion).toBe(1);
    expect(validated.definitions).toEqual([]);

    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        { manifest },
        { type: 'body', metatype: RegisterTemplatePackageDto },
      ),
    ).resolves.toBeDefined();
  });

  it('accepts the production Skinova v2 manifest and exposes its contracts', async () => {
    const manifest = release(
      '../../../web/template-packages/skinova/manifest.v2.template.json',
    );
    const validated = assertValidTemplatePackageRelease(manifest);

    expect(validated.manifest.manifestVersion).toBe(2);
    expect(validated.definitions.map(({ key }) => key)).toEqual([
      'skinova-promo-strip',
      'skinova-consultation-banner',
      'skinova-article-sidebar-banner',
    ]);
    for (const definition of validated.definitions) {
      expect(definition.fields.map(({ key }) => key)).toHaveLength(8);
      expect(definition.fields).toContainEqual(
        expect.objectContaining({
          key: 'sort_order',
          widget: 'number',
          required: true,
          constraints: expect.objectContaining({
            min: 0,
            max: 9999,
            step: 1,
          }),
        }),
      );
    }
    expect(
      validated.manifest.templates.flatMap((template) =>
        (template.slots ?? []).map((slot) => ({
          placement: slot.placement,
          allowedChunks: slot.allowedChunks,
        })),
      ),
    ).toEqual([
      {
        placement: 'homepage_top',
        allowedChunks: [
          { definitionKey: 'skinova-promo-strip', schemaVersion: '1' },
        ],
      },
      {
        placement: 'homepage_middle',
        allowedChunks: [
          {
            definitionKey: 'skinova-consultation-banner',
            schemaVersion: '1',
          },
        ],
      },
      {
        placement: 'article_sidebar',
        allowedChunks: [
          {
            definitionKey: 'skinova-article-sidebar-banner',
            schemaVersion: '1',
          },
        ],
      },
      {
        placement: 'homepage_top',
        allowedChunks: [
          { definitionKey: 'skinova-promo-strip', schemaVersion: '1' },
        ],
      },
    ]);

    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    await expect(
      pipe.transform(
        { manifest },
        { type: 'body', metatype: RegisterTemplatePackageDto },
      ),
    ).resolves.toBeDefined();
  });
});
