import {
  SKINOVA_ARTICLE_PLACEMENT_MIGRATION,
  SKINOVA_INSTANCE_MIGRATION,
  SKINOVA_PAGE_PLACEMENT_MIGRATION,
  canonicalSkinovaSourceChecksum,
  projectSkinovaManagedBackfill,
  type SkinovaManagedBackfillSource,
} from './skinova-managed-backfill.projection';

const SITE_ID = '51a00000-0000-4000-8000-000000000002';
const HOME_ID = '51a40000-0000-4000-8000-000000000001';
const PRIVACY_ID = '51a40000-0000-4000-8000-000000000002';
const NOT_FOUND_ID = '51a40000-0000-4000-8000-000000000003';
const PROMO_ID = '51a60000-0000-4000-8000-000000000001';
const CONSULTATION_ID = '51a60000-0000-4000-8000-000000000002';
const ARTICLE_ID = '51a60000-0000-4000-8000-000000000003';

const source = (): SkinovaManagedBackfillSource => ({
  siteId: SITE_ID,
  pages: [
    {
      id: HOME_ID,
      siteId: SITE_ID,
      slug: '',
      kind: 'homepage',
      publishedSystemTemplateKey: 'skinova-home',
      publishedSystemTemplateVersion: '1',
    },
    {
      id: PRIVACY_ID,
      siteId: SITE_ID,
      slug: 'privacy-policy',
      kind: 'page',
      publishedSystemTemplateKey: null,
      publishedSystemTemplateVersion: null,
    },
    {
      id: NOT_FOUND_ID,
      siteId: SITE_ID,
      slug: '404',
      kind: 'page',
      publishedSystemTemplateKey: 'skinova',
      publishedSystemTemplateVersion: '1',
    },
  ],
  banners: [
    {
      id: PROMO_ID,
      siteId: SITE_ID,
      name: 'Промо Skinova',
      placement: null,
      title: 'Бесплатная консультация',
      subtitle: 'Фотодинамическая терапия',
      buttonText: 'Записаться',
      linkUrl: '#consultation',
      mediaId: '61a60000-0000-4000-8000-000000000001',
      mobileMediaId: null,
      sortOrder: 3,
      isActive: true,
    },
    {
      id: CONSULTATION_ID,
      siteId: SITE_ID,
      name: 'Консультация косметолога',
      placement: null,
      title: null,
      subtitle: 'Подберём план',
      buttonText: null,
      linkUrl: null,
      mediaId: null,
      mobileMediaId: '61a60000-0000-4000-8000-000000000002',
      sortOrder: 7,
      isActive: false,
    },
    {
      id: ARTICLE_ID,
      siteId: SITE_ID,
      name: 'Баннер статьи Skinova',
      placement: 'article_sidebar',
      title: 'Подберём препарат',
      subtitle: null,
      buttonText: 'Записаться',
      linkUrl: '#consultation',
      mediaId: null,
      mobileMediaId: null,
      sortOrder: 0,
      isActive: true,
    },
  ],
  assignments: [
    {
      id: '71a60000-0000-4000-8000-000000000001',
      siteId: SITE_ID,
      pageId: HOME_ID,
      bannerId: PROMO_ID,
      zone: 'homepage_top',
    },
    {
      id: '71a60000-0000-4000-8000-000000000002',
      siteId: SITE_ID,
      pageId: HOME_ID,
      bannerId: CONSULTATION_ID,
      zone: 'homepage_middle',
    },
    {
      id: '71a60000-0000-4000-8000-000000000003',
      siteId: SITE_ID,
      pageId: PRIVACY_ID,
      bannerId: PROMO_ID,
      zone: 'homepage_top',
    },
    {
      id: '71a60000-0000-4000-8000-000000000004',
      siteId: SITE_ID,
      pageId: NOT_FOUND_ID,
      bannerId: PROMO_ID,
      zone: 'homepage_top',
    },
  ],
});

