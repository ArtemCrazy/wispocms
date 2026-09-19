import {
  extractPage,
  pageGroup,
  selectSitePages,
  SiteCrawler,
  siteUrl,
  usablePage,
  type SitePage,
} from './site-crawler';
import * as reader from './public-material';

jest.mock('node:timers/promises', () => ({
  setTimeout: async () => undefined,
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
    expect(selected).toHaveLength(30);
    expect(selected.filter((p) => p.group === 'Блог и новости')).toHaveLength(
      3,
    );
    for (const group of ['Главная', 'Цены и условия', 'Контакты', 'О компании'])
      expect(selected.some((p) => p.group === group)).toBe(true);
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
