import {
  checkedPageDecisions,
  selectSourcePages,
  selectionRequestSize,
  type PageSelectionInput,
  type PageDecision,
} from './site-page-selection';
import type { PreparationProvider } from './preparation-ai.service';
import type { SitePage } from './site-crawler';

const page = (name: string, group = 'Блог и новости'): SitePage => ({
  url: `https://example.com/${name}`,
  title: name,
  group,
  recommended: false,
  status: 'loaded',
  content: `Текст страницы ${name}. Собственные методики и услуги компании.`,
});
const signal = () => new AbortController().signal;
const progress = async () => {};
const request: PageSelectionInput = {
  task: 'Профиль компании',
  project: [],
  pages: [
    {
      id: 1,
      title: 'Кейс',
      url: 'https://example.com/case',
      excerpt: 'Компания выполнила проект.',
    },
  ],
};

describe('AI page selection', () => {
  it('protects core pages, includes cases/uncertain pages and excludes only validated decisions', async () => {
    const selectPages = jest.fn().mockResolvedValue([
      { id: 1, decision: 'include', reason: 'Кейс компании' },
      { id: 2, decision: 'exclude', reason: 'Общая справочная статья' },
      { id: 3, decision: 'uncertain', reason: 'Нужен полный текст условий' },
    ]);
    const pages = [
      page('prices', 'Цены и условия'),
      page('case'),
      page('reference'),
      page('offer', 'Юридические документы'),
      {
        ...page('blocked'),
        status: 'failed' as const,
        content: undefined,
        error: 'Недоступна',
      },
    ];
    const result = await selectSourcePages(
      { name: 'test', generate: jest.fn(), selectPages },
      'Обзор компании',
      pages,
      signal(),
      progress,
    );
    expect(result.map((item) => item.recommended)).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
    expect(result[0].reason).toContain('Обязательная');
    expect(result[2]).toMatchObject({
      status: 'found',
      content: pages[2].content,
    });
    expect(result[3].reason).toContain('включён полный текст');
    expect(result[4].status).toBe('failed');
    const [input] = selectPages.mock.calls[0] as [PageSelectionInput];
    expect(input.pages.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(input.project[0].title).toBe('prices');
    expect(pages.every((item) => !item.recommended)).toBe(true);
  });

  it.each([
    { pages: [] },
    { pages: [{ id: 7, decision: 'exclude', reason: 'Чужой id' }] },
    {
      pages: [
        { id: 1, decision: 'include', reason: 'a' },
        { id: 1, decision: 'exclude', reason: 'b' },
      ],
    },
    { pages: [{ id: 1, decision: 'fetch', reason: 'https://127.0.0.1/' }] },
    { pages: [{ id: 1, decision: 'exclude', reason: '' }] },
  ])('rejects incomplete, forged or ambiguous responses: %j', (value) => {
    expect(() => checkedPageDecisions(value, request)).toThrow(
      'некорректный отбор',
    );
  });

  it('batches with exact full-message budget and no paid retries', async () => {
    const selectPages = jest
      .fn<Promise<PageDecision[]>, [PageSelectionInput, AbortSignal]>()
      .mockImplementation((input) =>
        Promise.resolve(
          input.pages.map(({ id }) => ({
            id,
            decision: 'include',
            reason: 'Сведения о продукте',
          })),
        ),
      );
    const pages = Array.from({ length: 55 }, (_, index) => ({
      ...page(`p${index}`),
      content: '"\\\n'.repeat(4000),
    }));
    const result = await selectSourcePages(
      { name: 'test', generate: jest.fn(), selectPages },
      'Обзор',
      pages,
      signal(),
      progress,
    );
    expect(result).toHaveLength(55);
    expect(selectPages.mock.calls.length).toBeGreaterThan(2);
    for (const [input] of selectPages.mock.calls) {
      expect(input.pages.length).toBeLessThanOrEqual(20);
      expect(selectionRequestSize(input)).toBeLessThanOrEqual(60000);
      expect(input.pages.every((item) => item.excerpt.length <= 1600)).toBe(
        true,
      );
    }
    selectPages.mockClear();
    selectPages.mockRejectedValue(new Error('provider unavailable'));
    await expect(
      selectSourcePages(
        { name: 'test', generate: jest.fn(), selectPages },
        'Обзор',
        pages,
        signal(),
        progress,
      ),
    ).rejects.toThrow('provider unavailable');
    expect(selectPages).toHaveBeenCalledTimes(1);
  });

  it('does not call AI for core-only pages, and refuses unavailable AI for optional pages', async () => {
    const selectPages = jest.fn();
    const provider: PreparationProvider = {
      name: 'test',
      generate: jest.fn(),
      selectPages,
    };
    expect(
      (
        await selectSourcePages(
          provider,
          'Обзор',
          [page('home', 'Главная')],
          signal(),
          progress,
        )
      )[0].recommended,
    ).toBe(true);
    expect(selectPages).not.toHaveBeenCalled();
    await expect(
      selectSourcePages(undefined, 'Обзор', [page('blog')], signal(), progress),
    ).rejects.toThrow('недоступен');
    await expect(
      selectSourcePages(
        provider,
        'x'.repeat(60000),
        [page('blog')],
        signal(),
        progress,
      ),
    ).rejects.toThrow('слишком велика');
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      selectSourcePages(
        provider,
        'Обзор',
        [page('blog')],
        aborted.signal,
        progress,
      ),
    ).rejects.toThrow();
    expect(selectPages).not.toHaveBeenCalled();
  });
});