describe('Skinova managed backfill projection', () => {
  it('projects the current seed into 3 instances, 4 layouts, and 5 placements', () => {
    const projected = projectSkinovaManagedBackfill(source());

    expect(projected.instances).toHaveLength(3);
    expect(projected.layouts).toHaveLength(4);
    expect(
      projected.layouts.flatMap((layout) => layout.placements),
    ).toHaveLength(5);
    expect(projected.instances.map(({ id }) => id).sort()).toEqual(
      [PROMO_ID, CONSULTATION_ID, ARTICLE_ID].sort(),
    );
    expect(projected.layouts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeKind: 'page',
          pageId: HOME_ID,
          templateKey: 'skinova-home',
          templateVersion: '1',
          placements: expect.arrayContaining([
            expect.objectContaining({
              siteId: SITE_ID,
              instanceId: PROMO_ID,
              slotKey: 'homepage_top',
              position: 0,
              migrationVersion: SKINOVA_PAGE_PLACEMENT_MIGRATION,
            }),
            expect.objectContaining({
              instanceId: CONSULTATION_ID,
              slotKey: 'homepage_middle',
              position: 0,
              migrationVersion: SKINOVA_PAGE_PLACEMENT_MIGRATION,
            }),
          ]),
        }),
        expect.objectContaining({
          scopeKind: 'page',
          pageId: PRIVACY_ID,
          templateKey: 'skinova',
          templateVersion: '1',
        }),
        expect.objectContaining({
          scopeKind: 'page',
          pageId: NOT_FOUND_ID,
          templateKey: 'skinova',
          templateVersion: '1',
        }),
        expect.objectContaining({
          scopeKind: 'site_surface',
          surfaceKey: 'template:article:skinova-article@1',
          templateKey: 'skinova-article',
          templateVersion: '1',
          placements: [
            expect.objectContaining({
              instanceId: ARTICLE_ID,
              slotKey: 'article_sidebar',
              position: 0,
              migrationVersion: SKINOVA_ARTICLE_PLACEMENT_MIGRATION,
            }),
          ],
        }),
      ]),
    );
  });

  it('maps names, fields, images, nulls, and provenance without normalization', () => {
    const projected = projectSkinovaManagedBackfill(source());
    const promo = projected.instances.find(({ id }) => id === PROMO_ID);
    const consultation = projected.instances.find(
      ({ id }) => id === CONSULTATION_ID,
    );

    expect(promo).toEqual(
      expect.objectContaining({
        displayName: 'Промо Skinova',
        definitionKey: 'skinova-promo-strip',
        schemaVersion: '1',
        migrationVersion: SKINOVA_INSTANCE_MIGRATION,
        data: {
          title: 'Бесплатная консультация',
          subtitle: 'Фотодинамическая терапия',
          button_text: 'Записаться',
          link_url: '#consultation',
          media_id: {
            mediaId: '61a60000-0000-4000-8000-000000000001',
            alt: '',
            decorative: true,
          },
          mobile_media_id: null,
          sort_order: 3,
          is_active: true,
        },
      }),
    );
    expect(consultation?.data).toEqual({
      title: null,
      subtitle: 'Подберём план',
      button_text: null,
      link_url: null,
      media_id: null,
      mobile_media_id: {
        mediaId: '61a60000-0000-4000-8000-000000000002',
        alt: '',
        decorative: true,
      },
      sort_order: 7,
      is_active: false,
    });
  });

  it('computes a stable canonical checksum that detects source changes', () => {
    const first = canonicalSkinovaSourceChecksum({
      title: 'Same',
      nested: { second: 2, first: 1 },
    });
    const reordered = canonicalSkinovaSourceChecksum({
      nested: { first: 1, second: 2 },
      title: 'Same',
    });
    const changed = canonicalSkinovaSourceChecksum({
      nested: { first: 1, second: 3 },
      title: 'Same',
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it.each([
    [
      'unknown page slug',
      (value: SkinovaManagedBackfillSource) => {
        value.pages[1].slug = 'contacts';
      },
    ],
    [
      'unknown assignment zone',
      (value: SkinovaManagedBackfillSource) => {
        value.assignments[0].zone = 'unknown_zone';
      },
    ],
    [
      'unknown direct placement',
      (value: SkinovaManagedBackfillSource) => {
        value.banners[2].placement = 'footer';
      },
    ],
    [
      'ambiguous banner use',
      (value: SkinovaManagedBackfillSource) => {
        value.assignments[1].bannerId = PROMO_ID;
      },
    ],
    [
      'unassigned banner',
      (value: SkinovaManagedBackfillSource) => {
        value.assignments = value.assignments.filter(
          ({ bannerId }) => bannerId !== CONSULTATION_ID,
        );
      },
    ],
    [
      'cross-site source',
      (value: SkinovaManagedBackfillSource) => {
        value.banners[0].siteId = '51a00000-0000-4000-8000-000000000099';
      },
    ],
  ])('rejects %s before persistence', (_label, mutate) => {
    const value = source();
    mutate(value);

    expect(() => projectSkinovaManagedBackfill(value)).toThrow(
      /Skinova managed backfill/,
    );
  });
});
