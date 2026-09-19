import { readFileSync } from 'node:fs';
import { ContentCenterSiteImports1790572800000 } from '../database/migrations/1790572800000-ContentCenterSiteImports';
import { PreparationRequestLabels1790659200000 } from '../database/migrations/1790659200000-PreparationRequestLabels';
import { PreparationReadablePrompts1790745600000 } from '../database/migrations/1790745600000-PreparationReadablePrompts';
import { SiteCrawler, type SitePage } from './site-crawler';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { GlobalPromptLibrary1790486400000 } from '../database/migrations/1790486400000-GlobalPromptLibrary';
import { PlatformPromptsService } from '../platform/platform-prompts.service';
import { AiProviderError } from '../ai/ai-provider.error';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureMaterialBodyParser } from './material-body-parser';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ContentCenterController } from './content-center.controller';
import { MaterialUploadGuard } from './material-upload.guard';
import * as publicMaterial from './public-material';
import { DataSource } from 'typeorm';
import { PlatformRole } from '../database/entities';
import { ContentCenterPreparation1790020800000 } from '../database/migrations/1790020800000-ContentCenterPreparation';
import { ContentCenterSourceFiles1790107200000 } from '../database/migrations/1790107200000-ContentCenterSourceFiles';
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
      await new ContentCenterSourceFiles1790107200000().up(runner);
      await new GlobalPromptLibrary1790486400000().up(runner);
      await new ContentCenterSiteImports1790572800000().up(runner);
      await new PreparationRequestLabels1790659200000().up(runner);
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
      new PreparationAiService({
        name: 'integration-test-only',
        supportsFiles: true,
        generate,
      }),
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
      `TRUNCATE cc_preparation_runs,cc_preparation_versions,cc_preparation_drafts,cc_materials,cc_prompts,platform_prompts`,
    );
    generate.mockReset().mockResolvedValue({
      content: '# Компания\nФакты из тестового источника.',
    });
  });

  it('updates only the legacy starter citation sentence, preserving edits and history', async () => {
    const library = new PlatformPromptsService(db);
    const oldRule =
      'При возможности указывай название материала или предоставленную ссылку, откуда взят факт; не выдумывай источники.';
    const matching = await library.create({
      title: 'Анализ компании',
      content: `Мои изменения. ${oldRule} Мой финал.`,
    });
    await library.create({
      title: 'Анализ лендинга',
      content: 'Полностью мой текст.',
    });
    await library.create({ title: 'Другой промпт', content: oldRule });
    await service.saveDraft(workspace, admin, {
      instruction: oldRule,
      withoutMaterials: true,
      revision: 0,
    });
    await service.start(workspace, admin, {
      instruction: oldRule,
      withoutMaterials: true,
    });
    await service.processNext();
    const before = await service.overview(workspace, admin);
    const beforeHistory = await db.query<unknown[]>(
      'SELECT * FROM cc_preparation_versions',
    );
    const runner = db.createQueryRunner();
    try {
      await new PreparationReadablePrompts1790745600000().up(runner);
      const once = await library.list();
      const updated = once.find((p) => p.id === matching.id)!;
      expect(updated.content).toContain(
        'Мои изменения. В итоговом документе не добавляй ссылки на источники',
      );
      expect(updated.content).toMatch(/Мой финал\.$/);
      expect(updated.revision).toBe(2);
      expect(once.find((p) => p.title === 'Анализ лендинга')!.content).toBe(
        'Полностью мой текст.',
      );
      expect(once.find((p) => p.title === 'Другой промпт')!.content).toBe(
        oldRule,
      );
      await new PreparationReadablePrompts1790745600000().up(runner);
      expect(await library.list()).toEqual(once);
      expect((await service.overview(workspace, admin)).draft).toEqual(
        before.draft,
      );
      expect(await db.query('SELECT * FROM cc_preparation_versions')).toEqual(
        beforeHistory,
      );
    } finally {
      await runner.release();
    }
  });

  it('snapshots request names and instructions through queueing, library edits and restoration', async () => {
    const library = new PlatformPromptsService(db);
    const prompt = await library.create({
      title: 'Анализ компании',
      content: 'Original task',
    });
    const task = {
      instruction: 'Original task with my changes',
      promptTitle: prompt.title,
      withoutMaterials: true,
    };
    await service.saveDraft(workspace, employee, { ...task, revision: 0 });
    expect(
      (await service.overview(workspace, employee)).draft.prompt_title,
    ).toBe(prompt.title);
    await service.start(workspace, employee, task);
    await service.saveDraft(workspace, employee, {
      ...task,
      promptTitle: 'Следующая задача',
      revision: 1,
    });
    await library.update(prompt.id, {
      title: 'New library title',
      content: 'New template',
      revision: 1,
    });
    await library.remove(prompt.id, 2);
    await service.processNext();
    const first = (await service.overview(workspace, employee)).versions[0];
    expect(first.prompt_title).toBe('Анализ компании');
    expect(first).not.toHaveProperty('instruction');
    expect(
      await service.getVersion(workspace, first.id, employee),
    ).toMatchObject({
      prompt_title: 'Анализ компании',
      instruction: task.instruction,
    });
    expect(generate.mock.calls[0][0].instruction).toBe(task.instruction);
    await service.start(workspace, employee, {
      ...task,
      promptTitle: 'Другой запрос',
    });
    await service.processNext();
    const restored = await service.restore(workspace, first.id, employee, 2);
    expect(
      await service.getVersion(workspace, restored.id, employee),
    ).toMatchObject({
      number: 3,
      restored_from: 1,
      prompt_title: 'Анализ компании',
      instruction: task.instruction,
    });
    expect((await service.overview(otherWorkspace, admin)).versions).toEqual(
      [],
    );
    await expect(
      service.getVersion(otherWorkspace, first.id, employee),
    ).rejects.toThrow('недоступно');
    await expect(
      service.getVersion(otherWorkspace, first.id, admin),
    ).rejects.toThrow('не найдена');
  });

  it('allows unnamed requests and preserves draft title concurrency', async () => {
    await service.saveDraft(workspace, employee, {
      instruction: 'Task',
      promptTitle: 'First',
      withoutMaterials: true,
      revision: 0,
    });
    await service.saveDraft(workspace, employee, {
      instruction: 'Task',
      promptTitle: 'Second',
      withoutMaterials: true,
      revision: 1,
    });
    await expect(
      service.saveDraft(workspace, employee, {
        instruction: 'Task',
        promptTitle: 'Stale',
        withoutMaterials: true,
        revision: 1,
      }),
    ).rejects.toThrow('другим сотрудником');
    expect(
      (await service.overview(workspace, employee)).draft.prompt_title,
    ).toBe('Second');
    await service.start(workspace, employee, {
      instruction: 'My task',
      withoutMaterials: true,
    });
    await service.processNext();
    const version = (await service.overview(workspace, employee)).versions[0];
    expect(version.prompt_title).toBe('Свой запрос');
    expect(
      (await service.getVersion(workspace, version.id, employee)).instruction,
    ).toBe('My task');
  });

  it('backfills only unambiguous run and prompt matches without changing legacy results', async () => {
    const runner = db.createQueryRunner();
    const migration = new PreparationRequestLabels1790659200000();
    try {
      await migration.down(runner);
      await db.query(
        `INSERT INTO cc_preparation_versions (workspace_id,number,content,actor_name,reason) VALUES ($1,1,'Legacy result','Employee','Обработка материалов')`,
        [workspace],
      );
      await db.query(
        `INSERT INTO platform_prompts (title,content) VALUES ('Анализ компании','Exact task'),('First title','Ambiguous task'),('Second title','Ambiguous task')`,
      );
      await db.query(
        `INSERT INTO cc_preparation_versions (workspace_id,number,content,actor_name,reason,created_at) VALUES
        ($1,2,'Matched result','Employee','Обработка материалов','2026-09-19T12:00:00Z'),
        ($1,3,'Ambiguous result','Employee','Обработка материалов','2026-09-19T13:00:00Z'),
        ($1,4,'No local run','Employee','Обработка материалов','2026-09-19T14:00:00Z'),
        ($1,5,'Ambiguous runs','Employee','Обработка материалов','2026-09-19T15:00:00Z')`,
        [workspace],
      );
      await db.query(
        `INSERT INTO cc_preparation_runs (workspace_id,status,actor_name,instruction,provider,finished_at) VALUES
        ($1,'succeeded','Employee','Exact task','test','2026-09-19T12:00:00Z'),
        ($1,'succeeded','Employee','Ambiguous task','test','2026-09-19T13:00:00Z'),
        ($2,'succeeded','Employee','Exact task','test','2026-09-19T14:00:00Z'),
        ($1,'succeeded','Employee','Exact task','test','2026-09-19T15:00:00Z'),
        ($1,'succeeded','Employee','Exact task','test','2026-09-19T15:00:00Z')`,
        [workspace, otherWorkspace],
      );
    } finally {
      await migration.up(runner);
      await runner.release();
    }
    const rows = await db.query<
      Array<{
        number: number;
        content: string;
        prompt_title: string | null;
        instruction: string | null;
      }>
    >(
      `SELECT number,content,prompt_title,instruction FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number`,
      [workspace],
    );
    expect(rows).toEqual([
      {
        number: 1,
        content: 'Legacy result',
        prompt_title: null,
        instruction: null,
      },
      {
        number: 2,
        content: 'Matched result',
        prompt_title: 'Анализ компании',
        instruction: 'Exact task',
      },
      {
        number: 3,
        content: 'Ambiguous result',
        prompt_title: null,
        instruction: 'Ambiguous task',
      },
      {
        number: 4,
        content: 'No local run',
        prompt_title: null,
        instruction: null,
      },
      {
        number: 5,
        content: 'Ambiguous runs',
        prompt_title: null,
        instruction: null,
      },
    ]);
  });

  it('shares prompts across workspaces without sharing project data or rewriting copied tasks', async () => {
    const library = new PlatformPromptsService(db);
    const prompt = await library.create({
      title: 'Shared',
      content: 'Original instruction',
    });
    await service.saveDraft(workspace, employee, {
      instruction: prompt.content,
      withoutMaterials: true,
      revision: 0,
    });
    await service.start(workspace, employee, {
      instruction: prompt.content,
      withoutMaterials: true,
    });
    await service.processNext();
    await expect(
      service.createPrompt(workspace, employee, {
        title: 'Local',
        content: 'Private',
      }),
    ).rejects.toThrow('теперь общая');
    await library.update(prompt.id, {
      title: 'Updated',
      content: 'Shared new instruction',
      revision: 1,
    });
    expect((await service.overview(workspace, employee)).prompts).toEqual(
      (await service.overview(otherWorkspace, admin)).prompts,
    );
    expect(
      (await service.overview(workspace, employee)).prompts[0].content,
    ).toBe('Shared new instruction');
    expect(
      (await service.overview(workspace, employee)).draft.instruction,
    ).toBe('Original instruction');
    expect(
      (await service.overview(otherWorkspace, admin)).draft.instruction,
    ).toBe('');
    expect(
      (await service.overview(otherWorkspace, admin)).versions,
    ).toHaveLength(0);
    await expect(
      library.update(prompt.id, {
        title: 'Stale',
        content: 'Lost',
        revision: 1,
      }),
    ).rejects.toThrow('другим администратором');
    await expect(library.remove(prompt.id, 1)).rejects.toThrow(
      'другим администратором',
    );
    await library.remove(prompt.id, 2);
    expect(await library.list()).toEqual([]);
    const runs = await db.query<Array<{ instruction: string; status: string }>>(
      'SELECT instruction,status FROM cc_preparation_runs',
    );
    expect(runs[0].instruction).toBe('Original instruction');
    expect((await service.overview(workspace, employee)).versions).toHaveLength(
      1,
    );
    await expect(library.remove(prompt.id, 2)).rejects.toThrow('уже удалён');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('migrates only exact generic starter texts once; retains private legacy data', async () => {
    const code = readFileSync(
      resolve(__dirname, '../../../../deploy/seed-content-center-prompts.cjs'),
      'utf8',
    );
    const box = {
      module: { exports: {} },
      require: { main: null },
      process: { argv: ['node', 'test'] },
    };
    runInNewContext(code, box);
    const { prompts } = box.module.exports as {
      prompts: Array<{ title: string; content: string }>;
    };
    for (const [index, p] of prompts.entries())
      for (const id of [workspace, otherWorkspace]) {
        await db.query(
          `INSERT INTO cc_prompts (workspace_id,title,content,created_at) VALUES ($1,$2,$3,'2026-09-19 10:00:00+00'::timestamptz - ($4::int * interval '1 second'))`,
          [id, p.title, p.content, index],
        );
      }
    await db.query(
      'INSERT INTO cc_prompts (workspace_id,title,content) VALUES ($1,$2,$3)',
      [workspace, prompts[0].title, 'Private changed client text'],
    );
    await db.query('DROP TABLE platform_prompts');
    const runner = db.createQueryRunner();
    try {
      await new GlobalPromptLibrary1790486400000().up(runner);
    } finally {
      await runner.release();
    }
    const shared = await new PlatformPromptsService(db).list();
    expect(shared.map(({ title, content }) => ({ title, content }))).toEqual(
      prompts,
    );
    expect(
      await db.query('SELECT count(*)::int AS total FROM cc_prompts'),
    ).toEqual([{ total: 13 }]);
    expect(shared.some((p) => p.content.includes('Private changed'))).toBe(
      false,
    );
  });

  it('stores link categories and distinguishes inaccessible pages from extracted content', async () => {
    const read = jest
      .spyOn(publicMaterial, 'readPublicMaterial')
      .mockResolvedValue('Public page text');
    try {
      const dto = {
        kind: 'url' as const,
        title: 'Source',
        sourceUrl: 'https://example.com',
        urlCategory: 'social',
      };
      const { id } = await service.saveMaterial(workspace, admin, dto);
      expect(await service.getMaterial(workspace, id, admin)).toMatchObject({
        url_category: 'social',
        content: 'Public page text',
        source_error: null,
      });
      read.mockRejectedValue(new Error('Page unavailable'));
      await service.saveMaterial(workspace, admin, { ...dto, revision: 1 }, id);
      expect(await service.getMaterial(workspace, id, admin)).toMatchObject({
        url_category: 'social',
        content: '',
      });
      expect(
        (await service.getMaterial(workspace, id, admin)).source_error,
      ).toContain('недоступен');
      await service.start(workspace, admin, {
        instruction: 'Read',
        withoutMaterials: false,
      });
      await service.processNext();
      expect(generate).not.toHaveBeenCalled();
      const state = await service.overview(workspace, admin);
      expect(state.run.status).toBe('failed');
      expect(state.versions).toHaveLength(0);
      await expect(
        service.saveMaterial(workspace, admin, {
          ...dto,
          sourceUrl: 'https://127.0.0.1/private',
        }),
      ).rejects.toThrow();
    } finally {
      read.mockRestore();
    }
  });

  it('accepts multipart uploads and serves authenticated attachment downloads only', async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentCenterController],
      providers: [
        { provide: ContentCenterService, useValue: service },
        MaterialUploadGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<AuthenticatedRequest>().auth =
            employee;
          return true;
        },
      })
      .compile();
    const app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    configureMaterialBodyParser(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    try {
      const http = app.getHttpServer();
      const route = `/api/workspaces/${workspace}/content-center`;
      const longText = 'Информация о проекте.\n'.repeat(10000).trim();
      const upload = await request(http)
        .post(`${route}/files`)
        .attach('file', Buffer.from(longText), 'source.txt')
        .expect(201);
      const id = (upload.body as { id: string }).id;
      const response = await request(http)
        .get(`${route}/materials/${id}/file`)
        .expect(200);
      expect(response.text).toBe(longText);
      expect((await service.getMaterial(workspace, id, employee)).content).toBe(
        longText,
      );
      const manual = await request(http)
        .post(`${route}/materials`)
        .send({ title: 'Длинный текст', kind: 'text', content: longText })
        .expect(201);
      const manualId = (manual.body as { id: string }).id;
      const updatedText = `${longText}\nДополнительные сведения.`;
      await request(http)
        .put(`${route}/materials/${manualId}`)
        .send({
          title: 'Длинный текст',
          kind: 'text',
          content: updatedText,
          revision: 1,
        })
        .expect(200);
      expect(
        (await service.getMaterial(workspace, manualId, employee)).content,
      ).toBe(updatedText);
      await request(http)
        .put(`${route}/draft`)
        .send({ instruction: 'Задача', withoutMaterials: false, revision: 0 })
        .expect(200);
      await request(http)
        .put(`${route}/draft`)
        .send({ instruction: longText, withoutMaterials: false, revision: 1 })
        .expect(413);
      await request(http)
        .post(`${route}/materials`)
        .send({
          title: 'Too large',
          kind: 'text',
          content: 'x'.repeat(10 * 1024 * 1024),
        })
        .expect(413);
      const run = await service.start(workspace, employee, {
        instruction: 'Обработай материалы',
        withoutMaterials: false,
      });
      const [queued] = await db.query<
        Array<{ input_context: { materials: Array<{ content: string }> } }>
      >('SELECT input_context FROM cc_preparation_runs WHERE id=$1', [run.id]);
      expect(queued.input_context.materials.map((m) => m.content)).toEqual([
        longText,
        updatedText,
      ]);
      expect(response.headers['content-disposition']).toContain('attachment;');
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      await request(http)
        .post(`/api/workspaces/${otherWorkspace}/content-center/files`)
        .attach('file', Buffer.from('Secret'), 'source.txt')
        .expect(404);
      await request(http)
        .get(
          `/api/workspaces/${otherWorkspace}/content-center/materials/${id}/file`,
        )
        .expect(404);
      await request(http)
        .post(`${route}/files`)
        .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.txt')
        .expect(413);
    } finally {
      await app.close();
    }
  });

  it('stores private originals, returns safe metadata and enforces workspace access', async () => {
    const buffer = Buffer.from('%PDF-1.7\nTest document');
    const { id } = await service.uploadFile(workspace, employee, {
      originalname: 'Бриф.pdf',
      buffer,
    });
    const material = await service.getMaterial(workspace, id, employee);
    expect(material).toMatchObject({
      file_name: 'Бриф.pdf',
      file_size: buffer.length,
      has_original: true,
      media_type: 'application/pdf',
      content: '',
    });
    expect(material).not.toHaveProperty('file_data');
    const overview = await service.overview(workspace, employee);
    expect(overview.materials[0]).not.toHaveProperty('file_data');
    expect(overview.materials[0]).not.toHaveProperty('content');
    expect(
      (await service.getFile(workspace, id, employee)).data.equals(buffer),
    ).toBe(true);
    await expect(service.getFile(otherWorkspace, id, admin)).rejects.toThrow(
      'не найден',
    );
    await expect(service.getFile(otherWorkspace, id, employee)).rejects.toThrow(
      'недоступно',
    );
    await expect(
      service.uploadFile(otherWorkspace, employee, {
        originalname: 'Бриф.pdf',
        buffer,
      }),
    ).rejects.toThrow('недоступно');
    await expect(
      service.saveMaterial(
        workspace,
        employee,
        { title: 'Overwrite', kind: 'text', content: 'changed', revision: 1 },
        id,
      ),
    ).rejects.toThrow('оригинал');
  });

  it('keeps original bytes in the queued snapshot when a source is removed', async () => {
    const buffer = Buffer.from('%PDF-1.7\nOriginal');
    const { id } = await service.uploadFile(workspace, admin, {
      originalname: 'source.pdf',
      buffer,
    });
    await service.start(workspace, admin, {
      instruction: 'Read source',
      withoutMaterials: false,
    });
    await service.deleteMaterial(workspace, id, 1, admin);
    await service.processNext();
    expect(generate.mock.calls[0][0].context.files).toEqual([
      {
        fileName: 'source.pdf',
        mediaType: 'application/pdf',
        dataBase64: buffer.toString('base64'),
      },
    ]);
    expect((await service.overview(workspace, admin)).versions).toHaveLength(1);
    await expect(service.getFile(workspace, id, admin)).rejects.toThrow(
      'не найден',
    );
  });

  it('extracts UTF-8 text and refuses to silently drop binary attachments', async () => {
    await service.uploadFile(workspace, admin, {
      originalname: 'notes.txt',
      buffer: Buffer.from('Информация клиента'),
    });
    const textOnly = new ContentCenterService(
      db,
      new PreparationAiService({ name: 'text-only', generate }),
    );
    await textOnly.start(workspace, admin, {
      instruction: 'Read',
      withoutMaterials: false,
    });
    await textOnly.processNext();
    expect(generate.mock.calls[0][0].context.materials[0].content).toBe(
      'Информация клиента',
    );
    expect(generate.mock.calls[0][0].context.files).toBeUndefined();
    await service.uploadFile(workspace, admin, {
      originalname: 'image.jpg',
      buffer: Buffer.from([255, 216, 255, 0]),
    });
    await expect(
      textOnly.start(workspace, admin, {
        instruction: 'Read',
        withoutMaterials: false,
      }),
    ).rejects.toThrow('не умеет');
  });

  it('accepts parallel uploads above 50 MB total and preserves their original bytes', async () => {
    const buffer = Buffer.alloc(10 * 1024 * 1024);
    buffer.write('%PDF-');
    for (let i = 0; i < 4; i++)
      await service.uploadFile(workspace, admin, {
        originalname: `file-${i}.pdf`,
        buffer,
      });
    const attempts = await Promise.allSettled(
      [1, 2].map((i) =>
        service.uploadFile(workspace, admin, {
          originalname: `extra-${i}.pdf`,
          buffer,
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(0);
    const { materials } = await service.overview(workspace, admin);
    expect(materials).toHaveLength(6);
    expect(
      materials.reduce((sum, material) => sum + Number(material.file_size), 0),
    ).toBe(60 * 1024 * 1024);
    expect(
      (await service.getFile(workspace, materials[0].id, admin)).data.equals(
        buffer,
      ),
    ).toBe(true);
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
    await new PlatformPromptsService(db).create({
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

  it('collects a website on launch, keeps archived sources after edits and preserves them on restore', async () => {
    const page: SitePage = {
      url: 'https://example.com/about',
      title: 'Компания',
      group: 'О компании',
      recommended: true,
      status: 'loaded',
      content: 'Факты о компании из второй страницы',
    };
    const discover = jest
      .spyOn(SiteCrawler.prototype, 'discover')
      .mockResolvedValue({
        root: 'https://example.com/',
        pages: [page],
        warnings: [],
      });
    const collect = jest
      .spyOn(SiteCrawler.prototype, 'collect')
      .mockImplementation(async () => {
        await service.saveMaterial(
          workspace,
          admin,
          {
            kind: 'url',
            title: 'Другой сайт',
            sourceUrl: 'https://other.example.com/',
            urlCategory: 'site',
            revision: 1,
          },
          material.id,
        );
        return [page];
      });
    const material = await service.saveMaterial(workspace, admin, {
      kind: 'url',
      title: 'Компания',
      sourceUrl: 'https://example.com/',
      urlCategory: 'site',
    });
    try {
      expect(discover).not.toHaveBeenCalled();
      await service.start(workspace, admin, {
        instruction: 'Проанализируй компанию',
        withoutMaterials: false,
      });
      await service.processNext();
      const state = await service.overview(workspace, admin);
      expect(state.run.status).toBe('succeeded');
      expect(
        (await service.getMaterial(workspace, material.id, admin)).site_pages,
      ).toBeNull();
      const version = await service.getVersion(
        workspace,
        state.versions[0].id,
        admin,
      );
      expect(version.sources?.[0].sourceUrl).toBe('https://example.com/');
      expect(version.sources?.[0].pages[0].content).toContain(
        'второй страницы',
      );
      await service.deleteMaterial(workspace, material.id, 2, admin);
      await expect(
        service.getVersion(otherWorkspace, version.id, employee),
      ).rejects.toThrow();
      await service.start(workspace, admin, {
        instruction: 'Новое сообщение без источников',
        withoutMaterials: true,
      });
      await service.processNext();
      const restored = await service.restore(workspace, version.id, admin, 2);
      expect(
        (await service.getVersion(workspace, restored.id, admin)).sources,
      ).toEqual(version.sources);
    } finally {
      discover.mockRestore();
      collect.mockRestore();
    }
  });

  it('uses only the message after the last material is deleted, without old result facts', async () => {
    const material = await service.saveMaterial(workspace, admin, {
      kind: 'text',
      title: 'Старые факты',
      content: 'Не включать в следующий запуск',
    });
    await service.start(workspace, admin, {
      instruction: 'Первый документ',
      withoutMaterials: false,
    });
    await service.processNext();
    const first = (await service.overview(workspace, admin)).versions[0];
    await service.deleteMaterial(workspace, material.id, 1, admin);
    expect(
      (await service.getVersion(workspace, first.id, admin)).content,
    ).toContain('Факты из тестового');

    await service.start(workspace, admin, {
      instruction: 'Используй только это сообщение',
      withoutMaterials: true,
    });
    await service.processNext();
    expect(generate.mock.calls[1][0].instruction).toBe(
      'Используй только это сообщение',
    );
    expect(generate.mock.calls[1][0].context).toEqual({
      materials: [],
      previousResult: null,
    });
    expect((await service.overview(workspace, admin)).versions).toHaveLength(2);
    expect(
      (await service.getVersion(workspace, first.id, admin)).content,
    ).toContain('Факты из тестового');
  });

  it.each([
    'Недостаточно средств на аккаунте DeepSeek.',
    'DeepSeek отклонил ключ. Замените его в настройках.',
    'DeepSeek не ответил вовремя. Результат не сохранён.',
    'DeepSeek вернул неполный или некорректный результат. Текущая версия не изменена.',
  ])(
    'persists trusted provider failure without retrying or changing the saved result: %s',
    async (message) => {
      await service.start(workspace, admin, {
        instruction: 'First',
        withoutMaterials: true,
      });
      await service.processNext();
      const previous = (await service.overview(workspace, admin)).versions[0];
      generate.mockRejectedValue(new AiProviderError(message));
      const failed = await service.start(workspace, admin, {
        instruction: 'Retry',
        withoutMaterials: true,
      });
      await service.processNext();
      await service.processNext();
      const state = await service.overview(workspace, employee);
      expect(state.run.status).toBe('failed');
      expect(state.run.error).toBe(message);
      expect(state.versions).toHaveLength(1);
      expect(state.versions[0].id).toBe(previous.id);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(
        await db.query(
          'SELECT input_context FROM cc_preparation_runs WHERE id=$1',
          [failed.id],
        ),
      ).toEqual([{ input_context: null }]);
    },
  );

  it('keeps the saved version when verification fails after extraction succeeded', async () => {
    await service.start(workspace, admin, {
      instruction: 'Первый результат',
      withoutMaterials: true,
    });
    await service.processNext();
    const previous = (await service.overview(workspace, admin)).versions[0];
    for (let index = 0; index < 3; index++)
      await service.saveMaterial(workspace, admin, {
        kind: 'text',
        title: `Исходник ${index}`,
        content: 'Исходные факты.\n'.repeat(2400),
      });
    generate.mockImplementation((request) =>
      request.instruction.startsWith('Сверь черновой реестр')
        ? Promise.reject(
            new AiProviderError('Сверка недоступна. Новая версия не создана.'),
          )
        : Promise.resolve({ content: 'Черновой реестр фактов' }),
    );
    const run = await service.start(workspace, admin, {
      instruction: 'Собери новый результат',
      withoutMaterials: false,
    });
    await service.processNext();
    const state = await service.overview(workspace, admin);
    expect(state.run.status).toBe('failed');
    expect(state.run.error).toContain('Сверка недоступна');
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0].id).toBe(previous.id);
    expect(
      generate.mock.calls
        .slice(1)
        .every(([r]) =>
          /^(Подготовь реестр фактов|Сверь черновой реестр)/.test(
            r.instruction,
          ),
        ),
    ).toBe(true);
    expect(
      await db.query(
        'SELECT input_context FROM cc_preparation_runs WHERE id=$1',
        [run.id],
      ),
    ).toEqual([{ input_context: null }]);
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
