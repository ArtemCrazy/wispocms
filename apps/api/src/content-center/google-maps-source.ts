/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException } from '@nestjs/common';
import { readPublicResource, publicMaterialUrl } from './public-material';
import type { SitePage } from './site-crawler';
import { collectVisibleGoogleReviews } from './google-maps-reviews';

const GOOGLE_MAPS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const GOOGLE_COLLECTION_LIMIT = 90_000;
const GOOGLE_PREVIEW_PB =
  '!1m14!1s{featureId}!3m9!1m3!1d5000!2d0!3d0!2m0!3m2!1i1024!2i768!4f13.1!4m2!3d0!4d0!13m1!2m0!15m47!1m8!4e2!18m5!3b0!6b1!14b1!17b1!20b1!20e2!4b1!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6!24b1!25b1!26b1!29b1!30m1!2b1!36b1!43b1!52b1!55b1!56m1!1b1!65m5!3m4!1m3!1m2!1i224!2i298!22m1!1e81!29m0!30m6!3b1!6m1!2b1!7m1!2b1!9b1!32b1!37i771';

type Json = any;

const GOOGLE_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'google.ru',
  'www.google.ru',
  'maps.google.ru',
  'maps.app.goo.gl',
  'goo.gl',
]);
const GOOGLE_MAPS_PATH = /^\/maps\/(?:place|search)(?:\/|$)/i;
const GOOGLE_CID_PATH = /^\/maps\/?$/i;
const FEATURE_ID = /0x[0-9a-f]+:0x[0-9a-f]+/i;
const PLACE_ID = /!1s(ChIJ[a-z0-9_-]+)/i;
const DAY_NAMES: Record<string, string> = {
  Monday: 'Пн',
  Tuesday: 'Вт',
  Wednesday: 'Ср',
  Thursday: 'Чт',
  Friday: 'Пт',
  Saturday: 'Сб',
  Sunday: 'Вс',
  понедельник: 'Пн',
  вторник: 'Вт',
  среда: 'Ср',
  четверг: 'Чт',
  пятница: 'Пт',
  суббота: 'Сб',
  воскресенье: 'Вс',
};

export type GoogleMapReview = {
  author: string;
  rating: number | null;
  date: string | null;
  text: string;
  url: string | null;
};

export type GoogleMapProduct = {
  title: string;
  description: string;
  price: string | null;
  volume: string | null;
};

export type GoogleMapCard = {
  provider: 'google';
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
  reviews: GoogleMapReview[];
  products: GoogleMapProduct[];
  features: string[];
  sourceUrl: string;
};

export class GoogleMapSourceError extends Error {}

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

function isGoogleHost(hostname: string): boolean {
  return GOOGLE_HOSTS.has(hostname.toLowerCase());
}

function isGoogleMapsPage(url: URL): boolean {
  if (url.hostname.toLowerCase() === 'maps.app.goo.gl') return true;
  if (
    url.hostname.toLowerCase() === 'goo.gl' &&
    /^\/maps(?:\/|$)/i.test(url.pathname)
  )
    return true;
  return (
    isGoogleHost(url.hostname) &&
    (GOOGLE_MAPS_PATH.test(url.pathname) ||
      (GOOGLE_CID_PATH.test(url.pathname) && url.searchParams.has('cid')))
  );
}

export function isGoogleMapsUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && isGoogleMapsPage(url);
  } catch {
    return false;
  }
}

export function googleMapsAddress(value: string): string {
  const url = publicMaterialUrl(value);
  if (!(
    url.protocol === 'https:' &&
    (isGoogleMapsPage(url) ||
      ['maps.app.goo.gl', 'goo.gl'].includes(url.hostname.toLowerCase()))
  ))
    throw new BadRequestException(
      'Укажите публичную HTTPS-ссылку на карточку организации в Google Maps',
    );
  return url.href;
}

function featureIdFromValue(value: string): string | null {
  const match = value.match(FEATURE_ID);
  return match?.[0] ?? null;
}

function cidFeatureId(value: string): string | null {
  try {
    const cid = new URL(value).searchParams.get('cid');
    if (!cid || !/^\d+$/.test(cid)) return null;
    return `0x0:0x${BigInt(cid).toString(16)}`;
  } catch {
    return null;
  }
}

