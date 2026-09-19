import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { publicMaterialUrl, readPublicResource } from './public-material';

export const SITE_PAGE_LIMIT = 30;
export const SITE_TEXT_LIMIT = 1_200_000;
const AGENT = 'WispoCMS';
export type SitePage = {
  url: string;
  title: string;
  group: string;
  recommended: boolean;
  status: 'found' | 'loaded' | 'failed' | 'duplicate';
  content?: string;
  error?: string;
  checkedAt?: string;
  hash?: string;
  duplicateOf?: string;
  reason?: string;
};

export function siteUrl(value: string, root: string): string {
  const url = publicMaterialUrl(new URL(value, root).href);
  const home = publicMaterialUrl(root);
  if (
    url.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')
  )
    throw new BadRequestException(
      'Страница должна принадлежать выбранному сайту',
    );
  if (url.href.length > 2048)
    throw new BadRequestException('Слишком длинный адрес');
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|gclid$|yclid$|fbclid$)/i.test(key))
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

export function pageGroup(url: string, title: string): string {
  let path = new URL(url).pathname;
  try {
    path = decodeURI(path);
  } catch {
    /* Keep encoded paths. */
  }
  if (path === '/') return 'Главная';
  const value = `${path} ${title}`.toLowerCase();
  if (/price|pricing|cost|цены|стоимост/.test(value)) return 'Цены и условия';
  if (/contact|контакт|адрес/.test(value)) return 'Контакты';
  if (/about|company|о нас|о компании|о клиник/.test(value))
    return 'О компании';
  if (/team|doctor|specialist|врач|специалист|команда/.test(value))
    return 'Команда';
  if (/licen|certif|лицензи|сертификат/.test(value))
    return 'Лицензии и документы';
  if (/blog|news|article|блог|новост|стать/.test(value))
    return 'Блог и новости';
  if (/privacy|policy|offer|agreement|политик|оферт|согласи/.test(value))
    return 'Юридические документы';
  return 'Услуги и другие страницы';
}

export function usablePage(url: string): boolean {
  const parsed = new URL(url);
  return (
    !/\.(?:jpg|jpeg|png|webp|gif|svg|ico|pdf|zip|mp4|js|css|xml|txt|woff2?)$/i.test(
      parsed.pathname,
    ) &&
    !/(?:^|\/)(?:cart|checkout|login|logout|admin|account|search|wp-admin|feed)(?:\/|$)/i.test(
      parsed.pathname,
    ) &&
    ![...parsed.searchParams.keys()].some((key) =>
      /^(?:s|q|search|sort|filter|page|add-to-cart)$/i.test(key),
    )
  );
}

export function extractPage(html: string, url: string) {
  if (html.includes('\0') || html.includes('\uFFFD'))
    throw new Error('encoding');
  const $ = load(html);
  const title = (
    $('h1').first().text() ||
    $('title').text() ||
    new URL(url).pathname
  )
    .trim()
    .slice(0, 200);
  const links = $('a[href]')
    .toArray()
    .slice(0, 3000)
    .map((a) => ({
      url: $(a).attr('href')!,
      title: $(a).text().trim().slice(0, 200),
    }));
  $(
    'script,style,noscript,svg,nav,form,iframe,[hidden],[aria-hidden="true"],body > header,body > footer,[role="banner"],[role="contentinfo"],[role="navigation"]',
  ).remove();
  $('[class*="cookie"],[id*="cookie"]').remove();
  const main = $('main,[role="main"]').first();
  const body = main.length ? main : $('body');
  body.find('td,th').append(' | ');
  body.find('h1,h2,h3,h4,h5,h6,p,li,tr,section,article,div,br').append('\n');
  const content = body
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (content.length < 80)
    throw new Error(
      'Страница не содержит достаточно текста; возможно, требуется JavaScript',
    );
  if (content.length > 100_000)
    throw new Error(
      'Текст страницы превышает 100 000 символов; добавьте нужную часть вручную',
    );
  const description = $('meta[name="description"]').attr('content') ?? '';
  return { title, links, content, description };
}

const MAIN_GROUPS = [
  'Главная',
  'О компании',
  'Цены и условия',
  'Контакты',
  'Команда',
  'Лицензии и документы',
  'Услуги и другие страницы',
];

