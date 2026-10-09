import { createHash } from 'node:crypto';

export const SKINOVA_INSTANCE_MIGRATION = 'skinova-v2-published-instance-v1';
export const SKINOVA_PAGE_PLACEMENT_MIGRATION = 'skinova-v2-page-placement-v1';
export const SKINOVA_ARTICLE_PLACEMENT_MIGRATION =
  'skinova-v2-article-placement-v1';

const ARTICLE_SURFACE_KEY = 'template:article:skinova-article@1';

export type SkinovaLegacyBanner = {
  id: string;
  siteId: string;
  name: string;
  placement: string | null;
  title: string | null;
  subtitle: string | null;
  buttonText: string | null;
  linkUrl: string | null;
  mediaId: string | null;
  mobileMediaId: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type SkinovaLegacyPage = {
  id: string;
  siteId: string;
  slug: string;
  kind: string;
  publishedSystemTemplateKey: string | null;
  publishedSystemTemplateVersion: string | null;
};

export type SkinovaLegacyPageBannerAssignment = {
  id: string;
  siteId: string;
  pageId: string;
  bannerId: string;
  zone: string;
};

export type SkinovaManagedBackfillSource = {
  siteId: string;
  banners: SkinovaLegacyBanner[];
  pages: SkinovaLegacyPage[];
  assignments: SkinovaLegacyPageBannerAssignment[];
};

export type SkinovaManagedImageValue = {
  mediaId: string;
  alt: '';
  decorative: true;
};

export type SkinovaManagedInstanceProjection = {
  id: string;
  siteId: string;
  displayName: string;
  definitionKey:
    | 'skinova-promo-strip'
    | 'skinova-consultation-banner'
    | 'skinova-article-sidebar-banner';
  schemaVersion: '1';
  data: {
    title: string | null;
    subtitle: string | null;
    button_text: string | null;
    link_url: string | null;
    media_id: SkinovaManagedImageValue | null;
    mobile_media_id: SkinovaManagedImageValue | null;
    sort_order: number;
    is_active: boolean;
  };
  migrationVersion: typeof SKINOVA_INSTANCE_MIGRATION;
  sourceType: 'banner';
  sourceId: string;
  sourceChecksum: string;
};

export type SkinovaManagedPlacementProjection = {
  siteId: string;
  sourceType: 'banner' | 'page_banner_assignment';
  sourceId: string;
  sourceChecksum: string;
  migrationVersion:
    | typeof SKINOVA_PAGE_PLACEMENT_MIGRATION
    | typeof SKINOVA_ARTICLE_PLACEMENT_MIGRATION;
  instanceId: string;
  slotKey: 'homepage_top' | 'homepage_middle' | 'article_sidebar';
  position: 0;
};

export type SkinovaManagedLayoutProjection =
  | {
      layoutKey: string;
      scopeKind: 'page';
      pageId: string;
      surfaceKey: null;
      templateKey: 'skinova-home' | 'skinova';
      templateVersion: '1';
      placements: SkinovaManagedPlacementProjection[];
    }
  | {
      layoutKey: string;
      scopeKind: 'site_surface';
      pageId: null;
      surfaceKey: typeof ARTICLE_SURFACE_KEY;
      templateKey: 'skinova-article';
      templateVersion: '1';
      placements: SkinovaManagedPlacementProjection[];
    };

export type SkinovaManagedBackfillProjection = {
  siteId: string;
  instances: SkinovaManagedInstanceProjection[];
  layouts: SkinovaManagedLayoutProjection[];
};

const fail = (message: string): never => {
  throw new Error(`Skinova managed backfill: ${message}`);
};

const canonicalize = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('checksum input contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => {
          if (record[key] === undefined) {
            fail('checksum input contains undefined');
          }
          return [key, canonicalize(record[key])];
        }),
    );
  }
  return fail('checksum input contains a non-JSON value');
};

export const canonicalSkinovaSourceChecksum = (value: unknown): string =>
  `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex')}`;

const imageValue = (mediaId: string | null): SkinovaManagedImageValue | null =>
  mediaId === null ? null : { mediaId, alt: '', decorative: true };

