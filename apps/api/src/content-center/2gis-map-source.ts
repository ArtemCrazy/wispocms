/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException } from '@nestjs/common';
import { readPublicResource, publicMaterialUrl } from './public-material';
import type { SitePage } from './site-crawler';

const TWO_GIS_HOSTS = new Set([
  '2gis.ru',
  'www.2gis.ru',
  '2gis.com',
  'www.2gis.com',
  '2gis.kz',
  'www.2gis.kz',
  '2gis.uz',
  'www.2gis.uz',
  '2gis.ge',
  'www.2gis.ge',
  '2gis.ae',
  'www.2gis.ae',
  '2gis.by',
  'www.2gis.by',
]);
const FIRM_PATH =
  /^\/[^/]+\/firm\/\d+(?:\/tab\/(?:info|reviews|prices|questions))?\/?$/i;
const SEARCH_FIRM_PATH =
  /^\/([^/]+)\/search\/[^/]+\/firm\/(\d+)(?:\/tab\/(?:info|reviews|prices|questions))?\/?$/i;
const TWO_GIS_COLLECTION_LIMIT = 90_000;
const TWO_GIS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

type JsonRecord = Record<string, any>;

export type TwoGisReview = {
  author: string;
  rating: number | null;
  date: string | null;
  text: string;
  url: string | null;
  officialAnswer?: string | null;
};

export type TwoGisProduct = {
  title: string;
  description: string;
  price: string | null;
  volume: string | null;
};

export type TwoGisMapCard = {
  provider: '2gis';
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
  reviews: TwoGisReview[];
  products: TwoGisProduct[];
  features: string[];
  sourceUrl: string;
};

export class TwoGisMapSourceError extends Error {}

