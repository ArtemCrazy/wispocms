import * as publicMaterial from './public-material';
import { collectVisibleGoogleReviews } from './google-maps-reviews';
import { GoogleMapSourceClient } from './google-maps-source';

jest.mock('./google-maps-reviews', () => ({
  collectVisibleGoogleReviews: jest.fn(),
}));

const featureId = '0x1:0x2';
const sourceUrl = `https://www.google.com/maps/place/Example/data=!1s${featureId}`;

function preview() {
  const place: unknown[] = [];
  place[10] = featureId;
  place[11] = 'Example';
  place[4] = [null, null, null, null, null, null, null, 4.8, 42];
  jest.spyOn(publicMaterial, 'readPublicResource').mockResolvedValue({
    body: JSON.stringify([place]),
    html: false,
    url: 'https://www.google.com/maps/preview/place',
    status: 200,
  });
}

describe('Google Maps public collection', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('saves actual reviews as a selectable source section', async () => {
    preview();
    jest.mocked(collectVisibleGoogleReviews).mockResolvedValue({
      reviewCount: 42,
      reviews: [
        {
          author: 'Анна',
          rating: 3,
          date: 'вчера',
          text: 'Шумно вечером.',
          url: sourceUrl,
        },
      ],
    });
    const result = await new GoogleMapSourceClient().collect(
      sourceUrl,
      new AbortController().signal,
    );
    expect(result.map.reviews).toHaveLength(1);
    expect(
      result.pages.find((page) => page.group === 'Google Maps · Отзывы')
        ?.content,
    ).toContain('Шумно вечером.');
    expect(result.warnings.join(' ')).toContain(
      'Полный архив не считается собранным',
    );
  });

  it('keeps the overview but does not claim zero reviews when the browser fails', async () => {
    preview();
    jest
      .mocked(collectVisibleGoogleReviews)
      .mockRejectedValue(new Error('раздел временно недоступен'));
    const result = await new GoogleMapSourceClient().collect(
      sourceUrl,
      new AbortController().signal,
    );
    expect(result.pages).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain(
      'Тексты отзывов Google Maps не получены',
    );
    expect(result.warnings.join(' ')).toContain('раздел временно недоступен');
  });
});
