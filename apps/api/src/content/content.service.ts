import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import nodemailer from 'nodemailer';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import {
  ArticleEntity,
  ArticleRedirectEntity,
  ArticleActivityEntity,
  ArticleActivityType,
  ArticleStatus,
  AuthorEntity,
  BannerEntity,
  BannerPlacement,
  CategoryActivityEntity,
  CategoryEntity,
  CategoryRedirectEntity,
  CategoryStatus,
  ContentEntityType,
  ContentEventType,
  ContentTemplateKind,
  DomainStatus,
  MediaEntity,
  PageEntity,
  PageKind,
  PageStatus,
  PlatformRole,
  PublicationState,
  EditorialState,
  PrivacyPolicyStateEntity,
  SiteEntity,
  SiteType,
  WorkspaceMembershipEntity,
} from '../database/entities';
import {
  configuredDomainTargets,
  isReservedHostname,
  normalizeHostnameInput,
  normalizeRequestHost,
} from '../platform/site-domain';
import { buildPublicIntegrationManifest } from './public-integration-manifest';
import {
  getSiteContentCapabilities,
  SiteContentModule,
  siteSupportsContentModule,
} from './site-content-capabilities';
import {
  CreateArticleDto,
  CreateAuthorDto,
  CreateBannerDto,
  CreateCategoryDto,
  UpdateArticleDto,
  UpdateArticleBodyDto,
  UpdateAuthorDto,
  UpdateBannerDto,
  UpdateCategoryDto,
  AddArticleCommentDto,
  ChangeArticleStatusDto,
  ChangePageStatusDto,
  CreatePageDto,
  SubmitContactRequestDto,
  UpdateSiteSettingsDto,
  UpdateSiteGlobalsDto,
  UpdateSiteLayoutDto,
  UpdateSiteSeoDto,
  UpdateMediaDto,
  UpdatePageDto,
  UpdateNotFoundTemplateDto,
  DeleteCategoryDto,
} from './content.dto';
import { ContentLifecycleService } from './content-lifecycle.service';
import {
  articleDocumentMediaIds,
  articleDocumentText,
  normalizeArticleDocument,
} from './article-document';
import { detectImageMimeType } from './image-signature';
import { hasSitePermission, SitePermission } from './content.permissions';
import { privacyFingerprint } from '../privacy/privacy-generator';
import {
  getNotFoundTemplate,
  NOT_FOUND_TEMPLATES,
} from './not-found-templates';
import {
  ARMATUREX_HOME_TEMPLATE_KEY,
  ARMATUREX_HOME_TEMPLATE_VERSION,
  armaturexPageBlockMediaIds,
  validateArmaturexPageBlocks,
  validateGenericPageBlocks,
} from './armaturex-home-validation';

type Actor = { userId: string; platformRole: PlatformRole };

