import * as publicMaterial from './public-material';
import { isYandexMapsUrl, YandexMapSourceClient } from './yandex-map-source';

const review = (author: string, text: string) => `
  <div class="business-review-view" itemprop="review">
    <div itemprop="author"><a href="https://yandex.ru/maps/user/${author}"><span itemprop="name">${author}</span></a></div>
    <span itemprop="reviewRating"><meta itemprop="ratingValue" content="5"></span>
    <meta itemprop="datePublished" content="2026-09-20T10:00:00.000Z">
    <div itemprop="reviewBody">${text}</div>
  </div>`;

const card = (body: string) => `<!doctype html><html><body>
  <div class="business-card-view" data-id="84036619207" data-coordinates="37.4,55.8">
    <meta itemprop="image" content="https://avatars.example/card.jpg">
    <h1 itemprop="name">Крейзи студио</h1>
    <meta itemprop="address" content="Химки, Союзная улица, 7">
    <span itemprop="telephone">+7 900 000-00-00</span>
    <a itemprop="url" href="https://crazy.studio/">crazy.studio</a>
    <meta itemprop="openingHours" content="Mo 10:00-18:00">
    <span itemprop="aggregateRating">
      <meta itemprop="ratingValue" content="4.5">
      <meta itemprop="reviewCount" content="2">
      <meta itemprop="ratingCount" content="4">
    </span>
    <div class="orgpage-categories-info-view__item">Студия веб-дизайна</div>
    <div class="business-features-view">
      <div class="business-features-view__bool-text">Wi-Fi</div>
      <div class="business-features-view__valued">Способ оплаты: картой</div>
    </div>
    <a class="tabs-select-view__label" href="/profile/org/kreyzi_studio/84036619207/reviews/">Отзывы 2</a>
    <a class="tabs-select-view__label" href="/profile/org/kreyzi_studio/84036619207/prices/">Товары и услуги</a>
    <a class="tabs-select-view__label">Новости 1</a>
    ${body}
  </div>
  </body></html>`;

describe('YandexMapSourceClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts organization cards and rejects unrelated Yandex pages', () => {
    expect(
      isYandexMapsUrl(
        'https://yandex.ru/profile/84036619207?utm_source=copy_link',
      ),
    ).toBe(true);
    expect(
      isYandexMapsUrl(
        'https://yandex.ru/maps/org/kreyzi_studio/84036619207/reviews/',
      ),
    ).toBe(true);
    expect(isYandexMapsUrl('https://yandex.ru/search/?text=test')).toBe(false);
    expect(isYandexMapsUrl('https://example.com/profile/84036619207')).toBe(
      false,
    );
  });

  it('collects overview, all public reviews, products and features', async () => {
    jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockImplementation((url) => {
        const value = String(url);
        let result;
        if (/\/reviews\/$/.test(value))
          result = {
            body: card(
              `${review('Анна', 'Отличная работа')}${review('Иван', 'Всё понравилось')}`,
            ),
            html: true,
            status: 200,
            url: value,
          };
        else if (/\/prices\/$/.test(value))
          result = {
            body: card(`<div class="related-product-view">
              <div class="related-item-photo-view__title" title="Сайт под ключ">Сайт под ключ</div>
              <div class="related-item-photo-view__description">Разработка сайта</div>
              <span class="related-product-view__price">50 000 ₽</span>
            </div>`),
            html: true,
            status: 200,
            url: value,
          };
        else
          result = {
            body: card(review('Анна', 'Короткий отзыв')),
            html: true,
            status: 200,
            url: value,
          };
        return Promise.resolve(result);
      });

    const collected = await new YandexMapSourceClient().collect(
      'https://yandex.ru/profile/84036619207',
      new AbortController().signal,
      new Date('2026-09-21T12:00:00.000Z'),
    );

    expect(collected.map).toMatchObject({
      organizationId: '84036619207',
      title: 'Крейзи студио',
      rating: 4.5,
      reviewCount: 2,
      ratingCount: 4,
      categories: ['Студия веб-дизайна'],
    });
    expect(collected.map.reviews).toHaveLength(2);
    expect(collected.map.products).toHaveLength(1);
    expect(collected.pages.map((page) => page.group)).toEqual([
      'Яндекс Карты · Обзор',
      'Яндекс Карты · Отзывы',
      'Яндекс Карты · Товары и услуги',
      'Яндекс Карты · Особенности',
      'Яндекс Карты · Новости',
    ]);
    expect(collected.pages[1].content).toContain('Отличная работа');
    expect(collected.pages[2].content).toContain('Сайт под ключ');
    expect(collected.pages.at(-1)).toMatchObject({
      status: 'found',
      recommended: false,
    });
  });
});