export function selectSitePages(pages: SitePage[]): SitePage[] {
  const selected: SitePage[] = [];
  const editorial = pages
    .filter((p) => p.group === 'Блог и новости')
    .slice(0, 3);
  // Round-robin ensures 25 doctors or products cannot displace contact/pricing pages.
  const buckets = MAIN_GROUPS.map((group) =>
    pages.filter((p) => p.group === group),
  );
  while (
    selected.length < SITE_PAGE_LIMIT - editorial.length &&
    buckets.some((b) => b.length)
  ) {
    for (const bucket of buckets) {
      if (bucket.length && selected.length < SITE_PAGE_LIMIT - editorial.length)
        selected.push(bucket.shift()!);
    }
  }
  selected.push(...editorial);
  for (const page of pages) {
    page.recommended = selected.includes(page);
    page.reason = page.recommended
      ? page.group === 'Блог и новости'
        ? 'Пример тематики и подачи'
        : 'Информация о компании и продукте'
      : page.group === 'Юридические документы'
        ? 'Не включено в профиль компании'
        : 'За пределами автоматической выборки';
  }
  return selected;
}

/** Uses only the DNS-pinned reader. No browser, cookies, credentials or external hosts. */
export class SiteCrawler {
  private robots = new Map<string, ReturnType<typeof robotsParser>>();
  private lastRequest = 0;
  private requests = 0;
  readonly signal: AbortSignal;
  private cache = new Map<
    string,
    Awaited<ReturnType<typeof readPublicResource>>
  >();

