import { SiteType } from '../database/entities';
import {
  getSiteContentCapabilities,
  siteSupportsContentModule,
} from './site-content-capabilities';

describe('site content capabilities', () => {
  it('keeps the media CMS complete', () => {
    expect(
      Object.values(getSiteContentCapabilities(SiteType.MEDIA)),
    ).not.toContain(false);
  });

  it('keeps corporate navigation focused on pages, blog and banners', () => {
    expect(getSiteContentCapabilities(SiteType.CORPORATE)).toEqual({
      articles: true,
      categories: false,
      authors: false,
      pages: true,
      banners: true,
    });
  });

  it('prevents content modules that do not belong to a landing page', () => {
    expect(siteSupportsContentModule(SiteType.LANDING, 'pages')).toBe(true);
    expect(siteSupportsContentModule(SiteType.LANDING, 'articles')).toBe(false);
    expect(siteSupportsContentModule(SiteType.LANDING, 'banners')).toBe(false);
  });
});
