import { existsSync } from 'node:fs';
import { load } from 'cheerio';
import { chromium } from 'playwright-core';
import type { GoogleMapReview } from './google-maps-source';

const REVIEW_CARD = '.jftiEf[data-review-id]';
const REVIEW_LIMIT = 20;

function browserExecutable(): string {
  const candidates = [
    process.env.GOOGLE_MAPS_CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const executable = candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!executable) throw new Error('Chromium не установлен на сервере');
  return executable;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function googleReviewCountFromText(text: string): number | null {
  const label = text.match(/^\s*(\d[\d,]*)\s+reviews\b/im);
  return label ? Number.parseInt(label[1].replace(/\D/g, ''), 10) : null;
}

/** Only text actually rendered in the public Google Maps review pane is saved. */
export function parseGoogleReviewHtml(
  html: string,
  sourceUrl: string,
): GoogleMapReview[] {
  const $ = load(html);
  const reviews = new Map<string, GoogleMapReview>();
  $(REVIEW_CARD).each((_, element) => {
    const card = $(element);
    const id = card.attr('data-review-id');
    if (!id || reviews.has(id)) return;
    const origin = clean(card.find('.qmhsmd').first().text());
    if (origin && origin !== 'Google') return;
    const author = clean(card.find('.d4r55').first().text());
    const ratingText = clean(card.find('.fontBodyLarge').first().text());
    const ratingMatch = ratingText.match(/^([1-5])\s*(?:\/\s*5)?$/);
    const meta = clean(card.find('.xRkPPb').first().text());
    const date = clean(meta.replace(/\s+(?:on|в)\s+Google\s*$/i, '')) || null;
    const body = card.find('.DU9Pgb').first().next('div').clone();
    body.find('button, [role="switch"]').remove();
    const text = clean(body.text());
    if (!author || !text) return;
    reviews.set(id, {
      author,
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      date,
      text,
      url: sourceUrl,
    });
  });
  return [...reviews.values()].slice(0, REVIEW_LIMIT);
}

/** Google shows a short logged-out sample; sorting exposes different public samples. */
export async function collectVisibleGoogleReviews(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<{ reviews: GoogleMapReview[]; reviewCount: number | null }> {
  signal.throwIfAborted();
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    timeout: 15_000,
    args: ['--disable-gpu'],
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
  const abort = () => {
    void browser.close().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const address = new URL(sourceUrl);
    address.searchParams.set('hl', 'en');
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      try {
        await page.goto(address.href, {
          waitUntil: 'domcontentloaded',
          timeout: 15_000,
        });
        const reviewsTab = page
          .locator('[role="tab"]')
          .filter({ hasText: /Reviews|Отзывы/i })
          .first();
        await reviewsTab.click({ timeout: 10_000 });
        await page
          .locator(REVIEW_CARD)
          .first()
          .waitFor({ state: 'attached', timeout: 10_000 });
        break;
      } catch {
        if (attempt === 1)
          throw new Error('Google Maps не показал публичную вкладку отзывов');
      }
    }
    const reviewCount = googleReviewCountFromText(
      await page.getByRole('main').innerText(),
    );

    const googleFilter = page.getByRole('button', {
      name: /^All reviews$|^Все отзывы$/i,
    });
    if (await googleFilter.count()) {
      await googleFilter.click();
      const googleOption = page.getByRole('menuitemradio', {
        name: /^Google$/,
      });
      try {
        await googleOption.click({ timeout: 3_000 });
      } catch {
        await page.keyboard.press('Escape');
      }
    }

    const collected = new Map<string, GoogleMapReview>();
    for (const sort of [
      null,
      /Newest|Сначала новые/i,
      /Lowest rating|Сначала низкие/i,
      /Highest rating|Сначала высокие/i,
    ]) {
      signal.throwIfAborted();
      if (sort) {
        const previousFirst = await page
          .locator(REVIEW_CARD)
          .first()
          .getAttribute('data-review-id');
        const sortButton = page
          .getByRole('button', {
            name: /Most relevant|Newest|Highest rating|Lowest rating|Самые полезные|Сначала новые|Сначала низкие|Сначала высокие/i,
          })
          .first();
        if (!(await sortButton.count())) continue;
        await sortButton.click();
        const option = page.getByRole('menuitemradio', { name: sort });
        try {
          await option.click({ timeout: 3_000 });
        } catch {
          await page.keyboard.press('Escape');
          continue;
        }
        await page
          .waitForFunction(
            ({ selector, previous }) => {
              const first = document.querySelector(selector);
              return Boolean(
                first && first.getAttribute('data-review-id') !== previous,
              );
            },
            { selector: REVIEW_CARD, previous: previousFirst },
            { timeout: 5_000 },
          )
          .catch(() => undefined);
      }
      const expand = page.locator(
        `${REVIEW_CARD} button[jsaction*="expandReview"]`,
      );
      for (let index = 0; index < 5 && (await expand.count()); index++) {
        await expand
          .first()
          .click({ timeout: 3_000 })
          .catch(() => undefined);
      }
      for (const review of parseGoogleReviewHtml(
        await page.content(),
        sourceUrl,
      )) {
        const key = `${review.author}\n${review.date ?? ''}\n${review.text.slice(0, 80)}`;
        if (!collected.has(key)) collected.set(key, review);
      }
      if (collected.size >= REVIEW_LIMIT) break;
    }
    return {
      reviews: [...collected.values()].slice(0, REVIEW_LIMIT),
      reviewCount,
    };
  } finally {
    signal.removeEventListener('abort', abort);
    await browser.close().catch(() => undefined);
  }
}
