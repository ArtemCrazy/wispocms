import { existsSync } from 'node:fs';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import type { SitePage } from './site-crawler';

const PRODUCT_LIMIT = 10;
const REVIEWS_PER_PRODUCT = 8;
const NAVIGATION_TIMEOUT = 20_000;

export class OzonSourceError extends Error {}

export function ozonSellerAddress(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OzonSourceError('Укажите публичную ссылку магазина Ozon.');
  }
  if (
    url.protocol !== 'https:' ||
    !['ozon.ru', 'www.ozon.ru'].includes(url.hostname.toLowerCase()) ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/seller\/[a-z\d_-]+\/?$/i.test(url.pathname)
  )
    throw new OzonSourceError(
      'Нужна ссылка вида https://www.ozon.ru/seller/название/.',
    );
  return `https://www.ozon.ru${url.pathname.replace(/\/?$/, '/')}`;
}

export function isOzonSellerUrl(value: string | null | undefined): boolean {
  try {
    ozonSellerAddress(value ?? '');
    return true;
  } catch {
    return false;
  }
}

type OzonProduct = {
  title: string;
  url: string;
  price: string | null;
  rating: string | null;
  reviewCount: string | null;
};

function clean(value: string): string {
  return value.replace(/[\s\u00a0\u2009]+/g, ' ').trim();
}

function productAddress(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.ozon.ru');
    if (
      !['ozon.ru', 'www.ozon.ru'].includes(url.hostname.toLowerCase()) ||
      !/^\/product\/[a-z\d-]+-\d+\/?$/i.test(url.pathname)
    )
      return null;
    return `https://www.ozon.ru${url.pathname.replace(/\/?$/, '/')}`;
  } catch {
    return null;
  }
}

/** Parse rendered public HTML only; never use Ozon's private application API. */
export function parseOzonSellerHtml(
  html: string,
  visibleText?: string,
): {
  title: string;
  rating: string | null;
  reviewCount: string | null;
  products: OzonProduct[];
} {
  const $ = load(html);
  const pageTitle = clean($('title').first().text());
  const title = pageTitle.split(/\s+[–—-]\s+/)[0] || 'Магазин Ozon';
  const leadingText = clean(visibleText ?? $('body').text()).slice(0, 2500);
  const rating = leadingText.match(/Магазин\s+([1-5][,.]\d)/i)?.[1] ?? null;
  const reviewCount =
    leadingText
      .match(/Магазин\s+[1-5][,.]\d\s+(\d[\d\s,.]*\s*[KMКМ]?)\s+отзывов/i)?.[1]
      ?.trim() ?? null;
  const products = new Map<string, OzonProduct>();
  $('a[href*="/product/"]').each((_, element) => {
    if (products.size >= PRODUCT_LIMIT) return;
    const anchor = $(element);
    const url = productAddress(anchor.attr('href') ?? '');
    const name = clean(anchor.text());
    if (!url || !name || products.has(url)) return;
    const cardText = clean(anchor.parent().parent().text());
    const price = cardText.match(/(\d[\d\s]*\s*₽)/)?.[1]?.trim() ?? null;
    const reviewMatch = cardText.match(
      /([1-5][,.]\d)\s+(\d[\d\s]*)\s+отзыв(?:ов|а)?/i,
    );
    products.set(url, {
      title: name.slice(0, 180),
      url,
      price,
      rating: reviewMatch?.[1] ?? null,
      reviewCount: reviewMatch?.[2]?.trim() ?? null,
    });
  });
  return { title, rating, reviewCount, products: [...products.values()] };
}

export function parseOzonReviewHtml(html: string): Array<{
  author: string;
  date: string | null;
  text: string;
}> {
  const $ = load(html);
  const reviews = new Map<
    string,
    { author: string; date: string | null; text: string }
  >();
  $('[class*="rpProduct_d7a"]').each((_, element) => {
    if (reviews.size >= REVIEWS_PER_PRODUCT) return;
    const card = $(element);
    const author = clean(
      card.find('.tsCompactControl500Medium').first().text(),
    );
    const date =
      clean(card.find('[class*="rpProduct_ac9"]').first().text()) || null;
    const text = clean(card.find('[class*="rpProduct_da0"]').first().text());
    if (!author || text.length < 8 || reviews.has(`${author}|${text}`)) return;
    reviews.set(`${author}|${text}`, {
      author,
      date,
      text: text.slice(0, 2500),
    });
  });
  return [...reviews.values()];
}

function browserExecutable(): string {
  const executable = [
    process.env.OZON_CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((path) => path && existsSync(path));
  if (!executable)
    throw new OzonSourceError('Chromium для сбора Ozon не установлен.');
  return executable;
}

function proxySettings() {
  const server = process.env.OZON_PROXY_SERVER?.trim();
  const username = process.env.OZON_PROXY_USERNAME?.trim();
  const password = process.env.OZON_PROXY_PASSWORD?.trim();
  if (!server || !username || !password)
    throw new OzonSourceError(
      'Сбор Ozon пока не настроен: нужен сетевой выход в настройках сервера.',
    );
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    throw new OzonSourceError('Некорректный адрес сетевого выхода Ozon.');
  }
  if (
    !['http:', 'https:', 'socks5:'].includes(url.protocol) ||
    !url.port ||
    url.username ||
    url.password
  )
    throw new OzonSourceError('Некорректный адрес сетевого выхода Ozon.');
  return { server, username, password };
}

