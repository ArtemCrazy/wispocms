import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { PlatformRole } from '../database/entities';
import { ContentCenterPreparation1790020800000 } from '../database/migrations/1790020800000-ContentCenterPreparation';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import type { PreparationProvider } from './preparation-ai.service';

// This suite uses real PostgreSQL, including transaction locks and SKIP LOCKED.
const url = process.env.CONTENT_CENTER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('Content Center / isolated PostgreSQL', () => {
  const schema = `cc_test_${randomUUID().replaceAll('-', '')}`;
  let root: DataSource;
  let db: DataSource;
  let service: ContentCenterService;
  const generate = jest.fn<
    ReturnType<PreparationProvider['generate']>,
    Parameters<PreparationProvider['generate']>
  >();
  const admin = {
    userId: randomUUID(),
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const employee = {
    userId: randomUUID(),
    platformRole: PlatformRole.EMPLOYEE,
  };
  const workspace = randomUUID();
  const otherWorkspace = randomUUID();

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      !parsed.pathname.endsWith('_tests')
    )
      throw new Error('Use a dedicated local database ending in _tests');
    root = new DataSource({ type: 'postgres', url });
    await root.initialize();
    await root.query(`CREATE SCHEMA "${schema}"`);
    db = new DataSource({
      type: 'postgres',
      url,
      extra: { options: `-c search_path=${schema}` },
    });
    await db.initialize();
    await db.query(
      `CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY, full_name varchar(160), is_active boolean); CREATE TABLE workspace_memberships(workspace_id uuid,user_id uuid);`,
    );
    const runner = db.createQueryRunner();
    try {
      await new ContentCenterPreparation1790020800000().up(runner);
    } finally {
      await runner.release();
    }
    await db.query(`INSERT INTO workspaces VALUES ($1),($2)`, [
      workspace,
      otherWorkspace,
    ]);
    await db.query(
      `INSERT INTO users VALUES ($1,'Администратор',true),($2,'Сотрудник',true)`,
      [admin.userId, employee.userId],
    );
    await db.query(`INSERT INTO workspace_memberships VALUES ($1,$2)`, [
      workspace,
      employee.userId,
    ]);
    service = new ContentCenterService(
      db,
      new PreparationAiService({ name: 'integration-test-only', generate }),
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
      `TRUNCATE cc_preparation_runs,cc_preparation_versions,cc_preparation_drafts,cc_materials,cc_prompts`,
    );
    generate.mockReset().mockResolvedValue({
      content: '# Компания\nФакты из тестового источника.',
    });
  });

  it('isolates overview, source, prompt, draft, version and run access by workspace', async () => {
    await expect(service.overview(otherWorkspace, employee)).rejects.toThrow(
      'недоступно',
    );
    await expect(
      service.saveMaterial(otherWorkspace, employee, {
        kind: 'text',
        title: 'Secret',
        content: 'data',
      }),
    ).rejects.toThrow('недоступно');
    await expect(
      service.createPrompt(otherWorkspace, employee, {
        title: 'Prompt',
        content: 'Task',
      }),
    ).rejects.toThrow('недоступно');
    await expect(
      service.saveDraft(otherWorkspace, employee, {
        instruction: '',
        withoutMaterials: true,
        revision: 0,
      }),
    ).rejects.toThrow('недоступно');
    await expect(
      service.start(otherWorkspace, employee, {
        instruction: 'Read',
        withoutMaterials: true,
      }),
    ).rejects.toThrow('недоступно');
    const m = await service.saveMaterial(otherWorkspace, admin, {
      kind: 'text',
      title: 'Secret',
      content: 'data',
    });
    await expect(
      service.getMaterial(workspace, m.id, employee),
    ).rejects.toThrow('не найден');
    await expect(
      service.getVersion(otherWorkspace, randomUUID(), employee),
    ).rejects.toThrow('недоступно');
    await expect(
      service.restore(otherWorkspace, randomUUID(), employee, 1),
    ).rejects.toThrow('недоступно');
    expect(
      (await service.overview(workspace, employee)).materials,
    ).toHaveLength(0);
  });

  it('rejects stale material edits and deletion by another editor', async () => {
    const m = await service.saveMaterial(workspace, admin, {
      kind: 'text',
      title: 'A',
      content: 'old',
    });
    const changed = {
      kind: 'text' as const,
      title: 'A',
      content: 'new',
      revision: 1,
    };
    await service.saveMaterial(workspace, employee, changed, m.id);
    await expect(
      service.saveMaterial(workspace, admin, changed, m.id),
    ).rejects.toThrow('другим сотрудником');
    await expect(
      service.deleteMaterial(workspace, m.id, 1, admin),
    ).rejects.toThrow('изменён');
    expect((await service.getMaterial(workspace, m.id, admin)).content).toBe(
      'new',
    );
    await service.deleteMaterial(workspace, m.id, 2, admin);
    await expect(service.getMaterial(workspace, m.id, admin)).rejects.toThrow(
      'не найден',
    );
  });

  it('persists draft and prompts without connecting any API and protects draft revisions', async () => {
    const offline = new ContentCenterService(db, new PreparationAiService());
    await offline.createPrompt(workspace, admin, {
      title: 'Бриф',
      content: 'Подготовь бриф',
    });
    expect(
      await offline.saveDraft(workspace, admin, {
        instruction: 'Уточнённая задача',
        withoutMaterials: true,
        revision: 0,
      }),
    ).toEqual({ revision: 1 });
    await expect(
      offline.saveDraft(workspace, employee, {
        instruction: 'stale',
        withoutMaterials: true,
        revision: 0,
      }),
    ).rejects.toThrow('другим сотрудником');
    expect(
      await offline.saveDraft(workspace, employee, {
        instruction: 'Новая задача',
        withoutMaterials: true,
        revision: 1,
      }),
    ).toEqual({ revision: 2 });
    const state = await offline.overview(workspace, admin);
    expect(state.prompts[0].content).toBe('Подготовь бриф');
    expect(state.draft.instruction).toBe('Новая задача');
    expect(state.ai.connected).toBe(false);
    await expect(
      offline.start(workspace, admin, {
        instruction: 'Task',
        withoutMaterials: true,
      }),
    ).rejects.toThrow('не подключён');
    expect((await offline.overview(workspace, admin)).run).toBeNull();
  });

  it('requires explicit no-materials choice and prevents duplicate concurrent launches', async () => {
    await expect(
      service.start(workspace, admin, {
        instruction: 'Task',
        withoutMaterials: false,
      }),
    ).rejects.toThrow('Добавьте материалы');
    const results = await Promise.allSettled([
      service.start(workspace, admin, {
        instruction: 'Task',
        withoutMaterials: true,
      }),
      service.start(workspace, employee, {
        instruction: 'Task',
        withoutMaterials: true,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('uses launch-time inputs, creates immutable versions and clears temporary context', async () => {
    const m = await service.saveMaterial(workspace, admin, {
      kind: 'text',
      title: 'Факты',
      content: 'До запуска',
    });
    await service.start(workspace, employee, {
      instruction: 'Документ',
      withoutMaterials: false,
    });
    await service.saveMaterial(
      workspace,
      admin,
      { kind: 'text', title: 'Факты', content: 'После запуска', revision: 1 },
      m.id,
    );
    await service.processNext();
    expect(generate.mock.calls[0][0].context.materials[0].content).toBe(
      'До запуска',
    );
    const first = await service.overview(workspace, admin);
    expect(first.run.status).toBe('succeeded');
    expect(first.versions[0].number).toBe(1);
    expect(first.versions[0].actor_name).toBe('Сотрудник');
    expect(
      (
        await db.query<Array<{ input_context: unknown }>>(
          `SELECT input_context FROM cc_preparation_runs`,
        )
      )[0].input_context,
    ).toBeNull();
    generate.mockResolvedValue({ content: '# V2\nНовые сведения' });
    await service.start(workspace, admin, {
      instruction: 'Обнови',
      withoutMaterials: false,
    });
    await service.processNext();
    expect(generate.mock.calls[1][0].context.materials[0].content).toBe(
      'После запуска',
    );
    expect(
      (await service.getVersion(workspace, first.versions[0].id, admin))
        .content,
    ).toContain('Факты из тестового');
    const restored = await service.restore(
      workspace,
      first.versions[0].id,
      employee,
      2,
    );
    expect(restored.number).toBe(3);
    expect(
      (await service.getVersion(workspace, restored.id, admin)).content,
    ).toContain('Факты из тестового');
    await expect(
      service.restore(workspace, first.versions[0].id, employee, 2),
    ).rejects.toThrow('Появилась новая версия');
  });

  it('keeps the last result on failure and recovers abandoned jobs', async () => {
    await service.start(workspace, admin, {
      instruction: 'Task',
      withoutMaterials: true,
    });
    await service.processNext();
    generate.mockRejectedValue(
      new Error('Secret provider token must not be returned'),
    );
    await service.start(workspace, admin, {
      instruction: 'Again',
      withoutMaterials: true,
    });
    await service.processNext();
    const state = await service.overview(workspace, admin);
    expect(state.versions).toHaveLength(1);
    expect(state.run.status).toBe('failed');
    expect(state.run.error).not.toContain('Secret');
    await service.start(workspace, admin, {
      instruction: 'Retry',
      withoutMaterials: true,
    });
    await db.query(
      `UPDATE cc_preparation_runs SET status='processing',started_at=now()-interval '10 minutes' WHERE status='queued'`,
    );
    await service.processNext();
    expect((await service.overview(workspace, admin)).run.status).toBe(
      'failed',
    );
    expect((await service.overview(workspace, admin)).versions).toHaveLength(1);
    const queued = await service.start(workspace, admin, {
      instruction: 'Queued before disconnect',
      withoutMaterials: true,
    });
    await db.query(
      `UPDATE cc_preparation_runs SET created_at=now()-interval '31 minutes' WHERE status='queued'`,
    );
    await new ContentCenterService(
      db,
      new PreparationAiService(),
    ).processNext();
    const recovered = await service.overview(workspace, admin);
    const [expired] = await db.query<Array<{ status: string; error: string }>>(
      `SELECT status,error FROM cc_preparation_runs WHERE id=$1`,
      [queued.id],
    );
    expect(expired.status).toBe('failed');
    expect(expired.error).toContain('время ожидания');
    expect(recovered.versions).toHaveLength(1);
  });

  it('allows only one worker to claim a queued job', async () => {
    await service.start(workspace, admin, {
      instruction: 'Task',
      withoutMaterials: true,
    });
    const second = new ContentCenterService(
      db,
      new PreparationAiService({ name: 'integration-test-only', generate }),
    );
    await Promise.all([service.processNext(), second.processNext()]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.overview(workspace, admin)).versions).toHaveLength(1);
  });
});
