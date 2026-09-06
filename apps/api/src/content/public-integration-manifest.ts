import { DomainStatus, SiteEntity, SiteType } from '../database/entities';
import { getSiteContentCapabilities } from './site-content-capabilities';

const PUBLIC_INTEGRATION_SCHEMA_VERSION = '1.1';

type IntegrationSite = Pick<
  SiteEntity,
  'name' | 'slug' | 'domain' | 'domainStatus' | 'siteType'
> & {
  linkedCommercialSite?: Pick<
    SiteEntity,
    'id' | 'name' | 'slug' | 'domain' | 'domainStatus' | 'isActive'
  > | null;
};

export function buildPublicIntegrationManifest(site: IntegrationSite) {
  const base = `/api/public/sites/${encodeURIComponent(site.slug)}`;
  const capabilities = getSiteContentCapabilities(site.siteType);
  const linkedCommercialSite =
    site.siteType === SiteType.MEDIA && site.linkedCommercialSite?.isActive
      ? {
          id: site.linkedCommercialSite.id,
          name: site.linkedCommercialSite.name,
          slug: site.linkedCommercialSite.slug,
          domain: site.linkedCommercialSite.domain,
          publicUrl:
            site.linkedCommercialSite.domain &&
            site.linkedCommercialSite.domainStatus === DomainStatus.VERIFIED
              ? `https://${site.linkedCommercialSite.domain}`
              : `/preview/${encodeURIComponent(site.linkedCommercialSite.slug)}`,
        }
      : null;

  return {
    schemaVersion: PUBLIC_INTEGRATION_SCHEMA_VERSION,
    site: {
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      siteType: site.siteType,
      linkedCommercialSite,
    },
    capabilities: {
      ...capabilities,
      media: true,
      search: true,
      contactForm: true,
      seo: true,
      serverSideRendering: true,
    },
    endpoints: {
      manifest: `${base}/manifest`,
      site: base,
      article: {
        enabled: capabilities.articles,
        path: `${base}/articles/{articleSlug}`,
      },
      category: {
        enabled: capabilities.categories,
        path: `${base}/categories/{categorySlug}`,
      },
      page: {
        enabled: capabilities.pages,
        path: `${base}/pages/{pageSlug}`,
      },
      search: `${base}/search?q={query}`,
      media: `${base}/media/{mediaId}`,
      contact: `${base}/contact`,
    },
    routes: {
      homepage: '/',
      article: capabilities.articles ? '/articles/{articleSlug}' : null,
      category: capabilities.categories ? '/categories/{categorySlug}' : null,
      page: capabilities.pages ? '/pages/{pageSlug}' : null,
    },
    contentModel: {
      site: [
        'name',
        'slug',
        'domain',
        'siteType',
        'seoTitle',
        'seoDescription',
        'canonicalUrl',
        'seoImageMediaId',
        'noIndex',
        'globalData',
        'layoutSettings',
      ],
      page: capabilities.pages
        ? [
            'title',
            'slug',
            'kind',
            'status',
            'blocks',
            'seoTitle',
            'seoDescription',
            'canonicalUrl',
            'noIndex',
          ]
        : [],
      article: capabilities.articles
        ? [
            'title',
            'slug',
            'excerpt',
            'body',
            'bodyDocument',
            'documentVersion',
            'status',
            'category',
            'author',
            'coverMedia',
            'seoTitle',
            'seoDescription',
            'canonicalUrl',
            'noIndex',
            'publishedAt',
          ]
        : [],
      category: capabilities.categories
        ? [
            'name',
            'slug',
            'description',
            'status',
            'parentId',
            'publishedAt',
            'sortOrder',
            'color',
            'imageMedia',
            'icon',
            'seoTitle',
            'seoDescription',
            'canonicalUrl',
            'noIndex',
          ]
        : [],
      banner: capabilities.banners
        ? ['name', 'title', 'placement', 'sortOrder', 'linkUrl', 'media']
        : [],
    },
    rendering: {
      recommendedMode: 'server-side',
      arbitraryCodeInCms: false,
      description:
        'Шаблон хранится в проекте сайта и получает опубликованные данные из публичного API.',
    },
  };
}
