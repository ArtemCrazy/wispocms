import { PreparationCollectionService } from './preparation-collection.service';
import { SiteCrawler, type SitePage } from './site-crawler';
import { DataSource } from 'typeorm';
import type { SourceSnapshot } from './preparation-ai.service';
import { selectSourcePages } from './site-page-selection';

describe('preparation source snapshots', () => {
  afterEach(() => jest.restoreAllMocks());
  const material = {
    id: 'material',
    revision: 4,
    title: 'Компания',
    content: '',
    sourceUrl: 'https://example.com/',
    urlCategory: 'site',
  };
  const page: SitePage = {
    url: 'https://example.com/about',
    title: 'Компания',
    group: 'О компании',
    recommended: true,
    status: 'loaded',
    content: 'Исходные факты',
  };
  it('archives exact texts and conditions metadata writes on workspace and captured revision', async () => {
    jest.spyOn(SiteCrawler.prototype, 'discover').mockResolvedValue({
      root: material.sourceUrl,
      pages: [page],
      warnings: [],
      discovery: {
        state: 'finished',
        checkedPages: 1,
        pendingPages: 0,
        pendingSitemaps: 0,
        reasons: [],
      },
    });
    jest.spyOn(SiteCrawler.prototype, 'collect').mockResolvedValue([page]);
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const result = await new PreparationCollectionService({
      query,
    } as unknown as DataSource).collect(
      'workspace',
      { materials: [material], previousResult: null },
      async () => {},
      new AbortController().signal,
    );
    expect(result.sources?.[0].pages[0].content).toBe('Исходные факты');
    expect(result.sources?.[0].coverage).toMatchObject({
      state: 'finished',
      selected: 1,
      read: 1,
      unread: 0,
    });
    expect(result.materials[0].title).toContain('[S1.1]');
    expect(result.materials[0].topic).toMatchObject({
      sourceId: 'S1',
      key: 'company',
    });
    expect(result.materials[1].topic).toMatchObject({
      sourceId: 'S1',
      key: 'coverage',
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(
      'workspace_id=$1 AND id=$2 AND revision=$3 AND source_url=$5',
    );
    expect(params.slice(0, 3)).toEqual(['workspace', 'material', 4]);
    expect(params[4]).toBe(material.sourceUrl);
  });
  it('preserves partial discovery and unchecked pages in both archived and AI coverage', async () => {
    const pending: SitePage = {
      ...page,
      url: 'https://example.com/service',
      title: 'Услуга',
      content: undefined,
      status: 'pending',
      reason: 'Достигнут предел запросов обхода',
    };
    jest.spyOn(SiteCrawler.prototype, 'discover').mockResolvedValue({
      root: material.sourceUrl,
      pages: [page, pending],
      warnings: [],
      discovery: {
        state: 'partial',
        checkedPages: 1,
        pendingPages: 1,
        pendingSitemaps: 2,
        reasons: ['Осталось проверить карт сайта: 2.'],
      },
    });
    jest
      .spyOn(SiteCrawler.prototype, 'collect')
      .mockResolvedValue([page, pending]);
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const result = await new PreparationCollectionService({
      query,
    } as unknown as DataSource).collect(
      'workspace',
      { materials: [material], previousResult: null },
      async () => {},
      new AbortController().signal,
    );
    expect(result.sources?.[0].coverage).toMatchObject({
      state: 'partial',
      read: 1,
      unread: 1,
      pendingSitemaps: 2,
    });
    const coverage = JSON.parse(result.materials[1].content) as {
      unchecked: unknown[];
      unavailable: unknown[];
    };
    expect(coverage.unchecked).toEqual([
      { url: pending.url, reason: pending.reason },
    ]);
    expect(coverage.unavailable).toEqual([]);
    expect(
      (JSON.parse(query.mock.calls[0][1][3] as string) as SourceSnapshot)
        .coverage,
    ).toEqual(result.sources?.[0].coverage);
  });
  it('fails honestly if no source could be read, instead of analysing an empty website', async () => {
    jest
      .spyOn(SiteCrawler.prototype, 'discover')
      .mockRejectedValue(new Error('unavailable'));
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    await expect(
      new PreparationCollectionService({
        query,
      } as unknown as DataSource).collect(
        'workspace',
        { materials: [material], previousResult: null },
        async () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('ни один источник');
    expect(
      (JSON.parse(query.mock.calls[0][1][3] as string) as SourceSnapshot)
        .pages[0].status,
    ).toBe('failed');
  });

  it('AI selection sees excluded blog pages, archives decisions, and never sends rejected text to analysis', async () => {
    const optional: SitePage[] = ['case', 'generic', 'terms'].map((name) => ({
      ...page,
      url: `https://example.com/blog/${name}`,
      title: name,
      group: 'Блог и новости',
      recommended: false,
      status: 'found',
      content: undefined,
    }));
    jest.spyOn(SiteCrawler.prototype, 'discover').mockResolvedValue({
      root: material.sourceUrl,
      pages: [page, ...optional],
      warnings: [],
      discovery: {
        state: 'finished',
        checkedPages: 1,
        pendingPages: 0,
        pendingSitemaps: 0,
        reasons: [],
      },
    });
    const collect = jest
      .spyOn(SiteCrawler.prototype, 'collect')
      .mockImplementation((pages) =>
        Promise.resolve(
          pages.map((item) => ({
            ...item,
            status: 'loaded',
            content: `${item.title} UNIQUE CONTENT`,
          })),
        ),
      );
    const selectPages = jest.fn().mockResolvedValue([
      { id: 1, decision: 'include', reason: 'Реальный кейс' },
      { id: 2, decision: 'exclude', reason: 'Общая справка' },
      { id: 3, decision: 'uncertain', reason: 'Недостаточно фрагмента' },
    ]);
    const query = jest.fn().mockResolvedValue([]);
    const collector = new PreparationCollectionService({
      query,
    } as unknown as DataSource);
    const result = await collector.collect(
      'workspace',
      { materials: [material], previousResult: null },
      async () => {},
      new AbortController().signal,
      {
        selectPages: (pages, signal) =>
          selectSourcePages(
            { name: 'test', generate: jest.fn(), selectPages },
            'Профиль',
            pages,
            signal,
            async () => {},
          ),
      },
    );
    expect(collect.mock.calls[0][0]).toHaveLength(4);
    expect(
      result.materials.map((item) => item.content).join('\n'),
    ).not.toContain('generic UNIQUE CONTENT');
    expect(result.materials.some((item) => item.title.includes('[S1.4]'))).toBe(
      true,
    );
    expect(result.sources?.[0].pages[2]).toMatchObject({
      recommended: false,
      status: 'found',
      content: 'generic UNIQUE CONTENT',
      reason: 'AI — не включена: Общая справка',
    });
    expect(result.sources?.[0].coverage).toMatchObject({
      selected: 3,
      read: 3,
    });
    expect(query).toHaveBeenCalledTimes(1);

    // Free refresh has no selector: it keeps the programmatic sample and never calls AI.
    selectPages.mockClear();
    collect.mockClear();
    await collector.collect(
      'workspace',
      { materials: [material], previousResult: null },
      async () => {},
      new AbortController().signal,
      { persistSnapshots: false, allowUnread: true },
    );
    expect(collect.mock.calls[0][0]).toHaveLength(1);
    expect(selectPages).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not swallow AI selection failures or replace the saved snapshot', async () => {
    jest.spyOn(SiteCrawler.prototype, 'discover').mockResolvedValue({
      root: material.sourceUrl,
      pages: [page],
      warnings: [],
      discovery: {
        state: 'finished',
        checkedPages: 1,
        pendingPages: 0,
        pendingSitemaps: 0,
        reasons: [],
      },
    });
    jest.spyOn(SiteCrawler.prototype, 'collect').mockResolvedValue([page]);
    const query = jest.fn();
    await expect(
      new PreparationCollectionService({
        query,
      } as unknown as DataSource).collect(
        'workspace',
        { materials: [material], previousResult: null },
        async () => {},
        new AbortController().signal,
        {
          selectPages: () => Promise.reject(new Error('AI selection failed')),
        },
      ),
    ).rejects.toThrow('AI selection failed');
    expect(query).not.toHaveBeenCalled();
  });
});
