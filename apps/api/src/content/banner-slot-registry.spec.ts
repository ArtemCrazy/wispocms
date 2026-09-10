import { PageKind } from '../database/entities';
import {
  bannerSlotsForPage,
  isAllowedBannerLink,
} from './banner-slot-registry';

describe('banner slot registry', () => {
  it('exposes the exact Skinova homepage slots and asset constraints', () => {
    const slots = bannerSlotsForPage({
      kind: PageKind.HOMEPAGE,
      systemTemplateKey: 'skinova-home',
      systemTemplateVersion: '1',
    });
    expect(slots.map((slot) => slot.id)).toEqual([
      'homepage_top',
      'homepage_middle',
    ]);
    expect(slots[1]).toMatchObject({
      renderer: 'skinova-consultation',
      desktop: { aspectRatio: '15:4', minWidth: 1800, minHeight: 480 },
      mobile: { aspectRatio: '15:4', fallbackToDesktop: true },
    });
  });

  it('does not expose slots for unbound or unrelated templates', () => {
    expect(
      bannerSlotsForPage({
        kind: PageKind.HOMEPAGE,
        systemTemplateKey: null,
        systemTemplateVersion: null,
      }),
    ).toEqual([]);
    expect(
      bannerSlotsForPage({
        kind: PageKind.HOMEPAGE,
        systemTemplateKey: 'armaturex-home-v1',
        systemTemplateVersion: '1',
      }),
    ).toEqual([]);
  });

  it('accepts local and HTTP links but rejects executable or protocol-relative links', () => {
    expect(isAllowedBannerLink('/articles/example')).toBe(true);
    expect(isAllowedBannerLink('https://example.ru/path')).toBe(true);
    expect(isAllowedBannerLink('javascript:alert(1)')).toBe(false);
    expect(isAllowedBannerLink('data:text/html,unsafe')).toBe(false);
    expect(isAllowedBannerLink('//example.ru/path')).toBe(false);
  });
});
