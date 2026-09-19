import { PreparationCollectionService } from './preparation-collection.service';
import { SiteCrawler, type SitePage } from './site-crawler';
import { DataSource } from 'typeorm';

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
    });
    jest.spyOn(SiteCrawler.prototype, 'collect').mockResolvedValue([page]);
    const query = jest.fn().mockResolvedValue([]);
    const result = await new PreparationCollectionService({
      query,
    } as unknown as DataSource).collect(
      'workspace',
      { materials: [material], previousResult: null },
      async () => {},
      new AbortController().signal,
    );
    expect(result.sources?.[0].pages[0].content).toBe('Исходные факты');
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
  it('fails honestly if no source could be read, instead of analysing an empty website', async () => {
    jest
      .spyOn(SiteCrawler.prototype, 'discover')
      .mockRejectedValue(new Error('unavailable'));
    const query = jest.fn().mockResolvedValue([]);
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
    expect(JSON.parse(query.mock.calls[0][1][3]).pages[0].status).toBe(
      'failed',
    );
  });
});
