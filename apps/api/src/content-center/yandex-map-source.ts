import { BadRequestException } from '@nestjs/common';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import { readPublicResource, publicMaterialUrl } from './public-material';
import type { SitePage } from './site-crawler';

const YANDEX_HOSTS = new Set([
  'yandex.ru',
  'www.yandex.ru',
  'yandex.com',
  'www.yandex.com',
  'yandex.com.tr',
  'www.yandex.com.tr',
  'maps.yandex.ru',
]);
const MAPS_ORG_PATH = /^\/(?:maps\/)?org\/[^/]+\/\d+(?:\/[^/]*)*\/?$/i;
const PROFILE_ID_PATH = /^\/profile\/\d+\/?$/i;
const PROFILE_ORG_PATH = /^\/profile\/org\/[^/]+\/\d+(?:\/[^/]*)*\/?$/i;
const TAB_PATH = /\/(reviews|prices)\/?$/i;
const YANDEX_COLLECTION_LIMIT = 90_000;

export type YandexMapReview = {
  author: string;
  rating: number | null;
  date: string | null;
  text: string;
  url: string | null;
};

export type YandexMapProduct = {
  title: string;
  description: string;
  price: string | null;
  volume: string | null;
};

export type YandexMapCard = {
  provider: 'yandex';
  organizationId: string | null;
  title: string;
  address: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  phone: string | null;
  website: string | null;
  image: string | null;
  rating: number | null;
  reviewCount: number | null;
  ratingCount: number | null;
  categories: string[];
  openingHours: string[];
  reviews: YandexMapReview[];
  products: YandexMapProduct[];
  features: string[];
  sourceUrl: string;
};

export class YandexMapSourceError extends Error {}