const bannerChecksumInput = (banner: SkinovaLegacyBanner) => ({
  id: banner.id,
  siteId: banner.siteId,
  name: banner.name,
  placement: banner.placement,
  title: banner.title,
  subtitle: banner.subtitle,
  buttonText: banner.buttonText,
  linkUrl: banner.linkUrl,
  mediaId: banner.mediaId,
  mobileMediaId: banner.mobileMediaId,
  sortOrder: banner.sortOrder,
  isActive: banner.isActive,
});

const definitionForZone = (
  zone: string,
): SkinovaManagedInstanceProjection['definitionKey'] => {
  if (zone === 'homepage_top') return 'skinova-promo-strip';
  if (zone === 'homepage_middle') return 'skinova-consultation-banner';
  return fail(`unknown page assignment zone "${zone}"`);
};

const pageTemplate = (
  page: SkinovaLegacyPage,
): Pick<
  Extract<SkinovaManagedLayoutProjection, { scopeKind: 'page' }>,
  'templateKey' | 'templateVersion'
> => {
  if (page.kind === 'homepage' && page.slug === '') {
    return { templateKey: 'skinova-home', templateVersion: '1' };
  }
  if (
    page.kind === 'page' &&
    (page.slug === '404' || page.slug === 'privacy-policy')
  ) {
    return { templateKey: 'skinova', templateVersion: '1' };
  }
  return fail(`unknown assigned page "${page.slug}" (${page.kind})`);
};

const assertSourceSite = (
  siteId: string,
  value: { id: string; siteId: string },
  source: string,
): void => {
  if (value.siteId !== siteId) {
    fail(`${source} "${value.id}" belongs to another site`);
  }
};