const fixedSystemPageTitles = new Map([
  ['privacy-policy', 'Политика конфиденциальности'],
  ['404', 'Страница 404'],
]);

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private readonly contactAttempts = new SlidingWindowRateLimiter(
    10 * 60 * 1000,
    5,
  );
  private readonly searchAttempts = new SlidingWindowRateLimiter(60 * 1000, 60);

  constructor(
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(AuthorEntity)
    private readonly authors: Repository<AuthorEntity>,
    @InjectRepository(ArticleEntity)
    private readonly articles: Repository<ArticleEntity>,
    @InjectRepository(ArticleActivityEntity)
    private readonly articleActivities: Repository<ArticleActivityEntity>,
    @InjectRepository(MediaEntity)
    private readonly media: Repository<MediaEntity>,
    @InjectRepository(PageEntity)
    private readonly pages: Repository<PageEntity>,
    @InjectRepository(BannerEntity)
    private readonly banners: Repository<BannerEntity>,
    @InjectRepository(PrivacyPolicyStateEntity)
    private readonly privacyPolicyStates?: Repository<PrivacyPolicyStateEntity>,
    @Optional()
    @InjectRepository(ArticleRedirectEntity)
    private readonly articleRedirects?: Repository<ArticleRedirectEntity>,
    @Optional()
    @InjectRepository(CategoryRedirectEntity)
    private readonly categoryRedirects?: Repository<CategoryRedirectEntity>,
    @Optional()
    @InjectRepository(CategoryActivityEntity)
    private readonly categoryActivities?: Repository<CategoryActivityEntity>,
    @Optional()
    private readonly lifecycle?: ContentLifecycleService,
  ) {}

  private categoryIsPublic(
    category: CategoryEntity | null | undefined,
    allowHidden = false,
  ) {
    return (
      !category ||
      (!category.deletedAt &&
        (category.publicationState === PublicationState.PUBLISHED ||
          (allowHidden &&
            category.publicationState === PublicationState.HIDDEN)) &&
        (!category.publishedAt || category.publishedAt <= new Date()))
    );
  }

  private articleIsPublic(article: ArticleEntity, allowHidden = false) {
    return (
      !article.deletedAt &&
      (article.publicationState === PublicationState.PUBLISHED ||
        (allowHidden &&
          article.publicationState === PublicationState.HIDDEN)) &&
      (article.publicationState === PublicationState.HIDDEN ||
        !article.publishedAt ||
        article.publishedAt <= new Date())
    );
  }

  private publicCanonicalBase(site: SiteEntity) {
    return (
      site.canonicalUrl ||
      (site.domain && site.domainStatus === DomainStatus.VERIFIED
        ? `https://${site.domain}`
        : null)
    );
  }

  private publicActor(
    user: { id: string; fullName: string } | null | undefined,
  ) {
    return user ? { id: user.id, fullName: user.fullName } : null;
  }

  private mailTransport() {
    const port = Number(process.env.SMTP_PORT ?? 25);
    const user = process.env.SMTP_USER?.trim();
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? '127.0.0.1',
      port,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 7000,
      secure:
        process.env.SMTP_SECURE !== undefined
          ? process.env.SMTP_SECURE === 'true'
          : port === 465,
      ...(user
        ? {
            auth: {
              user,
              pass: process.env.SMTP_PASS ?? '',
            },
          }
        : {}),
    });
  }

  private async requireSite(
    siteId: string,
    actor: Actor,
    permission = SitePermission.READ,
  ) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN) {
      const membership = await this.memberships.findOne({
        select: { role: true },
        where: {
          userId: actor.userId,
          workspaceId: site.workspaceId,
        },
      });
      if (
        !hasSitePermission(
          actor.platformRole,
          membership?.role ?? null,
          permission,
        )
      )
        throw new ForbiddenException('Недостаточно прав для этого действия');
    }
    return site;
  }

  private async requireSiteModule(
    siteId: string,
    actor: Actor,
    module: SiteContentModule,
    permission = SitePermission.READ,
  ) {
    const site = await this.requireSite(siteId, actor, permission);
    if (!siteSupportsContentModule(site.siteType, module))
      throw new BadRequestException(
        `Раздел «${
          {
            articles: 'Статьи',
            categories: 'Рубрики',
            authors: 'Авторы',
            pages: 'Страницы',
            banners: 'Баннеры',
          }[module]
        }» недоступен для этого типа сайта`,
      );
    return site;
  }

  private async workspaceMedia(
    siteId: string,
    mediaId: string,
    message = 'Изображение рабочего пространства не найдено',
  ) {
    const site = await this.sites.findOne({
      where: { id: siteId },
      select: { id: true, workspaceId: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const media = await this.media.findOne({
      where: { id: mediaId, workspaceId: site.workspaceId },
    });
    if (!media) throw new NotFoundException(message);
    return { site, media };
  }

  private async workspaceHasMedia(siteId: string, mediaId: string) {
    const site = await this.sites.findOne({
      where: { id: siteId },
      select: { id: true, workspaceId: true },
    });
    return Boolean(
      site &&
      (await this.media.existsBy({
        id: mediaId,
        workspaceId: site.workspaceId,
      })),
    );
  }

  async resolvePublicSiteByHost(rawHost?: string | null) {
    const host = normalizeRequestHost(rawHost);
    if (!host || isReservedHostname(host))
      throw new NotFoundException('Публичный домен не найден');
    const site = await this.sites
      .createQueryBuilder('site')
      .where('lower(site.domain) = :host', { host })
      .andWhere('site.domainStatus = :status', {
        status: DomainStatus.VERIFIED,
      })
      .andWhere('site.isActive = true')
      .getOne();
    if (!site) throw new NotFoundException('Публичный домен не найден');
    return { id: site.id, slug: site.slug, siteType: site.siteType };
  }

  async getPublicSite(siteSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
      relations: { linkedCommercialSite: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const capabilities = getSiteContentCapabilities(site.siteType);
    const [articles, pages, banners, categories] = await Promise.all([
      capabilities.articles
        ? this.articles.find({
            where: {
              siteId: site.id,
              publicationState: PublicationState.PUBLISHED,
              deletedAt: IsNull(),
              publishedAt: LessThanOrEqual(new Date()),
            },
            relations: {
              category: true,
              author: true,
              coverMedia: true,
              previewMedia: true,
            },
            order: {
              sortOrder: 'ASC',
              publishedAt: 'DESC',
              updatedAt: 'DESC',
            },
          })
        : Promise.resolve([]),
      this.pages.find({
        where: { siteId: site.id, status: PageStatus.PUBLISHED },
        order: { kind: 'ASC', title: 'ASC' },
      }),
      capabilities.banners
        ? this.banners.find({
            where: { siteId: site.id, isActive: true },
            relations: { media: true },
            order: { placement: 'ASC', sortOrder: 'ASC' },
          })
        : Promise.resolve([]),
      capabilities.categories
        ? this.categories.find({
            where: {
              siteId: site.id,
              publicationState: PublicationState.PUBLISHED,
              deletedAt: IsNull(),
            },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
          })
        : Promise.resolve([]),
    ]);
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        siteType: site.siteType,
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: this.publicCanonicalBase(site),
        seoImageMediaId: site.seoImageMediaId,
        noIndex: site.noIndex,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        linkedCommercialSite:
          site.siteType === SiteType.MEDIA &&
          site.linkedCommercialSite?.isActive
            ? {
                id: site.linkedCommercialSite.id,
                name: site.linkedCommercialSite.name,
                slug: site.linkedCommercialSite.slug,
                domain: site.linkedCommercialSite.domain,
                publicUrl:
                  site.linkedCommercialSite.domain &&
                  site.linkedCommercialSite.domainStatus ===
                    DomainStatus.VERIFIED
                    ? `https://${site.linkedCommercialSite.domain}`
                    : `/preview/${encodeURIComponent(site.linkedCommercialSite.slug)}`,
              }
            : null,
      },
      articles: articles.filter((article) =>
        this.categoryIsPublic(article.category),
      ),
      pages,
      banners,
      categories: categories.filter((category) =>
        this.categoryIsPublic(category),
      ),
    };
  }

  async getPublicIntegrationManifest(siteSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
      relations: { linkedCommercialSite: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    return buildPublicIntegrationManifest(site);
  }

  async searchPublicContent(
    siteSlug: string,
    rawQuery: string,
    clientKey = 'unknown',
  ) {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100)
      throw new BadRequestException(
        'Поисковый запрос должен содержать от 2 до 100 символов',
      );

    const normalizedSiteSlug = siteSlug.trim().toLowerCase();
    if (!this.searchAttempts.tryConsume(`${normalizedSiteSlug}:${clientKey}`))
      throw new HttpException(
        'Слишком много поисковых запросов. Попробуйте через минуту',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const site = await this.sites.findOne({
      where: { slug: normalizedSiteSlug, isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const capabilities = getSiteContentCapabilities(site.siteType);

    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escapedQuery}%`;
    const [articles, pages] = await Promise.all([
      capabilities.articles
        ? this.articles
            .createQueryBuilder('article')
            .where('article.siteId = :siteId', { siteId: site.id })
            .leftJoin('article.category', 'category')
            .andWhere('article.status = :articleStatus', {
              articleStatus: ArticleStatus.PUBLISHED,
            })
            .andWhere('article.publishedAt <= :now', { now: new Date() })
            .andWhere(
              `(article.categoryId IS NULL OR (category.status = :categoryStatus AND (category.publishedAt IS NULL OR category.publishedAt <= :now)))`,
              { categoryStatus: CategoryStatus.ACTIVE },
            )
            .andWhere(
              `(article.title ILIKE :pattern ESCAPE '\\' OR COALESCE(article.excerpt, '') ILIKE :pattern ESCAPE '\\' OR article.body ILIKE :pattern ESCAPE '\\')`,
              { pattern },
            )
            .orderBy({
              'article.sortOrder': 'ASC',
              'article.publishedAt': 'DESC',
              'article.updatedAt': 'DESC',
            })
            .limit(10)
            .getMany()
        : Promise.resolve([]),
      this.pages
        .createQueryBuilder('page')
        .where('page.siteId = :siteId', { siteId: site.id })
        .andWhere('page.status = :pageStatus', {
          pageStatus: PageStatus.PUBLISHED,
        })
        .andWhere(
          `(page.title ILIKE :pattern ESCAPE '\\' OR CAST(page.blocks AS text) ILIKE :pattern ESCAPE '\\')`,
          { pattern },
        )
        .orderBy('page.updatedAt', 'DESC')
        .limit(10)
        .getMany(),
    ]);

    const cleanExcerpt = (value: string) =>
      value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    const pageExcerpt = (page: PageEntity) =>
      cleanExcerpt(
        page.blocks
          .flatMap((block) => [block.title, block.text])
          .filter(Boolean)
          .join(' '),
      );

    return {
      query,
      results: [
        ...articles.map((article) => ({
          id: article.id,
          type: 'article' as const,
          title: article.title,
          slug: article.slug,
          excerpt: cleanExcerpt(article.excerpt || article.body),
          path: `/articles/${article.slug}`,
          updatedAt: article.updatedAt,
        })),
        ...pages.map((page) => ({
          id: page.id,
          type: 'page' as const,
          title: page.title,
          slug: page.slug,
          excerpt: pageExcerpt(page),
          path: page.kind === PageKind.HOMEPAGE ? '/' : `/pages/${page.slug}`,
          updatedAt: page.updatedAt,
        })),
      ]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .slice(0, 20)
        .map((result) => ({
          id: result.id,
          type: result.type,
          title: result.title,
          slug: result.slug,
          excerpt: result.excerpt,
          path: result.path,
        })),
    };
  }

  async getPublicMedia(siteSlug: string, mediaId: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const capabilities = getSiteContentCapabilities(site.siteType);
    const media = await this.media.findOne({
      where: { id: mediaId, workspaceId: site.workspaceId },
    });
    if (!media) throw new NotFoundException('Изображение не найдено');
    const [publishedPages, bannerUses, publicArticles, categoryUses] =
      await Promise.all([
        this.pages.find({
          where: { siteId: site.id, status: PageStatus.PUBLISHED },
          select: { blocks: true },
        }),
        capabilities.banners
          ? this.banners.existsBy({ siteId: site.id, isActive: true, mediaId })
          : Promise.resolve(false),
        capabilities.articles
          ? this.articles.find({
              where: {
                siteId: site.id,
                publicationState: In([
                  PublicationState.PUBLISHED,
                  PublicationState.HIDDEN,
                ]),
                deletedAt: IsNull(),
              },
              relations: { category: true },
            })
          : Promise.resolve([]),
        this.categories.find({
          where: { siteId: site.id, imageMediaId: mediaId },
        }),
      ]);
    const pageUses = publishedPages.some((page) =>
      page.blocks.some((block) => block.mediaId === mediaId),
    );
    const seoUses = site.seoImageMediaId === mediaId;
    const articleUses = publicArticles.some(
      (article) =>
        this.categoryIsPublic(article.category, true) &&
        (article.coverMediaId === mediaId ||
          article.previewMediaId === mediaId),
    );
    const articleDocumentUses = publicArticles.some(
      (article) =>
        this.categoryIsPublic(article.category, true) &&
        Boolean(
          article.bodyDocument &&
          articleDocumentMediaIds(article.bodyDocument).includes(mediaId),
        ),
    );
    const publicCategoryUses = categoryUses.some((category) =>
      this.categoryIsPublic(category, true),
    );
    if (
      !articleUses &&
      !articleDocumentUses &&
      !publicCategoryUses &&
      !pageUses &&
      !bannerUses &&
      !seoUses
    )
      throw new NotFoundException('Изображение не опубликовано');
    return {
      path: join(
        process.env.MEDIA_ROOT ?? '/data/media',
        media.storageNamespace,
        media.storedName,
      ),
      mimeType: media.mimeType,
    };
  }

  async getPublicArticle(siteSlug: string, articleSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (!siteSupportsContentModule(site.siteType, 'articles'))
      throw new NotFoundException('Материал не найден');
    const normalizedArticleSlug = articleSlug.trim().toLowerCase();
    let article = await this.articles.findOne({
      where: {
        siteId: site.id,
        slug: normalizedArticleSlug,
        deletedAt: IsNull(),
      },
      relations: {
        category: true,
        author: true,
        coverMedia: true,
        previewMedia: true,
      },
    });
    let redirectTo: string | null = null;
    if (!article && this.articleRedirects) {
      const redirect = await this.articleRedirects.findOne({
        where: { siteId: site.id, fromSlug: normalizedArticleSlug },
      });
      if (redirect) {
        article = await this.articles.findOne({
          where: {
            id: redirect.articleId,
            siteId: site.id,
            deletedAt: IsNull(),
          },
          relations: {
            category: true,
            author: true,
            coverMedia: true,
            previewMedia: true,
          },
        });
        redirectTo = article?.slug ?? null;
      }
    }
    if (!article || !this.articleIsPublic(article, true))
      throw new NotFoundException('Материал не найден');
    if (!this.categoryIsPublic(article.category, true))
      throw new NotFoundException('Материал не найден');
    const [related, pages, banners] = await Promise.all([
      this.lifecycle?.resolveRelatedArticles(site.id, article.id, true) ??
        Promise.resolve([]),
      this.pages.find({
        where: {
          siteId: site.id,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
        select: { id: true, title: true, slug: true },
        order: { title: 'ASC' },
      }),
      this.banners.find({
        where: {
          siteId: site.id,
          isActive: true,
          placement: BannerPlacement.ARTICLE_SIDEBAR,
        },
        relations: { media: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: this.publicCanonicalBase(site),
        seoImageMediaId: site.seoImageMediaId,
        noIndex: site.noIndex,
      },
      article:
        article.createdBy || article.updatedBy
          ? {
              ...article,
              createdBy: this.publicActor(article.createdBy),
              updatedBy: this.publicActor(article.updatedBy),
            }
          : article,
      redirectTo,
      pages,
      banners,
      related,
    };
  }

  async getPublicCategory(siteSlug: string, categorySlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const slug = categorySlug.trim().toLowerCase();
    let category = await this.categories.findOne({
      where: { siteId: site.id, slug, deletedAt: IsNull() },
      relations: { imageMedia: true },
    });
    let redirectTo: string | null = null;
    if (
      (!category || !this.categoryIsPublic(category, true)) &&
      this.categoryRedirects
    ) {
      const redirect = await this.categoryRedirects.findOne({
        where: { siteId: site.id, fromSlug: slug },
      });
      if (redirect) {
        category = await this.categories.findOne({
          where: {
            id: redirect.categoryId,
            siteId: site.id,
            deletedAt: IsNull(),
          },
          relations: { imageMedia: true },
        });
        if (category && this.categoryIsPublic(category, true))
          redirectTo = category.slug;
      }
    }
    if (!category || !this.categoryIsPublic(category, true))
      throw new NotFoundException('Рубрика не найдена');
    const [articles, children, pages] = await Promise.all([
      this.articles.find({
        where: {
          siteId: site.id,
          categoryId: category.id,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
          publishedAt: LessThanOrEqual(new Date()),
        },
        relations: { author: true, coverMedia: true, previewMedia: true },
        order: {
          sortOrder: 'ASC',
          publishedAt: 'DESC',
          updatedAt: 'DESC',
        },
      }),
      this.categories.find({
        where: {
          siteId: site.id,
          parentId: category.id,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.pages.find({
        where: {
          siteId: site.id,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
        select: { id: true, title: true, slug: true },
        order: { title: 'ASC' },
      }),
    ]);
    return {
      site: {
        name: site.name,
        slug: site.slug,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        canonicalUrl: this.publicCanonicalBase(site),
        noIndex: site.noIndex,
      },
      category,
      redirectTo,
      articles,
      children: children.filter((item) => this.categoryIsPublic(item)),
      pages,
    };
  }

  async getPublicPage(siteSlug: string, pageSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (pageSlug.trim().toLowerCase() === '404')
      throw new NotFoundException('Страница не найдена');
    const page = await this.pages.findOne({
      where: {
        siteId: site.id,
        slug: pageSlug.trim().toLowerCase(),
        kind: PageKind.PAGE,
        status: PageStatus.PUBLISHED,
      },
    });
    if (!page) throw new NotFoundException('Страница не найдена');
    const pages = await this.pages.find({
      where: {
        siteId: site.id,
        status: PageStatus.PUBLISHED,
        kind: PageKind.PAGE,
      },
      select: { id: true, title: true, slug: true },
      order: { title: 'ASC' },
    });
    const privacyDisplay =
      page.slug === 'privacy-policy'
        ? await this.privacyPolicyStates?.findOne({
            where: { siteId: site.id, pageId: page.id },
          })
        : null;
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: this.publicCanonicalBase(site),
        seoImageMediaId: site.seoImageMediaId,
        noIndex: site.noIndex,
      },
      page,
      pages,
      privacyDisplay: privacyDisplay
        ? {
            key: privacyDisplay.publishedDisplayTemplateKey ?? 'system-policy',
            version: privacyDisplay.publishedDisplayTemplateVersion ?? '1',
            config: privacyDisplay.publishedDisplayTemplateConfig ?? {},
          }
        : null,
    };
  }

  async getPublicNotFoundPage(siteSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const [page, pages] = await Promise.all([
      this.pages.findOne({ where: { siteId: site.id, slug: '404' } }),
      this.pages.find({
        where: {
          siteId: site.id,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
        select: { id: true, title: true, slug: true },
        order: { title: 'ASC' },
      }),
    ]);
    const active = page?.status === PageStatus.PUBLISHED;
    const template = active
      ? getNotFoundTemplate(
          page.publishedSystemTemplateKey,
          page.publishedSystemTemplateVersion,
        )
      : getNotFoundTemplate();
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
      },
      pages: pages.filter((item) => item.slug !== '404'),
      active,
      template,
    };
  }

  async getArticlePreview(siteId: string, articleId: string, actor: Actor) {
    const site = await this.requireSiteModule(siteId, actor, 'articles');
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
      relations: {
        category: true,
        author: true,
        coverMedia: true,
        previewMedia: true,
        createdBy: true,
        updatedBy: true,
      },
    });
    if (!article) throw new NotFoundException('Материал не найден');
    const [related, pages, banners] = await Promise.all([
      this.lifecycle?.resolveRelatedArticles(siteId, article.id, false) ??
        Promise.resolve([]),
      this.pages.find({
        where: {
          siteId,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
        select: { id: true, title: true, slug: true },
        order: { title: 'ASC' },
      }),
      this.banners.find({
        where: {
          siteId,
          isActive: true,
          placement: BannerPlacement.ARTICLE_SIDEBAR,
        },
        relations: { media: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: null,
        seoImageMediaId: site.seoImageMediaId,
        noIndex: true,
      },
      article:
        article.createdBy || article.updatedBy
          ? {
              ...article,
              createdBy: this.publicActor(article.createdBy),
              updatedBy: this.publicActor(article.updatedBy),
            }
          : article,
      pages,
      banners,
      related,
    };
  }

  async getPagePreview(siteId: string, pageId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    const [navigationPages, articles, banners] = await Promise.all([
      this.pages.find({
        where: {
          siteId,
          status: PageStatus.PUBLISHED,
          kind: PageKind.PAGE,
        },
        order: { title: 'ASC' },
      }),
      this.articles.find({
        where: {
          siteId,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
          publishedAt: LessThanOrEqual(new Date()),
        },
        relations: {
          category: true,
          author: true,
          coverMedia: true,
          previewMedia: true,
        },
        order: {
          sortOrder: 'ASC',
          publishedAt: 'DESC',
          updatedAt: 'DESC',
        },
      }),
      this.banners.find({
        where: { siteId, isActive: true },
        relations: { media: true },
        order: { placement: 'ASC', sortOrder: 'ASC' },
      }),
    ]);
    const privacyDisplay =
      page.slug === 'privacy-policy'
        ? await this.privacyPolicyStates?.findOne({
            where: { siteId, pageId: page.id },
          })
        : null;
    return {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        siteType: site.siteType,
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: null,
        seoImageMediaId: site.seoImageMediaId,
        noIndex: true,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
      },
      page,
      pages:
        page.kind === PageKind.HOMEPAGE
          ? [page, ...navigationPages]
          : navigationPages,
      articles,
      banners,
      privacyDisplay: privacyDisplay
        ? {
            key: privacyDisplay.displayTemplateKey,
            version: privacyDisplay.displayTemplateVersion,
            config: privacyDisplay.displayTemplateConfig ?? {},
          }
        : null,
      notFoundDisplay:
        page.slug === '404'
          ? getNotFoundTemplate(
              page.systemTemplateKey,
              page.systemTemplateVersion,
            )
          : null,
    };
  }

  async submitContactRequest(
    siteSlug: string,
    ip: string,
    dto: SubmitContactRequestDto,
  ) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (dto.website) return { ok: true };
    if (!dto.consent)
      throw new BadRequestException('Нужно согласие на обработку данных');

    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    if (!email && !phone)
      throw new BadRequestException('Укажите телефон или электронную почту');
    if (!site.notificationEmail)
      throw new ServiceUnavailableException(
        'Форма временно недоступна: получатель ещё не настроен',
      );

    const rateKey = `${site.id}:${ip}`;
    if (!this.contactAttempts.tryConsume(rateKey))
      throw new HttpException(
        'Слишком много заявок. Попробуйте ещё раз через несколько минут',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const lines = [
      `Новая заявка с сайта «${site.name}»`,
      '',
      `Имя: ${dto.name.trim()}`,
      `Телефон: ${phone || 'не указан'}`,
      `Почта: ${email || 'не указана'}`,
      '',
      'Сообщение:',
      dto.message?.trim() || 'не указано',
      '',
      `Сайт: ${site.slug}`,
      `IP: ${ip}`,
      `Дата: ${new Date().toISOString()}`,
    ];

    try {
      await this.mailTransport().sendMail({
        from: process.env.MAIL_FROM ?? 'Wispo CMS <noreply@crazy.studio>',
        to: site.notificationEmail,
        replyTo: email,
        subject: `Новая заявка — ${site.name.replace(/[\r\n]/g, ' ')}`,
        text: lines.join('\n'),
      });
    } catch (error) {
      this.logger.error(
        `Contact email delivery failed for site ${site.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Не удалось отправить заявку. Попробуйте ещё раз позже',
      );
    }

    return { ok: true };
  }

  async sendContactTestEmail(siteId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.MANAGE_SETTINGS,
    );
    if (!site.notificationEmail)
      throw new ServiceUnavailableException(
        'Сначала сохраните почту для заявок',
      );

    try {
      await this.mailTransport().sendMail({
        from: process.env.MAIL_FROM ?? 'Wispo CMS <noreply@crazy.studio>',
        to: site.notificationEmail,
        subject: `Проверка заявок — ${site.name.replace(/[\r\n]/g, ' ')}`,
        text: [
          `Тестовое письмо с сайта «${site.name}».`,
          '',
          'Почта для заявок настроена правильно.',
          'Теперь обращения с публичной формы будут приходить на этот адрес.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(
        `Contact test email delivery failed for site ${site.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Не удалось отправить тестовое письмо. Проверьте почтовый сервер',
      );
    }

    return { ok: true, email: site.notificationEmail };
  }

  async getContactEmailStatus(siteId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.MANAGE_SETTINGS,
    );
    try {
      await this.mailTransport().verify();
      return {
        recipientConfigured: Boolean(site.notificationEmail),
        transportReady: true,
      };
    } catch (error) {
      this.logger.warn(
        `Contact email transport check failed for site ${site.id}`,
        error instanceof Error ? error.message : undefined,
      );
      return {
        recipientConfigured: Boolean(site.notificationEmail),
        transportReady: false,
      };
    }
  }

  async getSiteSettings(siteId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.MANAGE_SETTINGS,
    );
    const [linkedCommercialSite, commercialSiteOptions] = await Promise.all([
      site.linkedCommercialSiteId
        ? this.sites.findOne({
            where: { id: site.linkedCommercialSiteId },
            select: {
              id: true,
              name: true,
              slug: true,
              domain: true,
              isActive: true,
              siteType: true,
            },
          })
        : Promise.resolve(null),
      site.siteType === SiteType.MEDIA
        ? this.sites.find({
            where: {
              workspaceId: site.workspaceId,
              siteType: In([
                SiteType.CORPORATE,
                SiteType.ECOMMERCE,
                SiteType.LANDING,
              ]),
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              slug: true,
              domain: true,
              siteType: true,
            },
            order: { name: 'ASC' },
          })
        : Promise.resolve([]),
    ]);
    return {
      id: site.id,
      workspaceId: site.workspaceId,
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      domainStatus: site.domainStatus,
      domainCheckedAt: site.domainCheckedAt,
      domainStatusMessage: site.domainStatusMessage,
      expectedDnsRecords: configuredDomainTargets(),
      siteType: site.siteType,
      linkedCommercialSiteId: site.linkedCommercialSiteId,
      linkedCommercialSite,
      commercialSiteOptions,
      seoTitle: site.seoTitle,
      seoDescription: site.seoDescription,
      notificationEmail: site.notificationEmail,
    };
  }

  async updateSiteSettings(
    siteId: string,
    actor: Actor,
    dto: UpdateSiteSettingsDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.MANAGE_SETTINGS,
    );
    const domain =
      dto.domain === undefined
        ? site.domain
        : normalizeHostnameInput(dto.domain);
    const domainOwner =
      dto.domain !== undefined && domain
        ? await this.sites.findOne({ where: { domain } })
        : null;
    if (domainOwner && domainOwner.id !== site.id)
      throw new ConflictException('Этот домен уже назначен другому сайту');
    if (dto.linkedCommercialSiteId !== undefined) {
      if (site.siteType !== SiteType.MEDIA && dto.linkedCommercialSiteId)
        throw new BadRequestException(
          'Связанный коммерческий сайт можно выбрать только для Media',
        );
      if (dto.linkedCommercialSiteId) {
        const target = await this.sites.findOneBy({
          id: dto.linkedCommercialSiteId,
        });
        if (
          !target ||
          !target.isActive ||
          target.id === site.id ||
          target.workspaceId !== site.workspaceId ||
          ![SiteType.CORPORATE, SiteType.ECOMMERCE, SiteType.LANDING].includes(
            target.siteType,
          )
        )
          throw new BadRequestException(
            'Выберите активный Corporate, Ecommerce или Landing из этого рабочего пространства',
          );
        site.linkedCommercialSiteId = target.id;
      } else {
        site.linkedCommercialSiteId = null;
      }
    }
    site.name = dto.name.trim();
    if (dto.domain !== undefined && domain !== site.domain) {
      site.domain = domain;
      site.domainStatus = domain
        ? DomainStatus.PENDING
        : DomainStatus.NOT_CONFIGURED;
      site.domainCheckedAt = null;
      site.domainStatusMessage = null;
    }
    if (dto.seoTitle !== undefined)
      site.seoTitle = dto.seoTitle?.trim() || null;
    if (dto.seoDescription !== undefined)
      site.seoDescription = dto.seoDescription?.trim() || null;
    site.notificationEmail =
      dto.notificationEmail?.trim().toLowerCase() || null;
    await this.sites.save(site);
    return this.getSiteSettings(siteId, actor);
  }

  async verifySiteDomain(siteId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.MANAGE_SETTINGS,
    );
    if (!site.domain)
      throw new BadRequestException('Сначала укажите домен сайта');
    const targets = configuredDomainTargets();
    site.domainCheckedAt = new Date();
    if (!targets.length) {
      site.domainStatus = DomainStatus.ERROR;
      site.domainStatusMessage =
        'Проверка DNS не настроена администратором платформы';
      await this.sites.save(site);
      return this.getSiteSettings(siteId, actor);
    }
    const resolutions = await Promise.allSettled([
      resolve4(site.domain),
      resolve6(site.domain),
      resolveCname(site.domain),
    ]);
    const actual = resolutions.flatMap((result) =>
      result.status === 'fulfilled'
        ? result.value.map((value) => value.toLowerCase().replace(/\.$/, ''))
        : [],
    );
    const verified = actual.some((value) => targets.includes(value));
    site.domainStatus = verified ? DomainStatus.VERIFIED : DomainStatus.ERROR;
    site.domainStatusMessage = verified
      ? 'DNS указывает на публичный контур Wispo'
      : `Ожидается запись: ${targets.join(' или ')}`;
    await this.sites.save(site);
    return this.getSiteSettings(siteId, actor);
  }

  async getSiteGlobals(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    return { siteId: site.id, ...site.globalData };
  }

  async updateSiteGlobals(
    siteId: string,
    actor: Actor,
    dto: UpdateSiteGlobalsDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const value = (input?: string) => input?.trim() || undefined;
    site.globalData = {
      ...(site.globalData ?? {}),
      ...(dto.companyName !== undefined && {
        companyName: value(dto.companyName),
      }),
      ...(dto.organizationType !== undefined && {
        organizationType: dto.organizationType || undefined,
      }),
      ...(dto.legalName !== undefined && { legalName: value(dto.legalName) }),
      ...(dto.inn !== undefined && { inn: value(dto.inn) }),
      ...(dto.ogrn !== undefined && { ogrn: value(dto.ogrn) }),
      ...(dto.legalAddress !== undefined && {
        legalAddress: value(dto.legalAddress),
      }),
      ...(dto.phone !== undefined && { phone: value(dto.phone) }),
      ...(dto.email !== undefined && {
        email: value(dto.email)?.toLowerCase(),
      }),
      ...(dto.address !== undefined && { address: value(dto.address) }),
      ...(dto.telegramUrl !== undefined && {
        telegramUrl: value(dto.telegramUrl),
      }),
      ...(dto.vkUrl !== undefined && { vkUrl: value(dto.vkUrl) }),
    };
    await this.sites.save(site);
    return { siteId: site.id, ...site.globalData };
  }

  async getSiteLayout(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    return { siteId: site.id, ...site.layoutSettings };
  }

  async getSiteSeo(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    return {
      siteId: site.id,
      seoTitle: site.seoTitle,
      seoDescription: site.seoDescription,
      canonicalUrl: site.canonicalUrl,
      seoImageMediaId: site.seoImageMediaId,
      noIndex: site.noIndex,
    };
  }

  async updateSiteSeo(siteId: string, actor: Actor, dto: UpdateSiteSeoDto) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    if (
      dto.seoImageMediaId &&
      !(await this.workspaceHasMedia(siteId, dto.seoImageMediaId))
    )
      throw new NotFoundException('SEO-изображение не найдено');
    if (dto.seoTitle !== undefined)
      site.seoTitle = dto.seoTitle?.trim() || null;
    if (dto.seoDescription !== undefined)
      site.seoDescription = dto.seoDescription?.trim() || null;
    if (dto.canonicalUrl !== undefined)
      site.canonicalUrl = dto.canonicalUrl?.trim().replace(/\/$/, '') || null;
    if (dto.seoImageMediaId !== undefined)
      site.seoImageMediaId = dto.seoImageMediaId || null;
    if (dto.noIndex !== undefined) site.noIndex = dto.noIndex;
    await this.sites.save(site);
    return this.getSiteSeo(siteId, actor);
  }

  async updateSiteLayout(
    siteId: string,
    actor: Actor,
    dto: UpdateSiteLayoutDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    if (
      dto.logoMediaId &&
      !(await this.workspaceHasMedia(siteId, dto.logoMediaId))
    )
      throw new NotFoundException('Логотип не найден');
    const value = (input?: string) => input?.trim() || undefined;
    site.layoutSettings = {
      ...site.layoutSettings,
      ...(dto.logoText !== undefined && { logoText: value(dto.logoText) }),
      ...(dto.logoMediaId !== undefined && {
        logoMediaId: dto.logoMediaId || undefined,
      }),
      ...(dto.showPages !== undefined && { showPages: dto.showPages }),
      ...(dto.showArticles !== undefined && {
        showArticles: dto.showArticles,
      }),
      ...(dto.ctaLabel !== undefined && { ctaLabel: value(dto.ctaLabel) }),
      ...(dto.ctaUrl !== undefined && { ctaUrl: value(dto.ctaUrl) }),
      ...(dto.footerDescription !== undefined && {
        footerDescription: value(dto.footerDescription),
      }),
      ...(dto.showContacts !== undefined && {
        showContacts: dto.showContacts,
      }),
      ...(dto.showSocials !== undefined && { showSocials: dto.showSocials }),
    };
    await this.sites.save(site);
    return { siteId: site.id, ...site.layoutSettings };
  }

  async listBanners(siteId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'banners');
    return this.banners.find({
      where: { siteId },
      relations: { media: true },
      order: { placement: 'ASC', sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  private async validateBannerMedia(siteId: string, mediaId?: string | null) {
    if (mediaId && !(await this.workspaceHasMedia(siteId, mediaId)))
      throw new NotFoundException(
        'Изображение рабочего пространства не найдено',
      );
  }

  async createBanner(siteId: string, actor: Actor, dto: CreateBannerDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.EDIT_CONTENT,
    );
    await this.validateBannerMedia(siteId, dto.mediaId);
    return this.banners.save(
      this.banners.create({
        siteId,
        name: dto.name.trim(),
        placement: dto.placement,
        title: dto.title?.trim() || null,
        linkUrl: dto.linkUrl?.trim() || null,
        mediaId: dto.mediaId || null,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      }),
    );
  }

  async updateBanner(
    siteId: string,
    bannerId: string,
    actor: Actor,
    dto: UpdateBannerDto,
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.EDIT_CONTENT,
    );
    const banner = await this.banners.findOne({
      where: { id: bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер не найден');
    await this.validateBannerMedia(siteId, dto.mediaId);
    if (dto.name !== undefined) banner.name = dto.name.trim();
    if (dto.placement !== undefined) banner.placement = dto.placement;
    if (dto.title !== undefined) banner.title = dto.title?.trim() || null;
    if (dto.linkUrl !== undefined) banner.linkUrl = dto.linkUrl?.trim() || null;
    if (dto.mediaId !== undefined) banner.mediaId = dto.mediaId || null;
    if (dto.sortOrder !== undefined) banner.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) banner.isActive = dto.isActive;
    return this.banners.save(banner);
  }

  async deleteBanner(siteId: string, bannerId: string, actor: Actor) {
    await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.EDIT_CONTENT,
    );
    const banner = await this.banners.findOne({
      where: { id: bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер не найден');
    await this.banners.remove(banner);
    return { id: bannerId };
  }

  private async validateLinks(
    siteId: string,
    categoryId?: string,
    authorId?: string,
    coverMediaId?: string,
    previewMediaId?: string,
  ) {
    if (
      categoryId &&
      !(await this.categories.existsBy({ id: categoryId, siteId }))
    )
      throw new NotFoundException('Категория этого сайта не найдена');
    if (authorId && !(await this.authors.existsBy({ id: authorId, siteId })))
      throw new NotFoundException('Автор этого сайта не найден');
    if (coverMediaId && !(await this.workspaceHasMedia(siteId, coverMediaId)))
      throw new NotFoundException('Обложка этого сайта не найдена');
    if (
      previewMediaId &&
      !(await this.workspaceHasMedia(siteId, previewMediaId))
    )
      throw new NotFoundException('Изображение превью этого сайта не найдено');
  }

  private async validateArticleDocumentMedia(
    siteId: string,
    document: ReturnType<typeof normalizeArticleDocument>,
  ) {
    const mediaIds = [...new Set(articleDocumentMediaIds(document))];
    for (const mediaId of mediaIds) {
      if (!(await this.workspaceHasMedia(siteId, mediaId)))
        throw new NotFoundException(
          'Изображение одного из блоков этого сайта не найдено',
        );
    }
  }

  async listArticles(siteId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'articles');
    const rows = await this.articles.find({
      where: { siteId, deletedAt: IsNull() },
      relations: {
        category: true,
        author: true,
        coverMedia: true,
        previewMedia: true,
        createdBy: true,
        updatedBy: true,
      },
      order: { sortOrder: 'ASC', updatedAt: 'DESC' },
    });
    return rows.map((article) => ({
      ...article,
      createdBy: this.publicActor(article.createdBy),
      updatedBy: this.publicActor(article.updatedBy),
    }));
  }

  async listSiteActivity(siteId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'articles');
    const rows = await this.articleActivities.find({
      where: { article: { siteId } },
      relations: { article: true, user: true },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      createdAt: row.createdAt,
      article: { id: row.article.id, title: row.article.title },
      user: { id: row.user.id, fullName: row.user.fullName },
    }));
  }

  async createArticle(siteId: string, actor: Actor, dto: CreateArticleDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      SitePermission.EDIT_CONTENT,
    );
    await this.validateLinks(
      siteId,
      dto.categoryId,
      dto.authorId,
      dto.coverMediaId,
      dto.previewMediaId,
    );
    const slug = dto.slug.trim().toLowerCase();
    if (new Set(['404', 'privacy-policy', 'search']).has(slug))
      throw new ConflictException('Этот slug зарезервирован системой');
    const reservedRedirect = await this.articleRedirects?.findOne({
      where: { siteId, fromSlug: slug },
    });
    if (reservedRedirect)
      throw new ConflictException(
        'Этот slug уже сохранён как прежний адрес другой статьи',
      );
    if (await this.articles.existsBy({ siteId, slug }))
      throw new ConflictException('Такой slug статьи уже используется');
    if (
      (dto.status && dto.status !== ArticleStatus.DRAFT) ||
      (dto.publicationState &&
        dto.publicationState !== PublicationState.DRAFT) ||
      (dto.editorialState && dto.editorialState !== EditorialState.DRAFT)
    )
      throw new BadRequestException(
        'Новый материал сначала нужно сохранить как черновик',
      );
    const status = ArticleStatus.DRAFT;
    const bodyDocument = normalizeArticleDocument(
      dto.bodyDocument,
      dto.body ?? '',
    );
    await this.validateArticleDocumentMedia(siteId, bodyDocument);
    const body = dto.bodyDocument
      ? articleDocumentText(bodyDocument)
      : (dto.body ?? '');
    const displayTemplateKey =
      dto.displayTemplateKey?.trim() || 'standard-article';
    const displayTemplateVersion = dto.displayTemplateVersion?.trim() || '1';
    await this.lifecycle?.assertTemplate(
      siteId,
      ContentTemplateKind.ARTICLE,
      displayTemplateKey,
      displayTemplateVersion,
    );
    return this.articles.manager.transaction(async (manager) => {
      if (await manager.exists(ArticleEntity, { where: { siteId, slug } }))
        throw new ConflictException('Такой slug статьи уже используется');
      if (
        await manager.exists(ArticleRedirectEntity, {
          where: { siteId, fromSlug: slug },
        })
      )
        throw new ConflictException(
          'Этот slug уже сохранён как прежний адрес другой статьи',
        );
      const article = await manager.save(
        manager.create(ArticleEntity, {
          siteId,
          title: dto.title.trim(),
          slug,
          excerpt: dto.excerpt?.trim() || null,
          body,
          bodyDocument,
          documentVersion: bodyDocument.version,
          status,
          publicationState: PublicationState.DRAFT,
          editorialState: EditorialState.DRAFT,
          displayTemplateKey,
          displayTemplateVersion,
          displayTemplateConfig: dto.displayTemplateConfig ?? {},
          deletedAt: null,
          deletedByUserId: null,
          categoryId: dto.categoryId ?? null,
          authorId: dto.authorId ?? null,
          coverMediaId: dto.coverMediaId ?? null,
          previewMediaId: dto.previewMediaId ?? null,
          sortOrder: dto.sortOrder ?? 0,
          seoTitle: dto.seoTitle?.trim() || null,
          seoDescription: dto.seoDescription?.trim() || null,
          canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
          noIndex: dto.noIndex ?? false,
          publishedAt: null,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        }),
      );
      await manager.save(
        manager.create(ArticleActivityEntity, {
          articleId: article.id,
          userId: actor.userId,
          type: ArticleActivityType.UPDATED,
          message: 'Материал создан',
          fromStatus: null,
          toStatus: article.status,
        }),
      );
      await this.lifecycle?.recordArticleChange(
        null,
        article,
        actor.userId,
        ContentEventType.CREATED,
        'article created',
        true,
        manager,
      );
      return article;
    });
  }

  async updateArticle(
    siteId: string,
    articleId: string,
    actor: Actor,
    dto: UpdateArticleDto,
  ) {
    await this.requireSiteModule(siteId, actor, 'articles');
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      article.publicationState === PublicationState.PUBLISHED ||
        article.publicationState === PublicationState.HIDDEN
        ? SitePermission.EDIT_PUBLISHED
        : SitePermission.EDIT_CONTENT,
    );
    await this.validateLinks(
      siteId,
      dto.categoryId,
      dto.authorId,
      dto.coverMediaId,
      dto.previewMediaId,
    );
    const displayTemplateKey =
      dto.displayTemplateKey?.trim() || article.displayTemplateKey;
    const displayTemplateVersion =
      dto.displayTemplateVersion?.trim() || article.displayTemplateVersion;
    await this.lifecycle?.assertTemplate(
      siteId,
      ContentTemplateKind.ARTICLE,
      displayTemplateKey,
      displayTemplateVersion,
    );
    const slug = dto.slug.trim().toLowerCase();
    const reservedSlugs = new Set(['404', 'privacy-policy', 'search']);
    if (reservedSlugs.has(slug))
      throw new ConflictException('Этот slug зарезервирован системой');
    if (
      (dto.status && dto.status !== article.status) ||
      (dto.publicationState &&
        dto.publicationState !== article.publicationState) ||
      (dto.editorialState && dto.editorialState !== article.editorialState)
    )
      throw new BadRequestException(
        'Статусы материала изменяются только через отдельные процессы',
      );
    const changes = {
      title: dto.title.trim(),
      slug,
      excerpt: dto.excerpt?.trim() || null,
      categoryId: dto.categoryId ?? null,
      authorId: dto.authorId ?? null,
      coverMediaId: dto.coverMediaId ?? null,
      previewMediaId: dto.previewMediaId ?? null,
      sortOrder: dto.sortOrder ?? article.sortOrder ?? 0,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
      canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
      noIndex: dto.noIndex ?? false,
      displayTemplateKey,
      displayTemplateVersion,
      displayTemplateConfig:
        dto.displayTemplateConfig ?? article.displayTemplateConfig,
      publishedAt:
        dto.publishedAt === undefined
          ? article.publishedAt
          : dto.publishedAt
            ? new Date(dto.publishedAt)
            : null,
      updatedByUserId: actor.userId,
    };
    return this.articles.manager.transaction(async (manager) => {
      const locked = await manager.findOne(ArticleEntity, {
        where: { id: articleId, siteId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Статья не найдена');
      const before = Object.assign(new ArticleEntity(), locked);
      const previousSlug = locked.slug;
      const slugChanged = previousSlug !== slug;
      const transactionalDuplicate = await manager.findOne(ArticleEntity, {
        where: { siteId, slug },
      });
      if (transactionalDuplicate && transactionalDuplicate.id !== locked.id)
        throw new ConflictException('Такой slug статьи уже используется');
      const targetRedirect = await manager.findOne(ArticleRedirectEntity, {
        where: { siteId, fromSlug: slug },
      });
      if (targetRedirect && targetRedirect.articleId !== locked.id)
        throw new ConflictException(
          'Этот slug уже сохранён как прежний адрес другой статьи',
        );
      if (slugChanged) {
        const previousRedirect = await manager.findOne(ArticleRedirectEntity, {
          where: { siteId, fromSlug: previousSlug },
        });
        if (previousRedirect && previousRedirect.articleId !== locked.id)
          throw new ConflictException(
            'Прежний адрес принадлежит другой статье',
          );
        if (targetRedirect)
          await manager.delete(ArticleRedirectEntity, {
            siteId,
            fromSlug: slug,
          });
      }
      await manager.update(
        ArticleEntity,
        { id: locked.id, siteId },
        changes as never,
      );
      const saved = Object.assign(locked, changes);
      if (slugChanged)
        await manager.upsert(
          ArticleRedirectEntity,
          { siteId, articleId: locked.id, fromSlug: previousSlug },
          ['siteId', 'fromSlug'],
        );
      await manager.save(
        manager.create(ArticleActivityEntity, {
          articleId: locked.id,
          userId: actor.userId,
          type: ArticleActivityType.UPDATED,
          message: 'Содержимое материала обновлено',
          fromStatus: null,
          toStatus: null,
        }),
      );
      await this.lifecycle?.recordArticleChange(
        before,
        saved,
        actor.userId,
        ContentEventType.PARAMETERS_UPDATED,
        'article parameters saved',
        true,
        manager,
      );
      if (slugChanged)
        await this.lifecycle?.recordEvent(
          {
            siteId,
            entityType: ContentEntityType.ARTICLE,
            entityId: locked.id,
            eventType: ContentEventType.REDIRECT_CREATED,
            actorUserId: actor.userId,
            reason: 'slug changed',
            before: { slug: previousSlug },
            after: { slug },
          },
          manager,
        );
      return saved;
    });
  }

  async updateArticleBody(
    siteId: string,
    articleId: string,
    actor: Actor,
    dto: UpdateArticleBodyDto,
  ) {
    await this.requireSiteModule(siteId, actor, 'articles');
    const article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      article.publicationState === PublicationState.PUBLISHED ||
        article.publicationState === PublicationState.HIDDEN
        ? SitePermission.EDIT_PUBLISHED
        : SitePermission.EDIT_CONTENT,
    );
    if (dto.body === undefined && dto.bodyDocument === undefined)
      throw new BadRequestException('Передайте текст или документ статьи');
    const before = Object.assign(new ArticleEntity(), article);
    const bodyDocument = normalizeArticleDocument(
      dto.bodyDocument,
      dto.body ?? article.body,
    );
    await this.validateArticleDocumentMedia(siteId, bodyDocument);
    const body = dto.bodyDocument
      ? articleDocumentText(bodyDocument)
      : (dto.body ?? article.body);
    const nextUpdatedAt = new Date();
    return this.articles.manager.transaction(async (manager) => {
      const result = await manager.update(
        ArticleEntity,
        { id: articleId, siteId, revision: dto.expectedRevision },
        {
          body,
          bodyDocument,
          documentVersion: bodyDocument.version,
          revision: dto.expectedRevision + 1,
          updatedAt: nextUpdatedAt,
          updatedByUserId: actor.userId,
        },
      );
      if (result.affected !== 1)
        throw new ConflictException(
          'Материал уже изменён. Обновите данные и повторите сохранение',
        );
      await manager.save(
        manager.create(ArticleActivityEntity, {
          articleId,
          userId: actor.userId,
          type: ArticleActivityType.UPDATED,
          message: 'Текст материала сохранён автоматически',
          fromStatus: null,
          toStatus: null,
        }),
      );
      const savedArticle = await manager.findOneByOrFail(ArticleEntity, {
        id: articleId,
        siteId,
      });
      await this.lifecycle?.recordArticleChange(
        before,
        savedArticle,
        actor.userId,
        ContentEventType.CONTENT_UPDATED,
        'article content autosaved',
        true,
        manager,
      );
      return {
        id: article.id,
        body,
        bodyDocument,
        documentVersion: bodyDocument.version,
        revision: dto.expectedRevision + 1,
        updatedAt: nextUpdatedAt,
      };
    });
  }

  async deleteArticle(siteId: string, articleId: string, actor: Actor) {
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      SitePermission.EDIT_CONTENT,
    );
    const article = await this.articles.findOne({
      where: { id: articleId, siteId },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    if (article.status === ArticleStatus.PUBLISHED)
      throw new ConflictException(
        'Сначала снимите статью с публикации, затем её можно удалить',
      );
    await this.articles.remove(article);
    return { id: articleId };
  }

  async listArticleRedirects(siteId: string, articleId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'articles');
    if (!(await this.articles.existsBy({ id: articleId, siteId })))
      throw new NotFoundException('Статья не найдена');
    return this.articleRedirects
      ? this.articleRedirects.find({
          where: { siteId, articleId },
          order: { createdAt: 'DESC' },
        })
      : [];
  }

  async deleteArticleRedirect(
    siteId: string,
    articleId: string,
    redirectId: string,
    actor: Actor,
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      SitePermission.EDIT_CONTENT,
    );
    return this.articles.manager.transaction(async (manager) => {
      const redirect = await manager.findOne(ArticleRedirectEntity, {
        where: { id: redirectId, siteId, articleId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!redirect) throw new NotFoundException('Прежний адрес не найден');
      await manager.remove(redirect);
      await this.lifecycle?.recordEvent(
        {
          siteId,
          entityType: ContentEntityType.ARTICLE,
          entityId: articleId,
          eventType: ContentEventType.REDIRECT_REMOVED,
          actorUserId: actor.userId,
          before: { fromSlug: redirect.fromSlug },
          reason: 'article redirect removed',
        },
        manager,
      );
      return { id: redirectId };
    });
  }

  async listCategories(siteId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'categories');
    const rows = await this.categories.find({
      where: { siteId, deletedAt: IsNull() },
      relations: { imageMedia: true, createdBy: true, updatedBy: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return Promise.all(
      rows.map(async (category) => {
        const [articleCount, childCount, redirects] = await Promise.all([
          this.articles.count({
            where: { siteId, categoryId: category.id, deletedAt: IsNull() },
          }),
          this.categories.count({
            where: { siteId, parentId: category.id, deletedAt: IsNull() },
          }),
          this.categoryRedirects
            ? this.categoryRedirects.find({
                where: { siteId, categoryId: category.id },
                order: { createdAt: 'DESC' },
              })
            : Promise.resolve([]),
        ]);
        return {
          ...category,
          createdBy: this.publicActor(category.createdBy),
          updatedBy: this.publicActor(category.updatedBy),
          articleCount,
          childCount,
          redirects,
        };
      }),
    );
  }

  private async validateCategoryParent(
    siteId: string,
    parentId: string | null,
    categoryId?: string,
  ) {
    if (!parentId) return;
    if (parentId === categoryId)
      throw new BadRequestException(
        'Рубрика не может быть вложена сама в себя',
      );

    const visited = new Set<string>();
    let currentId: string | null = parentId;
    while (currentId) {
      if (currentId === categoryId)
        throw new BadRequestException(
          'Нельзя переместить рубрику внутрь её дочерней рубрики',
        );
      if (visited.has(currentId))
        throw new BadRequestException(
          'Обнаружена циклическая вложенность рубрик',
        );
      visited.add(currentId);
      const current = await this.categories.findOne({
        where: { id: currentId, siteId },
      });
      if (!current)
        throw new NotFoundException(
          'Родительская рубрика этого сайта не найдена',
        );
      currentId = current.parentId;
    }
  }

  private async validateCategoryImage(
    siteId: string,
    imageMediaId: string | null,
  ) {
    if (imageMediaId && !(await this.workspaceHasMedia(siteId, imageMediaId)))
      throw new NotFoundException('Изображение этой рубрики не найдено');
  }

  async createCategory(siteId: string, actor: Actor, dto: CreateCategoryDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'categories',
      SitePermission.EDIT_CONTENT,
    );
    const slug = dto.slug.trim().toLowerCase();
    if (new Set(['404', 'privacy-policy', 'search']).has(slug))
      throw new ConflictException('Этот slug зарезервирован системой');
    if (await this.categories.existsBy({ siteId, slug }))
      throw new ConflictException('Такая категория уже существует');
    if (await this.categoryRedirects?.existsBy({ siteId, fromSlug: slug }))
      throw new ConflictException(
        'Этот slug уже сохранён как прежний адрес другой рубрики',
      );
    const parentId = dto.parentId ?? null;
    const imageMediaId = dto.imageMediaId ?? null;
    await this.validateCategoryParent(siteId, parentId);
    await this.validateCategoryImage(siteId, imageMediaId);
    const displayTemplateKey =
      dto.displayTemplateKey?.trim() || 'standard-category';
    const displayTemplateVersion = dto.displayTemplateVersion?.trim() || '1';
    await this.lifecycle?.assertTemplate(
      siteId,
      ContentTemplateKind.CATEGORY,
      displayTemplateKey,
      displayTemplateVersion,
    );
    return this.categories.manager.transaction(async (manager) => {
      if (await manager.exists(CategoryEntity, { where: { siteId, slug } }))
        throw new ConflictException('Такая категория уже существует');
      if (
        await manager.exists(CategoryRedirectEntity, {
          where: { siteId, fromSlug: slug },
        })
      )
        throw new ConflictException(
          'Этот slug уже сохранён как прежний адрес другой рубрики',
        );
      const category = await manager.save(
        manager.create(CategoryEntity, {
          siteId,
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim() || null,
          status: CategoryStatus.DRAFT,
          publicationState: PublicationState.DRAFT,
          publishedAt: null,
          sortOrder: dto.sortOrder ?? 0,
          color: dto.color ?? '#9f91ef',
          parentId,
          icon: dto.icon?.trim() || null,
          imageMediaId,
          seoTitle: dto.seoTitle?.trim() || null,
          seoDescription: dto.seoDescription?.trim() || null,
          canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
          noIndex: dto.noIndex ?? false,
          displayTemplateKey,
          displayTemplateVersion,
          displayTemplateConfig: dto.displayTemplateConfig ?? {},
          deletedAt: null,
          deletedByUserId: null,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        }),
      );
      if (this.categoryActivities)
        await manager.save(
          manager.create(CategoryActivityEntity, {
            categoryId: category.id,
            userId: actor.userId,
            action: 'created',
            message: 'Рубрика создана',
          }),
        );
      await this.lifecycle?.recordCategoryChange(
        null,
        category,
        actor.userId,
        ContentEventType.CREATED,
        'category created',
        manager,
      );
      return category;
    });
  }

  async updateCategory(
    siteId: string,
    categoryId: string,
    actor: Actor,
    dto: UpdateCategoryDto,
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'categories',
      SitePermission.EDIT_CONTENT,
    );
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    if (
      (dto.status && dto.status !== category.status) ||
      (dto.publicationState &&
        dto.publicationState !== category.publicationState)
    )
      throw new BadRequestException(
        'Статус рубрики изменяется только через процесс публикации',
      );
    const displayTemplateKey =
      dto.displayTemplateKey?.trim() || category.displayTemplateKey;
    const displayTemplateVersion =
      dto.displayTemplateVersion?.trim() || category.displayTemplateVersion;
    await this.lifecycle?.assertTemplate(
      siteId,
      ContentTemplateKind.CATEGORY,
      displayTemplateKey,
      displayTemplateVersion,
    );
    const slug = dto.slug.trim().toLowerCase();
    if (new Set(['404', 'privacy-policy', 'search']).has(slug))
      throw new ConflictException('Этот slug зарезервирован системой');
    const duplicate = await this.categories.findOne({
      where: { siteId, slug },
    });
    if (duplicate && duplicate.id !== categoryId)
      throw new ConflictException('Такая рубрика уже существует');
    const parentId =
      dto.parentId === undefined ? (category.parentId ?? null) : dto.parentId;
    const imageMediaId =
      dto.imageMediaId === undefined
        ? (category.imageMediaId ?? null)
        : dto.imageMediaId;
    await this.validateCategoryParent(siteId, parentId, categoryId);
    await this.validateCategoryImage(siteId, imageMediaId);
    const changes = {
      name: dto.name.trim(),
      slug,
      description:
        dto.description === undefined
          ? category.description
          : dto.description?.trim() || null,
      status: category.status,
      publishedAt:
        dto.publishedAt === undefined
          ? category.publishedAt
          : dto.publishedAt
            ? new Date(dto.publishedAt)
            : null,
      sortOrder: dto.sortOrder ?? category.sortOrder ?? 0,
      color: dto.color ?? category.color,
      parentId,
      icon:
        dto.icon === undefined
          ? (category.icon ?? null)
          : dto.icon?.trim() || null,
      imageMediaId,
      seoTitle:
        dto.seoTitle === undefined
          ? (category.seoTitle ?? null)
          : dto.seoTitle?.trim() || null,
      seoDescription:
        dto.seoDescription === undefined
          ? (category.seoDescription ?? null)
          : dto.seoDescription?.trim() || null,
      canonicalUrl:
        dto.canonicalUrl === undefined
          ? (category.canonicalUrl ?? null)
          : dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
      noIndex: dto.noIndex ?? category.noIndex ?? false,
      displayTemplateKey,
      displayTemplateVersion,
      displayTemplateConfig:
        dto.displayTemplateConfig ?? category.displayTemplateConfig,
      updatedByUserId: actor.userId,
    };
    return this.categories.manager.transaction(async (manager) => {
      const locked = await manager.findOne(CategoryEntity, {
        where: { id: categoryId, siteId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Рубрика не найдена');
      const before = Object.assign(new CategoryEntity(), locked);
      const previousSlug = locked.slug;
      const slugChanged = previousSlug !== slug;
      const duplicateInTransaction = await manager.findOne(CategoryEntity, {
        where: { siteId, slug },
      });
      if (duplicateInTransaction && duplicateInTransaction.id !== categoryId)
        throw new ConflictException('Такая рубрика уже существует');
      const targetRedirect = await manager.findOne(CategoryRedirectEntity, {
        where: { siteId, fromSlug: slug },
      });
      if (targetRedirect && targetRedirect.categoryId !== categoryId)
        throw new ConflictException(
          'Этот slug уже сохранён как прежний адрес другой рубрики',
        );
      if (slugChanged) {
        const previousRedirect = await manager.findOne(CategoryRedirectEntity, {
          where: { siteId, fromSlug: previousSlug },
        });
        if (previousRedirect && previousRedirect.categoryId !== categoryId)
          throw new ConflictException(
            'Прежний адрес принадлежит другой рубрике',
          );
        if (targetRedirect)
          await manager.delete(CategoryRedirectEntity, {
            id: targetRedirect.id,
          });
      }
      changes.status = locked.status;
      if (dto.publishedAt === undefined)
        changes.publishedAt = locked.publishedAt;
      await manager.update(
        CategoryEntity,
        { id: categoryId, siteId },
        changes as never,
      );
      const saved = Object.assign(locked, changes);
      if (slugChanged)
        await manager.upsert(
          CategoryRedirectEntity,
          { siteId, categoryId, fromSlug: previousSlug },
          ['siteId', 'fromSlug'],
        );
      if (this.categoryActivities)
        await manager.save(
          manager.create(CategoryActivityEntity, {
            categoryId,
            userId: actor.userId,
            action: slugChanged ? 'slug_changed' : 'updated',
            message: slugChanged
              ? `Адрес изменён: ${previousSlug} → ${slug}`
              : 'Настройки рубрики обновлены',
          }),
        );
      await this.lifecycle?.recordCategoryChange(
        before,
        saved,
        actor.userId,
        ContentEventType.PARAMETERS_UPDATED,
        'category parameters saved',
        manager,
      );
      if (slugChanged)
        await this.lifecycle?.recordEvent(
          {
            siteId,
            entityType: ContentEntityType.CATEGORY,
            entityId: categoryId,
            eventType: ContentEventType.REDIRECT_CREATED,
            actorUserId: actor.userId,
            reason: 'slug changed',
            before: { slug: previousSlug },
            after: { slug },
          },
          manager,
        );
      return saved;
    });
  }

  async getCategoryDeleteSummary(
    siteId: string,
    categoryId: string,
    actor: Actor,
  ) {
    await this.requireSiteModule(siteId, actor, 'categories');
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    const [articleCount, childCount, publishedArticleCount] = await Promise.all(
      [
        this.articles.count({
          where: { siteId, categoryId, deletedAt: IsNull() },
        }),
        this.categories.count({
          where: { siteId, parentId: categoryId, deletedAt: IsNull() },
        }),
        this.articles.count({
          where: {
            siteId,
            categoryId,
            publicationState: PublicationState.PUBLISHED,
            deletedAt: IsNull(),
          },
        }),
      ],
    );
    return {
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      articleCount,
      childCount,
      publishedArticleCount,
    };
  }

  async getCategoryPreview(siteId: string, categoryId: string, actor: Actor) {
    const site = await this.requireSiteModule(siteId, actor, 'categories');
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
      relations: { imageMedia: true },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    const [articles, children, pages] = await Promise.all([
      this.articles.find({
        where: { siteId, categoryId, deletedAt: IsNull() },
        relations: { author: true, coverMedia: true, previewMedia: true },
        order: {
          sortOrder: 'ASC',
          publishedAt: 'DESC',
          updatedAt: 'DESC',
        },
      }),
      this.categories.find({
        where: { siteId, parentId: categoryId, deletedAt: IsNull() },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
      this.pages.find({
        where: { siteId, status: PageStatus.PUBLISHED, kind: PageKind.PAGE },
        select: { id: true, title: true, slug: true },
        order: { title: 'ASC' },
      }),
    ]);
    return {
      site: {
        name: site.name,
        slug: site.slug,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
        canonicalUrl: null,
        noIndex: true,
      },
      category,
      redirectTo: null,
      articles,
      children,
      pages,
    };
  }

  async deleteCategory(
    siteId: string,
    categoryId: string,
    actor: Actor,
    dto: DeleteCategoryDto = {},
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'categories',
      SitePermission.EDIT_CONTENT,
    );
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    const summary = await this.getCategoryDeleteSummary(
      siteId,
      categoryId,
      actor,
    );
    const hasContent = summary.articleCount > 0 || summary.childCount > 0;
    if (
      hasContent &&
      !Object.prototype.hasOwnProperty.call(dto, 'moveToCategoryId')
    )
      throw new ConflictException(
        `Перед удалением выберите, куда переместить содержимое: привязано материалов — ${summary.articleCount}; дочерние рубрики — ${summary.childCount}`,
      );
    const targetId =
      dto.moveToCategoryId === null ? category.parentId : dto.moveToCategoryId;
    if (targetId)
      await this.validateCategoryParent(siteId, targetId, categoryId);
    await this.categories.manager.transaction(async (manager) => {
      if (hasContent) {
        await manager.update(
          CategoryEntity,
          { siteId, parentId: categoryId },
          { parentId: targetId ?? null, updatedByUserId: actor.userId },
        );
        await manager.update(
          ArticleEntity,
          { siteId, categoryId },
          { categoryId: targetId ?? null, updatedByUserId: actor.userId },
        );
      }
      await manager.delete(CategoryEntity, { id: categoryId, siteId });
      await this.lifecycle?.recordEvent(
        {
          siteId,
          entityType: ContentEntityType.CATEGORY,
          entityId: categoryId,
          eventType: ContentEventType.DELETED,
          actorUserId: actor.userId,
          reason: 'category permanently deleted after content move',
          before: this.lifecycle.categorySnapshot(category),
        },
        manager,
      );
    });
    return { id: categoryId };
  }

  async listCategoryActivity(siteId: string, categoryId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'categories');
    if (!(await this.categories.existsBy({ id: categoryId, siteId })))
      throw new NotFoundException('Рубрика не найдена');
    return this.categoryActivities
      ? this.categoryActivities.find({
          where: { categoryId },
          relations: { user: true },
          order: { createdAt: 'DESC' },
        })
      : [];
  }

  async deleteCategoryRedirect(
    siteId: string,
    categoryId: string,
    redirectId: string,
    actor: Actor,
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'categories',
      SitePermission.EDIT_CONTENT,
    );
    return this.categories.manager.transaction(async (manager) => {
      const redirect = await manager.findOne(CategoryRedirectEntity, {
        where: { id: redirectId, siteId, categoryId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!redirect) throw new NotFoundException('Прежний адрес не найден');
      await manager.remove(redirect);
      await this.lifecycle?.recordEvent(
        {
          siteId,
          entityType: ContentEntityType.CATEGORY,
          entityId: categoryId,
          eventType: ContentEventType.REDIRECT_REMOVED,
          actorUserId: actor.userId,
          before: { fromSlug: redirect.fromSlug },
          reason: 'category redirect removed',
        },
        manager,
      );
      return { id: redirectId };
    });
  }

  async listAuthors(siteId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'authors');
    return this.authors.find({ where: { siteId }, order: { fullName: 'ASC' } });
  }

  async createAuthor(siteId: string, actor: Actor, dto: CreateAuthorDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'authors',
      SitePermission.EDIT_CONTENT,
    );
    return this.authors.save(
      this.authors.create({
        siteId,
        fullName: dto.fullName.trim(),
        email: dto.email?.trim().toLowerCase() || null,
        bio: dto.bio?.trim() || null,
      }),
    );
  }

  async updateAuthor(
    siteId: string,
    authorId: string,
    actor: Actor,
    dto: UpdateAuthorDto,
  ) {
    await this.requireSiteModule(
      siteId,
      actor,
      'authors',
      SitePermission.EDIT_CONTENT,
    );
    const author = await this.authors.findOne({
      where: { id: authorId, siteId },
    });
    if (!author) throw new NotFoundException('Автор не найден');
    Object.assign(author, {
      fullName: dto.fullName.trim(),
      email: dto.email?.trim().toLowerCase() || null,
      bio: dto.bio?.trim() || null,
    });
    return this.authors.save(author);
  }

  async deleteAuthor(siteId: string, authorId: string, actor: Actor) {
    await this.requireSiteModule(
      siteId,
      actor,
      'authors',
      SitePermission.EDIT_CONTENT,
    );
    const author = await this.authors.findOne({
      where: { id: authorId, siteId },
    });
    if (!author) throw new NotFoundException('Автор не найден');
    const linkedArticles = await this.articles.count({
      where: { siteId, authorId },
    });
    if (linkedArticles)
      throw new ConflictException(
        `Нельзя удалить автора: к нему привязано материалов — ${linkedArticles}`,
      );
    await this.authors.remove(author);
    return { id: authorId };
  }

  async listMedia(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    const items = await this.media.find({
      where: { workspaceId: site.workspaceId },
      relations: { site: true },
      order: { createdAt: 'DESC' },
    });
    return items.map((item) => ({
      ...item,
      site: item.site
        ? { id: item.site.id, name: item.site.name, slug: item.site.slug }
        : null,
    }));
  }

  async uploadMedia(
    siteId: string,
    actor: Actor,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    altText?: string,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const detectedMimeType = detectImageMimeType(file.buffer);
    if (!detectedMimeType)
      throw new BadRequestException(
        'Файл не является поддерживаемым изображением',
      );
    if (detectedMimeType !== file.mimetype)
      throw new BadRequestException(
        'Формат файла не соответствует заявленному типу изображения',
      );

    const extension = extensions[detectedMimeType];
    if (!extension)
      throw new BadRequestException('Разрешены JPG, PNG, WebP и GIF');
    const storedName = `${randomUUID()}.${extension}`;
    const root = process.env.MEDIA_ROOT ?? '/data/media';
    const directory = join(root, site.workspaceId);
    const filePath = join(directory, storedName);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, file.buffer, { flag: 'wx' });
    try {
      return await this.media.save(
        this.media.create({
          workspaceId: site.workspaceId,
          siteId,
          storageNamespace: site.workspaceId,
          storedName,
          originalName: file.originalname.slice(0, 255),
          mimeType: detectedMimeType,
          size: file.size,
          altText: altText?.trim() || null,
        }),
      );
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async getMediaFile(siteId: string, mediaId: string, actor: Actor) {
    await this.requireSite(siteId, actor);
    const { media: item } = await this.workspaceMedia(
      siteId,
      mediaId,
      'Файл не найден',
    );
    return {
      path: join(
        process.env.MEDIA_ROOT ?? '/data/media',
        item.storageNamespace,
        item.storedName,
      ),
      mimeType: item.mimeType,
    };
  }

  async updateMedia(
    siteId: string,
    mediaId: string,
    actor: Actor,
    dto: UpdateMediaDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const { media: item } = await this.workspaceMedia(
      siteId,
      mediaId,
      'Файл не найден',
    );
    item.altText = dto.altText?.trim() || null;
    return this.media.save(item);
  }

  async deleteMedia(siteId: string, mediaId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const { media: item } = await this.workspaceMedia(
      siteId,
      mediaId,
      'Файл не найден',
    );
    const workspaceSiteIds = (
      await this.sites.find({
        where: { workspaceId: site.workspaceId },
        select: { id: true },
      })
    ).map(({ id }) => id);

    const [
      usedInArticle,
      usedInBanner,
      usedInCategory,
      usedInSiteSeo,
      sitePages,
      siteArticles,
    ] = await Promise.all([
      this.articles.existsBy([
        { siteId: In(workspaceSiteIds), coverMediaId: mediaId },
        { siteId: In(workspaceSiteIds), previewMediaId: mediaId },
      ]),
      this.banners.existsBy({ siteId: In(workspaceSiteIds), mediaId }),
      this.categories.existsBy({
        siteId: In(workspaceSiteIds),
        imageMediaId: mediaId,
      }),
      this.sites.existsBy({
        id: In(workspaceSiteIds),
        seoImageMediaId: mediaId,
      }),
      this.pages.find({
        where: { siteId: In(workspaceSiteIds) },
        select: {
          blocks: true,
          systemTemplateKey: true,
          systemTemplateVersion: true,
        },
      }),
      this.articles.find({
        where: { siteId: In(workspaceSiteIds) },
        select: { bodyDocument: true },
      }),
    ]);
    const usedInPage = sitePages.some((page) => {
      const blocks = Array.isArray(page.blocks) ? page.blocks : [];
      return (
        blocks.some((block) => block?.mediaId === mediaId) ||
        (page.systemTemplateKey === ARMATUREX_HOME_TEMPLATE_KEY &&
          page.systemTemplateVersion === ARMATUREX_HOME_TEMPLATE_VERSION &&
          armaturexPageBlockMediaIds(blocks).includes(mediaId))
      );
    });
    const usedInArticleDocument = siteArticles.some((article) =>
      article.bodyDocument
        ? articleDocumentMediaIds(article.bodyDocument).includes(mediaId)
        : false,
    );
    if (
      usedInArticle ||
      usedInArticleDocument ||
      usedInBanner ||
      usedInCategory ||
      usedInSiteSeo ||
      usedInPage
    )
      throw new ConflictException(
        'Изображение используется в контенте рабочего пространства. Сначала уберите его со всех сайтов.',
      );

    await this.media.remove(item);
    await unlink(
      join(
        process.env.MEDIA_ROOT ?? '/data/media',
        item.storageNamespace,
        item.storedName,
      ),
    ).catch(() => undefined);
    return { id: mediaId, deleted: true };
  }

  private async validatePageBlocks(
    siteId: string,
    dto: CreatePageDto,
    template?: { key: string | null; version: string | null },
  ) {
    const nestedMediaIds =
      template?.key === ARMATUREX_HOME_TEMPLATE_KEY &&
      template.version === ARMATUREX_HOME_TEMPLATE_VERSION
        ? validateArmaturexPageBlocks(dto.blocks)
        : (validateGenericPageBlocks(dto.blocks), []);
    const mediaIds = [
      ...new Set([
        ...dto.blocks
          .map((block) => block.mediaId)
          .filter((id): id is string => Boolean(id)),
        ...nestedMediaIds,
      ]),
    ];
    for (const mediaId of mediaIds) {
      if (!(await this.workspaceHasMedia(siteId, mediaId)))
        throw new NotFoundException('Изображение одного из блоков не найдено');
    }
    if (dto.kind === PageKind.PAGE && !dto.slug)
      throw new BadRequestException('Для обычной страницы требуется slug');
  }

  async listPages(siteId: string, actor: Actor) {
    await this.requireSite(siteId, actor);
    return this.pages.find({
      where: { siteId },
      order: { kind: 'ASC', title: 'ASC' },
    });
  }

  async getNotFoundPage(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    const currentTemplate = getNotFoundTemplate(
      page.systemTemplateKey,
      page.systemTemplateVersion,
    );
    const publishedTemplate = page.publishedSystemTemplateKey
      ? getNotFoundTemplate(
          page.publishedSystemTemplateKey,
          page.publishedSystemTemplateVersion,
        )
      : null;
    return {
      site: { id: site.id, name: site.name, slug: site.slug },
      page: {
        id: page.id,
        name: page.title,
        status: page.status,
        updatedAt: page.updatedAt,
      },
      template: currentTemplate,
      publishedTemplate,
      hasPendingTemplateChanges:
        page.status === PageStatus.PUBLISHED &&
        (currentTemplate.key !== publishedTemplate?.key ||
          currentTemplate.version !== publishedTemplate?.version),
      templates: NOT_FOUND_TEMPLATES,
    };
  }

  async updateNotFoundTemplate(
    siteId: string,
    actor: Actor,
    dto: UpdateNotFoundTemplateDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    const template = NOT_FOUND_TEMPLATES.find(
      (candidate) => candidate.key === dto.templateKey,
    );
    if (!template) throw new BadRequestException('Неизвестный шаблон 404');
    page.systemTemplateKey = template.key;
    page.systemTemplateVersion = template.version;
    await this.pages.save(page);
    return this.getNotFoundPage(siteId, actor);
  }

  async activateNotFoundPage(siteId: string, actor: Actor) {
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    const template = getNotFoundTemplate(
      page.systemTemplateKey,
      page.systemTemplateVersion,
    );
    page.systemTemplateKey = template.key;
    page.systemTemplateVersion = template.version;
    page.publishedSystemTemplateKey = template.key;
    page.publishedSystemTemplateVersion = template.version;
    page.status = PageStatus.PUBLISHED;
    await this.pages.save(page);
    return this.getNotFoundPage(siteId, actor);
  }

  async deactivateNotFoundPage(siteId: string, actor: Actor) {
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    page.status = PageStatus.DRAFT;
    await this.pages.save(page);
    return this.getNotFoundPage(siteId, actor);
  }

  async createPage(siteId: string, actor: Actor, dto: CreatePageDto) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    await this.validatePageBlocks(siteId, dto);
    if (dto.status !== PageStatus.DRAFT)
      throw new BadRequestException(
        'Новую страницу сначала нужно сохранить как черновик',
      );
    const slug =
      dto.kind === PageKind.HOMEPAGE ? '' : dto.slug.trim().toLowerCase();
    if (await this.pages.existsBy({ siteId, slug }))
      throw new ConflictException(
        dto.kind === PageKind.HOMEPAGE
          ? 'Главная страница уже существует'
          : 'Такой slug страницы уже используется',
      );
    return this.pages.save(
      this.pages.create({
        siteId,
        title: dto.title.trim(),
        slug,
        kind: dto.kind,
        status: PageStatus.DRAFT,
        blocks: dto.blocks,
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
        canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
        noIndex: dto.noIndex ?? false,
      }),
    );
  }

  async updatePage(
    siteId: string,
    pageId: string,
    actor: Actor,
    dto: UpdatePageDto,
  ) {
    await this.requireSite(siteId, actor);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    await this.validatePageBlocks(siteId, dto, {
      key: page.systemTemplateKey,
      version: page.systemTemplateVersion,
    });
    if (page.slug === 'privacy-policy' || page.slug === '404')
      throw new BadRequestException(
        page.slug === '404'
          ? 'Страницу 404 настраивайте через модуль 404'
          : 'Политику конфиденциальности редактируйте через модуль политики',
      );
    await this.requireSite(
      siteId,
      actor,
      page.status === PageStatus.PUBLISHED
        ? SitePermission.EDIT_PUBLISHED
        : SitePermission.EDIT_CONTENT,
    );
    if (dto.status !== page.status)
      throw new BadRequestException(
        'Статус страницы изменяется только через публикацию',
      );
    const fixedSystemTitle =
      page.kind === PageKind.PAGE
        ? fixedSystemPageTitles.get(page.slug)
        : undefined;
    const slug = fixedSystemTitle
      ? page.slug
      : dto.kind === PageKind.HOMEPAGE
        ? ''
        : dto.slug.trim().toLowerCase();
    const duplicate = await this.pages.findOne({ where: { siteId, slug } });
    if (duplicate && duplicate.id !== page.id)
      throw new ConflictException('Такой адрес страницы уже используется');
    Object.assign(page, {
      title: fixedSystemTitle ?? dto.title.trim(),
      slug,
      kind: fixedSystemTitle ? PageKind.PAGE : dto.kind,
      blocks: dto.blocks,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
      canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
      noIndex: dto.noIndex ?? false,
    });
    return this.pages.save(page);
  }

  async deletePage(siteId: string, pageId: string, actor: Actor) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    if (fixedSystemPageTitles.has(page.slug))
      throw new ConflictException('Системную страницу нельзя удалить');
    if (page.status === PageStatus.PUBLISHED)
      throw new ConflictException(
        'Сначала снимите страницу с публикации, затем её можно удалить',
      );
    await this.pages.remove(page);
    return { id: pageId };
  }

  async changePageStatus(
    siteId: string,
    pageId: string,
    actor: Actor,
    dto: ChangePageStatusDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    if (page.slug === '404')
      throw new BadRequestException(
        'Статус страницы 404 изменяется только через модуль 404',
      );
    if (dto.status === page.status) return page;

    const allowed =
      (page.status === PageStatus.DRAFT &&
        dto.status === PageStatus.PUBLISHED) ||
      (page.status === PageStatus.PUBLISHED && dto.status === PageStatus.DRAFT);
    if (!allowed)
      throw new BadRequestException('Недопустимое изменение статуса страницы');

    if (page.slug === 'privacy-policy' && dto.status === PageStatus.PUBLISHED) {
      const privacyPolicyStates = this.privacyPolicyStates;
      const state = await privacyPolicyStates?.findOne({
        where: { siteId, pageId: page.id },
        relations: { legalModel: true },
      });
      if (!state || state.legalModel.status !== 'approved')
        throw new BadRequestException(
          'Юридическая модель политики ещё не утверждена. Публикация недоступна',
        );
      const snapshot =
        state.mode === 'manual'
          ? state.manualSnapshot
          : state.automaticSnapshot;
      const site = await this.sites.findOne({ where: { id: siteId } });
      if (!site || !snapshot)
        throw new BadRequestException(
          'Сначала сформируйте и сохраните документ политики',
        );
      const fingerprint = privacyFingerprint(
        site.globalData ?? {},
        state.settings ?? {},
        state.legalModel.version,
        {
          key: state.displayTemplateKey,
          version: state.displayTemplateVersion,
          config: state.displayTemplateConfig ?? {},
        },
      );
      if (
        state.inputFingerprint !== fingerprint ||
        state.legacyContentPreserved ||
        state.modelReviewSourceVersion
      )
        throw new BadRequestException(
          'Политика требует внимания. Актуализируйте документ перед публикацией',
        );
      state.publishedSnapshot = snapshot;
      state.publishedAt = new Date();
      state.publishedLegalModelVersion = state.legalModel.version;
      state.publishedDisplayTemplateKey = state.displayTemplateKey;
      state.publishedDisplayTemplateVersion = state.displayTemplateVersion;
      state.publishedDisplayTemplateConfig = state.displayTemplateConfig ?? {};
      await privacyPolicyStates!.save(state);
      page.blocks = [
        {
          id: 'privacy-policy-document',
          type: 'text',
          text: snapshot,
        },
      ];
    }

    if (
      dto.status === PageStatus.PUBLISHED &&
      !page.blocks.some(
        (block) =>
          Boolean(block.mediaId) ||
          Boolean(block.title?.trim()) ||
          Boolean(block.text?.trim()),
      )
    )
      throw new BadRequestException(
        'Перед публикацией добавьте содержимое страницы',
      );

    page.status = dto.status;
    return this.pages.save(page);
  }

  async listArticleActivity(siteId: string, articleId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'articles');
    if (!(await this.articles.existsBy({ id: articleId, siteId })))
      throw new NotFoundException('Статья не найдена');
    return this.articleActivities
      .find({
        where: { articleId },
        relations: { user: true },
        order: { createdAt: 'DESC' },
      })
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          type: row.type,
          message: row.message,
          fromStatus: row.fromStatus,
          toStatus: row.toStatus,
          createdAt: row.createdAt,
          user: { id: row.user.id, fullName: row.user.fullName },
        })),
      );
  }

  async addArticleComment(
    siteId: string,
    articleId: string,
    actor: Actor,
    dto: AddArticleCommentDto,
  ) {
    await this.requireSiteModule(siteId, actor, 'articles');
    if (!(await this.articles.existsBy({ id: articleId, siteId })))
      throw new NotFoundException('Статья не найдена');
    return this.articleActivities.save(
      this.articleActivities.create({
        articleId,
        userId: actor.userId,
        type: ArticleActivityType.COMMENT,
        message: dto.message.trim(),
        fromStatus: null,
        toStatus: null,
      }),
    );
  }

  async changeArticleStatus(
    siteId: string,
    articleId: string,
    actor: Actor,
    dto: ChangeArticleStatusDto,
  ) {
    if (!this.lifecycle)
      throw new ServiceUnavailableException('Сервис публикации недоступен');
    if (dto.status === ArticleStatus.REVIEW)
      return this.lifecycle.setArticleEditorialState(siteId, articleId, actor, {
        state: EditorialState.REVIEW,
        reason: 'legacy status endpoint',
      });
    if (dto.status === ArticleStatus.CHANGES)
      return this.lifecycle.setArticleEditorialState(siteId, articleId, actor, {
        state: EditorialState.CHANGES,
        reason: 'legacy status endpoint',
      });
    if (dto.status === ArticleStatus.PUBLISHED) {
      let article = await this.articles.findOne({
        where: { id: articleId, siteId, deletedAt: IsNull() },
      });
      if (!article) throw new NotFoundException('Статья не найдена');
      if (
        article.editorialState === EditorialState.DRAFT ||
        article.editorialState === EditorialState.CHANGES
      )
        article = await this.lifecycle.setArticleEditorialState(
          siteId,
          articleId,
          actor,
          { state: EditorialState.REVIEW, reason: 'legacy status endpoint' },
        );
      if (article.editorialState === EditorialState.REVIEW)
        await this.lifecycle.setArticleEditorialState(
          siteId,
          articleId,
          actor,
          { state: EditorialState.APPROVED, reason: 'legacy status endpoint' },
        );
      return this.lifecycle.setArticlePublicationState(
        siteId,
        articleId,
        actor,
        {
          state: PublicationState.PUBLISHED,
          reason: 'legacy status endpoint',
        },
      );
    }
    const state =
      dto.status === ArticleStatus.HIDDEN
        ? PublicationState.HIDDEN
        : PublicationState.DRAFT;
    return this.lifecycle.setArticlePublicationState(siteId, articleId, actor, {
      state,
      reason: 'legacy status endpoint',
    });
  }
}