function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function numberValue(value: string | undefined | null): number | null {
  const number = Number.parseFloat((value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function isYandexHost(hostname: string): boolean {
  return YANDEX_HOSTS.has(hostname.toLowerCase());
}

function isYandexPagePath(pathname: string): boolean {
  return (
    PROFILE_ID_PATH.test(pathname) ||
    PROFILE_ORG_PATH.test(pathname) ||
    MAPS_ORG_PATH.test(pathname)
  );
}

export function isYandexMapsUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return (
      url.protocol === 'https:' &&
      isYandexHost(url.hostname) &&
      isYandexPagePath(url.pathname)
    );
  } catch {
    return false;
  }
}

export function yandexMapsAddress(value: string): string {
  const url = publicMaterialUrl(value);
  if (!isYandexMapsUrl(url.href))
    throw new BadRequestException(
      'Укажите публичную HTTPS-ссылку на карточку организации в Яндекс Картах',
    );
  return url.href;
}

function normalizeTabUrl(value: string, sourceUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(value, sourceUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    !isYandexHost(url.hostname) ||
    !TAB_PATH.test(url.pathname)
  )
    return null;
  // The profile SSR page links to /profile/org/...; the public tab route is
  // served by /maps/org/... and does not require an account or an API key.
  url.pathname = url.pathname.replace(/^\/profile\/org\//i, '/maps/org/');
  url.search = '';
  url.hash = '';
  return url.href;
}

function formatHours(value: string): string {
  const [day, hours] = value.split(/\s+/, 2);
  const names: Record<string, string> = {
    Mo: 'Пн',
    Tu: 'Вт',
    We: 'Ср',
    Th: 'Чт',
    Fr: 'Пт',
    Sa: 'Сб',
    Su: 'Вс',
  };
  return `${names[day] ?? day}: ${hours ?? value}`;
}

function elementText(node: Cheerio<any>): string {
  node.find('br').replaceWith('\n');
  return node
    .text()
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseReviews(root: Cheerio<any>): YandexMapReview[] {
  const selection = root.find('[itemprop="review"]');
  return selection
    .toArray()
    .map((_, index) => {
      const node = selection.eq(index);
      return {
        author: clean(
          node
            .find('[itemprop="author"] [itemprop="name"], [itemprop="author"]')
            .first()
            .text(),
        ),
        rating: numberValue(
          node.find('[itemprop="ratingValue"]').first().attr('content'),
        ),
        date:
          node.find('[itemprop="datePublished"]').first().attr('content') ??
          null,
        text: elementText(node.find('[itemprop="reviewBody"]').first()),
        url:
          node
            .find('a.business-review-view__link, [itemprop="author"] a')
            .first()
            .attr('href') ?? null,
      };
    })
    .filter((review) => review.text || review.author);
}

function parseProducts(root: Cheerio<any>): YandexMapProduct[] {
  const selection = root.find('.related-product-view');
  return selection
    .toArray()
    .map((_, index) => {
      const node = selection.eq(index);
      return {
        title: clean(
          node.find('.related-item-photo-view__title').first().attr('title') ??
            node.find('.related-item-photo-view__title').first().text(),
        ),
        description: clean(
          node.find('.related-item-photo-view__description').first().text(),
        ),
        price:
          clean(node.find('.related-product-view__price').first().text()) ||
          null,
        volume:
          clean(node.find('.related-product-view__volume').first().text()) ||
          null,
      };
    })
    .filter((product) => product.title || product.description);
}

function parseCard(root: CheerioAPI, sourceUrl: string): YandexMapCard {
  const card = root('.business-card-view').first();
  if (!card.length)
    throw new YandexMapSourceError(
      'Яндекс не отдал публичную карточку организации. Страница может требовать JavaScript, вход или временно показывать проверку.',
    );
  const coordinates = (card.attr('data-coordinates') ?? '')
    .split(',')
    .map(Number);
  const coordinateValue =
    coordinates.length === 2 && coordinates.every(Number.isFinite)
      ? { longitude: coordinates[0], latitude: coordinates[1] }
      : null;
  const ratingRoot = card.find('[itemprop="aggregateRating"]').first();
  const categories = unique(
    card
      .find('.orgpage-categories-info-view__item')
      .map((_, node) => root(node).text())
      .get(),
  );
  const features = unique([
    ...card
      .find('.business-features-view__bool-text')
      .map((_, node) => root(node).text())
      .get(),
    ...card
      .find('.business-features-view__valued')
      .map((_, node) => root(node).text())
      .get(),
  ]);
  return {
    provider: 'yandex',
    organizationId: card.attr('data-id') ?? null,
    title:
      clean(card.find('h1[itemprop="name"]').first().text()) ||
      'Организация в Яндекс Картах',
    address:
      clean(card.find('[itemprop="address"]').first().attr('content')) || null,
    coordinates: coordinateValue,
    phone: clean(card.find('[itemprop="telephone"]').first().text()) || null,
    website: card.find('[itemprop="url"]').first().attr('href') ?? null,
    image: card.find('meta[itemprop="image"]').first().attr('content') ?? null,
    rating: numberValue(
      ratingRoot.find('[itemprop="ratingValue"]').first().attr('content'),
    ),
    reviewCount: numberValue(
      ratingRoot.find('[itemprop="reviewCount"]').first().attr('content'),
    ),
    ratingCount: numberValue(
      ratingRoot.find('[itemprop="ratingCount"]').first().attr('content'),
    ),
    categories,
    openingHours: unique(
      card
        .find('[itemprop="openingHours"]')
        .map((_, node) => formatHours(String(root(node).attr('content') ?? '')))
        .get(),
    ),
    reviews: parseReviews(card),
    products: parseProducts(card),
    features,
    sourceUrl,
  };
}

function overviewContent(card: YandexMapCard): string {
  const lines = [
    `Источник: Яндекс Карты`,
    `Название: ${card.title}`,
    card.categories.length ? `Категории: ${card.categories.join(', ')}` : '',
    card.address ? `Адрес: ${card.address}` : '',
    card.phone ? `Телефон: ${card.phone}` : '',
    card.website ? `Сайт: ${card.website}` : '',
    card.coordinates
      ? `Координаты: ${card.coordinates.latitude}, ${card.coordinates.longitude}`
      : '',
    card.rating !== null ? `Рейтинг: ${card.rating} из 5` : '',
    card.reviewCount !== null ? `Отзывов заявлено: ${card.reviewCount}` : '',
    card.ratingCount !== null ? `Оценок заявлено: ${card.ratingCount}` : '',
    card.openingHours.length
      ? `Часы работы:\n${card.openingHours.join('\n')}`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function productsContent(products: YandexMapProduct[]): string {
  return products
    .map((product, index) => {
      const lines = [`${index + 1}. ${product.title}`];
      if (product.description) lines.push(product.description);
      if (product.price || product.volume)
        lines.push([product.price, product.volume].filter(Boolean).join(' · '));
      return lines.join('\n');
    })
    .join('\n\n');
}

function reviewsContent(reviews: YandexMapReview[]): string {
  return reviews
    .map((review, index) => {
      const date = review.date
        ? new Date(review.date).toLocaleDateString('ru-RU')
        : 'дата не указана';
      return [
        `${index + 1}. ${review.author || 'Автор не указан'} · ${date}`,
        review.rating !== null ? `Оценка: ${review.rating} из 5` : '',
        review.text,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

function featuresContent(features: string[]): string {
  return features.map((feature) => `• ${feature}`).join('\n');
}

function page(
  url: string,
  title: string,
  group: string,
  content: string,
  now: string,
  recommended = true,
): SitePage {
  return {
    url,
    title,
    group,
    recommended,
    status: content ? 'loaded' : 'found',
    content: content || undefined,
    checkedAt: now,
    reason: content
      ? undefined
      : 'Раздел найден, но его текст не отдан публичной HTML-страницей.',
  };
}

export class YandexMapSourceClient {
  async collect(
    sourceUrl: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<{ pages: SitePage[]; warnings: string[]; map: YandexMapCard }> {
    const address = yandexMapsAddress(sourceUrl);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(YANDEX_COLLECTION_LIMIT),
    ]);
    const fetchPage = async (url: string) => {
      const resource = await readPublicResource(url, {
        signal: deadline,
        beforeRequest: (target) => {
          if (
            !isYandexHost(target.hostname) ||
            (!isYandexPagePath(target.pathname) &&
              !TAB_PATH.test(target.pathname))
          )
            throw new YandexMapSourceError(
              'Яндекс перенаправил ссылку за пределы публичной карточки.',
            );
        },
      });
      if (!resource.html)
        throw new YandexMapSourceError(
          'Яндекс не вернул HTML-карточку организации.',
        );
      return resource;
    };
    const overview = await fetchPage(address);
    const root = load(overview.body);
    const map = parseCard(root, overview.url);
    const pages: SitePage[] = [];
    const warnings = [
      'Сбор выполнен из публичной HTML-страницы Яндекс Карт без входа и API. Получены только данные, которые сама страница отдала в этом запросе.',
    ];
    pages.push(
      page(
        address,
        `Обзор · ${map.title}`,
        'Яндекс Карты · Обзор',
        overviewContent(map),
        now.toISOString(),
      ),
    );

    const tabs = new Map<string, string>();
    root('a[href]').each((_, element) => {
      const url = normalizeTabUrl(root(element).attr('href') ?? '', address);
      if (url && /\/reviews\/?$/i.test(url)) tabs.set('reviews', url);
      if (url && /\/prices\/?$/i.test(url)) tabs.set('prices', url);
    });
    const sourcePath = new URL(address).pathname;
    if (TAB_PATH.test(sourcePath)) {
      if (/\/reviews\/?$/i.test(sourcePath)) tabs.delete('reviews');
      if (/\/prices\/?$/i.test(sourcePath)) tabs.delete('prices');
    }
    for (const [tab, url] of tabs) {
      deadline.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 250);
        deadline.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error(String(deadline.reason ?? 'Сбор отменён')));
          },
          { once: true },
        );
      });
      try {
        const resource = await fetchPage(url);
        const tabRoot = load(resource.body);
        if (tab === 'reviews') {
          const reviews = parseReviews(tabRoot('.business-card-view').first());
          if (reviews.length) {
            map.reviews = reviews;
            pages.push(
              page(
                url,
                `Отзывы · ${map.title}`,
                'Яндекс Карты · Отзывы',
                reviewsContent(reviews),
                now.toISOString(),
              ),
            );
          }
        } else {
          const products = parseProducts(
            tabRoot('.business-card-view').first(),
          );
          if (products.length) {
            map.products = products;
            pages.push(
              page(
                url,
                `Товары и услуги · ${map.title}`,
                'Яндекс Карты · Товары и услуги',
                productsContent(products),
                now.toISOString(),
              ),
            );
          }
        }
      } catch (error) {
        warnings.push(
          `Не удалось прочитать вкладку «${tab === 'reviews' ? 'Отзывы' : 'Товары и услуги'}»: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
        );
      }
    }
    if (
      !pages.some((item) => item.group === 'Яндекс Карты · Отзывы') &&
      map.reviews.length
    ) {
      pages.push(
        page(
          address,
          `Отзывы · ${map.title}`,
          'Яндекс Карты · Отзывы',
          reviewsContent(map.reviews),
          now.toISOString(),
        ),
      );
    }
    if (
      !pages.some((item) => item.group === 'Яндекс Карты · Товары и услуги') &&
      map.products.length
    ) {
      pages.push(
        page(
          address,
          `Товары и услуги · ${map.title}`,
          'Яндекс Карты · Товары и услуги',
          productsContent(map.products),
          now.toISOString(),
        ),
      );
    }
    if (map.features.length)
      pages.push(
        page(
          address,
          `Особенности · ${map.title}`,
          'Яндекс Карты · Особенности',
          featuresContent(map.features),
          now.toISOString(),
        ),
      );

    const declaredReviews = map.reviewCount ?? 0;
    if (declaredReviews > map.reviews.length)
      warnings.push(
        `Яндекс сообщил ${declaredReviews} отзывов, но в публичном HTML доступны ${map.reviews.length}. Полный архив без дополнительных запросов Яндекса не считается собранным.`,
      );
    const postsText = root('a.tabs-select-view__label')
      .filter((_, element) => /новости/i.test(root(element).text()))
      .text();
    if (postsText)
      pages.push(
        page(
          address,
          `Новости · ${map.title}`,
          'Яндекс Карты · Новости',
          '',
          now.toISOString(),
          false,
        ),
      );
    return { pages, warnings, map };
  }
}
