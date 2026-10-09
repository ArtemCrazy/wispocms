import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager, EntityTarget } from 'typeorm';
import {
  BannerEntity,
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkMigrationProvenanceEntity,
  ManagedChunkPlacementEntity,
  PageBannerAssignmentEntity,
  PageEntity,
  SiteEntity,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import { SkinovaManagedBackfillService } from './skinova-managed-backfill.service';

const SITE_ID = '51a00000-0000-4000-8000-000000000002';
const PACKAGE_ID = '81a00000-0000-4000-8000-000000000001';
const VERSION_ID = '81a00000-0000-4000-8000-000000000002';
const HOME_ID = '51a40000-0000-4000-8000-000000000001';
const PRIVACY_ID = '51a40000-0000-4000-8000-000000000002';
const NOT_FOUND_ID = '51a40000-0000-4000-8000-000000000003';
const PROMO_ID = '51a60000-0000-4000-8000-000000000001';
const CONSULTATION_ID = '51a60000-0000-4000-8000-000000000002';
const ARTICLE_ID = '51a60000-0000-4000-8000-000000000003';

type Row = Record<string, unknown>;
type EntityClass = new (...args: never[]) => object;

const managedEntities: EntityClass[] = [
  CmsRevisionResourceEntity,
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  ManagedChunkMigrationProvenanceEntity,
];

class FakeDatabase {
  readonly rows = new Map<EntityClass, Row[]>();
  readonly manager: EntityManager;
  readonly source: DataSource;

  constructor() {
    this.manager = {
      findOne: jest.fn(
        async <T extends Row>(
          target: EntityTarget<T>,
          options: { where?: Partial<T> },
        ): Promise<T | null> =>
          (this.table(target).find((row) =>
            this.matches(row, options.where as Row | undefined),
          ) as T | undefined) ?? null,
      ),
      find: jest.fn(
        async <T extends Row>(
          target: EntityTarget<T>,
          options?: { where?: Partial<T>; order?: Record<string, string> },
        ): Promise<T[]> => {
          const values = this.table(target).filter((row) =>
            this.matches(row, options?.where as Row | undefined),
          );
          if (options?.order) {
            const keys = Object.keys(options.order);
            values.sort((left, right) => {
              for (const key of keys) {
                const comparison = String(left[key]).localeCompare(
                  String(right[key]),
                );
                if (comparison !== 0) return comparison;
              }
              return 0;
            });
          }
          return values as T[];
        },
      ),
      save: jest.fn(async <T extends Row>(entity: T): Promise<T> => {
        const target = entity.constructor as EntityClass;
        const table = this.table(target);
        const id = entity.id;
        const existingIndex =
          id === undefined ? -1 : table.findIndex((row) => row.id === id);
        if (existingIndex >= 0) table[existingIndex] = entity;
        else table.push(entity);
        return entity;
      }),
    } as unknown as EntityManager;
    this.source = {
      transaction: jest.fn(
        async <T>(run: (manager: EntityManager) => Promise<T>): Promise<T> => {
          const snapshot = new Map<EntityClass, Row[]>(
            [...this.rows.entries()].map(([target, rows]) => [
              target,
              structuredClone(rows),
            ]),
          );
          try {
            return await run(this.manager);
          } catch (error) {
            this.rows.clear();
            for (const [target, rows] of snapshot) this.rows.set(target, rows);
            throw error;
          }
        },
      ),
    } as unknown as DataSource;
  }

  table<T extends Row>(target: EntityTarget<T> | EntityClass): Row[] {
    const key = target as EntityClass;
    const existing = this.rows.get(key);
    if (existing) return existing;
    const created: Row[] = [];
    this.rows.set(key, created);
    return created;
  }

  seed<T extends Row>(target: EntityClass, values: T[]): void {
    this.rows.set(target, values);
  }

  private matches(row: Row, where?: Row): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }
}

const banner = (
  id: string,
  name: string,
  placement: string | null,
): BannerEntity =>
  Object.assign(new BannerEntity(), {
    id,
    siteId: SITE_ID,
    name,
    placement,
    title: name + ' title',
    subtitle: name + ' subtitle',
    buttonText: 'Записаться',
    linkUrl: '#consultation',
    mediaId: null,
    mobileMediaId: null,
    sortOrder: 0,
    isActive: true,
  });

