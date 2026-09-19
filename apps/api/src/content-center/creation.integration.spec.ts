import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  ArticleEntity,
  ArticleRelatedItemEntity,
  ArticleSectionSettingsEntity,
  ArticleVersionEntity,
  CategoryEntity,
  ContentEventEntity,
  ContentStatusScheduleEntity,
  SiteContentTemplateEntity,
  SiteEntity,
  WorkspaceMembershipEntity,
  PlatformRole,
  databaseEntities,
} from '../database/entities';
import { ContentLifecycleService } from '../content/content-lifecycle.service';
import { ContentCenterPreparation1790020800000 } from '../database/migrations/1790020800000-ContentCenterPreparation';
import { ContentCenterCreation1790280000000 } from '../database/migrations/1790280000000-ContentCenterCreation';
import { CreationPublicationTargets1790340000000 } from '../database/migrations/1790340000000-CreationPublicationTargets';
import { containsCorrectionFragment } from './creation-model';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import { CreationService } from './creation.service';
import { CreationRunsService } from './creation-runs.service';
import { CreationAiService } from './creation-ai.service';
import type { CreationProvider } from './creation-ai.service';
import { CreationPublicationService } from './creation-publication.service';
import type { ClusterDto } from './creation.dto';
import type {
  CreatedArticle,
  CreationRunRow,
  CreationSnapshot,
} from './creation-model';

