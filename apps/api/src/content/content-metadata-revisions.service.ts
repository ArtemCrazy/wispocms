import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  ArticleEntity,
  ArticleRelatedItemEntity,
  ArticleSectionSettingsEntity,
  ContentTemplateKind,
  MediaEntity,
  SiteContentTemplateEntity,
  SiteEntity,
} from '../database/entities';
import {
  CmsRevisionsService,
  type CmsResourceType,
  type RevisionActor,
} from './cms-revisions.service';
import { SitePermission } from './content.permissions';

type DraftInput<T> = T & { expectedDraftRevisionId: string | null };
type ArticleListSnapshot = {
  listTemplateKey: string;
  listTemplateVersion: string;
  listTemplateConfig: Record<string, unknown>;
};
type RelatedSnapshot = { articleIds: string[] };
type MediaAltSnapshot = { altText: string | null; isDecorative: boolean };
type LayoutBindingsSnapshot = {
  headerTemplateKey: string;
  headerTemplateVersion: string;
  headerTemplateConfig: Record<string, unknown>;
  footerTemplateKey: string;
  footerTemplateVersion: string;
  footerTemplateConfig: Record<string, unknown>;
};

@Injectable()
export class ContentMetadataRevisionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(ArticleEntity)
    private readonly articles: Repository<ArticleEntity>,
    @InjectRepository(ArticleRelatedItemEntity)
    private readonly related: Repository<ArticleRelatedItemEntity>,
    @InjectRepository(SiteContentTemplateEntity)
    private readonly templates: Repository<SiteContentTemplateEntity>,
    @InjectRepository(ArticleSectionSettingsEntity)
    private readonly settings: Repository<ArticleSectionSettingsEntity>,
    @InjectRepository(MediaEntity)
    private readonly media: Repository<MediaEntity>,
    private readonly revisions: CmsRevisionsService,
  ) {}

  private view<T extends Record<string, unknown>>(
    snapshot: T,
    current: Awaited<ReturnType<CmsRevisionsService['current']>>,
    next?: { id: string; versionNumber: number },
    baselineId?: string,
  ) {
    return {
      ...snapshot,
      draftRevisionId: next?.id ?? current?.draft?.id ?? null,
      draftVersionNumber:
        next?.versionNumber ?? current?.draft?.versionNumber ?? null,
      approvedRevisionId: next ? null : (current?.approvedRevisionId ?? null),
      publishedRevisionId: current?.publishedRevisionId ?? baselineId ?? null,
      reviewState: next ? 'draft' : (current?.reviewState ?? 'draft'),
    };
  }

  private async save<T extends Record<string, unknown>>(
    siteId: string,
    resourceType: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
    snapshot: T,
    publishedSnapshot: T,
    expectedDraftRevisionId: string | null,
  ) {
    const current = await this.revisions.current(
      siteId,
      resourceType,
      entityId,
      actor,
    );
    if (expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const baseline = !current
      ? await this.revisions.importPublishedBaseline({
          siteId,
          resourceType,
          entityId,
          snapshot: publishedSnapshot,
          actor,
        })
      : null;
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType,
      entityId,
      snapshot,
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.view(snapshot, current, next, baseline?.id);
  }

  private async articleListPublished(
    siteId: string,
  ): Promise<ArticleListSnapshot> {
    const row = await this.settings.findOne({ where: { siteId } });
    if (!row) throw new NotFoundException('Настройки списка статей не найдены');
    return {
      listTemplateKey: row.listTemplateKey,
      listTemplateVersion: row.listTemplateVersion,
      listTemplateConfig: row.listTemplateConfig ?? {},
    };
  }

  async getArticleListSettings(siteId: string, actor: RevisionActor) {
    const current = await this.revisions.current(
      siteId,
      'site_article_list',
      siteId,
      actor,
    );
    const snapshot = (current?.draft?.snapshot ??
      (await this.articleListPublished(siteId))) as ArticleListSnapshot;
    return this.view(snapshot, current);
  }

  async saveArticleListSettings(
    siteId: string,
    actor: RevisionActor,
    input: DraftInput<{
      templateKey: string;
      templateVersion: string;
      config?: Record<string, unknown>;
    }>,
  ) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.EDIT_CODE,
    );
    const template = await this.templates.findOne({
      where: {
        siteId,
        kind: ContentTemplateKind.ARTICLES_LIST,
        key: input.templateKey,
        version: input.templateVersion,
        isActive: true,
      },
    });
    if (!template)
      throw new BadRequestException('Шаблон списка статей не найден');
    const snapshot: ArticleListSnapshot = {
      listTemplateKey: template.key,
      listTemplateVersion: template.version,
      listTemplateConfig: structuredClone(input.config ?? {}),
    };
    return this.save(
      siteId,
      'site_article_list',
      siteId,
      actor,
      snapshot,
      await this.articleListPublished(siteId),
      input.expectedDraftRevisionId,
    );
  }

  private async assertArticle(siteId: string, articleId: string) {
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    return article;
  }

  private async relatedPublished(articleId: string): Promise<RelatedSnapshot> {
    const rows = await this.related.find({
      where: { articleId },
      order: { sortOrder: 'ASC' },
    });
    return { articleIds: rows.map((row) => row.relatedArticleId) };
  }

  private articleSnapshot(article: ArticleEntity): Record<string, unknown> {
    return {
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      body: article.body,
      bodyDocument: article.bodyDocument,
      documentVersion: article.documentVersion,
      categoryId: article.categoryId,
      authorId: article.authorId,
      coverMediaId: article.coverMediaId,
      previewMediaId: article.previewMediaId,
      sortOrder: article.sortOrder,
      publicationState: article.publicationState,
      publishedAt: article.publishedAt,
      editorialState: article.editorialState,
      displayTemplateKey: article.displayTemplateKey,
      displayTemplateVersion: article.displayTemplateVersion,
      displayTemplateConfig: article.displayTemplateConfig,
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      canonicalUrl: article.canonicalUrl,
      noIndex: article.noIndex,
      ogTitle: article.ogTitle,
      ogDescription: article.ogDescription,
      ogImageMediaId: article.ogImageMediaId,
      structuredData: article.structuredData,
      revision: article.revision,
    };
  }

  private async validateRelated(
    siteId: string,
    articleId: string,
    articleIds: string[],
  ) {
    if (new Set(articleIds).size !== articleIds.length)
      throw new BadRequestException(
        'Связанные материалы не должны повторяться',
      );
    if (articleIds.includes(articleId))
      throw new BadRequestException('Статья не может ссылаться сама на себя');
    await this.assertArticle(siteId, articleId);
    if (!articleIds.length) return;
    const targets = await this.articles.find({
      where: { id: In(articleIds), siteId, deletedAt: IsNull() },
      select: { id: true },
    });
    if (targets.length !== articleIds.length)
      throw new BadRequestException('Один из связанных материалов не найден');
  }

  async getRelatedArticles(
    siteId: string,
    articleId: string,
    actor: RevisionActor,
  ) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.READ,
    );
    await this.assertArticle(siteId, articleId);
    const current = await this.revisions.current(
      siteId,
      'article',
      articleId,
      actor,
    );
    const publicRelated = await this.relatedPublished(articleId);
    const snapshot: RelatedSnapshot = {
      articleIds: Array.isArray(current?.draft?.snapshot.relatedArticleIds)
        ? (current.draft.snapshot.relatedArticleIds as string[])
        : publicRelated.articleIds,
    };
    if (!snapshot.articleIds.length) return [];
    const articles = await this.articles.find({
      where: { id: In(snapshot.articleIds), siteId, deletedAt: IsNull() },
    });
    const byId = new Map(articles.map((article) => [article.id, article]));
    return snapshot.articleIds.flatMap((relatedArticleId, sortOrder) => {
      const relatedArticle = byId.get(relatedArticleId);
      return relatedArticle
        ? [{ articleId, relatedArticleId, sortOrder, relatedArticle }]
        : [];
    });
  }

  async saveRelatedArticles(
    siteId: string,
    articleId: string,
    actor: RevisionActor,
    input: DraftInput<RelatedSnapshot>,
  ) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const article = await this.assertArticle(siteId, articleId);
    await this.validateRelated(siteId, articleId, input.articleIds);
    const current = await this.revisions.current(
      siteId,
      'article',
      articleId,
      actor,
    );
    if (input.expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const publicRelated = await this.relatedPublished(articleId);
    const baselineSnapshot = {
      ...this.articleSnapshot(article),
      relatedArticleIds: publicRelated.articleIds,
    };
    const baseline = !current
      ? await this.revisions.importPublishedBaseline({
          siteId,
          resourceType: 'article',
          entityId: articleId,
          snapshot: baselineSnapshot,
          actor,
        })
      : null;
    const snapshot = {
      ...(current?.draft?.snapshot ?? baselineSnapshot),
      relatedArticleIds: [...input.articleIds],
      revision: current?.draft?.snapshot.revision ?? article.revision + 1,
    };
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: 'article',
      entityId: articleId,
      snapshot,
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.view(snapshot, current, next, baseline?.id);
  }

  private async assertMediaNotShared(
    querySource: Pick<EntityManager, 'query'>,
    mediaId: string,
    siteId: string,
  ) {
    const sharedRows = await querySource.query<Array<{ count: number }>>(
      `SELECT COUNT(DISTINCT "site_id")::int AS "count" FROM (
        SELECT "site_id" FROM "articles" WHERE "cover_media_id" = $1 OR "preview_media_id" = $1 OR "og_image_media_id" = $1
        UNION ALL SELECT "site_id" FROM "categories" WHERE "image_media_id" = $1 OR "og_image_media_id" = $1
        UNION ALL SELECT "site_id" FROM "banners" WHERE "media_id" = $1 OR "mobile_media_id" = $1
        UNION ALL SELECT "site_id" FROM "pages" WHERE "og_image_media_id" = $1
        UNION ALL SELECT "site_id" FROM "pages"
          WHERE jsonb_path_exists(
            COALESCE("blocks", '[]'::jsonb),
            '$.** ? (@ == $mediaId)',
            jsonb_build_object('mediaId', to_jsonb($1::text))
          )
        UNION ALL SELECT "site_id" FROM "articles"
          WHERE jsonb_path_exists(
            COALESCE("body_document", '{}'::jsonb),
            '$.** ? (@ == $mediaId)',
            jsonb_build_object('mediaId', to_jsonb($1::text))
          )
        UNION ALL SELECT "id" AS "site_id" FROM "sites" WHERE "seo_image_media_id" = $1
        UNION ALL SELECT "id" AS "site_id" FROM "sites"
          WHERE jsonb_path_exists(
            COALESCE("layout_settings", '{}'::jsonb),
            '$.** ? (@ == $mediaId)',
            jsonb_build_object('mediaId', to_jsonb($1::text))
          )
      ) uses WHERE "site_id" <> $2`,
      [mediaId, siteId],
    );
    if (Number(sharedRows[0]?.count ?? 0) > 0)
      throw new ConflictException(
        'Изображение используется другим сайтом; требуется согласование пространства',
      );
  }

  private async ownedMedia(siteId: string, mediaId: string) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    const media = await this.media.findOne({
      where: { id: mediaId, workspaceId: site.workspaceId },
    });
    if (!media || media.siteId !== siteId)
      throw new ConflictException(
        'Общее изображение нельзя менять из сайта до согласования на уровне пространства',
      );
    await this.assertMediaNotShared(this.dataSource.manager, mediaId, siteId);
    return media;
  }

  async getMediaAlt(siteId: string, mediaId: string, actor: RevisionActor) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.READ,
    );
    const media = await this.ownedMedia(siteId, mediaId);
    const current = await this.revisions.current(
      siteId,
      'media_alt',
      mediaId,
      actor,
    );
    const snapshot = (current?.draft?.snapshot ?? {
      altText: media.altText,
      isDecorative: media.isDecorative,
    }) as MediaAltSnapshot;
    return this.view(snapshot, current);
  }

  async saveMediaAlt(
    siteId: string,
    mediaId: string,
    actor: RevisionActor,
    input: DraftInput<{
      altText?: string | null;
      isDecorative: boolean;
    }>,
  ) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const media = await this.ownedMedia(siteId, mediaId);
    const altText = input.altText?.trim() || null;
    if (altText && altText.length > 300)
      throw new BadRequestException('Описание длиннее 300 символов');
    if (!altText && !input.isDecorative)
      throw new BadRequestException(
        'Добавьте alt-текст или отметьте изображение декоративным',
      );
    return this.save(
      siteId,
      'media_alt',
      mediaId,
      actor,
      { altText, isDecorative: input.isDecorative },
      { altText: media.altText, isDecorative: media.isDecorative },
      input.expectedDraftRevisionId,
    );
  }

  private layoutBindings(site: SiteEntity): LayoutBindingsSnapshot {
    return {
      headerTemplateKey:
        site.layoutSettings?.headerTemplateKey ?? 'standard-header',
      headerTemplateVersion: site.layoutSettings?.headerTemplateVersion ?? '1',
      headerTemplateConfig: site.layoutSettings?.headerTemplateConfig ?? {},
      footerTemplateKey:
        site.layoutSettings?.footerTemplateKey ?? 'standard-footer',
      footerTemplateVersion: site.layoutSettings?.footerTemplateVersion ?? '1',
      footerTemplateConfig: site.layoutSettings?.footerTemplateConfig ?? {},
    };
  }

  async getLayoutBindings(siteId: string, actor: RevisionActor) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.READ,
    );
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    const current = await this.revisions.current(
      siteId,
      'site_layout_bindings',
      siteId,
      actor,
    );
    const snapshot = (current?.draft?.snapshot ??
      this.layoutBindings(site)) as LayoutBindingsSnapshot;
    return this.view(snapshot, current);
  }

  async saveLayoutBindings(
    siteId: string,
    actor: RevisionActor,
    input: DraftInput<LayoutBindingsSnapshot>,
  ) {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.EDIT_CODE,
    );
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    for (const [kind, key, version] of [
      [
        ContentTemplateKind.HEADER,
        input.headerTemplateKey,
        input.headerTemplateVersion,
      ],
      [
        ContentTemplateKind.FOOTER,
        input.footerTemplateKey,
        input.footerTemplateVersion,
      ],
    ] as const) {
      const exists = await this.templates.findOne({
        where: { siteId, kind, key, version, isActive: true },
      });
      if (!exists)
        throw new BadRequestException('Шаблон шапки или подвала не найден');
    }
    const snapshot: LayoutBindingsSnapshot = {
      headerTemplateKey: input.headerTemplateKey,
      headerTemplateVersion: input.headerTemplateVersion,
      headerTemplateConfig: structuredClone(input.headerTemplateConfig ?? {}),
      footerTemplateKey: input.footerTemplateKey,
      footerTemplateVersion: input.footerTemplateVersion,
      footerTemplateConfig: structuredClone(input.footerTemplateConfig ?? {}),
    };
    return this.save(
      siteId,
      'site_layout_bindings',
      siteId,
      actor,
      snapshot,
      this.layoutBindings(site),
      input.expectedDraftRevisionId,
    );
  }

  async applyDraftAlt<T extends { id: string }>(
    siteId: string,
    actor: RevisionActor,
    items: T[],
  ) {
    return Promise.all(
      items.map(async (item) => {
        const current = await this.revisions.current(
          siteId,
          'media_alt',
          item.id,
          actor,
        );
        return current?.draft
          ? {
              ...item,
              ...current.draft.snapshot,
              draftRevisionId: current.draft.id,
            }
          : item;
      }),
    );
  }

  current(
    siteId: string,
    type: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ) {
    return this.revisions.current(siteId, type, entityId, actor);
  }

  history(
    siteId: string,
    type: CmsResourceType,
    entityId: string,
    actor: RevisionActor,
  ) {
    return this.revisions.listVersions(siteId, type, entityId, actor);
  }

  preview(
    siteId: string,
    type: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.revisions.getVersion(siteId, type, entityId, revisionId, actor);
  }

  private async activate(
    manager: EntityManager,
    siteId: string,
    type: CmsResourceType,
    entityId: string,
    snapshot: Record<string, unknown>,
  ) {
    if (type === 'site_article_list') {
      const key =
        typeof snapshot.listTemplateKey === 'string'
          ? snapshot.listTemplateKey
          : '';
      const version =
        typeof snapshot.listTemplateVersion === 'string'
          ? snapshot.listTemplateVersion
          : '';
      const template = await manager.findOne(SiteContentTemplateEntity, {
        where: {
          siteId,
          kind: ContentTemplateKind.ARTICLES_LIST,
          key,
          version,
          isActive: true,
        },
      });
      if (!template)
        throw new BadRequestException('Шаблон списка статей не найден');
      await manager.upsert(
        ArticleSectionSettingsEntity,
        {
          siteId,
          listTemplateKey: key,
          listTemplateVersion: version,
          listTemplateConfig: snapshot.listTemplateConfig ?? {},
        },
        ['siteId'],
      );
      return;
    }
    if (type === 'site_layout_bindings') {
      const site = await manager.findOne(SiteEntity, { where: { id: siteId } });
      if (!site) throw new NotFoundException('Сайт не найден');
      for (const [kind, keyField, versionField] of [
        [
          ContentTemplateKind.HEADER,
          'headerTemplateKey',
          'headerTemplateVersion',
        ],
        [
          ContentTemplateKind.FOOTER,
          'footerTemplateKey',
          'footerTemplateVersion',
        ],
      ] as const) {
        const keyValue = snapshot[keyField];
        const versionValue = snapshot[versionField];
        const template = await manager.findOne(SiteContentTemplateEntity, {
          where: {
            siteId,
            kind,
            key: typeof keyValue === 'string' ? keyValue : '',
            version: typeof versionValue === 'string' ? versionValue : '',
            isActive: true,
          },
        });
        if (!template)
          throw new BadRequestException('Шаблон шапки или подвала не найден');
      }
      site.layoutSettings = { ...(site.layoutSettings ?? {}), ...snapshot };
      await manager.save(SiteEntity, site);
      return;
    }
    const media = await manager.findOne(MediaEntity, {
      where: { id: entityId },
    });
    const site = await manager.findOne(SiteEntity, { where: { id: siteId } });
    if (
      !site ||
      !media ||
      media.workspaceId !== site.workspaceId ||
      media.siteId !== siteId
    )
      throw new NotFoundException('Файл не найден');
    await this.assertMediaNotShared(manager, entityId, siteId);
    const altText =
      snapshot.altText === null
        ? null
        : typeof snapshot.altText === 'string'
          ? snapshot.altText.trim() || null
          : null;
    const isDecorative = snapshot.isDecorative === true;
    if (altText && altText.length > 300)
      throw new BadRequestException('Описание длиннее 300 символов');
    if (!altText && !isDecorative)
      throw new BadRequestException(
        'Добавьте alt-текст или отметьте изображение декоративным',
      );
    media.altText = altText;
    media.isDecorative = isDecorative;
    await manager.save(MediaEntity, media);
  }

  publish(
    siteId: string,
    type: CmsResourceType,
    entityId: string,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.revisions.publish(
      siteId,
      type,
      entityId,
      revisionId,
      actor,
      (manager, snapshot) =>
        this.activate(manager, siteId, type, entityId, snapshot),
    );
  }
}