function clean(value: unknown): string {
  const text =
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text.replace(/\s+/g, ' ').trim();
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function numberValue(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : Number.parseFloat(clean(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function isTwoGisHost(hostname: string): boolean {
  return TWO_GIS_HOSTS.has(hostname.toLowerCase());
}

function isTwoGisPagePath(pathname: string): boolean {
  return FIRM_PATH.test(pathname) || SEARCH_FIRM_PATH.test(pathname);
}

export function is2GisMapsUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return (
      url.protocol === 'https:' &&
      isTwoGisHost(url.hostname) &&
      isTwoGisPagePath(url.pathname)
    );
  } catch {
    return false;
  }
}

export function twoGisMapsAddress(value: string): string {
  const url = publicMaterialUrl(value);
  if (!is2GisMapsUrl(url.href))
    throw new BadRequestException(
      'Укажите публичную HTTPS-ссылку на карточку организации в 2ГИС',
    );
  const searchFirm = SEARCH_FIRM_PATH.exec(url.pathname);
  if (searchFirm) url.pathname = `/${searchFirm[1]}/firm/${searchFirm[2]}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function decodeJavaScriptString(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      output += character;
      continue;
    }
    const next = value[++index];
    if (next === undefined) break;
    if (next === 'n') output += '\n';
    else if (next === 'r') output += '\r';
    else if (next === 't') output += '\t';
    else if (next === 'b') output += '\b';
    else if (next === 'f') output += '\f';
    else if (next === 'v') output += '\v';
    else if (next === '0') output += '\0';
    else if (next === '\n') continue;
    else if (next === '\r') {
      if (value[index + 1] === '\n') index += 1;
    } else if (
      next === 'x' &&
      /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))
    ) {
      output += String.fromCharCode(
        Number.parseInt(value.slice(index + 1, index + 3), 16),
      );
      index += 2;
    } else if (
      next === 'u' &&
      /^[0-9a-f]{4}$/i.test(value.slice(index + 1, index + 5))
    ) {
      output += String.fromCharCode(
        Number.parseInt(value.slice(index + 1, index + 5), 16),
      );
      index += 4;
    } else output += next;
  }
  return output;
}

function extractJsonScript(body: string, marker: string): unknown {
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = body.indexOf("JSON.parse('", markerIndex);
  if (start < 0) return null;
  const valueStart = start + "JSON.parse('".length;
  let end = valueStart;
  for (; end < body.length; end += 1) {
    if (body[end] !== "'") continue;
    let slashes = 0;
    for (
      let index = end - 1;
      index >= valueStart && body[index] === '\\';
      index -= 1
    )
      slashes += 1;
    if (slashes % 2 === 0) break;
  }
  if (end >= body.length) return null;
  try {
    return JSON.parse(decodeJavaScriptString(body.slice(valueStart, end)));
  } catch {
    return null;
  }
}

function branchFromState(state: unknown, branchId: string): JsonRecord | null {
  const root = state as JsonRecord | null;
  const branch = root?.data?.entity?.profile?.[branchId]?.data;
  return branch && typeof branch === 'object' ? branch : null;
}

function reviewItems(state: unknown): JsonRecord[] {
  const queries = ((state as JsonRecord | null)?.queries ?? []) as JsonRecord[];
  const query = queries.find(
    (item) =>
      Array.isArray(item.queryKey) && item.queryKey[0] === 'fetchEntityReviews',
  );
  const pages = query?.state?.data?.pages;
  if (!Array.isArray(pages)) return [];
  return pages
    .flatMap((page: JsonRecord) =>
      Array.isArray(page?.items) ? page.items : [],
    )
    .slice(0, 100)
    .filter((item): item is JsonRecord =>
      Boolean(item && typeof item === 'object'),
    );
}

function parseReviews(state: unknown): TwoGisReview[] {
  return reviewItems(state)
    .map((item) => {
      const answer = clean(item.official_answer?.text);
      return {
        author: clean(item.user?.name) || 'Автор не указан',
        rating: numberValue(item.rating),
        date: clean(item.date_created) || null,
        text: clean(item.text) || answer,
        url: clean(item.url) || null,
        officialAnswer: answer || null,
      };
    })
    .filter((review) => review.text || review.author);
}

function parseProducts(state: unknown, branchId: string): TwoGisProduct[] {
  const market = ((state as JsonRecord | null)?.data?.market ??
    null) as JsonRecord | null;
  const pagination = market?.offersSearch?.pagination?.[branchId]?.['1']?.data;
  const references = Array.isArray(pagination)
    ? pagination
    : Object.keys((market?.offers ?? {}) as JsonRecord).filter((key) =>
        key.endsWith(`:${branchId}`),
      );
  const products = (market?.products ?? {}) as JsonRecord;
  const offers = (market?.offers ?? {}) as JsonRecord;
  return references
    .map((reference) => {
      const key = String(reference);
      const productId = key.split(':', 1)[0];
      const product = products[productId]?.data?.product as
        JsonRecord | undefined;
      const offer = offers[key]?.data as JsonRecord | undefined;
      if (!product) return null;
      const attributes = Array.isArray(product.attributes)
        ? product.attributes
            .map((attribute: JsonRecord) =>
              [clean(attribute.name), clean(attribute.value)]
                .filter(Boolean)
                .join(': '),
            )
            .filter(Boolean)
            .join('; ')
        : '';
      const priceValue = offer?.price ?? offer?.price_value?.fixed?.value;
      const price = numberValue(priceValue);
      return {
        title: clean(product.name),
        description: clean(product.description),
        price:
          price === null
            ? clean(offer?.price_text) || null
            : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(price)} ${clean(offer?.currency) === 'USD' ? '$' : clean(offer?.currency) === 'EUR' ? '€' : '₽'}`,
        volume: attributes || null,
      } satisfies TwoGisProduct;
    })
    .filter((product): product is TwoGisProduct =>
      Boolean(product && (product.title || product.description)),
    );
}

function formatHours(schedule: JsonRecord | undefined): string[] {
  if (!schedule || typeof schedule !== 'object') return [];
  const names: Record<string, string> = {
    Mon: 'Пн',
    Tue: 'Вт',
    Wed: 'Ср',
    Thu: 'Чт',
    Fri: 'Пт',
    Sat: 'Сб',
    Sun: 'Вс',
  };
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return order
    .filter((day) => schedule[day])
    .map((day) => {
      const value = schedule[day] as JsonRecord;
      if (value.is_24_hours) return `${names[day]}: круглосуточно`;
      const hours = Array.isArray(value.working_hours)
        ? value.working_hours
            .map((item: JsonRecord) => `${clean(item.from)}–${clean(item.to)}`)
            .filter(Boolean)
        : [];
      return `${names[day]}: ${hours.length ? hours.join(', ') : 'по записи'}`;
    });
}

