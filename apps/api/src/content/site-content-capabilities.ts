import { SiteType } from '../database/entities';

export type SiteContentModule =
  'articles' | 'categories' | 'authors' | 'pages' | 'banners';

export type SiteContentCapabilities = Record<SiteContentModule, boolean>;

const capabilitiesBySiteType: Record<SiteType, SiteContentCapabilities> = {
  [SiteType.MEDIA]: {
    articles: true,
    categories: true,
    authors: true,
    pages: true,
    banners: true,
  },
  [SiteType.CORPORATE]: {
    articles: true,
    categories: false,
    authors: false,
    pages: true,
    banners: true,
  },
  [SiteType.LANDING]: {
    articles: false,
    categories: false,
    authors: false,
    pages: true,
    banners: false,
  },
};

export function getSiteContentCapabilities(
  siteType: SiteType,
): SiteContentCapabilities {
  return capabilitiesBySiteType[siteType];
}

export function siteSupportsContentModule(
  siteType: SiteType,
  module: SiteContentModule,
) {
  return getSiteContentCapabilities(siteType)[module];
}