export const projectSkinovaManagedBackfill = (
  source: SkinovaManagedBackfillSource,
): SkinovaManagedBackfillProjection => {
  const banners = new Map<string, SkinovaLegacyBanner>();
  const pages = new Map<string, SkinovaLegacyPage>();
  const assignmentsByBanner = new Map<
    string,
    SkinovaLegacyPageBannerAssignment[]
  >();

  for (const banner of source.banners) {
    assertSourceSite(source.siteId, banner, 'banner');
    if (banners.has(banner.id)) fail(`duplicate banner "${banner.id}"`);
    banners.set(banner.id, banner);
  }
  for (const page of source.pages) {
    assertSourceSite(source.siteId, page, 'page');
    if (pages.has(page.id)) fail(`duplicate page "${page.id}"`);
    pages.set(page.id, page);
  }

  const assignmentIds = new Set<string>();
  const occupiedSlots = new Set<string>();
  for (const assignment of source.assignments) {
    assertSourceSite(source.siteId, assignment, 'assignment');
    if (assignmentIds.has(assignment.id)) {
      fail(`duplicate assignment "${assignment.id}"`);
    }
    assignmentIds.add(assignment.id);
    if (!banners.has(assignment.bannerId)) {
      fail(`assignment "${assignment.id}" references an unknown banner`);
    }
    const page =
      pages.get(assignment.pageId) ??
      fail(`assignment "${assignment.id}" references an unknown page`);
    definitionForZone(assignment.zone);
    pageTemplate(page);
    const occupied = `${assignment.pageId}:${assignment.zone}`;
    if (occupiedSlots.has(occupied)) {
      fail(`duplicate placement for "${occupied}"`);
    }
    occupiedSlots.add(occupied);
    const list = assignmentsByBanner.get(assignment.bannerId) ?? [];
    list.push(assignment);
    assignmentsByBanner.set(assignment.bannerId, list);
  }

  const instances: SkinovaManagedInstanceProjection[] = [];
  for (const banner of banners.values()) {
    const assignments = assignmentsByBanner.get(banner.id) ?? [];
    const definitions = new Set(
      assignments.map((assignment) => definitionForZone(assignment.zone)),
    );
    let definitionKey:
      SkinovaManagedInstanceProjection['definitionKey'] | undefined;

    if (banner.placement === 'article_sidebar') {
      if (assignments.length > 0) {
        fail(`banner "${banner.id}" mixes direct and page placement`);
      }
      definitionKey = 'skinova-article-sidebar-banner';
    } else if (banner.placement !== null) {
      fail(`unknown direct placement "${banner.placement}"`);
    } else {
      if (definitions.size === 0) fail(`banner "${banner.id}" is unassigned`);
      if (definitions.size !== 1) {
        fail(`banner "${banner.id}" has ambiguous managed definitions`);
      }
      definitionKey = [...definitions][0];
    }

    const resolvedDefinitionKey =
      definitionKey ?? fail(`banner "${banner.id}" has no managed definition`);

    instances.push({
      id: banner.id,
      siteId: source.siteId,
      displayName: banner.name,
      definitionKey: resolvedDefinitionKey,
      schemaVersion: '1',
      data: {
        title: banner.title,
        subtitle: banner.subtitle,
        button_text: banner.buttonText,
        link_url: banner.linkUrl,
        media_id: imageValue(banner.mediaId),
        mobile_media_id: imageValue(banner.mobileMediaId),
        sort_order: banner.sortOrder,
        is_active: banner.isActive,
      },
      migrationVersion: SKINOVA_INSTANCE_MIGRATION,
      sourceType: 'banner',
      sourceId: banner.id,
      sourceChecksum: canonicalSkinovaSourceChecksum(
        bannerChecksumInput(banner),
      ),
    });
  }

  const layoutsByPage = new Map<
    string,
    Extract<SkinovaManagedLayoutProjection, { scopeKind: 'page' }>
  >();
  for (const assignment of source.assignments) {
    const page =
      pages.get(assignment.pageId) ??
      fail(`assignment "${assignment.id}" references an unknown page`);
    const template = pageTemplate(page);
    const layout = layoutsByPage.get(page.id) ?? {
      layoutKey: `page:${page.id}`,
      scopeKind: 'page' as const,
      pageId: page.id,
      surfaceKey: null,
      ...template,
      placements: [],
    };
    layout.placements.push({
      siteId: source.siteId,
      sourceType: 'page_banner_assignment',
      sourceId: assignment.id,
      sourceChecksum: canonicalSkinovaSourceChecksum({
        id: assignment.id,
        siteId: assignment.siteId,
        pageId: assignment.pageId,
        bannerId: assignment.bannerId,
        zone: assignment.zone,
        page: {
          id: page.id,
          slug: page.slug,
          kind: page.kind,
        },
      }),
      migrationVersion: SKINOVA_PAGE_PLACEMENT_MIGRATION,
      instanceId: assignment.bannerId,
      slotKey: assignment.zone as 'homepage_top' | 'homepage_middle',
      position: 0,
    });
    layoutsByPage.set(page.id, layout);
  }

  const layouts: SkinovaManagedLayoutProjection[] = [...layoutsByPage.values()];
  const articleBanners = [...banners.values()].filter(
    ({ placement }) => placement === 'article_sidebar',
  );
  if (articleBanners.length > 1) {
    fail('multiple article_sidebar banners are ambiguous');
  }
  if (articleBanners.length === 1) {
    const banner = articleBanners[0];
    layouts.push({
      layoutKey: `site_surface:${ARTICLE_SURFACE_KEY}`,
      scopeKind: 'site_surface',
      pageId: null,
      surfaceKey: ARTICLE_SURFACE_KEY,
      templateKey: 'skinova-article',
      templateVersion: '1',
      placements: [
        {
          siteId: source.siteId,
          sourceType: 'banner',
          sourceId: banner.id,
          sourceChecksum: canonicalSkinovaSourceChecksum({
            ...bannerChecksumInput(banner),
            surfaceKey: ARTICLE_SURFACE_KEY,
            slotKey: 'article_sidebar',
          }),
          migrationVersion: SKINOVA_ARTICLE_PLACEMENT_MIGRATION,
          instanceId: banner.id,
          slotKey: 'article_sidebar',
          position: 0,
        },
      ],
    });
  }

  instances.sort((left, right) => left.id.localeCompare(right.id));
  for (const layout of layouts) {
    layout.placements.sort((left, right) =>
      left.slotKey.localeCompare(right.slotKey),
    );
  }
  layouts.sort((left, right) => left.layoutKey.localeCompare(right.layoutKey));

  return { siteId: source.siteId, instances, layouts };
};