const setup = () => {
  const database = new FakeDatabase();
  const site = Object.assign(new SiteEntity(), {
    id: SITE_ID,
    slug: 'skinova',
    templatePackageId: 'legacy-package-id',
    currentTemplatePackageVersionId: 'legacy-version-id',
  });
  database.seed(SiteEntity, [site]);
  database.seed(TemplatePackageEntity, [
    Object.assign(new TemplatePackageEntity(), {
      id: PACKAGE_ID,
      packageId: 'skinova-media',
    }),
  ]);
  database.seed(TemplatePackageVersionEntity, [
    Object.assign(new TemplatePackageVersionEntity(), {
      id: VERSION_ID,
      templatePackageId: PACKAGE_ID,
      packageVersion: '2',
      manifestVersion: 2,
    }),
  ]);
  database.seed(
    ManagedChunkContractEntity,
    [
      'skinova-promo-strip',
      'skinova-consultation-banner',
      'skinova-article-sidebar-banner',
    ].map((definitionKey, index) =>
      Object.assign(new ManagedChunkContractEntity(), {
        id: `91a00000-0000-4000-8000-00000000000${index + 1}`,
        templatePackageId: PACKAGE_ID,
        firstSeenTemplatePackageVersionId: VERSION_ID,
        definitionKey,
        schemaVersion: '1',
      }),
    ),
  );
  database.seed(PageEntity, [
    Object.assign(new PageEntity(), {
      id: HOME_ID,
      siteId: SITE_ID,
      slug: '',
      kind: 'homepage',
      publishedSystemTemplateKey: 'skinova-home',
      publishedSystemTemplateVersion: '1',
    }),
    Object.assign(new PageEntity(), {
      id: PRIVACY_ID,
      siteId: SITE_ID,
      slug: 'privacy-policy',
      kind: 'page',
      publishedSystemTemplateKey: null,
      publishedSystemTemplateVersion: null,
    }),
    Object.assign(new PageEntity(), {
      id: NOT_FOUND_ID,
      siteId: SITE_ID,
      slug: '404',
      kind: 'page',
      publishedSystemTemplateKey: 'skinova',
      publishedSystemTemplateVersion: '1',
    }),
  ]);
  database.seed(BannerEntity, [
    banner(PROMO_ID, 'Промо Skinova', null),
    banner(CONSULTATION_ID, 'Консультация', null),
    banner(ARTICLE_ID, 'Баннер статьи', 'article_sidebar'),
  ]);
  database.seed(
    PageBannerAssignmentEntity,
    [
      [HOME_ID, PROMO_ID, 'homepage_top'],
      [HOME_ID, CONSULTATION_ID, 'homepage_middle'],
      [PRIVACY_ID, PROMO_ID, 'homepage_top'],
      [NOT_FOUND_ID, PROMO_ID, 'homepage_top'],
    ].map(([pageId, bannerId, zone], index) =>
      Object.assign(new PageBannerAssignmentEntity(), {
        id: `71a60000-0000-4000-8000-00000000000${index + 1}`,
        siteId: SITE_ID,
        pageId,
        bannerId,
        zone,
      }),
    ),
  );

  return {
    database,
    service: new SkinovaManagedBackfillService(database.source),
    site,
  };
};

describe('SkinovaManagedBackfillService', () => {
  it('creates the exact published managed baseline and preserves legacy state', async () => {
    const { database, service, site } = setup();
    const legacyBefore = JSON.stringify({
      site,
      banners: database.table(BannerEntity),
      assignments: database.table(PageBannerAssignmentEntity),
    });

    const result = await service.backfill(SITE_ID);

    expect(result).toMatchObject({
      siteId: SITE_ID,
      status: 'created',
      created: {
        instances: 3,
        layouts: 4,
        placements: 5,
        provenance: 8,
      },
      repairedProvenance: 0,
    });
    expect(database.table(ManagedChunkInstanceEntity)).toHaveLength(3);
    expect(database.table(ManagedChunkInstanceRevisionEntity)).toHaveLength(3);
    expect(database.table(ManagedChunkLayoutEntity)).toHaveLength(4);
    expect(database.table(ManagedChunkPlacementEntity)).toHaveLength(5);
    expect(database.table(ManagedChunkMigrationProvenanceEntity)).toHaveLength(
      8,
    );
    const resources = database.table(CmsRevisionResourceEntity);
    expect(resources).toHaveLength(7);
    for (const resource of resources) {
      expect(resource).toMatchObject({
        latestVersionNumber: 1,
        reviewState: 'approved',
      });
      expect(resource.draftRevisionId).toBe(resource.publishedRevisionId);
      expect(resource.approvedRevisionId).toBe(resource.publishedRevisionId);
    }
    const instanceRevisions = database.table(
      ManagedChunkInstanceRevisionEntity,
    );
    for (const link of instanceRevisions) {
      const revision = database
        .table(CmsRevisionEntity)
        .find(({ id }) => id === link.revisionId);
      expect(revision?.snapshot).toMatchObject({
        formatVersion: 1,
        sanitizerPolicyVersion: null,
      });
    }
    expect(
      JSON.stringify({
        site,
        banners: database.table(BannerEntity),
        assignments: database.table(PageBannerAssignmentEntity),
      }),
    ).toBe(legacyBefore);
  });

  it('is an exact no-op on retry and rejects changed legacy source', async () => {
    const { database, service } = setup();
    await service.backfill(SITE_ID);
    const counts = managedEntities.map(
      (target) => database.table(target).length,
    );

    await expect(service.backfill(SITE_ID)).resolves.toMatchObject({
      status: 'unchanged',
      created: {
        instances: 0,
        layouts: 0,
        placements: 0,
        provenance: 0,
      },
      repairedProvenance: 0,
    });
    expect(
      managedEntities.map((target) => database.table(target).length),
    ).toEqual(counts);

    database.table(BannerEntity)[0].title = 'Changed outside migration';
    await expect(service.backfill(SITE_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      managedEntities.map((target) => database.table(target).length),
    ).toEqual(counts);
  });

  it('rolls back unknown mappings before creating managed rows', async () => {
    const { database, service } = setup();
    database.table(PageBannerAssignmentEntity)[0].zone = 'unknown';

    await expect(service.backfill(SITE_ID)).rejects.toThrow(
      /Skinova managed backfill/,
    );
    for (const target of managedEntities) {
      expect(database.table(target)).toHaveLength(0);
    }
  });

  it('rejects a partial target instead of adopting it', async () => {
    const { database, service } = setup();
    database.seed(CmsRevisionResourceEntity, [
      Object.assign(new CmsRevisionResourceEntity(), {
        id: 'a1a00000-0000-4000-8000-000000000001',
        siteId: SITE_ID,
        resourceType: 'chunk_instance',
        entityId: PROMO_ID,
        latestVersionNumber: 0,
        draftRevisionId: null,
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      }),
    ]);

    await expect(service.backfill(SITE_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(database.table(ManagedChunkInstanceEntity)).toHaveLength(0);
    expect(database.table(CmsRevisionResourceEntity)).toHaveLength(1);
  });
});