const url = process.env.CONTENT_CENTER_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Content creation / isolated PostgreSQL',
  () => {
    const schema = `creation_test_${randomUUID().replaceAll('-', '')}`;
    const workspace = randomUUID(),
      other = randomUUID(),
      site = randomUUID(),
      site2 = randomUUID(),
      foreignSite = randomUUID(),
      category = randomUUID(),
      category2 = randomUUID();
    const actor = { userId: randomUUID(), platformRole: PlatformRole.EMPLOYEE };
    let root: DataSource,
      db: DataSource,
      service: CreationService,
      runs: CreationRunsService,
      publication: CreationPublicationService;
    const produce = jest.fn<
      ReturnType<CreationProvider['produce']>,
      Parameters<CreationProvider['produce']>
    >();
    const snapshot = (): CreationSnapshot => ({
      title: 'Первая статья',
      excerpt: 'Описание',
      document: {
        version: 1,
        blocks: [
          { id: 'intro', type: 'paragraph', text: 'Первый текст' },
          { id: 'body', type: 'paragraph', text: 'Основной текст' },
        ],
      },
    });
    const clusterDto = (text = 'Уход за кожей'): ClusterDto => ({
      revision: 0,
      direction: 'Уход',
      archived: false,
      queries: [{ text, general: 100, exact: 20, primary: true }],
    });
    beforeAll(async () => {
      const parsed = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        !parsed.pathname.endsWith('_tests')
      )
        throw new Error('Use isolated local test database');
      root = await new DataSource({ type: 'postgres', url }).initialize();
      await root.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        type: 'postgres',
        url,
        schema,
        entities: databaseEntities,
        synchronize: true,
        extra: { options: `-c search_path=${schema},public` },
      }).initialize();
      const q = db.createQueryRunner();
      try {
        await new ContentCenterPreparation1790020800000().up(q);
        await new ContentCenterCreation1790280000000().up(q);
        await new CreationPublicationTargets1790340000000().up(q);
      } finally {
        await q.release();
      }
      await db.query(
        "INSERT INTO users(id,email,password_hash,full_name,platform_role) VALUES($1,'creation-test@example.test','not-a-login-hash','Editor','employee')",
        [actor.userId],
      );
      await db.query(
        "INSERT INTO workspaces(id,name,slug) VALUES($1,'Test','creation-test'),($2,'Other','creation-other')",
        [workspace, other],
      );
      await db.query(
        "INSERT INTO workspace_memberships(user_id,workspace_id,role) VALUES($1,$2,'editor')",
        [actor.userId, workspace],
      );
      await db.query(
        "INSERT INTO sites(id,workspace_id,name,slug,site_type) VALUES($1,$2,'Media','creation-media','media'),($3,$2,'Second','creation-second','media'),($4,$5,'Foreign','creation-foreign','media')",
        [site, workspace, site2, foreignSite, other],
      );
      await db.query(
        "INSERT INTO site_content_templates(site_id,kind,key,version,name) VALUES($1,'article','editorial','1','Статья'),($2,'article','editorial','1','Статья'),($3,'article','editorial','1','Статья')",
        [site, site2, foreignSite],
      );
      await db.query(
        "INSERT INTO categories(id,site_id,name,slug,display_template_key,display_template_version,publication_state) VALUES($1,$2,'Уход','care','editorial','1','published')",
        [category, site],
      );
      await db.query(
        "INSERT INTO categories(id,site_id,name,slug,display_template_key,display_template_version,publication_state) VALUES($1,$2,'Раздел второго сайта','second-care','editorial','1','published')",
        [category2, site2],
      );
      const access = new ContentCenterService(db, new PreparationAiService());
      service = new CreationService(db, access);
      runs = new CreationRunsService(
        service,
        new CreationAiService({ produce, supportsFiles: true }),
      );
      const lifecycle = new ContentLifecycleService(
        db,
        db.getRepository(SiteEntity),
        db.getRepository(WorkspaceMembershipEntity),
        db.getRepository(ArticleEntity),
        db.getRepository(CategoryEntity),
        db.getRepository(ArticleRelatedItemEntity),
        db.getRepository(ArticleVersionEntity),
        db.getRepository(ContentEventEntity),
        db.getRepository(ContentStatusScheduleEntity),
        db.getRepository(SiteContentTemplateEntity),
        db.getRepository(ArticleSectionSettingsEntity),
      );
      publication = new CreationPublicationService(service, lifecycle);
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
        'TRUNCATE cc_creation_events,cc_creation_runs,cc_corrections,cc_created_versions,cc_created_articles,cc_clusters,cc_creation_settings,cc_preparation_versions CASCADE',
      );
      await db.query('DELETE FROM articles WHERE site_id=ANY($1::uuid[])', [
        [site, site2],
      ]);
      produce.mockReset().mockResolvedValue({
        relevant: true,
        recommendation: 'create',
        rationale: 'Релевантно потребности',
        article: snapshot(),
        purpose: 'Информирование',
        task: 'Объяснить уход',
        need: 'Выбрать средство',
        contentRationale: 'По поисковым запросам',
      });
      await service.saveSettings(workspace, actor, {
        revision: 0,
        rules: 'Не обещать лечение',
        platforms: [{ siteId: site, rules: 'Обращение на вы' }],
      });
    });
    async function create() {
      const cluster = await service.saveCluster(workspace, actor, clusterDto());
      await runs.start(workspace, actor, {
        clusterIds: [cluster.id],
        instruction: 'Разовая задача',
      });
      await runs.processNext();
      const [article] = await db.query<CreatedArticle[]>(
        'SELECT * FROM cc_created_articles WHERE workspace_id=$1',
        [workspace],
      );
      if (!article) {
        const r = await db.query<
          Array<Pick<CreationRunRow, 'status' | 'operations'>>
        >('SELECT status,operations FROM cc_creation_runs');
        throw new Error(JSON.stringify(r));
      }
      return { cluster, article };
    }
    const publishDto = (revision: number) => ({
      revision,
      siteId: site,
      categoryId: category,
      slug: 'test-article',
      templateKey: 'editorial',
      templateVersion: '1',
    });

    it('moves an explicit publication without losing old URLs, versions or independent platform articles', async () => {
      const { article } = await create();
      await service.saveSettings(workspace, actor, {
        revision: 1,
        rules: 'Rules',
        platforms: [
          { siteId: site, rules: '' },
          { siteId: site2, rules: '' },
        ],
      });
      const details = await service.details(workspace, actor, article.id);
      expect(details.sites.map((s) => s.id).sort()).toEqual(
        [site, site2].sort(),
      );
      expect(details.categories.find((c) => c.id === category2)?.site_id).toBe(
        site2,
      );
      const first = await publication.publish(
        workspace,
        actor,
        article.id,
        publishDto(1),
      );
      const next = {
        ...publishDto(2),
        siteId: site2,
        categoryId: category2,
        slug: 'second-place',
      };
      await expect(
        publication.publish(workspace, actor, article.id, next),
      ).rejects.toThrow('Подтвердите перенос');
      await expect(
        publication.publish(workspace, actor, article.id, {
          ...next,
          confirmMove: true,
          categoryId: category,
        }),
      ).rejects.toThrow('раздел');
      expect((await service.article(workspace, article.id)).site_id).toBe(site);
      const second = await publication.publish(workspace, actor, article.id, {
        ...next,
        confirmMove: true,
      });
      expect(second.url).toContain('/creation-second/');
      const moved = await service.article(workspace, article.id);
      expect(moved).toMatchObject({
        site_id: site2,
        current_number: 1,
        published_number: 1,
        status: 'published',
      });
      const copies = await db.query<
        Array<{ site_id: string; publication_state: string }>
      >(
        'SELECT a.site_id,a.publication_state FROM articles a JOIN cc_article_publications p ON p.cms_article_id=a.id WHERE p.article_id=$1',
        [article.id],
      );
      expect(copies.find((c) => c.site_id === site)?.publication_state).toBe(
        'hidden',
      );
      expect(copies.find((c) => c.site_id === site2)?.publication_state).toBe(
        'published',
      );
      const returned = await publication.publish(workspace, actor, article.id, {
        ...publishDto(moved.revision),
        confirmMove: true,
        slug: 'must-not-change',
      });
      expect(returned.url).toBe(first.url);
      expect(
        (await service.details(workspace, actor, article.id)).versions,
      ).toHaveLength(1);
      const history = await service.history(workspace, actor);
      expect(
        history.events.filter((e) => e.type === 'unpublished'),
      ).toHaveLength(2);
    });
    it('refuses occupied or foreign destinations and detects edits to an earlier publication', async () => {
      const { article, cluster } = await create();
      await service.saveSettings(workspace, actor, {
        revision: 1,
        rules: '',
        platforms: [
          { siteId: site, rules: '' },
          { siteId: site2, rules: '' },
        ],
      });
      await expect(
        publication.publish(workspace, actor, article.id, {
          ...publishDto(1),
          siteId: foreignSite,
        }),
      ).rejects.toThrow();
      await publication.publish(workspace, actor, article.id, publishDto(1));
      await publication.publish(workspace, actor, article.id, {
        ...publishDto(2),
        siteId: site2,
        categoryId: category2,
        confirmMove: true,
      });
      await db.query(
        'UPDATE articles SET revision=revision+1 WHERE site_id=$1',
        [site],
      );
      await expect(
        publication.publish(workspace, actor, article.id, {
          ...publishDto(3),
          confirmMove: true,
        }),
      ).rejects.toThrow('изменена');
      produce.mockImplementation((input) =>
        Promise.resolve(
          input.article
            ? {
                relevant: true,
                recommendation: 'keep',
                rationale: 'Без изменений',
              }
            : {
                relevant: true,
                recommendation: 'create',
                rationale: 'Новая независимая статья',
                purpose: 'Информирование',
                task: 'Объяснить',
                need: 'Выбор',
                contentRationale: 'По запросам',
                article: snapshot(),
              },
        ),
      );
      await runs.start(workspace, actor, {
        clusterIds: [cluster.id],
        instruction: '',
      });
      await runs.processNext();
      const current = await service.article(workspace, article.id);
      await expect(
        publication.publish(workspace, actor, article.id, {
          ...publishDto(current.revision),
          confirmMove: true,
        }),
      ).rejects.toThrow('независимая статья');
      expect((await service.article(workspace, article.id)).site_id).toBe(
        site2,
      );
    });
    it('backfills publication ownership for existing CMS links', async () => {
      const { article } = await create();
      await publication.publish(workspace, actor, article.id, publishDto(1));
      const q = db.createQueryRunner();
      try {
        await new CreationPublicationTargets1790340000000().down(q);
        await new CreationPublicationTargets1790340000000().up(q);
      } finally {
        await q.release();
      }
      const [mapping] = await db.query<Array<{ site_id: string }>>(
        'SELECT * FROM cc_article_publications WHERE article_id=$1',
        [article.id],
      );
      expect(mapping.site_id).toBe(site);
      await publication.unpublish(workspace, actor, article.id, 2);
      expect((await service.article(workspace, article.id)).status).toBe(
        'unpublished',
      );
    });
    it('validates selected visible text rather than JSON escaping or internal document fields', async () => {
      const value = snapshot();
      value.document.blocks = [
        {
          id: 'intro',
          type: 'paragraph',
          text: 'Первый "фрагмент"\nна новой строке',
        },
      ];
      expect(
        containsCorrectionFragment(
          value,
          '"фрагмент"\nна новой',
          'block:intro',
        ),
      ).toBe(true);
      expect(
        containsCorrectionFragment(value, '"фрагмент" на новой', 'block:intro'),
      ).toBe(true);
      expect(
        containsCorrectionFragment(value, 'paragraph', 'block:intro'),
      ).toBe(false);
      expect(containsCorrectionFragment(value, 'Несуществующий текст')).toBe(
        false,
      );
      produce.mockResolvedValueOnce({
        relevant: true,
        recommendation: 'create',
        rationale: 'Контекст',
        purpose: 'Информирование',
        task: 'Объяснить',
        need: 'Выбор',
        contentRationale: 'По запросам',
        article: value,
      });
      const { article } = await create();
      await runs.correct(workspace, actor, article.id, {
        revision: 1,
        instruction: 'Сократи',
        target: 'block:intro',
        fragment: '"фрагмент" на новой',
      });
      const [run] = await db.query<
        Array<{
          input: { instruction: string; target: string; fragment: string };
        }>
      >("SELECT input FROM cc_creation_runs WHERE kind='correction'");
      expect(run.input).toMatchObject({
        instruction: 'Сократи',
        target: 'block:intro',
        fragment: '"фрагмент" на новой',
      });
    });
    it('isolates workspace access, rejects foreign platforms and stale settings/cluster writes', async () => {
      await expect(service.overview(other, actor)).rejects.toThrow(
        'недоступно',
      );
      await expect(
        service.saveSettings(workspace, actor, {
          revision: 1,
          rules: '',
          platforms: [{ siteId: foreignSite, rules: '' }],
        }),
      ).rejects.toThrow('недоступна');
      await expect(
        service.saveSettings(workspace, actor, {
          revision: 0,
          rules: '',
          platforms: [],
        }),
      ).rejects.toThrow('изменились');
      const c = await service.saveCluster(workspace, actor, clusterDto());
      await service.saveCluster(
        workspace,
        actor,
        { ...clusterDto(), revision: 1, direction: 'Другое' },
        c.id,
      );
      await expect(
        service.saveCluster(
          workspace,
          actor,
          { ...clusterDto(), revision: 1 },
          c.id,
        ),
      ).rejects.toThrow('изменились');
      await expect(service.cluster(other, c.id)).rejects.toThrow('не найден');
    });
    it('empty selection runs all active clusters, snapshots context and clears temporary file after completion', async () => {
      const c = await service.saveCluster(workspace, actor, clusterDto());
      await service.saveCluster(workspace, actor, {
        ...clusterDto('Архив'),
        archived: true,
      });
      await db.query(
        "INSERT INTO cc_preparation_versions(workspace_id,number,content,actor_name,reason) VALUES($1,1,'Prepared context','Editor','Processing')",
        [workspace],
      );
      await runs.start(
        workspace,
        actor,
        { clusterIds: [], instruction: 'Особая задача' },
        { originalname: 'brief.txt', buffer: Buffer.from('File context') },
      );
      await expect(
        runs.start(workspace, actor, { clusterIds: [], instruction: '' }),
      ).rejects.toThrow('уже выполняется');
      await runs.processNext();
      expect(produce).toHaveBeenCalledTimes(1);
      expect(produce.mock.calls[0][0]).toMatchObject({
        cluster: { id: c.id },
        context: {
          projectRules: 'Не обещать лечение',
          instruction: 'Особая задача',
          preparedInformation: { content: 'Prepared context' },
          file: { name: 'brief.txt' },
        },
      });
      const [run] = await db.query<CreationRunRow[]>(
        'SELECT * FROM cc_creation_runs',
      );
      expect(run.status).toBe('succeeded');
      expect(run.input).toBeNull();
      expect(await db.query('SELECT id FROM cc_materials')).toHaveLength(0);
    });
    it('records a failed operation without making an error an article status and supports explicit retry', async () => {
      await service.saveSettings(workspace, actor, {
        revision: 1,
        rules: '',
        platforms: [
          { siteId: site, rules: '' },
          { siteId: site2, rules: '' },
        ],
      });
      const cluster = await service.saveCluster(workspace, actor, clusterDto());
      produce.mockRejectedValueOnce(new Error('secret provider token'));
      const started = await runs.start(workspace, actor, {
        clusterIds: [cluster.id],
        instruction: '',
      });
      await runs.processNext();
      const [run] = await db.query<CreationRunRow[]>(
        'SELECT * FROM cc_creation_runs WHERE id=$1',
        [started.id],
      );
      expect(run.status).toBe('partial');
      expect(JSON.stringify(run)).not.toContain('secret provider');
      expect(await db.query('SELECT status FROM cc_created_articles')).toEqual([
        { status: 'created' },
      ]);
      await runs.start(workspace, actor, {
        clusterIds: [],
        instruction: 'Повтор',
        retryRunId: started.id,
      });
      await runs.processNext();
      expect(await db.query('SELECT id FROM cc_created_articles')).toHaveLength(
        2,
      );
    });
    it('finishes all proposal decisions before one new version, never changes the published version implicitly', async () => {
      const { article } = await create();
      await publication.publish(
        workspace,
        actor,
        article.id,
        publishDto(article.revision),
      );
      const published = await service.article(workspace, article.id);
      const original = await service.version(published);
      produce.mockResolvedValue({
        relevant: true,
        recommendation: 'update',
        rationale: 'Уточнения',
        proposals: [
          {
            target: 'title',
            before: original.snapshot.title,
            after: 'Новый заголовок',
            reason: 'Точнее',
          },
          {
            target: 'excerpt',
            before: original.snapshot.excerpt,
            after: 'Новое описание',
            reason: 'Короче',
          },
        ],
      });
      await runs.start(workspace, actor, { clusterIds: [], instruction: '' });
      await runs.processNext();
      let d = await service.details(workspace, actor, article.id);
      const correction = d.correction;
      await service.decide(workspace, actor, article.id, {
        revision: d.article.revision,
        correctionId: correction.id,
        proposalId: correction.proposals[0].id,
        decision: 'accepted',
      });
      d = await service.details(workspace, actor, article.id);
      expect(d.article.current_number).toBe(1);
      expect(d.version.snapshot.title).toBe('Первая статья');
      expect(d.versions).toHaveLength(1);
      await service.decide(workspace, actor, article.id, {
        revision: d.article.revision,
        correctionId: correction.id,
        proposalId: correction.proposals[1].id,
        decision: 'rejected',
      });
      d = await service.details(workspace, actor, article.id);
      expect(d.article).toMatchObject({
        current_number: 2,
        published_number: 1,
        status: 'published',
      });
      expect(d.version.snapshot).toMatchObject({
        title: 'Новый заголовок',
        excerpt: 'Описание',
      });
      expect(d.versions).toHaveLength(2);
      const cms = await db
        .getRepository(ArticleEntity)
        .findOneByOrFail({ id: d.article.cms_article_id! });
      expect(cms.title).toBe('Первая статья');
      await publication.publish(workspace, actor, article.id, {
        ...publishDto(d.article.revision),
        slug: 'should-not-replace-url',
      });
      d = await service.details(workspace, actor, article.id);
      expect(d.article.published_number).toBe(2);
      expect(d.article.publication_url).toContain('/test-article');
      await service.restore(
        workspace,
        actor,
        article.id,
        d.article.revision,
        1,
      );
      d = await service.details(workspace, actor, article.id);
      expect(d.article).toMatchObject({
        current_number: 3,
        published_number: 2,
        status: 'published',
      });
      expect(d.version.snapshot.title).toBe('Первая статья');
      await publication.unpublish(
        workspace,
        actor,
        article.id,
        d.article.revision,
      );
      const removed = await service.article(workspace, article.id);
      expect(removed).toMatchObject({
        status: 'unpublished',
        published_number: null,
      });
      expect(
        (
          await db
            .getRepository(ArticleEntity)
            .findOneByOrFail({ id: removed.cms_article_id! })
        ).publicationState,
      ).toBe('hidden');
    });
    it('rejecting everything makes no version; pending and unpublished articles are skipped on repeated production', async () => {
      const { article } = await create();
      produce.mockResolvedValue({
        relevant: true,
        recommendation: 'update',
        rationale: 'Изменить',
        proposals: [
          {
            target: 'title',
            before: 'Первая статья',
            after: 'Другая статья',
            reason: 'Причина',
          },
        ],
      });
      await runs.start(workspace, actor, { clusterIds: [], instruction: '' });
      await runs.processNext();
      let d = await service.details(workspace, actor, article.id);
      await runs.start(workspace, actor, { clusterIds: [], instruction: '' });
      await runs.processNext();
      expect(produce).toHaveBeenCalledTimes(2);
      await service.decide(workspace, actor, article.id, {
        revision: d.article.revision,
        correctionId: d.correction.id,
        proposalId: d.correction.proposals[0].id,
        decision: 'rejected',
      });
      d = await service.details(workspace, actor, article.id);
      expect(d.versions).toHaveLength(1);
      expect(d.correction).toBeNull();
      await publication.publish(
        workspace,
        actor,
        article.id,
        publishDto(d.article.revision),
      );
      d = await service.details(workspace, actor, article.id);
      await publication.unpublish(
        workspace,
        actor,
        article.id,
        d.article.revision,
      );
      await runs.start(workspace, actor, { clusterIds: [], instruction: '' });
      await runs.processNext();
      expect(produce).toHaveBeenCalledTimes(2);
    });
    it('does not automatically unpublish from an AI recommendation', async () => {
      const { article } = await create();
      await publication.publish(
        workspace,
        actor,
        article.id,
        publishDto(article.revision),
      );
      produce.mockResolvedValue({
        relevant: true,
        recommendation: 'unpublish',
        rationale: 'Потеряла актуальность',
      });
      await runs.start(workspace, actor, { clusterIds: [], instruction: '' });
      await runs.processNext();
      expect(await service.article(workspace, article.id)).toMatchObject({
        status: 'published',
        recommendation: 'unpublish',
        published_number: 1,
      });
    });
    it('refuses foreign article/version access and protects publication from outside CMS edits', async () => {
      const { article } = await create();
      await expect(service.details(other, actor, article.id)).rejects.toThrow(
        'недоступно',
      );
      await publication.publish(
        workspace,
        actor,
        article.id,
        publishDto(article.revision),
      );
      const a = await service.article(workspace, article.id);
      await db.query(
        "UPDATE articles SET title='Colleague edit',revision=revision+1 WHERE id=$1",
        [a.cms_article_id],
      );
      await expect(
        publication.publish(
          workspace,
          actor,
          article.id,
          publishDto(a.revision),
        ),
      ).rejects.toThrow('перезаписать');
      expect(
        (
          await db
            .getRepository(ArticleEntity)
            .findOneByOrFail({ id: a.cms_article_id! })
        ).title,
      ).toBe('Colleague edit');
    });
    it('refuses stale AI output and records the failure without overwriting manual changes', async () => {
      const cluster = await service.saveCluster(workspace, actor, clusterDto());
      let finish!: (
          v: Awaited<ReturnType<CreationProvider['produce']>>,
        ) => void,
        entered!: () => void;
      const start = new Promise<void>((r) => {
        entered = r;
      });
      produce.mockImplementation(() => {
        entered();
        return new Promise((r) => {
          finish = r;
        });
      });
      await runs.start(workspace, actor, {
        clusterIds: [cluster.id],
        instruction: '',
      });
      const pending = runs.processNext();
      await start;
      await service.saveCluster(
        workspace,
        actor,
        { ...clusterDto(), revision: cluster.revision, direction: 'Changed' },
        cluster.id,
      );
      finish({
        relevant: true,
        recommendation: 'create',
        rationale: 'Relevant',
        article: snapshot(),
        purpose: 'Purpose',
        task: 'Task',
        need: 'Need',
        contentRationale: 'Why',
      });
      await pending;
      expect(await db.query('SELECT id FROM cc_created_articles')).toHaveLength(
        0,
      );
      const [run] = await db.query<CreationRunRow[]>(
        'SELECT * FROM cc_creation_runs',
      );
      expect(run.status).toBe('failed');
      expect(run.operations[0].message).toContain('Кластер изменён');
    });
    it('keeps immutable history and links split/merged clusters without moving their articles', async () => {
      const source = await service.saveCluster(workspace, actor, {
        ...clusterDto(),
        queries: [
          ...clusterDto().queries,
          { text: 'Другой запрос', general: 50, exact: 10, primary: false },
        ],
      });
      const result = await service.restructure(workspace, actor, {
        kind: 'split',
        ids: [source.id],
        revisions: [source.revision],
        clusters: source.queries.map((q) => ({
          ...clusterDto(),
          queries: [{ ...q, primary: true }],
        })),
      });
      expect((await service.cluster(workspace, source.id)).archived).toBe(true);
      const events = (await service.history(workspace, actor)).events;
      expect(events.find((e) => e.type === 'split')!.related_ids).toHaveLength(
        3,
      );
      await service.restructure(workspace, actor, {
        kind: 'merge',
        ids: result.map((c) => c.id),
        revisions: result.map((c) => c.revision),
        clusters: [{ ...clusterDto(), queries: source.queries }],
      });
      expect(
        JSON.stringify(
          (await service.history(workspace, actor)).events.find(
            (e) => e.id === events[0].id,
          ),
        ),
      ).toBe(JSON.stringify(events[0]));
    });
    it('disconnected AI creates no run and malformed correction output creates no version', async () => {
      const disconnected = new CreationRunsService(
        service,
        new CreationAiService(),
      );
      await expect(
        disconnected.start(workspace, actor, {
          clusterIds: [],
          instruction: '',
        }),
      ).rejects.toThrow('не подключён');
      expect(await db.query('SELECT id FROM cc_creation_runs')).toHaveLength(0);
      const { article } = await create();
      produce.mockResolvedValue({
        relevant: true,
        recommendation: 'update',
        rationale: 'AI',
        proposals: [
          {
            target: 'title',
            before: 'Wrong original',
            after: 'Oops',
            reason: 'Reason',
          },
        ],
      });
      await runs.correct(workspace, actor, article.id, {
        revision: article.revision,
        instruction: 'Исправь',
        target: 'title',
      });
      await runs.processNext();
      expect(
        (await service.details(workspace, actor, article.id)).versions,
      ).toHaveLength(1);
      expect(await db.query('SELECT id FROM cc_corrections')).toHaveLength(0);
    });
  },
);