function findFeatureId(value: string, body = ''): string | null {
  return (
    featureIdFromValue(value) ??
    cidFeatureId(value) ??
    featureIdFromValue(body) ??
    body.match(PLACE_ID)?.[1] ??
    null
  );
}

function parseJson(body: string): Json {
  const text = body.replace(/^\)]}'\s*/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new GoogleMapSourceError(
      'Google Maps не отдал данные публичной карточки в читаемом формате.',
    );
  }
}

function walk(value: Json, visit: (value: Json) => void, depth = 0): void {
  if (depth > 18) return;
  visit(value);
  if (Array.isArray(value))
    for (const item of value) walk(item, visit, depth + 1);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) walk(item, visit, depth + 1);
}

function findPlaceNode(root: Json, featureId: string): Json[] | null {
  let result: Json[] | null = null;
  walk(root, (value) => {
    if (
      !result &&
      Array.isArray(value) &&
      value[10] === featureId &&
      typeof value[11] === 'string'
    )
      result = value;
  });
  return result;
}

function decodeGoogleUrl(value: string): string | null {
  const text = clean(value);
  if (!text) return null;
  try {
    const url = new URL(
      text.startsWith('/') ? `https://www.google.com${text}` : text,
    );
    const target = url.searchParams.get('q') || url.href;
    if (
      /google\.(?:com|ru)\//i.test(target) ||
      /googleusercontent\.com/i.test(target)
    )
      return null;
    return /^https?:\/\//i.test(target) ? target : `https://${target}`;
  } catch {
    return null;
  }
}

function findString(value: Json, pattern: RegExp): string | null {
  let result: string | null = null;
  walk(value, (item) => {
    if (!result && typeof item === 'string' && pattern.test(item))
      result = item;
  });
  return result;
}

