import type { SourceSnapshot } from './preparation-ai.service';
import { wouldLoseGoogleReviews } from './google-maps-refresh';

function snapshot(
  reviews: string[],
  reviewCount: number | null,
): SourceSnapshot {
  return {
    sourceId: 'google',
    title: 'Example',
    sourceUrl: 'https://www.google.com/maps/place/Example',
    checkedAt: '2026-09-23T00:00:00.000Z',
    mode: 'map-card',
    warnings: [],
    pages: [],
    map: {
      provider: 'google',
      organizationId: null,
      title: 'Example',
      address: null,
      coordinates: null,
      phone: null,
      website: null,
      image: null,
      rating: null,
      reviewCount,
      ratingCount: null,
      categories: [],
      openingHours: [],
      reviews: reviews.map((text) => ({
        author: 'Visitor',
        rating: null,
        date: null,
        text,
        url: null,
      })),
      products: [],
      features: [],
      sourceUrl: 'https://www.google.com/maps/place/Example',
    },
  };
}

describe('Google Maps refresh safety', () => {
  it('preserves prior reviews when a refresh only returns overview', () => {
    expect(
      wouldLoseGoogleReviews(snapshot(['Review'], 297), snapshot([], 297)),
    ).toBe(true);
    expect(
      wouldLoseGoogleReviews(snapshot(['Review'], 297), snapshot([], null)),
    ).toBe(true);
  });

  it('accepts first collection, refreshed reviews and a genuinely empty card', () => {
    expect(wouldLoseGoogleReviews(null, snapshot([], 297))).toBe(false);
    expect(
      wouldLoseGoogleReviews(snapshot(['Old'], 297), snapshot(['New'], 297)),
    ).toBe(false);
    expect(
      wouldLoseGoogleReviews(snapshot(['Old'], 297), snapshot([], 0)),
    ).toBe(false);
  });
});