export class OzonSourceClient {
  async collect(
    sourceUrl: string,
    signal: AbortSignal,
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<{
    pages: SitePage[];
    warnings: string[];
    coverage: {
      state: 'finished' | 'partial';
      checkedPages: number;
      pendingPages: number;
      pendingSitemaps: number;
      reasons: string[];
      selected: number;
      read: number;
      unread: number;
      sections: Array<{
        title: string;
        found: number;
        read: number;
        unread: number;
      }>;
    };
  }> {
    const address = ozonSellerAddress(sourceUrl);
    signal.throwIfAborted();
    const browser = await chromium.launch({
      executablePath: browserExecutable(),
      headless: true,
      timeout: 15_000,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
      proxy: proxySettings(),
      ...(process.platform === 'linux'
        ? {
            env: {
              PATH: process.env.PATH ?? '/usr/bin:/bin',
              XDG_CONFIG_HOME: '/tmp/chromium-config',
              XDG_CACHE_HOME: '/tmp/chromium-cache',
            },
          }
        : {}),
    });
    const abort = () => void browser.close().catch(() => undefined);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const context = await browser.newContext({
        locale: 'ru-RU',
        viewport: { width: 1280, height: 900 },
      });
      await context.route('**/*', (route) =>
        ['image', 'media', 'font'].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
      const page = await context.newPage();
      await page.goto(address, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT,
      });
      await page
        .locator('a[href*="/product/"]')
        .first()
        .waitFor({ timeout: NAVIGATION_TIMEOUT });
      const seller = parseOzonSellerHtml(
        await page.content(),
        await page.locator('body').innerText(),
      );
      if (!seller.products.length)
        throw new OzonSourceError(
          'Ozon не показал товары магазина. Сбор не сохранён.',
        );
      const pages: SitePage[] = [
        {
          url: address,
          title: `Магазин · ${seller.title}`,
          group: 'Магазин Ozon',
          recommended: true,
          status: 'loaded',
          content: `Магазин Ozon: ${seller.title}\nРейтинг магазина: ${seller.rating ?? 'нет данных'}\nЧисло отзывов о магазине на странице: ${seller.reviewCount ?? 'нет данных'}\nПроверена выборка первых ${seller.products.length} показанных товаров.`,
        },
      ];
      const warnings = [
        `Проверены первые ${seller.products.length} уникальных товаров публичной страницы магазина; полный каталог не обходился.`,
        'Отзывы на страницах товаров относятся к товару и могут включать варианты и покупки у других продавцов. Не считать их отзывами именно о магазине.',
      ];
      let collectedReviews = 0;
      for (const [index, product] of seller.products.entries()) {
        signal.throwIfAborted();
        pages.push({
          url: product.url,
          title: `Товар · ${product.title}`,
          group: 'Товары Ozon',
          recommended: true,
          status: 'loaded',
          content: `Товар: ${product.title}\nЦена на странице магазина: ${product.price ?? 'нет данных'}\nРейтинг товара: ${product.rating ?? 'нет данных'}\nОтзывов о товаре: ${product.reviewCount ?? 'нет данных'}\nИсточник: ${product.url}`,
        });
        const reviewUrl = `${product.url}reviews/`;
        try {
          await page.goto(reviewUrl, {
            waitUntil: 'domcontentloaded',
            timeout: NAVIGATION_TIMEOUT,
          });
          await page.locator('h1').first().waitFor({ timeout: 8000 });
          const reviews = parseOzonReviewHtml(await page.content());
          if (!reviews.length)
            throw new Error('Нет читаемых текстовых отзывов');
          collectedReviews += reviews.length;
          pages.push({
            url: reviewUrl,
            title: `Отзывы о товаре · ${product.title}`,
            group: 'Отзывы о товарах Ozon',
            recommended: true,
            status: 'loaded',
            content: `Отзывы о товаре «${product.title}» (не обязательно о магазине). Публичная выборка: ${reviews.length}.\n\n${reviews.map((review, number) => `${number + 1}. ${review.author}${review.date ? ` · ${review.date}` : ''}: ${review.text}`).join('\n\n')}`,
          });
        } catch {
          signal.throwIfAborted();
          pages.push({
            url: reviewUrl,
            title: `Отзывы о товаре · ${product.title}`,
            group: 'Отзывы о товарах Ozon',
            recommended: true,
            status: 'failed',
            error: 'Ozon не показал читаемые текстовые отзывы этого товара.',
          });
        }
        await onProgress?.(index + 1, seller.products.length);
      }
      if (!collectedReviews)
        warnings.push(
          'Ни одного текстового отзыва получить не удалось; не делайте выводов об отзывах по этому сбору.',
        );
      const failed = pages.filter((item) => item.status === 'failed').length;
      return {
        pages,
        warnings,
        coverage: {
          state: failed ? 'partial' : 'finished',
          checkedPages: pages.length,
          pendingPages: 0,
          pendingSitemaps: 0,
          reasons: failed ? [`Не прочитано страниц отзывов: ${failed}.`] : [],
          selected: pages.length,
          read: pages.length - failed,
          unread: failed,
          sections: [
            { title: 'Магазин', found: 1, read: 1, unread: 0 },
            {
              title: 'Товары',
              found: seller.products.length,
              read: seller.products.length,
              unread: 0,
            },
            {
              title: 'Отзывы о товарах',
              found: seller.products.length,
              read: seller.products.length - failed,
              unread: failed,
            },
          ],
        },
      };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof OzonSourceError) throw error;
      throw new OzonSourceError(
        'Ozon не открыл публичный магазин через настроенный сетевой выход. Предыдущий сбор сохранён.',
      );
    } finally {
      signal.removeEventListener('abort', abort);
      await browser.close().catch(() => undefined);
    }
  }
}
