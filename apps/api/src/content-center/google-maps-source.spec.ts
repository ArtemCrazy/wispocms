import { googleMapsAddress, isGoogleMapsUrl } from './google-maps-source';

describe('Google Maps public source', () => {
  it('accepts direct organization cards and public short links', () => {
    expect(
      isGoogleMapsUrl(
        'https://www.google.com/maps/place/Googleplex/@37.422,-122.085,17z',
      ),
    ).toBe(true);
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/example')).toBe(true);
    expect(googleMapsAddress('https://maps.app.goo.gl/example')).toBe(
      'https://maps.app.goo.gl/example',
    );
    expect(
      isGoogleMapsUrl(
        'https://www.google.com/maps/search/?api=1&query=Googleplex',
      ),
    ).toBe(true);
  });

  it('rejects a regular Google page or a search engine result', () => {
    expect(isGoogleMapsUrl('https://www.google.com/search?q=Googleplex')).toBe(
      false,
    );
    expect(() => googleMapsAddress('https://example.com/company')).toThrow(
      'Google Maps',
    );
  });
});
