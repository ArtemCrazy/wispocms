import {
  OzonSourceClient,
  isOzonSellerUrl,
  ozonSellerAddress,
  parseOzonReviewHtml,
  parseOzonSellerHtml,
} from './ozon-source';
import { PreparationCollectionService } from './preparation-collection.service';
import type { DataSource } from 'typeorm';

describe('public Ozon source', () => {
  it('accepts only public seller pages and removes tracking parameters', () => {
    expect(
      ozonSellerAddress('https://ozon.ru/seller/nonton/?from=search'),
    ).toBe('https://www.ozon.ru/seller/nonton/');
    expect(isOzonSellerUrl('https://www.ozon.ru/seller/145923/')).toBe(true);
    expect(isOzonSellerUrl('https://www.ozon.ru/product/table-123/')).toBe(
      false,
    );
    expect(isOzonSellerUrl('https://evil.example/seller/nonton/')).toBe(false);
    expect(isOzonSellerUrl('http://www.ozon.ru/seller/nonton/')).toBe(false);
    expect(isOzonSellerUrl('https://www.ozon.ru:8443/seller/nonton/')).toBe(
      false,
    );
    expect(
      isOzonSellerUrl('https://name:secret@www.ozon.ru/seller/nonton/'),
    ).toBe(false);
  });

  it('extracts seller facts and unique product cards, not unrelated links', () => {
    const result = parseOzonSellerHtml(
      `
      <html><head><title>НОНТОН – официальный магазин Ozon</title></head><body>
      <div class="product-card"><span>2 025 ₽</span><div>
        <a href="/product/nonton-table-4799664481/?at=tracking">НОНТОН Столик</a>
      </div></div>
      <a href="/product/nonton-table-4799664481/">НОНТОН Столик</a>
      <a href="https://evil.example/product/fake-999/">Чужой товар</a>
      </body></html>
    `,
      'НОНТОН Магазин 4,8 267 K отзывов 831 K заказов',
    );
    expect(result).toMatchObject({
      title: 'НОНТОН',
      rating: '4,8',
      reviewCount: '267 K',
      products: [
        {
          title: 'НОНТОН Столик',
          url: 'https://www.ozon.ru/product/nonton-table-4799664481/',
        },
      ],
    });
  });

  it('keeps only readable review texts with their public attribution', () => {
    const reviews = parseOzonReviewHtml(`
      <div class="rpProduct_d7a"><span class="tsCompactControl500Medium">Соня Б.</span>
        <span class="rpProduct_ac9">20 сентября 2026</span>
        <span class="rpProduct_da0">Хороший столик, но сложная сборка.</span>
      </div>
      <div class="rpProduct_d7a"><span class="tsCompactControl500Medium">Без текста</span>
        <span class="rpProduct_da0"></span></div>
    `);
    expect(reviews).toEqual([
      {
        author: 'Соня Б.',
        date: '20 сентября 2026',
        text: 'Хороший столик, но сложная сборка.',
      },
    ]);
  });

  it('passes the Ozon snapshot and review texts to preparation without an AI call', async () => {
    const collected = jest
      .spyOn(OzonSourceClient.prototype, 'collect')
      .mockResolvedValue({
        pages: [
          {
            url: 'https://www.ozon.ru/seller/nonton/',
            title: 'Магазин · НОНТОН',
            group: 'Магазин Ozon',
            recommended: true,
            status: 'loaded',
            content: 'Магазин НОНТОН',
          },
          {
            url: 'https://www.ozon.ru/product/table-123/reviews/',
            title: 'Отзывы о товаре',
            group: 'Отзывы о товарах Ozon',
            recommended: true,
            status: 'loaded',
            content: 'Покупателю понравился столик',
          },
        ],
        warnings: ['Выборка публичных страниц'],
        coverage: {
          state: 'finished',
          checkedPages: 2,
          pendingPages: 0,
          pendingSitemaps: 0,
          reasons: [],
          selected: 2,
          read: 2,
          unread: 0,
          sections: [{ title: 'Ozon', found: 2, read: 2, unread: 0 }],
        },
      });
    try {
      const service = new PreparationCollectionService({} as DataSource);
      const result = await service.collect(
        'workspace',
        {
          previousResult: null,
          materials: [
            {
              id: 'material',
              revision: 1,
              title: 'Ozon НОНТОН',
              sourceUrl: 'https://www.ozon.ru/seller/nonton/',
              urlCategory: 'marketplace',
              content: '',
            },
          ],
        },
        () => Promise.resolve(),
        new AbortController().signal,
        { persistSnapshots: false },
      );
      expect(collected).toHaveBeenCalledTimes(1);
      expect(result.sources?.[0].pages).toHaveLength(2);
      expect(result.materials.map((item) => item.content)).toEqual(
        expect.arrayContaining([
          'Магазин НОНТОН',
          'Покупателю понравился столик',
        ]),
      );
    } finally {
      collected.mockRestore();
    }
  });

  it('fails refresh without replacing an earlier snapshot when Ozon is unavailable', async () => {
    const collected = jest
      .spyOn(OzonSourceClient.prototype, 'collect')
      .mockRejectedValue(new Error('Ozon blocked'));
    try {
      const service = new PreparationCollectionService({} as DataSource);
      await expect(
        service.collect(
          'workspace',
          {
            previousResult: null,
            materials: [
              {
                id: 'material',
                revision: 1,
                title: 'Ozon НОНТОН',
                sourceUrl: 'https://www.ozon.ru/seller/nonton/',
                urlCategory: 'marketplace',
                content: '',
              },
            ],
          },
          () => Promise.resolve(),
          new AbortController().signal,
          { persistSnapshots: false, allowUnread: true },
        ),
      ).rejects.toThrow('Предыдущий сбор сохранён');
    } finally {
      collected.mockRestore();
    }
  });
});
