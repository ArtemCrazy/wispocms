import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  MediaEntity,
  PlatformRole,
  SiteEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  canonicalManagedChunkContract,
  computeManagedChunkContractDigest,
  deriveManagedChunkDataSchema,
} from './managed-chunk-schema';
import { ManagedChunkContentService } from './managed-chunk-content.service';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SITE_ID = '22222222-2222-4222-8222-222222222222';
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';
const INSTANCE_ID = '66666666-6666-4666-8666-666666666666';
const FOREIGN_INSTANCE_ID = '77777777-7777-4777-8777-777777777777';
const RESOURCE_ID = '88888888-8888-4888-8888-888888888888';
const DRAFT_ID = '99999999-9999-4999-8999-999999999999';
const MEDIA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = {
  userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  platformRole: PlatformRole.WISPO_ADMIN,
};

function harness(options?: {
  digestMismatch?: boolean;
  fieldContractMismatch?: boolean;
  categoryConflict?: boolean;
  mediaSiteId?: string;
  snapshotMediaId?: string;
  workflowUpdatedAt?: string;
  publishedBaseline?: boolean;
}) {
  const source = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../test/fixtures/managed-chunks-v2.fixture.json'),
      'utf8',
    ),
  ) as Record<string, any>;
  source.chunkDefinitions[0].fields = [
    { key: 'headline', label: 'Заголовок', widget: 'text', required: true },
    { key: 'picture', label: 'Изображение', widget: 'image', nullable: true },
  ];
  const definition = source.chunkDefinitions[0];
  const rows: object[] = [
    Object.assign(new SiteEntity(), {
      id: SITE_ID,
      templatePackageId: PACKAGE_ID,
    }),
    Object.assign(new ManagedChunkInstanceEntity(), {
      id: INSTANCE_ID,
      siteId: SITE_ID,
      revisionResourceId: RESOURCE_ID,
      displayName: 'Hero',
      isArchived: false,
      updatedAt: new Date('2026-10-09T10:00:00Z'),
    }),
    Object.assign(new CmsRevisionResourceEntity(), {
      id: RESOURCE_ID,
      siteId: SITE_ID,
      resourceType: 'chunk_instance',
      entityId: INSTANCE_ID,
      draftRevisionId: DRAFT_ID,
      publishedRevisionId: options?.publishedBaseline ? DRAFT_ID : null,
      approvedRevisionId: options?.publishedBaseline ? DRAFT_ID : null,
      reviewState: options?.publishedBaseline ? 'approved' : 'draft',
    }),
    Object.assign(new CmsRevisionEntity(), {
      id: DRAFT_ID,
      resourceId: RESOURCE_ID,
      versionNumber: 1,
      snapshot: {
        formatVersion: 1,
        data: {
          headline: 'Hello',
          picture: options?.snapshotMediaId
            ? { mediaId: options.snapshotMediaId, alt: '', decorative: true }
            : null,
        },
        sanitizerPolicyVersion: null,
      },
      createdAt: new Date('2026-10-09T10:00:00Z'),
    }),
    Object.assign(new ManagedChunkInstanceRevisionEntity(), {
      revisionId: DRAFT_ID,
      revisionResourceId: RESOURCE_ID,
      siteId: SITE_ID,
      instanceId: INSTANCE_ID,
      contractId: CONTRACT_ID,
    }),
    Object.assign(new ManagedChunkContractEntity(), {
      id: CONTRACT_ID,
      templatePackageId: PACKAGE_ID,
      firstSeenTemplatePackageVersionId: VERSION_ID,
      definitionKey: definition.key,
      schemaVersion: definition.schemaVersion,
      contractDigest: options?.digestMismatch
        ? `sha256:${'0'.repeat(64)}`
        : computeManagedChunkContractDigest(definition.fields),
      fieldContract: options?.fieldContractMismatch
        ? { fields: [] }
        : (JSON.parse(
            canonicalManagedChunkContract(definition.fields),
          ) as Record<string, unknown>),
      dataSchema: deriveManagedChunkDataSchema(definition.fields),
    }),
    Object.assign(new TemplatePackageVersionEntity(), {
      id: VERSION_ID,
      templatePackageId: PACKAGE_ID,
      manifestVersion: 2,
      manifest: source,
    }),
    Object.assign(new MediaEntity(), {
      id: MEDIA_ID,
      siteId: options?.mediaSiteId ?? SITE_ID,
      mimeType: 'image/webp',
    }),
  ];
  if (options?.workflowUpdatedAt) {
    rows.push(
      Object.assign(new CmsRevisionEventEntity(), {
        id: '13131313-1313-4313-8313-131313131313',
        resourceId: RESOURCE_ID,
        revisionId: DRAFT_ID,
        eventType: 'submitted',
        createdAt: new Date(options.workflowUpdatedAt),
      }),
    );
  }

  if (options?.categoryConflict) {
    const conflictManifest = structuredClone(source);
    conflictManifest.chunkCategories[0].title = 'Другое название';
    conflictManifest.chunkDefinitions[0].key = 'fixture-banner-secondary';
    conflictManifest.chunkDefinitions[0].rendererKey =
      'fixture-banner-secondary-renderer';
    conflictManifest.templates[0].slots[0].allowedChunks[0].definitionKey =
      'fixture-banner-secondary';
    const conflictDefinition = conflictManifest.chunkDefinitions[0];
    const conflictInstanceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const conflictResourceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const conflictRevisionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const conflictContractId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const conflictVersionId = '12121212-1212-4212-8212-121212121212';
    rows.push(
      Object.assign(new ManagedChunkInstanceEntity(), {
        id: conflictInstanceId,
        siteId: SITE_ID,
        revisionResourceId: conflictResourceId,
        displayName: 'Secondary',
        isArchived: false,
        updatedAt: new Date('2026-10-09T11:00:00Z'),
      }),
      Object.assign(new CmsRevisionResourceEntity(), {
        id: conflictResourceId,
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: conflictInstanceId,
        draftRevisionId: conflictRevisionId,
        publishedRevisionId: null,
        approvedRevisionId: null,
        reviewState: 'draft',
      }),
      Object.assign(new CmsRevisionEntity(), {
        id: conflictRevisionId,
        resourceId: conflictResourceId,
        versionNumber: 1,
        snapshot: {
          formatVersion: 1,
          data: { headline: 'Secondary', picture: null },
          sanitizerPolicyVersion: null,
        },
      }),
      Object.assign(new ManagedChunkInstanceRevisionEntity(), {
        revisionId: conflictRevisionId,
        revisionResourceId: conflictResourceId,
        siteId: SITE_ID,
        instanceId: conflictInstanceId,
        contractId: conflictContractId,
      }),
      Object.assign(new ManagedChunkContractEntity(), {
        id: conflictContractId,
        templatePackageId: PACKAGE_ID,
        firstSeenTemplatePackageVersionId: conflictVersionId,
        definitionKey: conflictDefinition.key,
        schemaVersion: conflictDefinition.schemaVersion,
        contractDigest: computeManagedChunkContractDigest(
          conflictDefinition.fields,
        ),
        fieldContract: JSON.parse(
          canonicalManagedChunkContract(conflictDefinition.fields),
        ) as Record<string, unknown>,
        dataSchema: deriveManagedChunkDataSchema(conflictDefinition.fields),
      }),
      Object.assign(new TemplatePackageVersionEntity(), {
        id: conflictVersionId,
        templatePackageId: PACKAGE_ID,
        manifestVersion: 2,
        manifest: conflictManifest,
      }),
    );
  }

  const manager = {
    find: jest.fn(
      (entity: unknown, query: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row instanceof (entity as any) &&
              Object.entries(query.where).every(
                ([key, value]) => (row as any)[key] === value,
              ),
          ),
        ),
    ),
    findOne: jest.fn(
      (entity: unknown, query: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows.find(
            (row) =>
              row instanceof (entity as any) &&
              Object.entries(query.where).every(
                ([key, value]) => (row as any)[key] === value,
              ),
          ) ?? null,
        ),
    ),
  };
  const persistence = {
    createInstanceDraft: jest.fn().mockResolvedValue({
      instanceId: INSTANCE_ID,
      revisionId: DRAFT_ID,
      versionNumber: 1,
    }),
    saveInstanceDraft: jest
      .fn()
      .mockResolvedValue({ revisionId: DRAFT_ID, versionNumber: 2 }),
    submitInstanceRevision: jest.fn(),
    approveInstanceRevision: jest.fn(),
    requestInstanceRevisionChanges: jest.fn(),
    publishInstanceRevision: jest.fn(),
    restoreInstanceRevision: jest.fn(async (input) => {
      const sourceRevision = rows.find(
        (row) =>
          row instanceof CmsRevisionEntity && row.id === input.sourceRevisionId,
      ) as CmsRevisionEntity;
      const sourceLink = rows.find(
        (row) =>
          row instanceof ManagedChunkInstanceRevisionEntity &&
          row.revisionId === input.sourceRevisionId,
      ) as ManagedChunkInstanceRevisionEntity;
      await input.validateUsingManager?.(
        manager,
        sourceRevision.snapshot,
        sourceLink.contractId,
      );
      return { id: '14141414-1414-4414-8414-141414141414', versionNumber: 2 };
    }),
  };
  const revisions = { assertSitePermission: jest.fn().mockResolvedValue(null) };
  return {
    service: new ManagedChunkContentService(
      { manager } as never,
      persistence as never,
      revisions as never,
    ),
    persistence,
    manager,
  };
}

