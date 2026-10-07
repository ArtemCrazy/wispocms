import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CMS_CHUNK_ICON_KEYS,
  CMS_IFRAME_PROVIDER_IDS,
  MANAGED_CHUNK_WIDGETS,
  MANAGED_LINK_PROTOCOLS,
  MANAGED_LINK_TARGETS,
  type ManagedChunkRepeaterField,
  type ManagedChunkSlot,
  type ManagedChunkTextField,
  type TemplatePackageManifestV2,
} from './managed-chunk.types';

const textareaField: ManagedChunkTextField = {
  key: 'summary',
  label: 'Summary',
  widget: 'textarea',
};

const repeaterField: ManagedChunkRepeaterField = {
  key: 'slides',
  label: 'Slides',
  widget: 'repeater',
  fields: [],
  constraints: {
    minItems: 1,
    maxItems: 3,
  },
};

const managedChunkSlot: ManagedChunkSlot = {
  key: 'hero',
  title: 'Hero',
  placement: 'homepage-hero',
  maxItems: 3,
  allowedChunks: [
    {
      definitionKey: 'fixture-banner',
      schemaVersion: '1',
    },
  ],
};

describe('managed chunk manifest v2 contract', () => {
  it('exposes the closed widget, icon, iframe, and link catalogs', () => {
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
    expect(MANAGED_LINK_PROTOCOLS).toEqual(['https', 'http', 'mailto', 'tel']);
    expect(MANAGED_LINK_TARGETS).toEqual(['_self', '_blank']);
    expect(textareaField.widget).toBe('textarea');
    expect(repeaterField.constraints).toEqual({ minItems: 1, maxItems: 3 });
    expect(managedChunkSlot.allowedChunks).toEqual([
      {
        definitionKey: 'fixture-banner',
        schemaVersion: '1',
      },
    ]);
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