function firstImage(value: Json): string | null {
  return findString(
    value,
    /^https?:\/\/[^\s"']+(?:googleusercontent|ggpht)\.[^\s"']+$/i,
  );
}

function descriptionFrom(node: Json): string | null {
  const values: string[] = [];
  const source = Array.isArray(node?.[32]) ? node[32] : [];
  walk(source, (item) => {
    if (typeof item === 'string' && item.length > 45 && !/^https?:/i.test(item))
      values.push(clean(item));
  });
  return unique(values)[0] ?? null;
}

function phoneFrom(node: Json): string | null {
  return findString(node?.[178], /(?:\+?\d[\d ()-]{6,}\d)/);
}

function hoursFrom(node: Json): string[] {
  const found = new Map<string, string>();
  const readDay = (value: Json): void => {
    if (!Array.isArray(value) || typeof value[0] !== 'string') return;
    const day = value[0];
    if (!DAY_NAMES[day]) return;
    const times: string[] = [];
    let closed = false;
    walk(value.slice(1), (item) => {
      if (typeof item !== 'string') return;
      if (/закрыто/i.test(item)) closed = true;
      if (/\d/.test(item) && item.length < 50)
        times.push(clean(item).replace(/[‑–—]/g, '–'));
    });
    const text = unique(times).filter(
      (item) =>
        !/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(
          item,
        ),
    );
    found.set(day, text[0] ?? (closed ? 'закрыто' : 'по записи'));
  };
  const rawSchedule = Array.isArray(node?.[203]?.[0]) ? node[203][0] : [];
  const schedule =
    Array.isArray(rawSchedule[0]) && Array.isArray(rawSchedule[0][0])
      ? rawSchedule[0]
      : rawSchedule;
  schedule.forEach(readDay);
  if (!found.size) walk(node?.[203], readDay);
  const ordered = [
    'понедельник',
    'вторник',
    'среда',
    'четверг',
    'пятница',
    'суббота',
    'воскресенье',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  return ordered
    .filter((day) => found.has(day))
    .map((day) => `${DAY_NAMES[day]}: ${found.get(day)}`);
}

function featureStrings(node: Json, description: string | null): string[] {
  const values: string[] = [];
  walk(node?.[100], (value) => {
    if (typeof value === 'string' && value.length > 1 && value.length < 120) {
      if (
        !/^https?:/i.test(value) &&
        !/^0x[0-9a-f]+$/i.test(value) &&
        !value.startsWith('/') &&
        value.toLowerCase() !== 'accessibility'
      )
        values.push(value);
    }
  });
  return unique([
    ...(description ? [`Описание: ${description}`] : []),
    ...values,
  ]).slice(0, 80);
}

function reviewStats(
  root: Json,
  node: Json,
): {
  reviewCount: number | null;
  ratingCount: number | null;
} {
  const directReviewCount =
    numberValue(node?.[4]?.[8]) ??
    (Array.isArray(node?.[4])
      ? (node[4]
          .slice(7)
          .map(numberValue)
          .find((value: number | null) => value !== null && value > 10) ?? null)
      : null);
  const reviewLabel = findString(root, /Отзывов?:\s*[\d\s.,]+/i);
  const ratingLabel = findString(root, /Оцен(?:ок|ки):\s*[\d\s.,]+/i);
  const readLabel = (value: string | null): number | null => {
    const match = value?.match(/([\d\s.,]+)$/);
    if (!match) return null;
    const number = Number.parseInt(match[1].replace(/\D/g, ''), 10);
    return Number.isFinite(number) ? number : null;
  };
  return {
    reviewCount: directReviewCount ?? readLabel(reviewLabel),
    ratingCount:
      directReviewCount ?? readLabel(ratingLabel) ?? readLabel(reviewLabel),
  };
}

function parseCard(
  root: Json,
  sourceUrl: string,
  featureId: string,
): GoogleMapCard {
  const node = findPlaceNode(root, featureId);
  if (!node)
    throw new GoogleMapSourceError(
      'Google Maps не нашёл публичную карточку по этой ссылке. Проверьте, что это ссылка именно на организацию, а не на общий поиск.',
    );
  const coordinate = Array.isArray(node[9]) ? node[9] : [];
  const latitude = numberValue(coordinate[2]);
  const longitude = numberValue(coordinate[3]);
  const categories = unique(
    Array.isArray(node[13])
      ? node[13].flat(Infinity).filter((item: Json) => typeof item === 'string')
      : [],
  );
  const description = descriptionFrom(node);
  const stats = reviewStats(root, node);
  const website = Array.isArray(node[7])
    ? (node[7]
        .flat(Infinity)
        .map((item: Json) =>
          typeof item === 'string' ? decodeGoogleUrl(item) : null,
        )
        .find(Boolean) ?? null)
    : null;
  return {
    provider: 'google',
    organizationId: clean(node[78]) || featureId,
    title: clean(node[11]) || 'Организация в Google Maps',
    address: clean(node[18]) || null,
    coordinates:
      latitude !== null && longitude !== null ? { latitude, longitude } : null,
    phone: phoneFrom(node),
    website,
    image: firstImage(node),
    rating: numberValue(node?.[4]?.[7]),
    reviewCount: stats.reviewCount,
    ratingCount: stats.ratingCount,
    categories,
    openingHours: hoursFrom(node),
    reviews: [],
    products: [],
    features: featureStrings(node, description),
    sourceUrl,
  };
}

function overviewContent(card: GoogleMapCard): string {
  return [
    'Источник: Google Maps',
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
    card.openingHours.length
      ? `Часы работы:\n${card.openingHours.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function reviewsContent(reviews: GoogleMapReview[]): string {
  return reviews
    .map((review, index) =>
      [
        `${index + 1}. ${review.author}${review.date ? ` · ${review.date}` : ''}`,
        review.rating !== null ? `Оценка: ${review.rating} из 5` : '',
        review.text,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

function page(
  url: string,
  title: string,
  group: string,
  content: string,
  now: string,
): SitePage {
  return {
    url,
    title,
    group,
    recommended: true,
    status: content ? 'loaded' : 'found',
    content: content || undefined,
    checkedAt: now,
    reason: content
      ? undefined
      : 'Раздел найден, но его текст не отдан публичным ответом Google Maps.',
  };
}

export class GoogleMapSourceClient {
  async collect(
    sourceUrl: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<{ pages: SitePage[]; warnings: string[]; map: GoogleMapCard }> {
    const address = googleMapsAddress(sourceUrl);
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(GOOGLE_COLLECTION_LIMIT),
    ]);
    let featureId = findFeatureId(address);
    let resolvedUrl = address;
    if (!featureId) {
      const source = await readPublicResource(address, {
        signal: deadline,
        userAgent: GOOGLE_MAPS_USER_AGENT,
        beforeRequest: (target) => {
          if (
            !isGoogleHost(target.hostname) ||
            (!isGoogleMapsPage(target) &&
              !['maps.app.goo.gl', 'goo.gl'].includes(
                target.hostname.toLowerCase(),
              ))
          )
            throw new GoogleMapSourceError(
              'Google Maps перенаправил ссылку за пределы публичной карточки.',
            );
        },
      });
      resolvedUrl = source.url;
      featureId = findFeatureId(source.url, source.body);
    }
    if (!featureId)
      throw new GoogleMapSourceError(
        'Не удалось определить идентификатор карточки Google Maps. Используйте прямую ссылку на организацию.',
      );
    const pb = GOOGLE_PREVIEW_PB.replace('{featureId}', featureId);
    const previewUrl = new URL('https://www.google.com/maps/preview/place');
    previewUrl.searchParams.set('authuser', '0');
    previewUrl.searchParams.set('hl', 'ru');
    previewUrl.searchParams.set('gl', 'ru');
    previewUrl.searchParams.set('pb', pb);
    const preview = await readPublicResource(previewUrl.href, {
      signal: deadline,
      json: true,
      userAgent: GOOGLE_MAPS_USER_AGENT,
      beforeRequest: (target) => {
        if (
          target.hostname !== 'www.google.com' ||
          target.pathname !== '/maps/preview/place'
        )
          throw new GoogleMapSourceError(
            'Google Maps вернул неожиданный адрес данных карточки.',
          );
      },
    });
    const map = parseCard(parseJson(preview.body), resolvedUrl, featureId);
    const pages: SitePage[] = [
      page(
        address,
        `Обзор · ${map.title}`,
        'Google Maps · Обзор',
        overviewContent(map),
        now.toISOString(),
      ),
    ];
    if (map.features.length)
      pages.push(
        page(
          address,
          `Особенности · ${map.title}`,
          'Google Maps · Особенности',
          map.features.map((feature) => `• ${feature}`).join('\n'),
          now.toISOString(),
        ),
      );
    const warnings = [
      'Сбор выполнен из публичной карточки Google Maps без входа, OAuth и API-ключа. Доступны только сведения, которые Google показывает без авторизации.',
    ];
    try {
      const visible = await collectVisibleGoogleReviews(resolvedUrl, deadline);
      map.reviews = visible.reviews;
      map.reviewCount ??= visible.reviewCount;
      if (map.reviews.length)
        pages.push(
          page(
            address,
            `Отзывы · ${map.title}`,
            'Google Maps · Отзывы',
            reviewsContent(map.reviews),
            now.toISOString(),
          ),
        );
    } catch (error) {
      deadline.throwIfAborted();
      warnings.push(
        `Не удалось получить публичный раздел отзывов Google Maps: ${error instanceof Error ? error.message : 'неизвестная ошибка'}. Обзор карточки сохранён.`,
      );
    }
    if (!map.reviews.length)
      warnings.push(
        'Тексты отзывов Google Maps не получены; это не означает, что у организации нет отзывов.',
      );
    else if (map.reviewCount !== null && map.reviewCount > map.reviews.length)
      warnings.push(
        `Google Maps показывает ${map.reviewCount} отзывов, но без входа удалось собрать только ${map.reviews.length}. Полный архив не считается собранным.`,
      );
    warnings.push(
      'Товары и услуги Google Maps этим сбором не извлечены; пустой список не означает, что их нет у организации.',
    );
    if (map.reviewCount === null)
      warnings.push(
        'Количество отзывов не пришло в общедоступном ответе Google Maps.',
      );
    if (resolvedUrl !== address)
      warnings.push(
        'Ссылка была перенаправлена Google Maps; использован конечный публичный адрес.',
      );
    return { pages, warnings, map };
  }
}
