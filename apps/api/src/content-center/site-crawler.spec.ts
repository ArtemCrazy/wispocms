import {
  extractPage,
  extractStructure,
  pageGroup,
  selectSitePages,
  SiteCrawler,
  siteUrl,
  siteCoverage,
  SITE_ADDRESS_LIMIT,
  SITE_REQUEST_LIMIT,
  usablePage,
  type SitePage,
} from './site-crawler';
import * as reader from './public-material';

jest.mock('node:timers/promises', () => ({
  setTimeout: () => Promise.resolve(undefined),
}));

const page = (url: string): SitePage => ({
  url,
  title: url,
  group: pageGroup(url, ''),
  recommended: false,
  status: 'found',
});
const html = (title: string, links = '') =>
  `<html><body><nav>Навигация</nav><main><h1>${title}</h1><p>${'Проверенные сведения о компании и продукте. '.repeat(4)}</p>${links}</main><script>malicious()</script></body></html>`;

describe('automatic website collection', () => {
  afterEach(() => jest.restoreAllMocks());
  it('normalizes tracking links and rejects other hosts and unsafe URLs', () => {
    expect(siteUrl('/about?utm_source=x#team', 'https://example.com')).toBe(
      'https://example.com/about',
    );
    for (const url of [
      'https://other.com',
      'https://example.com.evil.com',
      'http://example.com',
      'https://127.0.0.1',
      'https://a:secret@example.com',
    ])
      expect(() => siteUrl(url, 'https://example.com')).toThrow();
    expect(usablePage('https://example.com/services?filter=x')).toBe(false);
    expect(usablePage('https://example.com/wp-admin/')).toBe(false);
  });
  it('preserves business sections and samples at most three editorial pages', () => {
    const pages = [
      page('https://example.com/'),
      ...Array.from({ length: 150 }, (_, i) =>
        page(`https://example.com/blog/${i}`),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        page(`https://example.com/doctor/${i}`),
      ),
      page('https://example.com/price'),
      page('https://example.com/contact'),
      page('https://example.com/about'),
    ];
    const selected = selectSitePages(pages);
    expect(selected).toHaveLength(47);
    expect(selected.filter((p) => p.group === 'Команда')).toHaveLength(40);
    expect(selected.filter((p) => p.group === 'Блог и новости')).toHaveLength(
      3,
    );
    for (const group of ['Главная', 'Цены и условия', 'Контакты', 'О компании'])
      expect(selected.some((p) => p.group === group)).toBe(true);
  });
  it('does not misclassify editorial headlines and balances different business branches', () => {
    expect(
      pageGroup(
        'https://example.com/blog/price',
        'Цены на консультации врачей',
      ),
    ).toBe('Блог и новости');
    const selected = selectSitePages([
      ...Array.from({ length: 50 }, (_, i) =>
        page(`https://example.com/products/${i}`),
      ),
      page('https://example.com/services/important'),
      page('https://example.com/delivery'),
    ]);
    expect(
      selected.findIndex((p) => p.url.endsWith('/important')),
    ).toBeLessThan(4);
    expect(selected).toHaveLength(52);
  });
  it('discovers links from short hubs even if their own text cannot be analysed', () => {
    const input =
      '<html><body><a href="/services/scars">Лечение рубцов</a></body></html>';
    expect(
      extractStructure(input, 'https://example.com/hub').links,
    ).toHaveLength(1);
    expect(() => extractPage(input, 'https://example.com/hub')).toThrow(
      'достаточно текста',
    );
  });
  it('follows a deep business frontier beyond 20 pages and reads more than 30 without refetching', async () => {
    const requests: string[] = [];
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        requests.push(url);
        if (url.endsWith('/robots.txt'))
          return { url, html: false, status: 200, body: '' };
        if (url.endsWith('.xml'))
          return { url, html: false, status: 200, body: '<urlset />' };
        const step = Number(new URL(url).pathname.split('/').pop()) || 0;
        const next =
          step < 40
            ? `<a href="/services/${step + 1}">Следующее направление</a>`
            : '';
        // An intermediate hub has no body text but links must still be followed.
        const body =
          step === 25
            ? `<html><body>${next}</body></html>`
            : html(`Услуга ${step}`, next);
        return { url, html: true, status: 200, body };
      });
    const progress = jest.fn().mockResolvedValue(undefined);
    const crawler = new SiteCrawler('https://example.com/');
    const discovery = await crawler.discover(progress);
    expect(discovery.pages).toHaveLength(41);
    expect(discovery.discovery).toMatchObject({
      state: 'finished',
      checkedPages: 41,
      pendingPages: 0,
    });
    const before = requests.length;
    const pages = await crawler.collect(
      discovery.pages.filter((p) => p.recommended),
      async () => {},
    );
    expect(requests).toHaveLength(before);
    expect(pages.filter((p) => p.status === 'loaded')).toHaveLength(40);
    expect(pages.find((p) => p.url.endsWith('/40'))?.status).toBe('loaded');
    expect(siteCoverage(discovery.discovery, pages).state).toBe('partial'); // short hub has no readable body
    expect(progress).toHaveBeenCalledTimes(41);
  });
  it('reads nested sitemaps beyond six and reports unvisited maps explicitly', async () => {
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        if (url.endsWith('/robots.txt'))
          return { url, html: false, status: 200, body: '' };
        if (url.endsWith('/sitemap.xml'))
          return {
            url,
            html: false,
            status: 200,
            body: `<sitemapindex>${Array.from({ length: 70 }, (_, i) => `<sitemap><loc>https://example.com/maps/${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`,
          };
        if (url.endsWith('.xml'))
          return {
            url,
            html: false,
            status: 200,
            body: `<urlset><url><loc>https://example.com/services/${new URL(url).pathname.split('/').pop()?.replace('.xml', '')}</loc></url></urlset>`,
          };
        return { url, html: true, status: 200, body: html(url) };
      });
    const discovery = await new SiteCrawler('https://example.com/').discover();
    expect(discovery.pages.some((p) => p.url.endsWith('/services/10'))).toBe(
      true,
    );
    expect(discovery.discovery).toMatchObject({
      state: 'partial',
      pendingSitemaps: 7,
    });
    expect(discovery.discovery.reasons.join(' ')).toContain(
      'Осталось проверить карт сайта: 7',
    );
  });
  it('keeps found URLs and cached texts when the request budget ends; unchecked is not failed', async () => {
    let requests = 0;
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        requests++;
        if (url.endsWith('/robots.txt'))
          return {
            url,
            html: false,
            status: 200,
            body: 'User-agent: *\nDisallow: /private',
          };
        if (url.endsWith('.xml'))
          return { url, html: false, status: 200, body: '<urlset />' };
        const links = url.endsWith('/')
          ? '<a href="/private">Закрытая</a>' +
            Array.from(
              { length: 220 },
              (_, i) => `<a href="/services/${i}">Услуга ${i}</a>`,
            ).join('')
          : '';
        return { url, html: true, status: 200, body: html(url, links) };
      });
    const crawler = new SiteCrawler('https://example.com/');
    const discovery = await crawler.discover();
    expect(discovery.pages).toHaveLength(222);
    expect(discovery.discovery.state).toBe('partial');
    expect(discovery.discovery.reasons.join(' ')).toContain('180 запросов');
    expect(requests).toBe(SITE_REQUEST_LIMIT);
    const pages = await crawler.collect(
      discovery.pages.filter((p) => p.recommended),
      async () => {},
    );
    expect(requests).toBe(SITE_REQUEST_LIMIT);
    expect(pages.find((p) => p.url.endsWith('/private'))?.status).toBe(
      'failed',
    );
    expect(pages.filter((p) => p.status === 'loaded').length).toBeGreaterThan(
      30,
    );
    expect(pages.filter((p) => p.status === 'pending').length).toBeGreaterThan(
      0,
    );
    expect(siteCoverage(discovery.discovery, pages).state).toBe('partial');
  });
  it('retains business URLs behind a large editorial sitemap and explicitly reports registry truncation', async () => {
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        if (url.endsWith('/robots.txt'))
          return { url, html: false, status: 200, body: '' };
        if (url.endsWith('.xml'))
          return {
            url,
            html: false,
            status: 200,
            body: `<urlset>${Array.from({ length: SITE_ADDRESS_LIMIT + 5 }, (_, i) => `<url><loc>https://example.com/blog/${i}</loc></url>`).join('')}<url><loc>https://example.com/services/important</loc></url></urlset>`,
          };
        return { url, html: true, status: 200, body: html(url) };
      });
    const discovery = await new SiteCrawler('https://example.com/').discover();
    expect(discovery.pages).toHaveLength(SITE_ADDRESS_LIMIT);
    expect(
      discovery.pages.find((p) => p.url.endsWith('/services/important'))
        ?.recommended,
    ).toBe(true);
    expect(discovery.discovery.state).toBe('partial');
    expect(discovery.discovery.reasons.join(' ')).toContain(
      'Не все обнаруженные ссылки сохранены',
    );
  });
  it('preserves discovered URLs on a site timeout and propagates caller cancellation', async () => {
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        if (url.endsWith('/robots.txt'))
          return { url, html: false, status: 200, body: '' };
        if (url.endsWith('.xml'))
          return { url, html: false, status: 200, body: '<urlset />' };
        return {
          url,
          html: true,
          status: 200,
          body: html(url, '<a href="/services/deep">Услуга</a>'),
        };
      });
    const localTimeout = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(localTimeout.signal);
    const crawler = new SiteCrawler('https://example.com/');
    const discovery = await crawler.discover(() => {
      localTimeout.abort();
      return Promise.resolve();
    });
    expect(discovery.pages).toHaveLength(2);
    expect(discovery.discovery.state).toBe('partial');
    const pages = await crawler.collect(discovery.pages, async () => {});
    expect(pages.map((p) => p.status)).toEqual(['loaded', 'pending']);
    const parent = new AbortController();
    parent.abort(new Error('cancelled'));
    await expect(
      new SiteCrawler(
        'https://example.com/',
        async () => {},
        parent.signal,
      ).discover(),
    ).rejects.toThrow('cancelled');
  });
  it('extracts content, not executable markup or repeated navigation', () => {
    const result = extractPage(html('Продукт'), 'https://example.com/');
    expect(result.content).toContain('Продукт');
    expect(result.content).not.toMatch(/malicious|Навигация|<script/);
  });
  it('retains section boundaries for semantic splitting without losing heading text', () => {
    const result = extractPage(
      html(
        'Компания',
        '<h2>Доставка</h2><p>Только в пределах МКАД.</p><h3>Исключения</h3><p>За пределами — отдельный расчёт.</p>',
      ),
      'https://example.com/',
    );
    expect(result.title).toBe('Компания');
    expect(result.content).toMatch(/^# Компания\n/);
    expect(result.content).toContain(
      '\n\n## Доставка\nТолько в пределах МКАД.',
    );
    expect(result.content).toContain(
      '\n\n### Исключения\nЗа пределами — отдельный расчёт.',
    );
  });
  it('obeys robots, records failures, deduplicates text, and rejects external links', async () => {
    const requests: string[] = [];
    jest
      .spyOn(reader, 'readPublicResource')
      .mockImplementation(async (url, options = {}) => {
        await options.beforeRequest?.(new URL(url));
        requests.push(url);
        if (url.endsWith('/robots.txt'))
          return {
            url,
            body: 'User-agent: *\nDisallow: /private',
            html: false,
            status: 200,
          };
        if (url.endsWith('.xml')) throw new Error('no sitemap');
        const body = url.endsWith('/')
          ? html(
              'Компания',
              '<a href="/about">О компании</a><a href="/private">Условия</a><a href="/copy">Копия</a><a href="https://evil.com">Внешний</a>',
            )
          : html('Описание');
        return { url, body, html: true, status: 200 };
      });
    const crawler = new SiteCrawler('https://example.com/');
    const discovered = await crawler.discover();
    const pages = await crawler.collect(
      discovered.pages.filter((p) => p.recommended),
      async () => {},
    );
    expect(
      pages.some((p) => p.url.endsWith('/private') && p.status === 'failed'),
    ).toBe(true);
    expect(pages.filter((p) => p.status === 'duplicate')).toHaveLength(1);
    expect(
      requests.some((u) => u.includes('evil.com') || u.endsWith('/private')),
    ).toBe(false);
    expect(requests.filter((u) => u === 'https://example.com/')).toHaveLength(
      1,
    );
  });
});