  constructor(
    private root: string,
    private alive: () => Promise<void> = () => Promise.resolve(),
    signal?: AbortSignal,
  ) {
    this.root = siteUrl(root, root);
    this.signal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(4 * 60_000)])
      : AbortSignal.timeout(4 * 60_000);
  }

  private async pace(url: URL) {
    siteUrl(url.href, this.root);
    await this.alive();
    this.signal.throwIfAborted();
    if (++this.requests > 180)
      throw new Error('Достигнут предел запросов обхода');
    const seconds = this.robots.get(url.origin)?.getCrawlDelay(AGENT) ?? 0;
    if (seconds > 10)
      throw new Error('Сайт требует слишком большой интервал обхода');
    const pause =
      Math.max(600, seconds * 1000) - (Date.now() - this.lastRequest);
    if (pause > 0) await delay(pause, undefined, { signal: this.signal });
    this.lastRequest = Date.now();
  }

  private async policy(origin: string) {
    if (this.robots.has(origin)) return this.robots.get(origin)!;
    const resource = await readPublicResource(`${origin}/robots.txt`, {
      signal: this.signal,
      allowNotFound: true,
      beforeRequest: async (url) => {
        if (url.origin !== origin)
          throw new Error('robots.txt перенаправляет на другой адрес');
        await this.pace(url);
      },
    });
    if (resource.status === 200 && resource.html)
      throw new Error('Некорректный robots.txt');
    const policy = robotsParser(`${origin}/robots.txt`, resource.body);
    this.robots.set(origin, policy);
    return policy;
  }

  private async read(url: string, xml = false) {
    const normalized = siteUrl(url, this.root);
    if (this.cache.has(normalized)) return this.cache.get(normalized)!;
    const result = await readPublicResource(normalized, {
      signal: this.signal,
      xml,
      beforeRequest: async (target) => {
        siteUrl(target.href, this.root);
        const policy = await this.policy(target.origin);
        if (policy.isAllowed(target.href, AGENT) === false)
          throw new Error('Загрузка запрещена robots.txt');
        await this.pace(target);
      },
    });
    if (!xml && this.cache.size < 35) this.cache.set(normalized, result);
    return result;
  }

  async discover() {
    const pages = new Map<string, SitePage>();
    const warnings: string[] = [];
    const add = (value: string, title = '', base = this.root) => {
      try {
        const url = siteUrl(new URL(value, base).href, this.root);
        if (!usablePage(url) || pages.size >= 300 || pages.has(url)) return;
        pages.set(url, {
          url,
          title: title || new URL(url).pathname,
          group: pageGroup(url, title),
          recommended: false,
          status: 'found',
        });
      } catch {
        /* Invalid, external or unsupported links are not sources. */
      }
    };
    add(this.root, 'Главная');
    const rootResource = await this.read(this.root);
    if (!rootResource.html)
      throw new Error('Адрес сайта не является HTML-страницей');
    this.root = siteUrl(rootResource.url, this.root);
    pages.clear();
    add(this.root, 'Главная');
    const rootPage = extractPage(rootResource.body, this.root);
    pages.get(this.root)!.title = rootPage.title;
    rootPage.links.forEach((link) => add(link.url, link.title));
    const policy = await this.policy(new URL(this.root).origin);
    const sitemaps = [
      ...policy.getSitemaps(),
      `${new URL(this.root).origin}/sitemap.xml`,
    ];
    const visitedMaps = new Set<string>();
    while (sitemaps.length && visitedMaps.size < 6 && pages.size < 300) {
      const value = sitemaps.shift()!;
      try {
        const url = siteUrl(value, this.root);
        if (visitedMaps.has(url)) continue;
        visitedMaps.add(url);
        const xml = await this.read(url, true);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml.body))
          throw new Error('unsupported XML');
        const $ = load(xml.body, { xml: true });
        $('sitemap > loc').each((_i, el) => {
          if (sitemaps.length < 20) sitemaps.push($(el).text().trim());
        });
        $('url > loc').each((_i, el) => add($(el).text().trim()));
      } catch {
        warnings.push(
          'Не все карты сайта удалось прочитать. Дополнительно используем внутренние ссылки.',
        );
      }
    }
    // Follow a bounded breadth-first sample, not all articles/products from one section.
    const queue = [...pages.values()].sort(
      (a, b) => this.priority(a) - this.priority(b),
    );
    const visited = new Set([this.root]);
    while (queue.length && visited.size < 21 && pages.size < 300) {
      const page = queue.shift()!;
      if (visited.has(page.url) || page.group === 'Юридические документы')
        continue;
      visited.add(page.url);
      try {
        const response = await this.read(page.url);
        if (!response.html) continue;
        const parsed = extractPage(response.body, response.url);
        page.title = parsed.title;
        page.group = pageGroup(page.url, `${page.title} ${parsed.description}`);
        parsed.links.forEach((link) => add(link.url, link.title, response.url));
        // Prioritize deeper product pages, while only sampling editorial content.
        for (const next of [...pages.values()].sort(
          (a, b) => this.priority(a) - this.priority(b),
        ))
          if (
            !visited.has(next.url) &&
            !queue.some((item) => item.url === next.url)
          )
            queue.push(next);
      } catch {
        /* Loading will show the exact per-page error after selection. */
      }
    }
    const result = [...pages.values()].sort(
      (a, b) => this.priority(a) - this.priority(b),
    );
    selectSitePages(result);
    warnings.push(
      'Автоматическая выборка основных страниц, не полный аудит сайта. Архив статей и новости используются выборочно.',
    );
    if (pages.size >= 300)
      warnings.push('Обнаружение ограничено 300 уникальными адресами.');
    return { root: this.root, pages: result, warnings: [...new Set(warnings)] };
  }

  private priority(page: SitePage) {
    return MAIN_GROUPS.indexOf(page.group) >= 0
      ? MAIN_GROUPS.indexOf(page.group)
      : 90;
  }

  async collect(
    pages: SitePage[],
    progress: (pages: SitePage[]) => Promise<void>,
  ) {
    if (!pages.length || pages.length > SITE_PAGE_LIMIT)
      throw new Error('Некорректный размер выборки страниц');
    const results: SitePage[] = [];
    const hashes = new Map<string, string>();
    let total = 0;
    for (const candidate of pages) {
      await this.alive();
      this.signal.throwIfAborted();
      const page: SitePage = {
        ...candidate,
        status: 'failed',
        content: undefined,
        checkedAt: new Date().toISOString(),
      };
      try {
        const response = await this.read(candidate.url);
        if (!response.html)
          throw new Error('Не HTML-страница; документ можно загрузить файлом');
        const parsed = extractPage(response.body, response.url);
        page.title = parsed.title;
        page.url = response.url;
        page.hash = createHash('sha256').update(parsed.content).digest('hex');
        const duplicate = hashes.get(page.hash);
        if (duplicate) {
          page.status = 'duplicate';
          page.duplicateOf = duplicate;
        } else {
          if (total + parsed.content.length > SITE_TEXT_LIMIT)
            throw new Error(
              'Достигнут предел объёма сайта: 1,2 млн символов. Сократите выбор',
            );
          page.status = 'loaded';
          page.content = parsed.content;
          hashes.set(page.hash, page.url);
          total += parsed.content.length;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        page.error = /robots|JavaScript|символов|HTML|интервал/.test(message)
          ? message.slice(0, 250)
          : 'Не удалось прочитать страницу. Она недоступна, защищена или требует JavaScript.';
      }
      results.push(page);
      await progress(results);
    }
    return results;
  }
}
