import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { PlatformRole } from '../database/entities';
import { ContentCenterPreparation1790020800000 } from '../database/migrations/1790020800000-ContentCenterPreparation';
import { ContentCenterResearch1790193600000 } from '../database/migrations/1790193600000-ContentCenterResearch';
import { ContentCenterSourceFiles1790107200000 } from '../database/migrations/1790107200000-ContentCenterSourceFiles';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import { ResearchService } from './research.service';
import { ResearchSearchService } from './research-search.service';
import type { ResearchSearchProvider } from './research-search.service';
import type { ResearchDraftDto } from './research.dto';

const url = process.env.CONTENT_CENTER_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Research / isolated PostgreSQL', () => {
  const schema = `research_test_${randomUUID().replaceAll('-', '')}`;
  const workspace = randomUUID();
  const other = randomUUID();
  const admin = {
    userId: randomUUID(),
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const employee = {
    userId: randomUUID(),
    platformRole: PlatformRole.EMPLOYEE,
  };
  let root: DataSource;
  let db: DataSource;
  let access: ContentCenterService;
  let service: ResearchService;
  const search = jest.fn<
    ReturnType<ResearchSearchProvider['search']>,
    Parameters<ResearchSearchProvider['search']>
  >();
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      !parsed.pathname.endsWith('_tests')
    )
      throw new Error('Use dedicated local _tests database');
    root = await new DataSource({ type: 'postgres', url }).initialize();
    await root.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    await db.query(
      'CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY,full_name varchar(160),is_active boolean); CREATE TABLE workspace_memberships(workspace_id uuid,user_id uuid);',
    );
    const runner = db.createQueryRunner();
    try {
      await new ContentCenterPreparation1790020800000().up(runner);
      await new ContentCenterSourceFiles1790107200000().up(runner);
      await new ContentCenterResearch1790193600000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query('INSERT INTO workspaces VALUES ($1),($2)', [
      workspace,
      other,
    ]);
    await db.query(
      "INSERT INTO users VALUES ($1,'Admin',true),($2,'Employee',true)",
      [admin.userId, employee.userId],
    );
    await db.query('INSERT INTO workspace_memberships VALUES ($1,$2)', [
      workspace,
      employee.userId,
    ]);
    access = new ContentCenterService(db, new PreparationAiService());
    service = new ResearchService(
      db,
      access,
      new ResearchSearchService({ search }),
    );
  });
  afterAll(async () => {
    await db?.destroy();
    if (root?.isInitialized) {
      await root.query(`DROP SCHEMA "${schema}" CASCADE`);
      await root.destroy();
    }
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE cc_research_confirmations,cc_research_drafts,cc_research_search_locks,cc_preparation_versions,cc_materials',
    );
    search.mockReset().mockResolvedValue([]);
  });
  const draft = (): ResearchDraftDto => ({
    revision: 0,
    contextKind: 'conclusions',
    direction: 'Натуральная косметика',
    categories: [
      { id: 'direct', name: 'Конкуренты', enabled: true },
      { id: 'custom', name: 'Экспертные блоги', enabled: false },
    ],
    sources: [
      {
        id: randomUUID(),
        name: 'Source',
        url: 'https://example.com',
        categoryId: 'custom',
        included: true,
        description: 'Обзор продукции',
      },
    ],
  });
  const version = async (number = 1) => {
    const [row] = await db.query<Array<{ id: string }>>(
      "INSERT INTO cc_preparation_versions(workspace_id,number,content,actor_name,reason) VALUES ($1,$2,'Prepared project facts','Admin','Processing') RETURNING id",
      [workspace, number],
    );
    return row.id;
  };

  it('persists categories and manual sources without prepared materials', async () => {
    expect(
      (await service.overview(workspace, employee)).draft.contextKind,
    ).toBe('conclusions');
    const saved = await service.save(workspace, employee, draft());
    expect(saved.revision).toBe(1);
    expect((await service.overview(workspace, employee)).draft).toEqual(saved);
    expect(saved.sources[0].url).toBe('https://example.com/');
    const dto = { revision: 1, preparationVersionId: null };
    const confirmation = await service.confirm(workspace, employee, dto);
    expect(await service.confirm(workspace, employee, dto)).toEqual(
      confirmation,
    );
    expect(
      await service.confirmation(workspace, employee, confirmation.id),
    ).toMatchObject({
      context_kind: 'none',
      context_text: null,
      sources: saved.sources,
    });
  });
  it('rejects foreign workspace access and confirmation IDs', async () => {
    await expect(service.overview(other, employee)).rejects.toThrow(
      'недоступно',
    );
    await expect(service.save(other, employee, draft())).rejects.toThrow(
      'недоступно',
    );
    await expect(
      service.search(other, employee, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('недоступно');
    await service.save(other, admin, draft());
    const row = await service.confirm(other, admin, {
      revision: 1,
      preparationVersionId: null,
    });
    await expect(
      service.confirmation(workspace, employee, row.id),
    ).rejects.toThrow('не найден');
    await expect(
      service.confirm(other, employee, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('недоступно');
  });
  it('rejects stale edits and preserves immutable confirmed category membership', async () => {
    const saved = await service.save(workspace, employee, draft());
    const row = await service.confirm(workspace, employee, {
      revision: 1,
      preparationVersionId: null,
    });
    await service.save(workspace, employee, {
      ...saved,
      categories: [{ id: 'direct', name: 'Changed category', enabled: true }],
      sources: [],
    });
    await expect(service.save(workspace, admin, saved)).rejects.toThrow(
      'изменились',
    );
    await expect(
      service.confirm(workspace, admin, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('изменились');
    const fixed = await service.confirmation(workspace, employee, row.id);
    expect(fixed.sources).toHaveLength(1);
    expect(fixed.categories[1].name).toBe('Экспертные блоги');
  });
  it('confirms only included sources and refuses an empty or undefined research direction', async () => {
    const initial = draft();
    initial.sources.push({
      ...initial.sources[0],
      id: randomUUID(),
      url: 'https://example.org',
      included: false,
    });
    let saved = await service.save(workspace, employee, initial);
    const result = await service.confirm(workspace, employee, {
      revision: saved.revision,
      preparationVersionId: null,
    });
    expect(
      (await service.confirmation(workspace, employee, result.id)).sources,
    ).toHaveLength(1);
    saved = await service.save(workspace, employee, {
      ...saved,
      sources: saved.sources.map((s) => ({ ...s, included: false })),
    });
    await expect(
      service.confirm(workspace, employee, {
        revision: saved.revision,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('хотя бы один');
    saved = await service.save(workspace, employee, {
      ...saved,
      direction: '',
    });
    await expect(
      service.confirm(workspace, employee, {
        revision: saved.revision,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('направление');
  });
  it('does not substitute full text for conclusions and checks the selected prepared version', async () => {
    const preparedId = await version();
    const saved = await service.save(workspace, employee, draft());
    await expect(
      service.confirm(workspace, employee, {
        revision: 1,
        preparationVersionId: preparedId,
      }),
    ).rejects.toThrow('выводы');
    await service.save(workspace, employee, {
      ...saved,
      contextKind: 'full',
    });
    await expect(
      service.confirm(workspace, employee, {
        revision: 2,
        preparationVersionId: randomUUID(),
      }),
    ).rejects.toThrow('новая версия');
    const first = await service.confirm(workspace, employee, {
      revision: 2,
      preparationVersionId: preparedId,
    });
    const nextId = await version(2);
    await expect(
      service.confirm(workspace, employee, {
        revision: 2,
        preparationVersionId: preparedId,
      }),
    ).rejects.toThrow('новая версия');
    const second = await service.confirm(workspace, employee, {
      revision: 2,
      preparationVersionId: nextId,
    });
    expect(second.id).not.toBe(first.id);
    expect(
      (await service.confirmation(workspace, employee, first.id))
        .preparation_version_id,
    ).toBe(preparedId);
  });
  it('validates source URLs, duplicate categories, references and input limits', async () => {
    const state = draft();
    await expect(
      service.save(workspace, employee, {
        ...state,
        sources: [{ ...state.sources[0], url: 'javascript:alert(1)' }],
      }),
    ).rejects.toThrow();
    await expect(
      service.save(workspace, employee, {
        ...state,
        sources: [{ ...state.sources[0], url: 'https://127.0.0.1' }],
      }),
    ).rejects.toThrow();
    await expect(
      service.save(workspace, employee, {
        ...state,
        sources: [state.sources[0], { ...state.sources[0], id: randomUUID() }],
      }),
    ).rejects.toThrow('адрес уже');
    await expect(
      service.save(workspace, employee, {
        ...state,
        sources: [{ ...state.sources[0], categoryId: 'missing' }],
      }),
    ).rejects.toThrow('категорию');
    await expect(
      service.save(workspace, employee, {
        ...state,
        categories: [
          state.categories[0],
          { ...state.categories[0], id: 'duplicate' },
        ],
      }),
    ).rejects.toThrow('не должны повторяться');
    await expect(
      service.save(workspace, employee, {
        ...state,
        direction: 'x'.repeat(8001),
      }),
    ).rejects.toThrow();
  });
  it('passes only prepared context to real search and preserves manual choices', async () => {
    const preparedId = await version();
    await access.saveMaterial(workspace, employee, {
      kind: 'text',
      title: 'Not prepared',
      content: 'RAW SECRET MUST NOT ENTER SEARCH',
    });
    const saved = await service.save(workspace, employee, {
      ...draft(),
      contextKind: 'full',
    });
    search.mockResolvedValue([
      {
        name: 'Found',
        url: 'https://example.org',
        categoryId: 'direct',
        description: 'Relevant',
      },
    ]);
    const result = await service.search(workspace, employee, {
      revision: saved.revision,
      preparationVersionId: preparedId,
    });
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual(saved.sources[0]);
    expect(JSON.stringify(search.mock.calls[0][0])).not.toContain('RAW SECRET');
    expect(search.mock.calls[0][0].context?.content).toBe(
      'Prepared project facts',
    );
    expect(search.mock.calls[0][0].categories).toHaveLength(1);
  });
  it('preserves saved sources on provider failure and with a disconnected provider', async () => {
    const saved = await service.save(workspace, employee, draft());
    const disconnected = new ResearchService(
      db,
      access,
      new ResearchSearchService(),
    );
    await expect(
      disconnected.search(workspace, employee, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('не подключён');
    search.mockRejectedValue(new Error('secret provider details'));
    await expect(
      service.search(workspace, employee, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('Поиск не завершён');
    expect((await service.overview(workspace, employee)).draft).toEqual(saved);
    expect(
      await db.query('SELECT token FROM cc_research_search_locks'),
    ).toHaveLength(0);
  });
  it('prevents concurrent searches and does not overwrite edits made during a search', async () => {
    const saved = await service.save(workspace, employee, draft());
    let finish!: (
      value: Awaited<ReturnType<ResearchSearchProvider['search']>>,
    ) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    search.mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = service.search(workspace, employee, {
      revision: 1,
      preparationVersionId: null,
    });
    await started;
    await expect(
      service.search(workspace, employee, {
        revision: 1,
        preparationVersionId: null,
      }),
    ).rejects.toThrow('уже выполняется');
    await service.save(workspace, employee, {
      ...saved,
      direction: 'Manual change',
    });
    finish([
      {
        name: 'Found',
        url: 'https://example.org',
        categoryId: 'direct',
        description: '',
      },
    ]);
    await expect(pending).rejects.toThrow('изменились');
    expect((await service.overview(workspace, employee)).draft.direction).toBe(
      'Manual change',
    );
  });
});
