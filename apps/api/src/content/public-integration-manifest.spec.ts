import { DomainStatus, SiteType } from '../database/entities';
import { buildPublicIntegrationManifest } from './public-integration-manifest';

describe('buildPublicIntegrationManifest', () => {
  const site = {
    name: 'Wispo Media',
    slug: 'wispo-media',
    domain: 'media.example.test',
    domainStatus: DomainStatus.VERIFIED,
    siteType: SiteType.MEDIA,
    linkedCommercialSite: null,
  };

  it('describes the versioned public contract using portable relative paths', () => {
    const manifest = buildPublicIntegrationManifest(site);

    expect(manifest.schemaVersion).toBe('1.1');
    expect(manifest.site).toEqual({
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      siteType: site.siteType,
      linkedCommercialSite: null,
    });
    expect(manifest.endpoints.site).toBe('/api/public/sites/wispo-media');
    expect(manifest.endpoints.manifest).not.toMatch(/^https?:\/\//);
    expect(manifest.rendering.arbitraryCodeInCms).toBe(false);
  });

  it.each([
    [SiteType.MEDIA, true, true, true],
    [SiteType.CORPORATE, true, false, true],
    [SiteType.LANDING, false, false, false],
  ])(
    'exposes only the modules supported by %s sites',
    (siteType, articles, categories, banners) => {
      const manifest = buildPublicIntegrationManifest({
        ...site,
        siteType,
      });

      expect(manifest.capabilities.articles).toBe(articles);
      expect(manifest.capabilities.categories).toBe(categories);
      expect(manifest.capabilities.banners).toBe(banners);
      expect(manifest.endpoints.article.enabled).toBe(articles);
      expect(manifest.routes.article === null).toBe(!articles);
      expect(manifest.endpoints.category.enabled).toBe(categories);
      expect(manifest.routes.category === null).toBe(!categories);
      expect(manifest.contentModel.category.length > 0).toBe(categories);
    },
  );

  it('documents the public structured article and category models', () => {
    const manifest = buildPublicIntegrationManifest(site);

    expect(manifest.endpoints.category.path).toBe(
      '/api/public/sites/wispo-media/categories/{categorySlug}',
    );
    expect(manifest.routes.category).toBe('/categories/{categorySlug}');
    expect(manifest.contentModel.article).toEqual(
      expect.arrayContaining(['bodyDocument', 'documentVersion']),
    );
    expect(manifest.contentModel.category).toEqual(
      expect.arrayContaining(['name', 'slug', 'status', 'canonicalUrl']),
    );
  });

  it('publishes a safe commercial-site link for media consumers', () => {
    const manifest = buildPublicIntegrationManifest({
      ...site,
      linkedCommercialSite: {
        id: 'commercial-id',
        name: 'Wispo Agency',
        slug: 'wispo-agency',
        domain: 'agency.example.test',
        domainStatus: DomainStatus.VERIFIED,
        isActive: true,
      },
    });
    expect(manifest.site.linkedCommercialSite).toEqual({
      id: 'commercial-id',
      name: 'Wispo Agency',
      slug: 'wispo-agency',
      domain: 'agency.example.test',
      publicUrl: 'https://agency.example.test',
    });
  });
});