function parseCard(state: unknown, sourceUrl: string): TwoGisMapCard {
  const branchId =
    new URL(sourceUrl).pathname.match(/\/firm\/(\d+)/i)?.[1] ?? '';
  const branch = branchFromState(state, branchId);
  if (!branch)
    throw new TwoGisMapSourceError(
      '2ГИС не отдал публичную карточку организации. Страница может требовать JavaScript, вход или временно показывать проверку.',
    );
  const contacts = ((branch.contact_groups ?? []) as JsonRecord[]).flatMap(
    (group) => (Array.isArray(group.contacts) ? group.contacts : []),
  ) as JsonRecord[];
  const phone = contacts.find((contact) => contact.type === 'phone');
  const website = contacts.find((contact) => contact.type === 'website');
  const websiteUrl = clean(website?.url) || clean(website?.text);
  const point = branch.point as JsonRecord | undefined;
  const categories = unique(
    (Array.isArray(branch.rubrics) ? branch.rubrics : []).map(
      (rubric: JsonRecord) => rubric.name,
    ),
  );
  const features = unique(
    (Array.isArray(branch.attribute_groups)
      ? branch.attribute_groups
      : []
    ).flatMap((group: JsonRecord) =>
      (Array.isArray(group.attributes) ? group.attributes : []).map(
        (attribute: JsonRecord) =>
          group.name
            ? `${clean(group.name)}: ${clean(attribute.name)}`
            : attribute.name,
      ),
    ),
  );
  const reviewData = (branch.reviews ?? {}) as JsonRecord;
  return {
    provider: '2gis',
    organizationId: clean(branch.id) || branchId || null,
    title:
      clean(branch.name) || clean(branch.org?.primary) || 'Организация в 2ГИС',
    address: clean(branch.address_name) || null,
    coordinates:
      numberValue(point?.lat) !== null && numberValue(point?.lon) !== null
        ? {
            latitude: numberValue(point?.lat)!,
            longitude: numberValue(point?.lon)!,
          }
        : null,
    phone: clean(phone?.text || phone?.value) || null,
    website: websiteUrl
      ? /^https?:\/\//i.test(websiteUrl)
        ? websiteUrl
        : `https://${websiteUrl}`
      : null,
    image: clean(branch.external_content?.[0]?.main_photo_url) || null,
    rating: numberValue(reviewData.general_rating ?? reviewData.rating),
    reviewCount: numberValue(
      reviewData.general_review_count ?? reviewData.review_count,
    ),
    ratingCount: numberValue(
      reviewData.general_review_count_with_stars ??
        reviewData.general_review_count ??
        reviewData.review_count,
    ),
    categories,
    openingHours: formatHours(branch.schedule),
    reviews: [],
    products: [],
    features,
    sourceUrl,
  };
}