describe('ManagedChunkContentService', () => {
  it('builds catalog from exact referenced contracts without release metadata', async () => {
    const catalog = await harness().service.catalog(SITE_ID, ACTOR);
    expect(catalog.categories).toEqual([
      expect.objectContaining({
        key: 'banners',
        definitions: [
          expect.objectContaining({
            contractId: CONTRACT_ID,
            key: 'fixture-banner',
            schemaVersion: '1',
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/digest|repository|release/i);
  });
  it('fails closed on a first-seen manifest digest mismatch', async () => {
    await expect(
      harness({ digestMismatch: true }).service.catalog(SITE_ID, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('returns not found for a foreign-site instance', async () => {
    await expect(
      harness().service.get(SITE_ID, FOREIGN_INSTANCE_ID, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('does not write invalid schema or foreign media', async () => {
    const invalid = harness();
    await expect(
      invalid.service.create(SITE_ID, ACTOR, {
        displayName: 'Bad',
        contractId: CONTRACT_ID,
        data: { unknown: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(invalid.persistence.createInstanceDraft).not.toHaveBeenCalled();
    const foreign = harness({ mediaSiteId: OTHER_SITE_ID });
    await expect(
      foreign.service.create(SITE_ID, ACTOR, {
        displayName: 'Bad media',
        contractId: CONTRACT_ID,
        data: {
          headline: 'ok',
          picture: { mediaId: MEDIA_ID, alt: '', decorative: true },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(foreign.persistence.createInstanceDraft).not.toHaveBeenCalled();
  });
  it('passes optimistic draft pointer and cloned data to persistence', async () => {
    const { service, persistence } = harness();
    const data = { headline: 'Next', picture: null };
    await service.saveDraft(SITE_ID, INSTANCE_ID, ACTOR, {
      data,
      expectedDraftRevisionId: DRAFT_ID,
    });
    expect(persistence.saveInstanceDraft).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDraftRevisionId: DRAFT_ID, data }),
    );
    expect(persistence.saveInstanceDraft.mock.calls[0][0].data).not.toBe(data);
  });
  it('rejects an unknown category instead of returning an ambiguous empty list', async () => {
    await expect(
      harness().service.list(SITE_ID, ACTOR, 'unknown-category'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('fails closed when stored fieldContract differs from the first-seen definition', async () => {
    await expect(
      harness({ fieldContractMismatch: true }).service.catalog(SITE_ID, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when referenced exact manifests disagree on category presentation', async () => {
    await expect(
      harness({ categoryConflict: true }).service.catalog(SITE_ID, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a malformed image mediaId before querying media storage', async () => {
    const { service, manager } = harness();
    await expect(
      service.create(SITE_ID, ACTOR, {
        displayName: 'Malformed media',
        contractId: CONTRACT_ID,
        data: {
          headline: 'ok',
          picture: { mediaId: 'not-a-uuid', alt: '', decorative: true },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      manager.findOne.mock.calls.filter(([entity]) => entity === MediaEntity),
    ).toHaveLength(0);
  });
  it('revalidates and locks declared image media inside managed restore before writing', async () => {
    const { service, manager } = harness({
      mediaSiteId: OTHER_SITE_ID,
      snapshotMediaId: MEDIA_ID,
    });
    await expect(
      service.restore(SITE_ID, INSTANCE_ID, DRAFT_ID, DRAFT_ID, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      manager.findOne.mock.calls.find(
        ([entity]) => entity === MediaEntity,
      )?.[1],
    ).toEqual({
      where: { id: MEDIA_ID, siteId: SITE_ID },
      lock: { mode: 'pessimistic_read' },
    });
  });

  it('derives updatedAt from the latest revision workflow activity', async () => {
    const detail = await harness({
      workflowUpdatedAt: '2026-10-09T12:00:00.000Z',
    }).service.get(SITE_ID, INSTANCE_ID, ACTOR);
    expect(detail.updatedAt).toBe('2026-10-09T12:00:00.000Z');
  });
  it('does not offer publish when the approved baseline is already published', async () => {
    const detail = await harness({ publishedBaseline: true }).service.get(
      SITE_ID,
      INSTANCE_ID,
      ACTOR,
    );
    expect(detail.allowedActions).not.toContain('publish');
  });
});
