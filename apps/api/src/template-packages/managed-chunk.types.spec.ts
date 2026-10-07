import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CMS_CHUNK_ICON_KEYS,
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_CHUNK_WIDGETS,
  type TemplatePackageManifestV2,
} from './managed-chunk.types';

describe('managed chunk manifest v2 contract', () => {
  it('exposes the closed widget, icon, and iframe provider catalogs', () => {
    expect(MANAGED_CHUNK_WIDGETS).toEqual([
      'text',
      'textarea',
      'html',
      'number',
      'boolean',
      'select',
      'link',
      'image',
      'mediaFile',
      'group',
      'repeater',
    ]);
    expect(CMS_CHUNK_ICON_KEYS).toEqual([
      'banner',
      'cards',
      'content',
      'media',
      'layout',
    ]);
    expect(CMS_IFRAME_PROVIDER_IDS).toEqual(['youtube']);
  });

  it('loads the synthetic manifest v2 fixture', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../test/fixtures/managed-chunks-v2.fixture.json',
        ),
        'utf8',
      ),
    ) as TemplatePackageManifestV2;

    expect(fixture.manifestVersion).toBe(2);
    expect(fixture.chunkDefinitions[0]).toMatchObject({
      key: 'fixture-banner',
      schemaVersion: '1',
      rendererKey: 'fixture-banner-renderer',
    });
  });
});