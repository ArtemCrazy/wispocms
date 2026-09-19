import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import {
  ArticleEntity,
  ArticleRedirectEntity,
  ArticleStatus,
  CategoryEntity,
  ContentEventType,
  EditorialState,
  PublicationState,
  SiteContentTemplateEntity,
  SiteEntity,
  ContentTemplateKind,
} from '../database/entities';
import { articleDocumentText } from '../content/article-document';
import { ContentLifecycleService } from '../content/content-lifecycle.service';
import { CreationService } from './creation.service';
import type { CreationActor } from './creation.service';
import type { PublishCreatedArticleDto } from './creation.dto';

@Injectable()
export class CreationPublicationService {
  constructor(
    private readonly service: CreationService,
    private readonly lifecycle: ContentLifecycleService,
  ) {}
  async publish(
    w: string,
    a: CreationActor,
    id: string,
    dto: PublishCreatedArticleDto,
  ) {
    return this.service.transaction(w, a, async (m, name) => {
      const item = await this.service.article(w, id, m);
      this.service.revision(item, dto.revision);
      if (dto.siteId !== item.site_id)
        throw new BadRequestException(
          'Эта статья подготовлена для другой площадки; статьи площадок независимы',
        );
      const site = await m.findOne(SiteEntity, {
        where: { id: dto.siteId, workspaceId: w },
      });
      if (!site?.isActive)
        throw new BadRequestException('Площадка недоступна или выключена');
      const category = await m.findOne(CategoryEntity, {
        where: { id: dto.categoryId, siteId: site.id, deletedAt: IsNull() },
      });
      if (
        !category ||
        category.publicationState !== PublicationState.PUBLISHED ||
        (category.publishedAt && category.publishedAt > new Date())
      )
        throw new BadRequestException(
          'Выберите опубликованный раздел площадки',
        );
      const template = await m.findOne(SiteContentTemplateEntity, {
        where: {
          siteId: site.id,
          kind: ContentTemplateKind.ARTICLE,
          key: dto.templateKey,
          version: dto.templateVersion,
          isActive: true,
        },
      });
      if (!template) throw new BadRequestException('Шаблон статьи недоступен');
      const version = await this.service.version(item, item.current_number, m);
      await this.service.validateMedia(m, w, version.snapshot);
      let cms = item.cms_article_id
        ? await m.findOne(ArticleEntity, {
            where: {
              id: item.cms_article_id,
              siteId: site.id,
              deletedAt: IsNull(),
            },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      if (item.cms_article_id && (!cms || cms.revision !== item.cms_revision))
        throw new ConflictException(
          'Связанная статья изменена в CMS сайта. Публикация остановлена, чтобы не перезаписать чужую работу.',
        );
      const before = cms ? Object.assign(new ArticleEntity(), cms) : null;
      // Same site publication keeps its established URL, regardless of an edited form slug.
      const slug = cms?.slug ?? dto.slug;
      if (['404', 'privacy-policy', 'search'].includes(slug))
        throw new BadRequestException('Адрес зарезервирован');
      const conflict = await m.findOne(ArticleEntity, {
        where: { siteId: site.id, slug },
      });
      const redirect = await m.findOne(ArticleRedirectEntity, {
        where: { siteId: site.id, fromSlug: slug },
      });
      if (
        (conflict && conflict.id !== cms?.id) ||
        (redirect && redirect.articleId !== cms?.id)
      )
        throw new ConflictException('Этот адрес уже занят');
      cms ??= m.create(ArticleEntity, {
        siteId: site.id,
        slug,
        createdByUserId: a.userId,
        revision: 0,
      });
      Object.assign(cms, {
        title: version.snapshot.title,
        excerpt: version.snapshot.excerpt,
        bodyDocument: version.snapshot.document,
        documentVersion: 1,
        body: articleDocumentText(version.snapshot.document),
        categoryId: category.id,
        publicationState: PublicationState.PUBLISHED,
        editorialState: EditorialState.APPROVED,
        status: ArticleStatus.PUBLISHED,
        publishedAt: cms.publishedAt ?? new Date(),
        displayTemplateKey: template.key,
        displayTemplateVersion: template.version,
        displayTemplateConfig: template.config,
        updatedByUserId: a.userId,
        revision: cms.revision + 1,
      });
      const saved = await m.save(cms);
      await this.lifecycle.recordArticleChange(
        before,
        saved,
        a.userId,
        ContentEventType.PUBLICATION_CHANGED,
        'Опубликована текущая версия Контентного центра',
        true,
        m,
      );
      const url = `/preview/${encodeURIComponent(site.slug)}/articles/${encodeURIComponent(saved.slug)}`;
      await m.query(
        "UPDATE cc_created_articles SET status='published',published_number=current_number,cms_article_id=$2,cms_revision=$3,publication_url=$4,category_id=$5,revision=revision+1,updated_at=now() WHERE id=$1",
        [id, saved.id, saved.revision, url, category.id],
      );
      await this.service.event(
        m,
        w,
        name,
        'article',
        'published',
        item.cluster_id,
        id,
        version.snapshot.title,
        null,
        { version: version.number, siteId: site.id, siteName: site.name, url },
      );
      return { url };
    });
  }
  async unpublish(w: string, a: CreationActor, id: string, revision: number) {
    return this.service.transaction(w, a, async (m, name) => {
      const item = await this.service.article(w, id, m);
      this.service.revision(item, revision);
      if (item.status !== 'published' || !item.cms_article_id)
        throw new BadRequestException('Статья не опубликована');
      const cms = await m.findOne(ArticleEntity, {
        where: {
          id: item.cms_article_id,
          siteId: item.site_id,
          deletedAt: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cms || cms.revision !== item.cms_revision)
        throw new ConflictException(
          'Связанная статья изменена в CMS сайта. Обновите данные перед снятием.',
        );
      const before = Object.assign(new ArticleEntity(), cms);
      cms.publicationState = PublicationState.HIDDEN;
      cms.status = ArticleStatus.DRAFT;
      cms.revision++;
      cms.updatedByUserId = a.userId;
      await m.save(cms);
      await this.lifecycle.recordArticleChange(
        before,
        cms,
        a.userId,
        ContentEventType.PUBLICATION_CHANGED,
        'Снято с публикации из Контентного центра',
        true,
        m,
      );
      await m.query(
        "UPDATE cc_created_articles SET status='unpublished',published_number=NULL,publication_url=NULL,cms_revision=$2,revision=revision+1,updated_at=now() WHERE id=$1",
        [id, cms.revision],
      );
      const version = await this.service.version(item, item.current_number, m);
      await this.service.event(
        m,
        w,
        name,
        'article',
        'unpublished',
        item.cluster_id,
        id,
        version.snapshot.title,
        { version: item.published_number, url: item.publication_url },
        null,
      );
      return { ok: true };
    });
  }
}
