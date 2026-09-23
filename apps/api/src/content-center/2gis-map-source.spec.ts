/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as publicMaterial from './public-material';
import {
  is2GisMapsUrl,
  TwoGisMapSourceClient,
  twoGisMapsAddress,
} from './2gis-map-source';

function scriptJson(name: string, value: unknown): string {
  const json = JSON.stringify(value)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'");
  return `var ${name} = JSON.parse('${json}');`;
}

const initialState = {
  data: {
    entity: {
      profile: {
        '70000001080050161': {
          data: {
            id: '70000001080050161',
            name: 'Crazy studio, ИТ-компания',
            address_name: 'Союзная улица, 7',
            point: { lat: 55.896376, lon: 37.440687 },
            contact_groups: [
              {
                contacts: [
                  { type: 'phone', text: '+7‒965‒150‒03‒03' },
                  {
                    type: 'website',
                    url: 'http://crazy.studio',
                    text: 'crazy.studio',
                  },
                ],
              },
            ],
            external_content: [
              { main_photo_url: 'https://i4.photo.2gis.com/main/branch/photo' },
            ],
            reviews: {
              general_rating: 5,
              general_review_count: 3,
              general_review_count_with_stars: 3,
            },
            rubrics: [{ name: 'Разработка и продвижение сайтов' }],
            schedule: {
              Mon: { working_hours: [{ from: '11:00', to: '22:00' }] },
            },
            attribute_groups: [
              {
                name: 'Способы оплаты',
                attributes: [{ name: 'Оплата картой' }],
              },
            ],
            has_goods: true,
          },
        },
      },
    },
    market: {
      offersSearch: {
        profile: {
          '70000001080050161': { data: { total: 1 } },
        },
        pagination: {
          '70000001080050161': {
            '1': { data: ['product-1:70000001080050161'] },
          },
        },
      },
      products: {
        'product-1': {
          data: {
            product: {
              name: 'Сайт под ключ',
              description: 'Сайты под ключ для бизнеса',
              attributes: [],
            },
          },
        },
      },
      offers: {
        'product-1:70000001080050161': {
          data: { price: 20000, currency: 'RUB' },
        },
      },
    },
  },
};

const queryState = {
  queries: [
    {
      queryKey: ['fetchEntityReviews', ['70000001080050161', 'branch']],
      state: {
        data: {
          pages: [
            {
              items: [
                {
                  rating: 5,
                  text: 'Сотрудничаем несколько лет.',
                  date_created: '2026-09-20T10:00:00.000Z',
                  user: { name: 'Анна' },
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

const html = [
  '<!doctype html><html><head></head><body>',
  scriptJson('initialState', initialState),
  scriptJson('__REACT_QUERY_STATE__', queryState),
  '</body></html>',
].join('');

describe('TwoGisMapSourceClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts public firm cards and rejects unrelated 2GIS pages', () => {
    expect(is2GisMapsUrl('https://2gis.ru/khimki/firm/70000001080050161')).toBe(
      true,
    );
    expect(
      is2GisMapsUrl('https://2gis.ru/khimki/firm/70000001080050161/tab/prices'),
    ).toBe(true);
    expect(is2GisMapsUrl('https://2gis.ru/khimki/search/студия')).toBe(false);
    expect(
      is2GisMapsUrl(
        'https://2gis.ru/khimki/search/Crazy%20Studio/firm/70000001080050161',
      ),
    ).toBe(true);
    expect(
      is2GisMapsUrl('https://2gis.ru/khimki/search/Crazy/firm/not-a-number'),
    ).toBe(false);
    expect(
      twoGisMapsAddress(
        'https://2gis.ru/khimki/firm/70000001080050161?utm_source=x',
      ),
    ).toBe('https://2gis.ru/khimki/firm/70000001080050161');
    expect(
      twoGisMapsAddress(
        'https://2gis.ru/khimki/search/Crazy%20Studio/firm/70000001080050161',
      ),
    ).toBe('https://2gis.ru/khimki/firm/70000001080050161');
  });

  it('collects a saved search-card link from its canonical firm page', async () => {
    const read = jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockImplementation((url) =>
        Promise.resolve({
          body: html,
          html: true,
          status: 200,
          url: String(url),
        }),
      );

    const collected = await new TwoGisMapSourceClient().collect(
      'https://2gis.ru/khimki/search/Crazy%20Studio/firm/70000001080050161',
      new AbortController().signal,
    );

    expect(read).toHaveBeenCalledWith(
      'https://2gis.ru/khimki/firm/70000001080050161',
      expect.any(Object),
    );
    expect(collected.map.organizationId).toBe('70000001080050161');
    expect(collected.pages[0].url).toBe(
      'https://2gis.ru/khimki/firm/70000001080050161',
    );
  });

  it('collects the public card, reviews, prices and features', async () => {
    jest.spyOn(publicMaterial, 'readPublicResource').mockImplementation((url) =>
      Promise.resolve({
        body: html,
        html: true,
        status: 200,
        url: String(url),
      }),
    );

    const collected = await new TwoGisMapSourceClient().collect(
      'https://2gis.ru/khimki/firm/70000001080050161',
      new AbortController().signal,
      new Date('2026-09-21T12:00:00.000Z'),
    );

    expect(collected.map).toMatchObject({
      provider: '2gis',
      organizationId: '70000001080050161',
      title: 'Crazy studio, ИТ-компания',
      address: 'Союзная улица, 7',
      phone: '+7‒965‒150‒03‒03',
      rating: 5,
      reviewCount: 3,
      categories: ['Разработка и продвижение сайтов'],
      features: ['Способы оплаты: Оплата картой'],
    });
    expect(collected.map.reviews).toHaveLength(1);
    expect(collected.map.products).toMatchObject([
      { title: 'Сайт под ключ', price: expect.stringContaining('20') },
    ]);
    expect(collected.pages.map((item) => item.group)).toEqual([
      '2ГИС · Обзор',
      '2ГИС · Отзывы',
      '2ГИС · Товары и услуги',
      '2ГИС · Особенности',
    ]);
    expect(collected.pages[1].content).toContain('Сотрудничаем несколько лет');
    expect(collected.pages[2].content).toContain('Сайт под ключ');
  });
});
