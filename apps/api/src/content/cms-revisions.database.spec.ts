import { randomUUID } from 'crypto';
import { DataSource, IsNull } from 'typeorm';
import {
  ArticleEntity,
  ArticleRelatedItemEntity,
  ArticleSectionSettingsEntity,
  ArticleVersionEntity,
  CategoryEntity,
  CmsRevisionEventEntity,
  CmsRevisionEntity,
  CmsRevisionResourceEntity,
  ContentEventEntity,
  ContentStatusScheduleEntity,
  PlatformRole,
  PublicationState,
  SiteContentTemplateEntity,
  SiteEntity,
  UserEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { createDataSourceOptions } from '../database/data-source';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentLifecycleService } from './content-lifecycle.service';

const databaseSuite =
  process.env.CMS_REVISION_DB_SMOKE === 'true' ? describe : describe.skip;

databaseSuite('CMS revisions in local PostgreSQL', () => {
  let source: DataSource;

  beforeAll(async () => {
    source = new DataSource({
      ...createDataSourceOptions(),
      migrationsRun: false,
    });
    await source.initialize();
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
  });

  it('persists draft and publication in a rollback-only transaction', async () => {
    const site = await source.getRepository(SiteEntity).findOne({
      where: {},
    });
    if (!site) throw new Error('Local smoke test needs one site');
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const transaction = {
        transaction: async <T>(
          work: (manager: typeof runner.manager) => Promise<T>,
        ): Promise<T> => work(runner.manager),
      };
      const service = new CmsRevisionsService(
        transaction as never,
        source.getRepository(SiteEntity),
        source.getRepository(WorkspaceMembershipEntity),
      );
      const actor = {
        userId: randomUUID(),
        platformRole: PlatformRole.WISPO_ADMIN,
      };
      const entityId = randomUUID();
      const draft = await service.saveDraft({
        siteId: site.id,
        resourceType: 'chunk',
        entityId,
        snapshot: { html: '<section>First</section>' },
        expectedDraftRevisionId: null,
        actor,
      });
      expect(
        await service.published(site.id, 'chunk', entityId, actor),
      ).toBeNull();
      await service.submit(site.id, 'chunk', entityId, draft.id, actor);
      await service.approve(site.id, 'chunk', entityId, draft.id, actor);
      await service.publish(site.id, 'chunk', entityId, draft.id, actor);
      expect(
        await service.published(site.id, 'chunk', entityId, actor),
      ).toEqual({ html: '<section>First</section>' });
      const resource = await runner.manager.findOneByOrFail(
        CmsRevisionResourceEntity,
        { siteId: site.id, resourceType: 'chunk', entityId },
      );
      expect(
        await runner.manager.countBy(CmsRevisionEventEntity, {
          resourceId: resource.id,
        }),
      ).toBe(4);
      await expect(
        runner.manager.update(
          CmsRevisionEntity,
          { id: draft.id },
          { snapshot: { html: '<section>Altered</section>' } },
        ),
      ).rejects.toThrow();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('rolls back a failed public-row update without switching revision', async () => {
    const site = await source.getRepository(SiteEntity).findOne({
      where: {},
    });
    if (!site) throw new Error('Local smoke test needs one site');
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const transaction = {
        transaction: async <T>(
          work: (manager: typeof runner.manager) => Promise<T>,
        ): Promise<T> => runner.manager.transaction(work),
      };
      const service = new CmsRevisionsService(
        transaction as never,
        source.getRepository(SiteEntity),
        source.getRepository(WorkspaceMembershipEntity),
      );
      const actor = {
        userId: randomUUID(),
        platformRole: PlatformRole.WISPO_ADMIN,
      };
      const entityId = randomUUID();
      const baseline = await service.importPublishedBaseline({
        siteId: site.id,
        resourceType: 'article',
        entityId,
        snapshot: { title: 'Live' },
        actor,
      });
      const draft = await service.saveDraft({
        siteId: site.id,
        resourceType: 'article',
        entityId,
        snapshot: { title: 'Proposed' },
        expectedDraftRevisionId: baseline.id,
        actor,
      });
      await service.submit(site.id, 'article', entityId, draft.id, actor);
      await service.approve(site.id, 'article', entityId, draft.id, actor);
      await expect(
        service.publish(
          site.id,
          'article',
          entityId,
          draft.id,
          actor,
          async (db) => {
            await db.update(SiteEntity, { id: site.id }, { name: 'Temporary' });
            throw new Error('Renderer failed');
          },
        ),
      ).rejects.toThrow('Renderer failed');
      expect(
        await service.published(site.id, 'article', entityId, actor),
      ).toEqual({ title: 'Live' });
      expect(
        (await runner.manager.findOneByOrFail(SiteEntity, { id: site.id }))
          .name,
      ).toBe(site.name);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('keeps a published article live until its exact approved revision activates', async () => {
    const article = await source.getRepository(ArticleEntity).findOne({
      where: {
        publicationState: PublicationState.PUBLISHED,
        deletedAt: IsNull(),
      },
    });
    if (!article) throw new Error('Local smoke test needs a published article');
    const user = await source.getRepository(UserEntity).findOne({ where: {} });
    if (!user) throw new Error('Local smoke test needs one user');
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const transaction = {
        transaction: async <T>(
          work: (manager: typeof runner.manager) => Promise<T>,
        ): Promise<T> => runner.manager.transaction(work),
      };
      const revisions = new CmsRevisionsService(
        transaction as never,
        source.getRepository(SiteEntity),
        source.getRepository(WorkspaceMembershipEntity),
      );
      const lifecycle = new ContentLifecycleService(
        transaction as never,
        source.getRepository(SiteEntity),
        source.getRepository(WorkspaceMembershipEntity),
        source.getRepository(ArticleEntity),
        source.getRepository(CategoryEntity),
        source.getRepository(ArticleRelatedItemEntity),
        source.getRepository(ArticleVersionEntity),
        source.getRepository(ContentEventEntity),
        source.getRepository(ContentStatusScheduleEntity),
        source.getRepository(SiteContentTemplateEntity),
        source.getRepository(ArticleSectionSettingsEntity),
        revisions,
      );
      const actor = {
        userId: user.id,
        platformRole: PlatformRole.WISPO_ADMIN,
      };
      const baseline = await revisions.importPublishedBaseline({
        siteId: article.siteId,
        resourceType: 'article',
        entityId: article.id,
        snapshot: lifecycle.articleSnapshot(article),
        actor,
      });
      const proposedTitle = `${article.title} — checked draft`;
      const draft = await revisions.saveDraft({
        siteId: article.siteId,
        resourceType: 'article',
        entityId: article.id,
        snapshot: {
          ...lifecycle.articleSnapshot(article),
          title: proposedTitle,
          revision: article.revision + 1,
        },
        expectedDraftRevisionId: baseline.id,
        actor,
      });
      expect(
        (
          await runner.manager.findOneByOrFail(ArticleEntity, {
            id: article.id,
          })
        ).title,
      ).toBe(article.title);
      await revisions.submit(
        article.siteId,
        'article',
        article.id,
        draft.id,
        actor,
      );
      await revisions.approve(
        article.siteId,
        'article',
        article.id,
        draft.id,
        actor,
      );
      const saved = await lifecycle.publishArticleRevision(
        article.siteId,
        article.id,
        draft.id,
        actor,
      );
      expect(saved.title).toBe(proposedTitle);
      expect(
        (
          await runner.manager.findOneByOrFail(ArticleEntity, {
            id: article.id,
          })
        ).title,
      ).toBe(proposedTitle);
      expect(
        await revisions.published(article.siteId, 'article', article.id, actor),
      ).toEqual(expect.objectContaining({ title: proposedTitle }));
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    expect(
      (
        await source.getRepository(ArticleEntity).findOneByOrFail({
          id: article.id,
        })
      ).title,
    ).toBe(article.title);
  });
});
