import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { publicMaterialUrl, readPublicResource } from './public-material';

export const SITE_ADDRESS_LIMIT = 2000;
export const SITE_SITEMAP_LIMIT = 64;
export const SITE_REQUEST_LIMIT = 180;
export const SITE_TEXT_LIMIT = 1_200_000;
const AGENT = 'WispoCMS';
export type SitePage = {
  url: string;
  title: string;
  group: string;
  recommended: boolean;
  status: 'found' | 'loaded' | 'failed' | 'duplicate' | 'pending';
  content?: string;
  error?: string;
  checkedAt?: string;
  hash?: string;
  duplicateOf?: string;
  reason?: string;
};

export type SiteDiscovery = {
  state: 'finished' | 'partial';
  checkedPages: number;
  pendingPages: number;
  pendingSitemaps: number;
  reasons: string[];
};
export type SiteCoverage = SiteDiscovery & {
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

export function siteCoverage(
  discovery: SiteDiscovery,
  pages: SitePage[],
): SiteCoverage {
  const selected = pages.filter((p) => p.recommended);
  const available = (p: SitePage) =>
    p.status === 'loaded' || p.status === 'duplicate';
  const unread = selected.filter((p) => !available(p)).length;
  return {
    ...discovery,
    reasons: [
      ...new Set([
        ...discovery.reasons,
        ...(unread
          ? [
              `Не удалось включить выбранные страницы: ${unread}. Они не использованы в анализе.`,
            ]
          : []),
        ...selected
          .filter((p) => p.status === 'pending')
          .map((p) => p.reason ?? 'Страница не проверена'),
      ]),
    ],
    state: discovery.state === 'partial' || unread ? 'partial' : 'finished',
    selected: selected.length,
    read: selected.filter((p) => p.status === 'loaded').length,
    unread,
    sections: MAIN_GROUPS.map((title) => {
      const section = pages.filter((p) => p.group === title);
      return {
        title,
        found: section.length,
        read: section.filter(available).length,
        unread: section.filter((p) => !available(p)).length,
      };
    }),
  };
}

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
  // Editorial URLs stay editorial even when their headline mentions a price or doctor.
  if (/(?:^|\/)(?:blog|news|articles?|блог|новости|статьи)(?:\/|$)/i.test(path))
    return 'Блог и новости';
  const value = `${path} ${title}`.toLowerCase();
  if (
    /price|pricing|cost|цены|стоимост|delivery|payment|warranty|guarantee|доставк|оплат|гаранти/.test(
      value,
    )
  )
    return 'Цены и условия';
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

export function extractStructure(html: string, url: string) {
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
    .map((a) => ({
      url: $(a).attr('href')!,
      title: $(a).text().trim().slice(0, 200),
    }));
  return {
    title,
    links,
    description: $('meta[name="description"]').attr('content') ?? '',
  };
}

export function extractPage(html: string, url: string) {
  const structure = extractStructure(html, url);
  const $ = load(html);
  $(
    'script,style,noscript,svg,nav,form,iframe,[hidden],[aria-hidden="true"],body > header,body > footer,[role="banner"],[role="contentinfo"],[role="navigation"]',
  ).remove();
  $('[class*="cookie"],[id*="cookie"]').remove();
  const main = $('main,[role="main"]').first();
  const body = main.length ? main : $('body');
  body.find('h1,h2,h3,h4,h5,h6').each((_, heading) => {
    const level = Number(heading.tagName.slice(1));
    $(heading).prepend(`\n\n${'#'.repeat(level)} `);
  });
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
  return { ...structure, content };
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

function balanceBranches(pages: SitePage[]) {
  const branches = new Map<string, SitePage[]>();
  for (const page of [...pages].sort(
    (a, b) =>
      new URL(a.url).pathname.split('/').filter(Boolean).length -
      new URL(b.url).pathname.split('/').filter(Boolean).length,
  )) {
    const parts = new URL(page.url).pathname.split('/').filter(Boolean);
    const key = parts.slice(0, parts.length > 2 ? 2 : 1).join('/');
    const branch = branches.get(key) ?? [];
    branch.push(page);
    branches.set(key, branch);
  }
  const result: SitePage[] = [];
  while ([...branches.values()].some((branch) => branch.length))
    for (const branch of branches.values())
      if (branch.length) result.push(branch.shift()!);
  return result;
}

export function selectSitePages(pages: SitePage[]): SitePage[] {
  const selected: SitePage[] = [];
  const editorial = pages
    .filter((p) => p.group === 'Блог и новости')
    .slice(0, 3);
  // Interleave business sections; never drop a business page just because 30 were selected.
  const buckets = MAIN_GROUPS.map((group) =>
    balanceBranches(pages.filter((p) => p.group === group)),
  );
  while (buckets.some((b) => b.length)) {
    for (const bucket of buckets) {
      if (bucket.length) selected.push(bucket.shift()!);
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
        : 'Архив статей и новостей: используется выборочно';
  }
  return selected;
}

/** Uses only the DNS-pinned reader. No browser, cookies, credentials or external hosts. */
export class SiteCrawler {
  private robots = new Map<string, ReturnType<typeof robotsParser>>();
  private lastRequest = 0;
  private requests = 0;
  readonly signal: AbortSignal;
  private stopReason: string | undefined;
  private cachedCharacters = 0;
  private documents = new Map<
    string,
    {
      url: string;
      title: string;
      content?: string;
      error?: string;
      pending?: string;
    }
  >();

  constructor(
    private root: string,
    private alive: () => Promise<void> = () => Promise.resolve(),
    private readonly parentSignal?: AbortSignal,
  ) {
    this.root = siteUrl(root, root);
    this.signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(4 * 60_000)])
      : AbortSignal.timeout(4 * 60_000);
  }

  private async pace(url: URL) {
    siteUrl(url.href, this.root);
    await this.alive();
    this.signal.throwIfAborted();
    if (this.requests >= SITE_REQUEST_LIMIT) {
      this.stopReason = `Достигнут технический предел: ${SITE_REQUEST_LIMIT} запросов к сайту.`;
      throw new Error(this.stopReason);
    }
    this.requests++;
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
    return readPublicResource(normalized, {
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
  }

  private stopped() {
    this.parentSignal?.throwIfAborted();
    if (this.signal.aborted)
      this.stopReason ??= 'Достигнут предел времени обхода: 4 минуты.';
    return this.stopReason;
  }

  private errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return /robots|JavaScript|символов|HTML|интервал/.test(message)
      ? message.slice(0, 250)
      : 'Не удалось прочитать страницу. Она недоступна, защищена или требует JavaScript.';
  }

  private remember(
    url: string,
    resource: Awaited<ReturnType<typeof readPublicResource>>,
  ) {
    if (!resource.html)
      throw new Error('Не HTML-страница; документ можно загрузить файлом');
    // Structure discovery must work even on a short navigation page with no usable body text.
    const structure = extractStructure(resource.body, resource.url);
    const document: {
      url: string;
      title: string;
      content?: string;
      error?: string;
      pending?: string;
    } = {
      url: resource.url,
      title: structure.title,
    };
    try {
      const { content } = extractPage(resource.body, resource.url);
      if (this.cachedCharacters + content.length > SITE_TEXT_LIMIT) {
        document.pending =
          'Текст не включён: достигнут предел объёма сайта — 1,2 млн символов.';
      } else {
        document.content = content;
        this.cachedCharacters += content.length;
      }
    } catch (error) {
      document.error = this.errorMessage(error);
    }
    this.documents.set(url, document);
    return structure;
  }

  async discover(
    progress?: (checked: number, discovered: number) => Promise<void>,
  ) {
    const pages = new Map<string, SitePage>();
    const warnings: string[] = [];
    const reasons = new Set<string>();
    const inspected = new Set<string>();
    const attempted = new Set<string>();
    const add = (value: string, title = '', base = this.root) => {
      try {
        const url = siteUrl(new URL(value, base).href, this.root);
        if (!usablePage(url) || pages.has(url)) return;
        const group = pageGroup(url, title);
        if (pages.size >= SITE_ADDRESS_LIMIT) {
          reasons.add(
            `Реестр ограничен ${SITE_ADDRESS_LIMIT} адресами. Не все обнаруженные ссылки сохранены.`,
          );
          // A large editorial sitemap must not crowd out business URLs discovered later.
          const replace = MAIN_GROUPS.includes(group)
            ? [...pages.values()]
                .reverse()
                .find(
                  (p) =>
                    !MAIN_GROUPS.includes(p.group) && !attempted.has(p.url),
                )
            : undefined;
          if (!replace) return;
          pages.delete(replace.url);
        }
        pages.set(url, {
          url,
          title: title || new URL(url).pathname,
          group,
          recommended: false,
          status: 'found',
        });
      } catch {
        /* Invalid, external or unsupported links are not sources. */
      }
    };
    add(this.root, 'Главная');
    try {
      const rootResource = await this.read(this.root);
      this.root = siteUrl(rootResource.url, this.root);
      pages.clear();
      add(this.root, 'Главная');
      const rootPage = this.remember(this.root, rootResource);
      pages.get(this.root)!.title = rootPage.title;
      inspected.add(this.root);
      rootPage.links.forEach((link) => add(link.url, link.title));
    } catch (error) {
      this.parentSignal?.throwIfAborted();
      reasons.add('Не удалось проверить ссылки на главной странице.');
      this.documents.set(this.root, {
        url: this.root,
        title: 'Главная',
        error: this.errorMessage(error),
      });
    }
    attempted.add(this.root);
    await progress?.(inspected.size, pages.size);

    const sitemaps: string[] = [];
    const knownMaps = new Set<string>();
    const queueMap = (value: string) => {
      try {
        const url = siteUrl(value, this.root);
        if (knownMaps.has(url)) return;
        if (knownMaps.size >= 256) {
          reasons.add(
            'Не все вложенные карты сайта помещаются в очередь проверки.',
          );
          return;
        }
        knownMaps.add(url);
        sitemaps.push(url);
      } catch {
        reasons.add(
          'Карта сайта указывает на неподдерживаемый или внешний адрес.',
        );
      }
    };
    this.robots.get(new URL(this.root).origin)?.getSitemaps().forEach(queueMap);
    queueMap(`${new URL(this.root).origin}/sitemap.xml`);
    const visitedMaps = new Set<string>();
    while (
      sitemaps.length &&
      visitedMaps.size < SITE_SITEMAP_LIMIT &&
      !this.stopped()
    ) {
      // Prefer service/product sitemaps to editorial archives when a site has many maps.
      sitemaps.sort(
        (a, b) =>
          Number(/blog|news|article/i.test(a)) -
          Number(/blog|news|article/i.test(b)),
      );
      const url = sitemaps.shift()!;
      visitedMaps.add(url);
      try {
        const xml = await this.read(url, true);
        if (/<!DOCTYPE|<!ENTITY/i.test(xml.body))
          throw new Error('unsupported XML');
        const $ = load(xml.body, { xml: true });
        if (!$('sitemapindex,urlset').length)
          throw new Error('unsupported sitemap');
        $('sitemap > loc').each((_i, el) => {
          queueMap($(el).text().trim());
        });
        $('url > loc').each((_i, el) => add($(el).text().trim()));
      } catch {
        this.parentSignal?.throwIfAborted();
        reasons.add(
          'Не все карты сайта удалось прочитать. Поиск дополнен внутренними ссылками.',
        );
      }
    }
    if (sitemaps.length)
      reasons.add(`Осталось проверить карт сайта: ${sitemaps.length}.`);

    // Continue the business frontier to exhaustion, not just the first 20 pages.
    while (!this.stopped()) {
      const candidates = selectSitePages([...pages.values()]);
      const remaining = candidates.filter((p) => !attempted.has(p.url));
      const page = remaining[0];
      if (!page) break;
      attempted.add(page.url);
      try {
        const response = await this.read(page.url);
        const parsed = this.remember(page.url, response);
        page.title = parsed.title;
        page.group = pageGroup(page.url, `${page.title} ${parsed.description}`);
        inspected.add(page.url);
        parsed.links.forEach((link) => add(link.url, link.title, response.url));
      } catch (error) {
        this.parentSignal?.throwIfAborted();
        if (!this.stopped())
          this.documents.set(page.url, {
            url: page.url,
            title: page.title,
            error: this.errorMessage(error),
          });
      }
      await progress?.(inspected.size, pages.size);
    }
    const result = [...pages.values()].sort(
      (a, b) => this.priority(a) - this.priority(b),
    );
    const selected = selectSitePages(result);
    const pendingPages = selected.filter((p) => !inspected.has(p.url)).length;
    if (this.stopped()) reasons.add(this.stopped()!);
    if (pendingPages)
      reasons.add(
        `Не проверены ссылки на выбранных страницах: ${pendingPages}. В них могут быть другие важные разделы.`,
      );
    warnings.push(
      'Проверяются найденные страницы компании, услуг и продуктов. Блог и новости — до трёх примеров; юридические страницы исключены. Скрытые и недоступные ссылки могут остаться вне обхода.',
    );
    const discovery: SiteDiscovery = {
      state: reasons.size ? 'partial' : 'finished',
      checkedPages: inspected.size,
      pendingPages,
      pendingSitemaps: sitemaps.length,
      reasons: [...reasons],
    };
    return {
      root: this.root,
      pages: result,
      warnings: [...new Set(warnings)],
      discovery,
    };
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
    if (!pages.length || pages.length > SITE_ADDRESS_LIMIT)
      throw new Error('Некорректный размер выборки страниц');
    const results: SitePage[] = [];
    const hashes = new Map<string, string>();
    let total = 0;
    for (const candidate of pages) {
      await this.alive();
      this.parentSignal?.throwIfAborted();
      const page: SitePage = {
        ...candidate,
        status: 'failed',
        content: undefined,
        checkedAt: new Date().toISOString(),
      };
      try {
        if (!this.documents.has(candidate.url)) {
          if (this.stopped()) {
            this.documents.set(candidate.url, {
              url: candidate.url,
              title: candidate.title,
              pending: `${this.stopped()} Страница не проверена.`,
            });
          } else {
            this.remember(candidate.url, await this.read(candidate.url));
          }
        }
        const parsed = this.documents.get(candidate.url)!;
        page.title = parsed.title;
        page.url = parsed.url;
        if (parsed.pending) {
          page.status = 'pending';
          page.reason = parsed.pending;
        } else if (parsed.error || !parsed.content) {
          page.error =
            parsed.error ??
            'Страница не содержит текста; возможно, требуется JavaScript';
        } else {
          page.hash = createHash('sha256').update(parsed.content).digest('hex');
          const duplicate = hashes.get(page.hash);
          if (duplicate) {
            page.status = 'duplicate';
            page.duplicateOf = duplicate;
          } else {
            if (total + parsed.content.length > SITE_TEXT_LIMIT) {
              page.status = 'pending';
              page.reason =
                'Текст не включён: достигнут предел объёма сайта — 1,2 млн символов.';
            } else {
              page.status = 'loaded';
              page.content = parsed.content;
              hashes.set(page.hash, page.url);
              total += parsed.content.length;
            }
          }
        }
      } catch (error) {
        this.parentSignal?.throwIfAborted();
        if (this.stopped()) {
          page.status = 'pending';
          page.reason = `${this.stopped()} Страница не проверена.`;
        } else page.error = this.errorMessage(error);
      }
      results.push(page);
      await progress(results);
    }
    return results;
  }
}