function overviewContent(card: TwoGisMapCard): string {
  const lines = [
    'Источник: 2ГИС',
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

function productsContent(products: TwoGisProduct[]): string {
  return products
    .map((product, index) =>
      [
        `${index + 1}. ${product.title}`,
        product.description,
        [product.price, product.volume].filter(Boolean).join(' · '),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

function reviewsContent(reviews: TwoGisReview[]): string {
  return reviews
    .map((review, index) =>
      [
        `${index + 1}. ${review.author} · ${review.date ? new Date(review.date).toLocaleDateString('ru-RU') : 'дата не указана'}`,
        review.rating !== null ? `Оценка: ${review.rating} из 5` : '',
        review.text,
        review.officialAnswer
          ? `Ответ организации: ${review.officialAnswer}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
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

export class TwoGisMapSourceClient {
  async collect(
    sourceUrl: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<{ pages: SitePage[]; warnings: string[]; map: TwoGisMapCard }> {
    const address = twoGisMapsAddress(sourceUrl);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(TWO_GIS_COLLECTION_LIMIT),
    ]);
    const fetchPage = async (url: string) => {
      const resource = await readPublicResource(url, {
        signal: deadline,
        userAgent: TWO_GIS_USER_AGENT,
        beforeRequest: (target) => {
          if (
            !isTwoGisHost(target.hostname) ||
            !isTwoGisPagePath(target.pathname)
          )
            throw new TwoGisMapSourceError(
              '2ГИС перенаправил ссылку за пределы публичной карточки.',
            );
        },
      });
      if (!resource.html)
        throw new TwoGisMapSourceError(
          '2ГИС не вернул HTML-карточку организации.',
        );
      const initialState = extractJsonScript(resource.body, 'var initialState');
      if (!initialState)
        throw new TwoGisMapSourceError(
          '2ГИС не отдал данные публичной карточки в HTML-странице.',
        );
      return {
        resource,
        initialState,
        queryState: extractJsonScript(resource.body, '__REACT_QUERY_STATE__'),
      };
    };
    const overview = await fetchPage(address);
    const map = parseCard(overview.initialState, overview.resource.url);
    map.reviews = parseReviews(overview.queryState);
    const pages: SitePage[] = [
      page(
        address,
        `Обзор · ${map.title}`,
        '2ГИС · Обзор',
        overviewContent(map),
        now.toISOString(),
      ),
    ];
    const warnings = [
      'Сбор выполнен из публичной HTML-страницы 2ГИС без входа и API. Получены только данные, которые сама страница отдала в этом запросе.',
    ];
    if (map.reviews.length) {
      pages.push(
        page(
          address,
          `Отзывы · ${map.title}`,
          '2ГИС · Отзывы',
          reviewsContent(map.reviews),
          now.toISOString(),
        ),
      );
    }
    const branchId = map.organizationId;
    const branch = branchId
      ? branchFromState(overview.initialState, branchId)
      : null;
    const declaredProducts = numberValue(
      branchId
        ? (overview.initialState as JsonRecord | null)?.data?.market
            ?.offersSearch?.profile?.[branchId]?.data?.total
        : null,
    );
    const base = address
      .replace(/\/tab\/(?:info|reviews|prices|questions)\/?$/i, '')
      .replace(/\/$/, '');
    const pricesUrl = `${base}/tab/prices`;
    if (branch?.has_goods || branch?.has_pinned_goods || declaredProducts) {
      try {
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
        const prices = await fetchPage(pricesUrl);
        map.products = parseProducts(prices.initialState, branchId ?? '');
        if (map.products.length) {
          pages.push(
            page(
              pricesUrl,
              `Товары и услуги · ${map.title}`,
              '2ГИС · Товары и услуги',
              productsContent(map.products),
              now.toISOString(),
            ),
          );
        }
      } catch (error) {
        warnings.push(
          `Не удалось прочитать вкладку «Товары и услуги»: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
        );
      }
    }
    if (!map.reviews.length && (map.reviewCount ?? 0) > 0) {
      try {
        const reviews = await fetchPage(`${base}/tab/reviews`);
        map.reviews = parseReviews(reviews.queryState);
        if (map.reviews.length) {
          pages.push(
            page(
              `${base}/tab/reviews`,
              `Отзывы · ${map.title}`,
              '2ГИС · Отзывы',
              reviewsContent(map.reviews),
              now.toISOString(),
            ),
          );
        }
      } catch (error) {
        warnings.push(
          `Не удалось прочитать вкладку «Отзывы»: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
        );
      }
    }
    if (map.features.length)
      pages.push(
        page(
          address,
          `Особенности · ${map.title}`,
          '2ГИС · Особенности',
          featuresContent(map.features),
          now.toISOString(),
        ),
      );
    if ((map.reviewCount ?? 0) > map.reviews.length)
      warnings.push(
        `2ГИС сообщил ${map.reviewCount} отзывов, но в публичном HTML доступны ${map.reviews.length}. Полный архив без дополнительных запросов 2ГИС не считается собранным.`,
      );
    if (declaredProducts !== null && declaredProducts > map.products.length)
      warnings.push(
        `2ГИС сообщил ${declaredProducts} товаров и услуг, но в публичном HTML доступны ${map.products.length}.`,
      );
    return { pages, warnings, map };
  }
}
