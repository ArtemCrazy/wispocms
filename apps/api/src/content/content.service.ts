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
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import nodemailer from 'nodemailer';
import {
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
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
  PageActivityEntity,
  PageBannerAssignmentEntity,
  PageKind,
  PageStatus,
  PlatformRole,
  PublicationState,
  EditorialState,
  PrivacyPolicyStateEntity,
  SiteEntity,
  type SiteGlobalData,
  type SiteLayoutSettings,
  SiteSearchSettingsEntity,
  SiteType,
  SiteVariableEntity,
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
  bannerGeometryError,
  bannerSlotCompatibilityError,
  bannerSlotsForPage,
  isAllowedBannerLink,
  type BannerSlotDefinition,
} from './banner-slot-registry';
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
  AssignPageBannerDto,
  ConfirmRecommendedSearchDto,
  CreateSiteVariableDto,
  UpdateNotFoundSeoDto,
  UpdateSearchSettingsDto,
  UpdateSiteVariableDto,
  UnassignPageBannerDto,
} from './content.dto';
import { ContentLifecycleService } from './content-lifecycle.service';
import { CmsRevisionsService } from './cms-revisions.service';
import {
  articleDocumentMediaIds,
  articleDocumentText,
  normalizeArticleDocument,
} from './article-document';
import { detectImageMimeType, readImageDimensions } from './image-signature';
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
type PageBannerAssignmentSnapshot = { zone: string; bannerId: string };
type SiteSettingsRevisionType = 'site_globals' | 'site_header' | 'site_footer';
type SiteLayoutRevisionScope = 'header' | 'footer';

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
    @Optional()
    @InjectRepository(PageBannerAssignmentEntity)
    private readonly bannerAssignments?: Repository<PageBannerAssignmentEntity>,
    @Optional()
    @InjectRepository(SiteVariableEntity)
    private readonly siteVariables?: Repository<SiteVariableEntity>,
    @Optional()
    @InjectRepository(SiteSearchSettingsEntity)
    private readonly searchSettings?: Repository<SiteSearchSettingsEntity>,
    @Optional()
    @InjectRepository(PageActivityEntity)
    private readonly pageActivities?: Repository<PageActivityEntity>,
    private readonly revisions?: CmsRevisionsService,
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

  private async articleForCms(
    siteId: string,
    article: ArticleEntity,
    actor: Actor,
    revisionId?: string,
  ) {
    if (
      !this.revisions ||
      (!revisionId &&
        article.publicationState !== PublicationState.PUBLISHED &&
        article.publicationState !== PublicationState.HIDDEN)
    )
      return article;
    const current = revisionId
      ? null
      : await this.revisions.current(siteId, 'article', article.id, actor);
    const revision = revisionId
      ? await this.revisions.getVersion(
          siteId,
          'article',
          article.id,
          revisionId,
          actor,
        )
      : current?.draft;
    if (!revision) return article;
    const draft = Object.assign(
      new ArticleEntity(),
      article,
      revision.snapshot,
      {
        draftRevisionId: revision.id,
        approvedRevisionId: current?.approvedRevisionId ?? null,
        publishedRevisionId: current?.publishedRevisionId ?? null,
        reviewState: current?.reviewState ?? 'draft',
      },
    );
    if (draft.categoryId !== article.categoryId)
      draft.category = draft.categoryId
        ? await this.categories.findOne({
            where: { id: draft.categoryId, siteId, deletedAt: IsNull() },
          })
        : null;
    if (draft.authorId !== article.authorId)
      draft.author = draft.authorId
        ? await this.authors.findOne({
            where: { id: draft.authorId, siteId },
          })
        : null;
    if (
      draft.coverMediaId !== article.coverMediaId ||
      draft.previewMediaId !== article.previewMediaId
    ) {
      const site = await this.sites.findOne({ where: { id: siteId } });
      if (!site) throw new NotFoundException('Сайт не найден');
      if (draft.coverMediaId !== article.coverMediaId)
        draft.coverMedia = draft.coverMediaId
          ? await this.media.findOne({
              where: { id: draft.coverMediaId, workspaceId: site.workspaceId },
            })
          : null;
      if (draft.previewMediaId !== article.previewMediaId)
        draft.previewMedia = draft.previewMediaId
          ? await this.media.findOne({
              where: {
                id: draft.previewMediaId,
                workspaceId: site.workspaceId,
              },
            })
          : null;
    }
    return draft;
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
        select: { role: true, siteIds: true },
        where: {
          userId: actor.userId,
          workspaceId: site.workspaceId,
        },
      });
      if (
        !membership?.siteIds?.includes(siteId) ||
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

  private async requireMediaToolkit(
    siteId: string,
    actor: Actor,
    permission = SitePermission.READ,
  ) {
    const site = await this.requireSite(siteId, actor, permission);
    if (site.siteType !== SiteType.MEDIA)
      throw new BadRequestException(
        'Этот раздел доступен только для сайта типа Media',
      );
    return site;
  }

  private resolveVariables<T>(
    value: T,
    variables: Array<{ identifier: string; value: string }>,
  ): T {
    if (!variables.length) return value;
    const replacements = new Map(
      variables.map((variable) => [
        `{{${variable.identifier}}}`,
        variable.value,
      ]),
    );
    const walk = (entry: unknown): unknown => {
      if (typeof entry === 'string') {
        let result = entry;
        for (const [token, replacement] of replacements)
          result = result.split(token).join(replacement);
        return result;
      }
      if (Array.isArray(entry)) return entry.map(walk);
      if (entry && typeof entry === 'object')
        return Object.fromEntries(
          Object.entries(entry).map(([key, nested]) => [key, walk(nested)]),
        );
      return entry;
    };
    return walk(value) as T;
  }

  private async resolvePublicVariables<T>(siteId: string, value: T) {
    if (!this.siteVariables) return value;
    const variables = await this.siteVariables.find({
      where: { siteId },
      select: { identifier: true, value: true },
    });
    return this.resolveVariables(value, variables);
  }

  private async pageBannerData(
    site: SiteEntity,
    page: PageEntity | undefined,
    legacyBanners: BannerEntity[],
    revisionAssignments?: PageBannerAssignmentSnapshot[] | null,
  ) {
    if (site.siteType !== SiteType.MEDIA || !page || !this.bannerAssignments)
      return { banners: legacyBanners };
    const assignments = revisionAssignments
      ? await this.hydratePageBannerAssignments(
          site.id,
          page.id,
          revisionAssignments,
        )
      : await this.bannerAssignments.find({
          where: { siteId: site.id, pageId: page.id },
          relations: { banner: { media: true, mobileMedia: true } },
          order: { zone: 'ASC' },
        });
    const assignedBanners = assignments
      .filter((assignment) => assignment.banner.isActive)
      .map((assignment) => ({
        ...assignment.banner,
        placement: assignment.zone,
      }));
    return {
      banners: [
        ...legacyBanners.filter(
          (banner) => banner.placement === BannerPlacement.ARTICLE_SIDEBAR,
        ),
        ...assignedBanners,
      ],
    };
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
    const [articles, pages, banners, categories, variables] = await Promise.all(
      [
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
              relations: { media: true, mobileMedia: true },
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
        this.siteVariables
          ? this.siteVariables.find({
              where: { siteId: site.id },
              select: { identifier: true, value: true },
            })
          : Promise.resolve([]),
      ],
    );
    const pageBanners = await this.pageBannerData(
      site,
      pages.find((page) => page.kind === PageKind.HOMEPAGE),
      banners,
    );
    return this.resolveVariables(
      {
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
        banners: pageBanners.banners,
        categories: categories.filter((category) =>
          this.categoryIsPublic(category),
        ),
      },
      variables,
    );
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
    const mediaSearchSettings =
      site.siteType === SiteType.MEDIA && this.searchSettings
        ? await this.searchSettings.findOneBy({ siteId: site.id })
        : null;
    const searchableSections =
      site.siteType === SiteType.MEDIA
        ? (mediaSearchSettings?.searchableSections ?? ['articles'])
        : ['articles', 'pages'];

    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escapedQuery}%`;
    const [articles, pages, categories] = await Promise.all([
      capabilities.articles && searchableSections.includes('articles')
        ? this.articles
            .createQueryBuilder('article')
            .where('article.siteId = :siteId', { siteId: site.id })
            .leftJoin('article.category', 'category')
            .andWhere('article.publicationState = :publicationState', {
              publicationState: PublicationState.PUBLISHED,
            })
            .andWhere('article.deletedAt IS NULL')
            .andWhere(
              '(article.publishedAt IS NULL OR article.publishedAt <= :now)',
              { now: new Date() },
            )
            .andWhere(
              `(article.categoryId IS NULL OR (category.publicationState = :categoryPublicationState AND category.deletedAt IS NULL AND (category.publishedAt IS NULL OR category.publishedAt <= :now)))`,
              { categoryPublicationState: PublicationState.PUBLISHED },
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
      searchableSections.includes('pages')
        ? this.pages
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
            .getMany()
        : Promise.resolve([]),
      searchableSections.includes('categories')
        ? this.categories
            .createQueryBuilder('category')
            .where('category.siteId = :siteId', { siteId: site.id })
            .andWhere('category.publicationState = :publicationState', {
              publicationState: PublicationState.PUBLISHED,
            })
            .andWhere('category.deletedAt IS NULL')
            .andWhere(
              `(category.name ILIKE :pattern ESCAPE '\\' OR COALESCE(category.description, '') ILIKE :pattern ESCAPE '\\')`,
              { pattern },
            )
            .orderBy('category.updatedAt', 'DESC')
            .limit(10)
            .getMany()
        : Promise.resolve([]),
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

    return this.resolvePublicVariables(site.id, {
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
        ...categories.map((category) => ({
          id: category.id,
          type: 'category' as const,
          title: category.name,
          slug: category.slug,
          excerpt: cleanExcerpt(category.description ?? ''),
          path: `/categories/${category.slug}`,
          updatedAt: category.updatedAt,
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
    });
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
          select: { blocks: true, ogImageMediaId: true },
        }),
        capabilities.banners
          ? site.siteType === SiteType.MEDIA && this.bannerAssignments
            ? Promise.all([
                this.bannerAssignments.find({
                  where: { siteId: site.id },
                  relations: { banner: true, page: true },
                }),
                this.banners.exists({
                  where: [
                    {
                      siteId: site.id,
                      isActive: true,
                      placement: BannerPlacement.ARTICLE_SIDEBAR,
                      mediaId,
                    },
                    {
                      siteId: site.id,
                      isActive: true,
                      placement: BannerPlacement.ARTICLE_SIDEBAR,
                      mobileMediaId: mediaId,
                    },
                  ],
                }),
              ]).then(
                ([assignments, legacyArticleSidebarUse]) =>
                  legacyArticleSidebarUse ||
                  assignments.some(
                    ({ banner, page }) =>
                      page.status === PageStatus.PUBLISHED &&
                      banner.isActive &&
                      (banner.mediaId === mediaId ||
                        banner.mobileMediaId === mediaId),
                  ),
              )
            : this.banners.exists({
                where: [
                  { siteId: site.id, isActive: true, mediaId },
                  { siteId: site.id, isActive: true, mobileMediaId: mediaId },
                ],
              })
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
          where: [
            { siteId: site.id, imageMediaId: mediaId },
            { siteId: site.id, ogImageMediaId: mediaId },
          ],
        }),
      ]);
    const pageUses = publishedPages.some(
      (page) =>
        page.ogImageMediaId === mediaId ||
        page.blocks.some((block) => block.mediaId === mediaId),
    );
    const seoUses = site.seoImageMediaId === mediaId;
    const articleUses = publicArticles.some(
      (article) =>
        this.categoryIsPublic(article.category, true) &&
        (article.coverMediaId === mediaId ||
          article.previewMediaId === mediaId ||
          article.ogImageMediaId === mediaId),
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
    const [related, pages, banners, categories] = await Promise.all([
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
      this.categories.find({
        where: {
          siteId: site.id,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    return this.resolvePublicVariables(site.id, {
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
      categories: categories.filter((category) =>
        this.categoryIsPublic(category),
      ),
    });
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
    return this.resolvePublicVariables(site.id, {
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
    });
  }

  async getPublicPage(siteSlug: string, pageSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (pageSlug.trim().toLowerCase() === '404')
      throw new NotFoundException('Страница не найдена');
    const normalizedPageSlug = pageSlug.trim().toLowerCase();
    const page = await this.pages.findOne({
      where: {
        siteId: site.id,
        slug: normalizedPageSlug,
        kind: PageKind.PAGE,
        status: PageStatus.PUBLISHED,
      },
    });
    if (!page) {
      const redirectSources = await this.pages.find({
        where: { siteId: site.id, status: PageStatus.PUBLISHED },
      });
      const requestedPaths = [
        `/${normalizedPageSlug}`,
        `/pages/${normalizedPageSlug}`,
      ];
      const redirectPage = redirectSources.find((candidate) =>
        (candidate.redirects ?? []).some((redirect) =>
          requestedPaths.includes(redirect.fromPath.toLowerCase()),
        ),
      );
      const redirectRule = redirectPage?.redirects.find((redirect) =>
        requestedPaths.includes(redirect.fromPath.toLowerCase()),
      );
      if (redirectPage && redirectRule)
        return {
          redirectTo:
            redirectPage.kind === PageKind.HOMEPAGE
              ? '/'
              : `/pages/${redirectPage.slug}`,
          redirectStatus: redirectRule.statusCode,
        };
      throw new NotFoundException('Страница не найдена');
    }
    const [pages, banners, categories] = await Promise.all([
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
        where: { siteId: site.id, isActive: true },
        relations: { media: true },
        order: { placement: 'ASC', sortOrder: 'ASC' },
      }),
      this.categories.find({
        where: {
          siteId: site.id,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    const privacyDisplay =
      page.slug === 'privacy-policy'
        ? await this.privacyPolicyStates?.findOne({
            where: { siteId: site.id, pageId: page.id },
          })
        : null;
    const pageBanners = await this.pageBannerData(
      site,
      page ?? undefined,
      banners,
    );
    return this.resolvePublicVariables(site.id, {
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
      banners: pageBanners.banners,
      categories: categories.filter((category) =>
        this.categoryIsPublic(category),
      ),
      privacyDisplay: privacyDisplay
        ? {
            key: privacyDisplay.publishedDisplayTemplateKey ?? 'system-policy',
            version: privacyDisplay.publishedDisplayTemplateVersion ?? '1',
            config: privacyDisplay.publishedDisplayTemplateConfig ?? {},
          }
        : null,
    });
  }

  async getPublicNotFoundPage(siteSlug: string) {
    const site = await this.sites.findOne({
      where: { slug: siteSlug.trim().toLowerCase(), isActive: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const [page, pages, banners, categories] = await Promise.all([
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
      this.banners.find({
        where: { siteId: site.id, isActive: true },
        relations: { media: true },
        order: { placement: 'ASC', sortOrder: 'ASC' },
      }),
      this.categories.find({
        where: {
          siteId: site.id,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    const active = page?.status === PageStatus.PUBLISHED;
    const template = active
      ? getNotFoundTemplate(
          page.publishedSystemTemplateKey,
          page.publishedSystemTemplateVersion,
        )
      : getNotFoundTemplate();
    const pageBanners = await this.pageBannerData(
      site,
      page ?? undefined,
      banners,
    );
    return this.resolvePublicVariables(site.id, {
      site: {
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        globalData: site.globalData,
        layoutSettings: site.layoutSettings,
      },
      pages: pages.filter((item) => item.slug !== '404'),
      banners: pageBanners.banners,
      categories: categories.filter((category) =>
        this.categoryIsPublic(category),
      ),
      active,
      template,
    });
  }

  async getArticlePreview(
    siteId: string,
    articleId: string,
    actor: Actor,
    revisionId?: string,
  ) {
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
    const previewArticle = await this.articleForCms(
      siteId,
      article,
      actor,
      revisionId,
    );
    const [related, pages, banners, categories] = await Promise.all([
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
      this.categories.find({
        where: { siteId, deletedAt: IsNull() },
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
        previewArticle.createdBy || previewArticle.updatedBy
          ? {
              ...previewArticle,
              createdBy: this.publicActor(previewArticle.createdBy),
              updatedBy: this.publicActor(previewArticle.updatedBy),
            }
          : previewArticle,
      pages,
      banners,
      related,
      categories,
    };
  }

  async getPagePreview(
    siteId: string,
    pageId: string,
    actor: Actor,
    revisionId?: string,
    siteOverrides?: {
      globalData?: SiteGlobalData;
      layoutSettings?: SiteLayoutSettings;
    },
  ) {
    const site = await this.requireSite(siteId, actor);
    const publicPage = await this.pages.findOne({
      where: { id: pageId, siteId },
    });
    if (!publicPage) throw new NotFoundException('Страница не найдена');
    let page = publicPage;
    let selectedSnapshot: Record<string, unknown> | null = null;
    if (revisionId && !this.revisions)
      throw new ServiceUnavailableException('История страницы недоступна');
    if (this.revisions && this.versionedPage(publicPage)) {
      const selected = revisionId
        ? await this.revisions.getVersion(
            siteId,
            'page',
            pageId,
            revisionId,
            actor,
          )
        : (await this.revisions.current(siteId, 'page', pageId, actor))?.draft;
      if (selected) {
        selectedSnapshot = selected.snapshot;
        page = Object.assign(new PageEntity(), publicPage, selected.snapshot);
      }
    } else if (revisionId) {
      throw new BadRequestException('Ревизии этой страницы недоступны');
    }
    const [navigationPages, articles, banners, categories] = await Promise.all([
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
      this.categories.find({
        where: {
          siteId,
          publicationState: PublicationState.PUBLISHED,
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    const privacyDisplay =
      page.slug === 'privacy-policy'
        ? await this.privacyPolicyStates?.findOne({
            where: { siteId, pageId: page.id },
          })
        : null;
    const pageBanners = await this.pageBannerData(
      site,
      page,
      banners,
      this.pageBannerAssignmentsFromSnapshot(selectedSnapshot),
    );
    return this.resolvePublicVariables(site.id, {
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
        globalData: siteOverrides?.globalData ?? site.globalData,
        layoutSettings: siteOverrides?.layoutSettings ?? site.layoutSettings,
      },
      page,
      pages:
        page.kind === PageKind.HOMEPAGE
          ? [page, ...navigationPages]
          : navigationPages,
      articles,
      banners: pageBanners.banners,
      categories: categories.filter((category) =>
        this.categoryIsPublic(category),
      ),
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
    });
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

  private siteGlobalsSnapshot(
    source: SiteGlobalData,
    changes: UpdateSiteGlobalsDto = {},
  ): SiteGlobalData {
    const value = (input?: string | null) => input?.trim() || undefined;
    return {
      companyName:
        changes.companyName === undefined
          ? source.companyName
          : value(changes.companyName),
      organizationType:
        changes.organizationType === undefined
          ? source.organizationType
          : changes.organizationType || undefined,
      legalName:
        changes.legalName === undefined
          ? source.legalName
          : value(changes.legalName),
      inn: changes.inn === undefined ? source.inn : value(changes.inn),
      ogrn: changes.ogrn === undefined ? source.ogrn : value(changes.ogrn),
      legalAddress:
        changes.legalAddress === undefined
          ? source.legalAddress
          : value(changes.legalAddress),
      phone: changes.phone === undefined ? source.phone : value(changes.phone),
      email:
        changes.email === undefined
          ? source.email
          : value(changes.email)?.toLowerCase(),
      address:
        changes.address === undefined ? source.address : value(changes.address),
      telegramUrl:
        changes.telegramUrl === undefined
          ? source.telegramUrl
          : value(changes.telegramUrl),
      vkUrl: changes.vkUrl === undefined ? source.vkUrl : value(changes.vkUrl),
    };
  }

  private siteLayoutSectionSnapshot(
    scope: SiteLayoutRevisionScope,
    source: SiteLayoutSettings,
    changes: UpdateSiteLayoutDto = {},
  ): SiteLayoutSettings {
    const value = (input?: string | null) => input?.trim() || undefined;
    if (scope === 'header')
      return {
        logoText:
          changes.logoText === undefined
            ? source.logoText
            : value(changes.logoText),
        logoMediaId:
          changes.logoMediaId === undefined
            ? source.logoMediaId
            : changes.logoMediaId || undefined,
        showPages: changes.showPages ?? source.showPages,
        showArticles: changes.showArticles ?? source.showArticles,
        ctaLabel:
          changes.ctaLabel === undefined
            ? source.ctaLabel
            : value(changes.ctaLabel),
        ctaUrl:
          changes.ctaUrl === undefined ? source.ctaUrl : value(changes.ctaUrl),
      };
    return {
      footerDescription:
        changes.footerDescription === undefined
          ? source.footerDescription
          : value(changes.footerDescription),
      showContacts: changes.showContacts ?? source.showContacts,
      showSocials: changes.showSocials ?? source.showSocials,
    };
  }

  private siteSettingsRevisionView(
    siteId: string,
    snapshot: Record<string, unknown>,
    current: {
      draft: { id: string; versionNumber: number } | null;
      approvedRevisionId: string | null;
      publishedRevisionId: string | null;
      reviewState: string;
    } | null,
    next?: { id: string; versionNumber: number },
  ) {
    return {
      ...snapshot,
      siteId,
      draftRevisionId: next?.id ?? current?.draft?.id ?? null,
      draftVersionNumber:
        next?.versionNumber ?? current?.draft?.versionNumber ?? null,
      approvedRevisionId: next ? null : (current?.approvedRevisionId ?? null),
      publishedRevisionId: current?.publishedRevisionId ?? null,
      reviewState: next ? 'draft' : (current?.reviewState ?? 'draft'),
    };
  }

  private async siteSettingsDraftState(
    siteId: string,
    resourceType: SiteSettingsRevisionType,
    actor: Actor,
    expectedDraftRevisionId: string | null | undefined,
  ) {
    if (!this.revisions)
      throw new ServiceUnavailableException('История настроек недоступна');
    if (expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    const current = await this.revisions.current(
      siteId,
      resourceType,
      siteId,
      actor,
    );
    if (expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    return current;
  }

  private async saveSiteSettingsDraft(
    siteId: string,
    resourceType: SiteSettingsRevisionType,
    publicSnapshot: Record<string, unknown>,
    snapshot: Record<string, unknown>,
    current: Awaited<ReturnType<ContentService['siteSettingsDraftState']>>,
    actor: Actor,
  ) {
    const baseline = !current
      ? await this.revisions!.importPublishedBaseline({
          siteId,
          resourceType,
          entityId: siteId,
          snapshot: publicSnapshot,
          actor,
        })
      : null;
    const next = await this.revisions!.saveDraft({
      siteId,
      resourceType,
      entityId: siteId,
      snapshot,
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.siteSettingsRevisionView(siteId, snapshot, current, next);
  }

  async getSiteGlobals(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    const current = this.revisions
      ? await this.revisions.current(siteId, 'site_globals', siteId, actor)
      : null;
    const snapshot = this.siteGlobalsSnapshot(
      (current?.draft?.snapshot as SiteGlobalData | undefined) ??
        site.globalData ??
        {},
    );
    return this.siteSettingsRevisionView(site.id, snapshot, current);
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
    const current = await this.siteSettingsDraftState(
      siteId,
      'site_globals',
      actor,
      dto.expectedDraftRevisionId,
    );
    const source =
      (current?.draft?.snapshot as SiteGlobalData | undefined) ??
      site.globalData ??
      {};
    const snapshot = this.siteGlobalsSnapshot(source, dto);
    return this.saveSiteSettingsDraft(
      siteId,
      'site_globals',
      this.siteGlobalsSnapshot(site.globalData ?? {}),
      snapshot,
      current,
      actor,
    );
  }

  async getSiteLayout(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    return { siteId: site.id, ...site.layoutSettings };
  }

  async getSiteLayoutSection(
    siteId: string,
    scope: SiteLayoutRevisionScope,
    actor: Actor,
  ) {
    const site = await this.requireSite(siteId, actor);
    const resourceType = `site_${scope}` as const;
    const current = this.revisions
      ? await this.revisions.current(siteId, resourceType, siteId, actor)
      : null;
    const snapshot = this.siteLayoutSectionSnapshot(
      scope,
      (current?.draft?.snapshot as SiteLayoutSettings | undefined) ??
        site.layoutSettings ??
        {},
    );
    return this.siteSettingsRevisionView(site.id, snapshot, current);
  }

  async updateSiteLayoutSection(
    siteId: string,
    scope: SiteLayoutRevisionScope,
    actor: Actor,
    dto: UpdateSiteLayoutDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const headerFields = [
      dto.logoText,
      dto.logoMediaId,
      dto.showPages,
      dto.showArticles,
      dto.ctaLabel,
      dto.ctaUrl,
    ];
    const footerFields = [
      dto.footerDescription,
      dto.showContacts,
      dto.showSocials,
    ];
    const templateFields = [
      dto.headerTemplateKey,
      dto.headerTemplateVersion,
      dto.headerTemplateConfig,
      dto.footerTemplateKey,
      dto.footerTemplateVersion,
      dto.footerTemplateConfig,
    ];
    if (
      templateFields.some((value) => value !== undefined) ||
      (scope === 'header' &&
        footerFields.some((value) => value !== undefined)) ||
      (scope === 'footer' && headerFields.some((value) => value !== undefined))
    )
      throw new BadRequestException(
        'Изменения шапки и подвала согласуются отдельно',
      );
    if (
      scope === 'header' &&
      dto.logoMediaId &&
      !(await this.workspaceHasMedia(siteId, dto.logoMediaId))
    )
      throw new NotFoundException('Логотип не найден');
    const resourceType = `site_${scope}` as const;
    const current = await this.siteSettingsDraftState(
      siteId,
      resourceType,
      actor,
      dto.expectedDraftRevisionId,
    );
    const source =
      (current?.draft?.snapshot as SiteLayoutSettings | undefined) ??
      site.layoutSettings ??
      {};
    const snapshot = this.siteLayoutSectionSnapshot(scope, source, dto);
    return this.saveSiteSettingsDraft(
      siteId,
      resourceType,
      this.siteLayoutSectionSnapshot(scope, site.layoutSettings ?? {}),
      snapshot,
      current,
      actor,
    );
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
    const changesHeaderContent =
      dto.logoText !== undefined ||
      dto.logoMediaId !== undefined ||
      dto.showPages !== undefined ||
      dto.showArticles !== undefined ||
      dto.ctaLabel !== undefined ||
      dto.ctaUrl !== undefined;
    const changesFooterContent =
      dto.footerDescription !== undefined ||
      dto.showContacts !== undefined ||
      dto.showSocials !== undefined;
    if (changesHeaderContent || changesFooterContent)
      throw new BadRequestException(
        'Содержимое шапки и подвала сохраняется через отдельные версии',
      );
    if (
      dto.logoMediaId &&
      !(await this.workspaceHasMedia(siteId, dto.logoMediaId))
    )
      throw new NotFoundException('Логотип не найден');
    const value = (input?: string) => input?.trim() || undefined;
    const changesHeaderTemplate =
      dto.headerTemplateKey !== undefined ||
      dto.headerTemplateVersion !== undefined ||
      dto.headerTemplateConfig !== undefined;
    const changesFooterTemplate =
      dto.footerTemplateKey !== undefined ||
      dto.footerTemplateVersion !== undefined ||
      dto.footerTemplateConfig !== undefined;
    if (changesHeaderTemplate || changesFooterTemplate)
      await this.requireSite(siteId, actor, SitePermission.EDIT_CODE);
    if (
      site.siteType !== SiteType.MEDIA &&
      (changesHeaderTemplate || changesFooterTemplate)
    )
      throw new BadRequestException(
        'Шаблоны шапки и подвала доступны только Media-сайтам',
      );
    const headerTemplateKey =
      value(dto.headerTemplateKey) ??
      site.layoutSettings.headerTemplateKey ??
      'standard-header';
    const headerTemplateVersion =
      value(dto.headerTemplateVersion) ??
      site.layoutSettings.headerTemplateVersion ??
      '1';
    const footerTemplateKey =
      value(dto.footerTemplateKey) ??
      site.layoutSettings.footerTemplateKey ??
      'standard-footer';
    const footerTemplateVersion =
      value(dto.footerTemplateVersion) ??
      site.layoutSettings.footerTemplateVersion ??
      '1';
    const lifecycle = this.lifecycle;
    if (changesHeaderTemplate || changesFooterTemplate) {
      if (!lifecycle)
        throw new ServiceUnavailableException(
          'Проверка шаблонов временно недоступна',
        );
      if (changesHeaderTemplate)
        await lifecycle.assertTemplate(
          siteId,
          ContentTemplateKind.HEADER,
          headerTemplateKey,
          headerTemplateVersion,
        );
      if (changesFooterTemplate)
        await lifecycle.assertTemplate(
          siteId,
          ContentTemplateKind.FOOTER,
          footerTemplateKey,
          footerTemplateVersion,
        );
    }
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
      ...(changesHeaderTemplate && {
        headerTemplateKey,
        headerTemplateVersion,
        headerTemplateConfig:
          dto.headerTemplateConfig ??
          site.layoutSettings.headerTemplateConfig ??
          {},
      }),
      ...(changesFooterTemplate && {
        footerTemplateKey,
        footerTemplateVersion,
        footerTemplateConfig:
          dto.footerTemplateConfig ??
          site.layoutSettings.footerTemplateConfig ??
          {},
      }),
    };
    await this.sites.save(site);
    return { siteId: site.id, ...site.layoutSettings };
  }

  async getSiteSettingsRevisionPreview(
    siteId: string,
    resourceType: SiteSettingsRevisionType,
    revisionId: string,
    actor: Actor,
  ) {
    if (!this.revisions)
      throw new ServiceUnavailableException('История настроек недоступна');
    const site = await this.requireSite(siteId, actor);
    const homepage = await this.pages.findOne({
      where: { siteId, kind: PageKind.HOMEPAGE },
    });
    if (!homepage) throw new NotFoundException('Главная страница не найдена');
    const version = await this.revisions.getVersion(
      siteId,
      resourceType,
      siteId,
      revisionId,
      actor,
    );
    if (resourceType === 'site_globals')
      return this.getPagePreview(siteId, homepage.id, actor, undefined, {
        globalData: this.siteGlobalsSnapshot(version.snapshot),
      });
    const scope: SiteLayoutRevisionScope =
      resourceType === 'site_header' ? 'header' : 'footer';
    const section = this.siteLayoutSectionSnapshot(scope, version.snapshot);
    if (
      scope === 'header' &&
      section.logoMediaId &&
      !(await this.workspaceHasMedia(siteId, section.logoMediaId))
    )
      throw new NotFoundException('Логотип не найден');
    return this.getPagePreview(siteId, homepage.id, actor, undefined, {
      layoutSettings: { ...(site.layoutSettings ?? {}), ...section },
    });
  }

  async publishSiteSettingsRevision(
    siteId: string,
    resourceType: SiteSettingsRevisionType,
    revisionId: string,
    actor: Actor,
  ) {
    if (!this.revisions)
      throw new ServiceUnavailableException('История настроек недоступна');
    let published: SiteGlobalData | SiteLayoutSettings | null = null;
    await this.revisions.publish(
      siteId,
      resourceType,
      siteId,
      revisionId,
      actor,
      async (manager, snapshot) => {
        const locked = await manager.findOne(SiteEntity, {
          where: { id: siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('Сайт не найден');
        if (resourceType === 'site_globals') {
          const globals = this.siteGlobalsSnapshot(snapshot);
          locked.globalData = globals;
          published = globals;
        } else {
          const scope: SiteLayoutRevisionScope =
            resourceType === 'site_header' ? 'header' : 'footer';
          const section = this.siteLayoutSectionSnapshot(scope, snapshot);
          if (
            scope === 'header' &&
            section.logoMediaId &&
            !(await this.workspaceHasMedia(siteId, section.logoMediaId))
          )
            throw new NotFoundException('Логотип не найден');
          locked.layoutSettings = {
            ...(locked.layoutSettings ?? {}),
            ...section,
          };
          published = section;
        }
        await manager.save(locked);
      },
    );
    return { siteId, ...(published ?? {}) };
  }

  async listBanners(siteId: string, actor: Actor) {
    const site = await this.requireSiteModule(siteId, actor, 'banners');
    const rows = await this.banners.find({
      where: { siteId },
      relations: { media: true, mobileMedia: true },
      order:
        site.siteType === SiteType.MEDIA
          ? { updatedAt: 'DESC' }
          : { placement: 'ASC', sortOrder: 'ASC', createdAt: 'DESC' },
    });
    return Promise.all(
      rows.map(async (banner) => {
        const current = this.revisions
          ? await this.revisions.current(siteId, 'banner', banner.id, actor)
          : null;
        return current?.draft
          ? this.bannerDraftView(
              banner,
              current.draft.snapshot,
              current.draft.id,
            )
          : banner;
      }),
    );
  }

  private bannerRevisionSnapshot(banner: BannerEntity) {
    return {
      name: banner.name,
      placement: banner.placement,
      title: banner.title,
      subtitle: banner.subtitle,
      buttonText: banner.buttonText,
      linkUrl: banner.linkUrl,
      mediaId: banner.mediaId,
      mobileMediaId: banner.mobileMediaId,
      sortOrder: banner.sortOrder,
      isActive: banner.isActive,
    };
  }

  private bannerDraftView(
    banner: BannerEntity,
    snapshot: Record<string, unknown>,
    draftRevisionId: string,
  ) {
    return {
      ...banner,
      ...snapshot,
      id: banner.id,
      siteId: banner.siteId,
      draftRevisionId,
    };
  }

  async assertVersionedBanner(siteId: string, bannerId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'banners');
    const banner = await this.banners.findOne({
      where: { id: bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер не найден');
    if (!this.revisions)
      throw new ServiceUnavailableException('История баннера недоступна');
    return banner;
  }

  private async validateBannerMedia(
    siteId: string,
    ...mediaIds: Array<string | null | undefined>
  ) {
    for (const mediaId of mediaIds) {
      if (mediaId && !(await this.workspaceHasMedia(siteId, mediaId)))
        throw new NotFoundException(
          'Изображение рабочего пространства не найдено',
        );
    }
  }

  async createBanner(siteId: string, actor: Actor, dto: CreateBannerDto) {
    const site = await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.EDIT_CONTENT,
    );
    await this.validateBannerMedia(siteId, dto.mediaId, dto.mobileMediaId);
    if (!isAllowedBannerLink(dto.linkUrl))
      throw new BadRequestException('Недопустимый адрес баннера');
    if (site.siteType !== SiteType.MEDIA && !dto.placement)
      throw new BadRequestException(
        'Для этого типа сайта требуется позиция баннера',
      );
    if (!this.revisions)
      throw new ServiceUnavailableException('История баннера недоступна');
    return this.banners.manager.transaction(async (manager) => {
      const desired = Object.assign(new BannerEntity(), {
        siteId,
        name: dto.name.trim(),
        placement:
          site.siteType === SiteType.MEDIA ? null : (dto.placement ?? null),
        title: dto.title?.trim() || null,
        subtitle: dto.subtitle?.trim() || null,
        buttonText: dto.buttonText?.trim() || null,
        linkUrl: dto.linkUrl?.trim() || null,
        mediaId: dto.mediaId || null,
        mobileMediaId: dto.mobileMediaId || null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      });
      const banner = await manager.save(
        manager.create(BannerEntity, {
          ...desired,
          // A new banner must not become public before its first approval.
          isActive: false,
        }),
      );
      const draft = await this.revisions!.saveDraftUsingManager(manager, {
        siteId,
        resourceType: 'banner',
        entityId: banner.id,
        snapshot: this.bannerRevisionSnapshot(desired),
        expectedDraftRevisionId: null,
        actor,
      });
      return this.bannerDraftView(
        banner,
        this.bannerRevisionSnapshot(desired),
        draft.id,
      );
    });
  }

  async updateBanner(
    siteId: string,
    bannerId: string,
    actor: Actor,
    dto: UpdateBannerDto,
  ) {
    const site = await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.EDIT_CONTENT,
    );
    const banner = await this.banners.findOne({
      where: { id: bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер не найден');
    if (!this.revisions)
      throw new ServiceUnavailableException('История баннера недоступна');
    const current = await this.revisions.current(
      siteId,
      'banner',
      bannerId,
      actor,
    );
    if (dto.expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    if (dto.expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    await this.validateBannerMedia(siteId, dto.mediaId, dto.mobileMediaId);
    if (!isAllowedBannerLink(dto.linkUrl))
      throw new BadRequestException('Недопустимый адрес баннера');
    const source = current?.draft
      ? Object.assign(new BannerEntity(), banner, current.draft.snapshot)
      : banner;
    const baseline = !current
      ? await this.revisions.importPublishedBaseline({
          siteId,
          resourceType: 'banner',
          entityId: bannerId,
          snapshot: this.bannerRevisionSnapshot(banner),
          actor,
        })
      : null;
    const prospective = Object.assign(new BannerEntity(), source, {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      placement:
        site.siteType === SiteType.MEDIA
          ? banner.placement === BannerPlacement.ARTICLE_SIDEBAR
            ? source.placement
            : null
          : dto.placement !== undefined
            ? dto.placement
            : source.placement,
      ...(dto.title !== undefined && { title: dto.title?.trim() || null }),
      ...(dto.subtitle !== undefined && {
        subtitle: dto.subtitle?.trim() || null,
      }),
      ...(dto.buttonText !== undefined && {
        buttonText: dto.buttonText?.trim() || null,
      }),
      ...(dto.linkUrl !== undefined && {
        linkUrl: dto.linkUrl?.trim() || null,
      }),
      ...(dto.mediaId !== undefined && { mediaId: dto.mediaId || null }),
      ...(dto.mobileMediaId !== undefined && {
        mobileMediaId: dto.mobileMediaId || null,
      }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    });
    if (prospective.isActive)
      await this.validateExistingBannerAssignments(siteId, prospective);
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: 'banner',
      entityId: bannerId,
      snapshot: this.bannerRevisionSnapshot(prospective),
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.bannerDraftView(
      banner,
      this.bannerRevisionSnapshot(prospective),
      next.id,
    );
  }

  async getBannerRevisionPreview(
    siteId: string,
    bannerId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const banner = await this.assertVersionedBanner(siteId, bannerId, actor);
    const version = await this.revisions!.getVersion(
      siteId,
      'banner',
      bannerId,
      revisionId,
      actor,
    );
    return {
      ...version.snapshot,
      id: banner.id,
      siteId: banner.siteId,
      revisionId: version.id,
      versionNumber: version.versionNumber,
    };
  }

  private bannerFromSnapshot(
    site: SiteEntity,
    banner: BannerEntity,
    snapshot: Record<string, unknown>,
  ) {
    const nullableText = (key: string, maxLength: number) => {
      const raw = snapshot[key];
      if (raw === null) return null;
      if (typeof raw !== 'string') return undefined;
      const trimmed = raw.trim();
      return trimmed.length <= maxLength ? trimmed || null : undefined;
    };
    const name = typeof snapshot.name === 'string' ? snapshot.name.trim() : '';
    const placement = snapshot.placement;
    const title = nullableText('title', 200);
    const subtitle = nullableText('subtitle', 300);
    const buttonText = nullableText('buttonText', 80);
    const linkUrl = nullableText('linkUrl', 500);
    const mediaId = nullableText('mediaId', 36);
    const mobileMediaId = nullableText('mobileMediaId', 36);
    const sortOrder = snapshot.sortOrder;
    const isActive = snapshot.isActive;
    const placementValid =
      placement === null ||
      (typeof placement === 'string' &&
        Object.values(BannerPlacement).includes(placement as BannerPlacement));
    if (
      name.length < 2 ||
      name.length > 160 ||
      !placementValid ||
      (site.siteType !== SiteType.MEDIA && placement === null) ||
      title === undefined ||
      subtitle === undefined ||
      buttonText === undefined ||
      linkUrl === undefined ||
      mediaId === undefined ||
      mobileMediaId === undefined ||
      !Number.isInteger(sortOrder) ||
      Number(sortOrder) < 0 ||
      Number(sortOrder) > 9999 ||
      typeof isActive !== 'boolean' ||
      !isAllowedBannerLink(linkUrl)
    )
      throw new BadRequestException('Снимок баннера несовместим');
    return Object.assign(new BannerEntity(), banner, {
      name,
      placement:
        site.siteType === SiteType.MEDIA &&
        placement !== BannerPlacement.ARTICLE_SIDEBAR
          ? null
          : placement,
      title,
      subtitle,
      buttonText,
      linkUrl,
      mediaId,
      mobileMediaId,
      sortOrder: Number(sortOrder),
      isActive,
    });
  }

  async publishBannerRevision(
    siteId: string,
    bannerId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const site = await this.requireSiteModule(siteId, actor, 'banners');
    const banner = await this.assertVersionedBanner(siteId, bannerId, actor);
    let published: BannerEntity | null = null;
    await this.revisions!.publish(
      siteId,
      'banner',
      bannerId,
      revisionId,
      actor,
      async (manager, snapshot) => {
        const locked = await manager.findOne(BannerEntity, {
          where: { id: bannerId, siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('Баннер не найден');
        const changed = this.bannerFromSnapshot(site, locked, snapshot);
        await this.validateBannerMedia(
          siteId,
          changed.mediaId,
          changed.mobileMediaId,
        );
        if (changed.isActive)
          await this.validateExistingBannerAssignments(siteId, changed);
        published = await manager.save(changed);
      },
    );
    return published ?? banner;
  }

  async deleteBanner(siteId: string, bannerId: string, actor: Actor) {
    await this.requireSiteModule(
      siteId,
      actor,
      'banners',
      SitePermission.APPROVE,
    );
    const banner = await this.banners.findOne({
      where: { id: bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер не найден');
    if (await this.bannerAssignments?.existsBy({ bannerId }))
      throw new ConflictException(
        'Баннер назначен на страницу. Сначала снимите все назначения',
      );
    await this.banners.remove(banner);
    return { id: bannerId };
  }

  private async recordPageActivity(
    siteId: string,
    pageId: string,
    actor: Actor,
    action: string,
    description: string,
    changes?: Record<string, unknown>,
  ) {
    if (!this.pageActivities) return;
    await this.pageActivities.save(
      this.pageActivities.create({
        siteId,
        pageId,
        userId: actor.userId,
        action,
        description,
        changes: changes ?? null,
      }),
    );
  }

  private pageBannerAssignmentsFromSnapshot(
    snapshot: Record<string, unknown> | null | undefined,
  ): PageBannerAssignmentSnapshot[] | null {
    if (!snapshot || snapshot.bannerAssignments === undefined) return null;
    if (!Array.isArray(snapshot.bannerAssignments))
      throw new BadRequestException('Снимок назначений баннеров повреждён');
    const assignments = snapshot.bannerAssignments.map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof (entry as Record<string, unknown>).zone !== 'string' ||
        typeof (entry as Record<string, unknown>).bannerId !== 'string'
      )
        throw new BadRequestException('Снимок назначений баннеров повреждён');
      return {
        zone: (entry as { zone: string }).zone,
        bannerId: (entry as { bannerId: string }).bannerId,
      };
    });
    if (
      new Set(assignments.map(({ zone }) => zone)).size !== assignments.length
    )
      throw new BadRequestException('Зона баннера повторяется в снимке');
    return assignments.sort((left, right) =>
      left.zone.localeCompare(right.zone),
    );
  }

  private async publicPageBannerAssignments(
    siteId: string,
    pageId: string,
    manager?: EntityManager,
  ): Promise<PageBannerAssignmentSnapshot[]> {
    const rows = manager
      ? await manager.find(PageBannerAssignmentEntity, {
          where: { siteId, pageId },
          order: { zone: 'ASC' },
        })
      : ((await this.bannerAssignments?.find({
          where: { siteId, pageId },
          order: { zone: 'ASC' },
        })) ?? []);
    return rows.map(({ zone, bannerId }) => ({ zone, bannerId }));
  }

  private async hydratePageBannerAssignments(
    siteId: string,
    pageId: string,
    assignments: PageBannerAssignmentSnapshot[],
  ) {
    if (!assignments.length) return [];
    const banners = await this.banners.find({
      where: {
        siteId,
        id: In(assignments.map(({ bannerId }) => bannerId)),
      },
      relations: { media: true, mobileMedia: true },
    });
    const byId = new Map(banners.map((banner) => [banner.id, banner]));
    return assignments.flatMap(({ zone, bannerId }) => {
      const banner = byId.get(bannerId);
      return banner
        ? [
            {
              id: `${pageId}:${zone}`,
              siteId,
              pageId,
              zone,
              bannerId,
              banner,
            },
          ]
        : [];
    });
  }

  private async pageAssignmentDraftState(
    siteId: string,
    page: PageEntity,
    actor: Actor,
    expectedDraftRevisionId: string | null | undefined,
  ) {
    if (!this.revisions)
      throw new ServiceUnavailableException('История страницы недоступна');
    if (expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    const current = await this.revisions.current(
      siteId,
      'page',
      page.id,
      actor,
    );
    if (expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const publicAssignments = await this.publicPageBannerAssignments(
      siteId,
      page.id,
    );
    return {
      current,
      publicAssignments,
      assignments:
        this.pageBannerAssignmentsFromSnapshot(current?.draft?.snapshot) ??
        publicAssignments,
      draftPage: current?.draft
        ? Object.assign(new PageEntity(), page, current.draft.snapshot)
        : page,
    };
  }

  private async savePageAssignmentDraft(
    siteId: string,
    page: PageEntity,
    actor: Actor,
    state: Awaited<ReturnType<ContentService['pageAssignmentDraftState']>>,
    assignments: PageBannerAssignmentSnapshot[],
  ) {
    const baseline =
      !state.current && page.status === PageStatus.PUBLISHED
        ? await this.revisions!.importPublishedBaseline({
            siteId,
            resourceType: 'page',
            entityId: page.id,
            snapshot: this.pageSnapshot(page, state.publicAssignments),
            actor,
          })
        : null;
    const next = await this.revisions!.saveDraft({
      siteId,
      resourceType: 'page',
      entityId: page.id,
      snapshot: this.pageSnapshot(state.draftPage, assignments),
      expectedDraftRevisionId: state.current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return {
      assignments: await this.hydratePageBannerAssignments(
        siteId,
        page.id,
        assignments,
      ),
      draftRevisionId: next.id,
    };
  }

  async listPageBannerAssignments(
    siteId: string,
    pageId: string,
    actor: Actor,
  ) {
    await this.requireMediaToolkit(siteId, actor);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    if (this.revisions && this.versionedPage(page)) {
      const current = await this.revisions.current(
        siteId,
        'page',
        pageId,
        actor,
      );
      const snapshotAssignments = this.pageBannerAssignmentsFromSnapshot(
        current?.draft?.snapshot,
      );
      if (snapshotAssignments)
        return this.hydratePageBannerAssignments(
          siteId,
          pageId,
          snapshotAssignments,
        );
    }
    return (
      (await this.bannerAssignments?.find({
        where: { siteId, pageId },
        relations: { banner: { media: true, mobileMedia: true } },
        order: { zone: 'ASC' },
      })) ?? []
    );
  }

  async assignPageBanner(
    siteId: string,
    pageId: string,
    actor: Actor,
    dto: AssignPageBannerDto,
  ) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    const state = this.versionedPage(page)
      ? await this.pageAssignmentDraftState(
          siteId,
          page,
          actor,
          dto.expectedDraftRevisionId,
        )
      : null;
    const slot = await this.requirePageBannerSlot(
      siteId,
      pageId,
      dto.zone,
      state?.draftPage,
    );
    const banner = await this.banners.findOne({
      where: { id: dto.bannerId, siteId },
    });
    if (!banner) throw new NotFoundException('Баннер этого сайта не найден');
    const compatibilityError = bannerSlotCompatibilityError(slot, banner);
    if (compatibilityError) throw new BadRequestException(compatibilityError);
    await this.validateBannerSlotMedia(siteId, banner, slot);
    if (!this.bannerAssignments)
      throw new ServiceUnavailableException('Назначения баннеров недоступны');
    if (state) {
      const assignments = [
        ...state.assignments.filter(({ zone }) => zone !== dto.zone),
        { zone: dto.zone, bannerId: dto.bannerId },
      ].sort((left, right) => left.zone.localeCompare(right.zone));
      return this.savePageAssignmentDraft(
        siteId,
        page,
        actor,
        state,
        assignments,
      );
    }
    await this.bannerAssignments.upsert(
      { siteId, pageId, bannerId: dto.bannerId, zone: dto.zone },
      ['pageId', 'zone'],
    );
    await this.recordPageActivity(
      siteId,
      pageId,
      actor,
      'banner_assigned',
      `Баннер назначен в зону ${dto.zone}`,
      { zone: dto.zone, bannerId: dto.bannerId },
    );
    return {
      assignments: await this.listPageBannerAssignments(siteId, pageId, actor),
      draftRevisionId: null,
    };
  }

  async unassignPageBanner(
    siteId: string,
    pageId: string,
    zone: string,
    actor: Actor,
    dto: UnassignPageBannerDto,
  ) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    const state = this.versionedPage(page)
      ? await this.pageAssignmentDraftState(
          siteId,
          page,
          actor,
          dto.expectedDraftRevisionId,
        )
      : null;
    await this.requirePageBannerSlot(siteId, pageId, zone, state?.draftPage);
    if (!this.bannerAssignments)
      throw new ServiceUnavailableException('Назначения баннеров недоступны');
    if (state)
      return this.savePageAssignmentDraft(
        siteId,
        page,
        actor,
        state,
        state.assignments.filter((assignment) => assignment.zone !== zone),
      );
    await this.bannerAssignments.delete({ siteId, pageId, zone });
    await this.recordPageActivity(
      siteId,
      pageId,
      actor,
      'banner_unassigned',
      `Баннер снят с зоны ${zone}`,
      { zone },
    );
    return { pageId, zone, assignments: [], draftRevisionId: null };
  }

  private async requirePageBannerSlot(
    siteId: string,
    pageId: string,
    zone: string,
    sourcePage?: PageEntity,
  ) {
    const page =
      sourcePage ??
      (await this.pages.findOne({ where: { id: pageId, siteId } }));
    if (!page) throw new NotFoundException('Страница не найдена');
    const slot = bannerSlotsForPage(page).find((item) => item.id === zone);
    if (!slot)
      throw new BadRequestException(
        'Шаблон страницы не содержит такой зоны баннера',
      );
    return slot;
  }

  private async validateBannerSlotMedia(
    siteId: string,
    banner: BannerEntity,
    slot: BannerSlotDefinition,
  ) {
    const candidates = [
      {
        id: banner.mediaId,
        label: 'Изображение для компьютера',
        constraints: slot.desktop,
      },
      {
        id: banner.mobileMediaId,
        label: 'Изображение для телефона',
        constraints: slot.mobile,
      },
    ];
    for (const candidate of candidates) {
      if (!candidate.id) continue;
      const { media } = await this.workspaceMedia(siteId, candidate.id);
      let dimensions =
        media.width && media.height
          ? { width: media.width, height: media.height }
          : null;
      if (!dimensions) {
        const buffer = await readFile(
          join(
            process.env.MEDIA_ROOT ?? '/data/media',
            media.storageNamespace,
            media.storedName,
          ),
        );
        const detectedMimeType = detectImageMimeType(buffer);
        dimensions = detectedMimeType
          ? readImageDimensions(buffer, detectedMimeType)
          : null;
        if (!dimensions)
          throw new BadRequestException(
            `${candidate.label}: не удалось определить размер изображения`,
          );
        media.width = dimensions.width;
        media.height = dimensions.height;
        await this.media.save(media);
      }
      const geometryError = bannerGeometryError(
        candidate.label,
        dimensions,
        candidate.constraints,
      );
      if (geometryError) throw new BadRequestException(geometryError);
    }
  }

  private async validateExistingBannerAssignments(
    siteId: string,
    banner: BannerEntity,
  ) {
    const assignments =
      (await this.bannerAssignments?.find({
        where: { siteId, bannerId: banner.id },
        relations: { page: true },
      })) ?? [];
    for (const assignment of assignments) {
      const slot = bannerSlotsForPage(assignment.page).find(
        (item) => item.id === assignment.zone,
      );
      if (!slot)
        throw new BadRequestException(
          `Зона ${assignment.zone} больше не объявлена шаблоном страницы`,
        );
      const compatibilityError = bannerSlotCompatibilityError(slot, banner);
      if (compatibilityError)
        throw new BadRequestException(`${slot.name}: ${compatibilityError}`);
      await this.validateBannerSlotMedia(siteId, banner, slot);
    }
  }

  private async variableUsageCount(siteId: string, identifier: string) {
    if (!this.siteVariables) return 0;
    const escapedIdentifier = identifier.replace(/[\\%_]/g, '\\$&');
    const token = `%{{${escapedIdentifier}}}%`;
    const rows: Array<{ count: string }> =
      await this.siteVariables.manager.query(
        `SELECT (
        (SELECT COUNT(*) FROM "sites" entry WHERE entry."id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "pages" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "articles" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "categories" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "banners" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "privacy_policy_states" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "site_content_templates" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "article_section_settings" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\')
      )::text AS "count"`,
        [siteId, token],
      );
    return Number(rows[0]?.count ?? 0);
  }

  async listSiteVariables(siteId: string, actor: Actor) {
    await this.requireMediaToolkit(siteId, actor);
    if (!this.siteVariables) return [];
    const rows = await this.siteVariables.find({
      where: { siteId },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(
      rows.map(async (variable) => ({
        ...variable,
        usageCount: await this.variableUsageCount(siteId, variable.identifier),
      })),
    );
  }

  async createSiteVariable(
    siteId: string,
    actor: Actor,
    dto: CreateSiteVariableDto,
  ) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    if (!this.siteVariables)
      throw new ServiceUnavailableException('Переменные сайта недоступны');
    const identifier = dto.identifier.trim().toLowerCase();
    if (await this.siteVariables.existsBy({ siteId, identifier }))
      throw new ConflictException('Такой идентификатор уже используется');
    return this.siteVariables.save(
      this.siteVariables.create({
        siteId,
        name: dto.name.trim(),
        identifier,
        value: dto.value,
      }),
    );
  }

  async updateSiteVariable(
    siteId: string,
    variableId: string,
    actor: Actor,
    dto: UpdateSiteVariableDto,
  ) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    if (!this.siteVariables)
      throw new ServiceUnavailableException('Переменные сайта недоступны');
    const variable = await this.siteVariables.findOneBy({
      id: variableId,
      siteId,
    });
    if (!variable) throw new NotFoundException('Переменная не найдена');
    const identifier = dto.identifier.trim().toLowerCase();
    if (identifier !== variable.identifier) {
      if ((await this.variableUsageCount(siteId, variable.identifier)) > 0)
        throw new ConflictException(
          'Используемый идентификатор нельзя изменить. Сначала замените его в контенте',
        );
      const duplicate = await this.siteVariables.findOneBy({
        siteId,
        identifier,
      });
      if (duplicate && duplicate.id !== variable.id)
        throw new ConflictException('Такой идентификатор уже используется');
    }
    variable.name = dto.name.trim();
    variable.identifier = identifier;
    variable.value = dto.value;
    return this.siteVariables.save(variable);
  }

  async deleteSiteVariable(siteId: string, variableId: string, actor: Actor) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    if (!this.siteVariables)
      throw new ServiceUnavailableException('Переменные сайта недоступны');
    const variable = await this.siteVariables.findOneBy({
      id: variableId,
      siteId,
    });
    if (!variable) throw new NotFoundException('Переменная не найдена');
    const usageCount = await this.variableUsageCount(
      siteId,
      variable.identifier,
    );
    if (usageCount > 0)
      throw new ConflictException(
        `Переменная используется в ${usageCount} элементах. Сначала удалите ссылки {{${variable.identifier}}}`,
      );
    await this.siteVariables.remove(variable);
    return { id: variableId };
  }

  async getSearchSettings(siteId: string, actor: Actor) {
    await this.requireMediaToolkit(siteId, actor);
    if (!this.searchSettings)
      throw new ServiceUnavailableException('Настройки поиска недоступны');
    let settings = await this.searchSettings.findOneBy({ siteId });
    if (!settings)
      settings = await this.searchSettings.save(
        this.searchSettings.create({
          siteId,
          searchableSections: ['articles'],
          popularQueries: [],
          recommendedQueries: [],
        }),
      );
    return {
      ...settings,
      recommendedQueries: settings.recommendedQueries.filter(
        (recommended) =>
          !settings.popularQueries.some(
            (popular) =>
              popular.query.toLocaleLowerCase('ru') ===
              recommended.query.toLocaleLowerCase('ru'),
          ),
      ),
      analyticsAvailable: false,
    };
  }

  async updateSearchSettings(
    siteId: string,
    actor: Actor,
    dto: UpdateSearchSettingsDto,
  ) {
    await this.requireMediaToolkit(siteId, actor, SitePermission.EDIT_CONTENT);
    const current = await this.getSearchSettings(siteId, actor);
    if (!this.searchSettings)
      throw new ServiceUnavailableException('Настройки поиска недоступны');
    const settings = await this.searchSettings.findOneByOrFail({ siteId });
    settings.searchableSections = dto.searchableSections;
    settings.popularQueries = dto.popularQueries.map((item) => ({
      id: item.id,
      query: item.query.trim(),
    }));
    settings.recommendedQueries = current.recommendedQueries;
    await this.searchSettings.save(settings);
    return this.getSearchSettings(siteId, actor);
  }

  async confirmRecommendedSearch(
    siteId: string,
    actor: Actor,
    dto: ConfirmRecommendedSearchDto,
  ) {
    const current = await this.getSearchSettings(siteId, actor);
    const recommendation = current.recommendedQueries.find(
      (item) => item.id === dto.recommendationId,
    );
    if (!recommendation)
      throw new NotFoundException('Рекомендованный запрос не найден');
    return this.updateSearchSettings(siteId, actor, {
      searchableSections: current.searchableSections,
      popularQueries: [
        ...current.popularQueries,
        { id: recommendation.id, query: recommendation.query },
      ],
    });
  }

  async listPageActivity(siteId: string, pageId: string, actor: Actor) {
    await this.requireSite(siteId, actor);
    if (!this.pageActivities) return [];
    const rows = await this.pageActivities.find({
      where: { siteId, pageId },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      description: row.description,
      changes: row.changes,
      createdAt: row.createdAt,
      user: row.user ? { id: row.user.id, fullName: row.user.fullName } : null,
    }));
  }

  private async validateLinks(
    siteId: string,
    categoryId?: string,
    authorId?: string,
    coverMediaId?: string,
    previewMediaId?: string,
    ogImageMediaId?: string | null,
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
    if (
      ogImageMediaId &&
      !(await this.workspaceHasMedia(siteId, ogImageMediaId))
    )
      throw new NotFoundException('Open Graph изображение не найдено');
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
    return Promise.all(
      rows.map(async (row) => {
        const article = await this.articleForCms(siteId, row, actor);
        return {
          ...article,
          createdBy: this.publicActor(article.createdBy),
          updatedBy: this.publicActor(article.updatedBy),
        };
      }),
    );
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
      dto.ogImageMediaId,
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
          ogTitle: dto.ogTitle?.trim() || null,
          ogDescription: dto.ogDescription?.trim() || null,
          ogImageMediaId: dto.ogImageMediaId ?? null,
          structuredData: dto.structuredData ?? null,
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
    let article = await this.articles.findOne({
      where: { id: articleId, siteId, deletedAt: IsNull() },
    });
    if (!article) throw new NotFoundException('Статья не найдена');
    const publicArticle = article;
    await this.requireSiteModule(
      siteId,
      actor,
      'articles',
      article.publicationState === PublicationState.PUBLISHED ||
        article.publicationState === PublicationState.HIDDEN
        ? SitePermission.EDIT_PUBLISHED
        : SitePermission.EDIT_CONTENT,
    );
    const staged =
      this.revisions &&
      (article.publicationState === PublicationState.PUBLISHED ||
        article.publicationState === PublicationState.HIDDEN);
    const currentRevision = staged
      ? await this.revisions.current(siteId, 'article', articleId, actor)
      : null;
    if (staged) {
      if (dto.expectedDraftRevisionId === undefined)
        throw new BadRequestException('Укажите актуальную версию черновика');
      if (dto.expectedDraftRevisionId !== (currentRevision?.draft?.id ?? null))
        throw new ConflictException('Черновик уже изменён');
    }
    if (currentRevision?.draft)
      article = Object.assign(
        new ArticleEntity(),
        article,
        currentRevision.draft.snapshot,
      );
    await this.validateLinks(
      siteId,
      dto.categoryId,
      dto.authorId,
      dto.coverMediaId,
      dto.previewMediaId,
      dto.ogImageMediaId,
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
      ogTitle:
        dto.ogTitle === undefined
          ? (article.ogTitle ?? null)
          : dto.ogTitle?.trim() || null,
      ogDescription:
        dto.ogDescription === undefined
          ? (article.ogDescription ?? null)
          : dto.ogDescription?.trim() || null,
      ogImageMediaId:
        dto.ogImageMediaId === undefined
          ? (article.ogImageMediaId ?? null)
          : dto.ogImageMediaId,
      structuredData:
        dto.structuredData === undefined
          ? (article.structuredData ?? null)
          : dto.structuredData,
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
    if (staged) {
      if (!this.lifecycle)
        throw new ServiceUnavailableException('История статьи недоступна');
      const duplicate = await this.articles.findOne({
        where: { siteId, slug },
      });
      if (duplicate && duplicate.id !== articleId)
        throw new ConflictException('Такой slug статьи уже используется');
      const redirect = await this.articleRedirects?.findOne({
        where: { siteId, fromSlug: slug },
      });
      if (redirect && redirect.articleId !== articleId)
        throw new ConflictException(
          'Этот slug уже сохранён как прежний адрес другой статьи',
        );
      const baseline = currentRevision
        ? null
        : await this.revisions.importPublishedBaseline({
            siteId,
            resourceType: 'article',
            entityId: articleId,
            snapshot: this.lifecycle.articleSnapshot(publicArticle),
            actor,
          });
      const snapshot =
        currentRevision?.draft?.snapshot ??
        this.lifecycle.articleSnapshot(publicArticle);
      const revision =
        (typeof snapshot.revision === 'number'
          ? snapshot.revision
          : publicArticle.revision) + 1;
      const draft = await this.revisions.saveDraft({
        siteId,
        resourceType: 'article',
        entityId: articleId,
        snapshot: { ...snapshot, ...changes, revision },
        expectedDraftRevisionId:
          currentRevision?.draft?.id ?? baseline?.id ?? null,
        actor,
      });
      return Object.assign(new ArticleEntity(), article, changes, {
        revision,
        draftRevisionId: draft.id,
      });
    }
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
    if (
      this.revisions &&
      (article.publicationState === PublicationState.PUBLISHED ||
        article.publicationState === PublicationState.HIDDEN)
    ) {
      if (!this.lifecycle)
        throw new ServiceUnavailableException('История статьи недоступна');
      const current = await this.revisions.current(
        siteId,
        'article',
        articleId,
        actor,
      );
      const baseline = current
        ? null
        : await this.revisions.importPublishedBaseline({
            siteId,
            resourceType: 'article',
            entityId: articleId,
            snapshot: this.lifecycle.articleSnapshot(article),
            actor,
          });
      const snapshot =
        current?.draft?.snapshot ?? this.lifecycle.articleSnapshot(article);
      if (snapshot.revision !== dto.expectedRevision)
        throw new ConflictException(
          'Материал уже изменён. Обновите данные и повторите сохранение',
        );
      const previousBody =
        typeof snapshot.body === 'string' ? snapshot.body : '';
      const bodyDocument = normalizeArticleDocument(
        dto.bodyDocument,
        dto.body ?? previousBody,
      );
      await this.validateArticleDocumentMedia(siteId, bodyDocument);
      const body = dto.bodyDocument
        ? articleDocumentText(bodyDocument)
        : (dto.body ?? previousBody);
      const updatedAt = new Date();
      const draft = await this.revisions.saveDraft({
        siteId,
        resourceType: 'article',
        entityId: articleId,
        snapshot: {
          ...snapshot,
          body,
          bodyDocument,
          documentVersion: bodyDocument.version,
          revision: dto.expectedRevision + 1,
        },
        expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
        actor,
      });
      return {
        id: articleId,
        body,
        bodyDocument,
        documentVersion: bodyDocument.version,
        revision: dto.expectedRevision + 1,
        updatedAt,
        draftRevisionId: draft.id,
      };
    }
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
    if (
      article.status === ArticleStatus.PUBLISHED ||
      article.status === ArticleStatus.HIDDEN ||
      article.publicationState === PublicationState.PUBLISHED ||
      article.publicationState === PublicationState.HIDDEN
    )
      throw new ConflictException(
        'Сначала снимите статью с публикации, затем её можно удалить',
      );
    if (
      this.revisions &&
      (await this.revisions.current(siteId, 'article', articleId, actor))
    )
      throw new ConflictException(
        'Статья использует ревизии: прямое удаление недоступно',
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

  private categoryRevisionSnapshot(
    category: CategoryEntity,
  ): Record<string, unknown> {
    return {
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sortOrder,
      color: category.color,
      parentId: category.parentId,
      icon: category.icon,
      imageMediaId: category.imageMediaId,
      seoTitle: category.seoTitle,
      seoDescription: category.seoDescription,
      canonicalUrl: category.canonicalUrl,
      noIndex: category.noIndex,
      ogTitle: category.ogTitle,
      ogDescription: category.ogDescription,
      ogImageMediaId: category.ogImageMediaId,
      structuredData: category.structuredData,
      displayTemplateKey: category.displayTemplateKey,
      displayTemplateVersion: category.displayTemplateVersion,
      displayTemplateConfig: category.displayTemplateConfig,
    };
  }

  private categoryDraftView(
    category: CategoryEntity,
    snapshot: Record<string, unknown>,
    draftRevisionId: string,
  ) {
    return {
      ...category,
      ...snapshot,
      id: category.id,
      siteId: category.siteId,
      status: category.status,
      publicationState: category.publicationState,
      publishedAt: category.publishedAt,
      draftRevisionId,
    };
  }

  async assertVersionedCategory(
    siteId: string,
    categoryId: string,
    actor: Actor,
  ) {
    await this.requireSiteModule(siteId, actor, 'categories');
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    if (!this.revisions)
      throw new ServiceUnavailableException('История рубрики недоступна');
    return category;
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
        const [articleCount, childCount, redirects, current] =
          await Promise.all([
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
            this.revisions
              ? this.revisions.current(siteId, 'category', category.id, actor)
              : Promise.resolve(null),
          ]);
        const view = current?.draft
          ? this.categoryDraftView(
              category,
              current.draft.snapshot,
              current.draft.id,
            )
          : category;
        return {
          ...view,
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
    ...mediaIds: Array<string | null>
  ) {
    for (const mediaId of mediaIds) {
      if (mediaId && !(await this.workspaceHasMedia(siteId, mediaId)))
        throw new NotFoundException('Изображение этой рубрики не найдено');
    }
  }

  async createCategory(siteId: string, actor: Actor, dto: CreateCategoryDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'categories',
      SitePermission.EDIT_CONTENT,
    );
    if (!this.revisions)
      throw new ServiceUnavailableException('История рубрики недоступна');
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
    await this.validateCategoryImage(
      siteId,
      imageMediaId,
      dto.ogImageMediaId ?? null,
    );
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
          ogTitle: dto.ogTitle?.trim() || null,
          ogDescription: dto.ogDescription?.trim() || null,
          ogImageMediaId: dto.ogImageMediaId ?? null,
          structuredData: dto.structuredData ?? null,
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
      const draft = await this.revisions!.saveDraftUsingManager(manager, {
        siteId,
        resourceType: 'category',
        entityId: category.id,
        snapshot: this.categoryRevisionSnapshot(category),
        expectedDraftRevisionId: null,
        actor,
      });
      return this.categoryDraftView(
        category,
        this.categoryRevisionSnapshot(category),
        draft.id,
      );
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
    if (!this.revisions)
      throw new ServiceUnavailableException('История рубрики недоступна');
    const current = await this.revisions.current(
      siteId,
      'category',
      categoryId,
      actor,
    );
    if (dto.expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    if (dto.expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const source = current?.draft
      ? Object.assign(new CategoryEntity(), category, current.draft.snapshot)
      : category;
    if (
      (dto.status && dto.status !== category.status) ||
      (dto.publicationState &&
        dto.publicationState !== category.publicationState)
    )
      throw new BadRequestException(
        'Статус рубрики изменяется только через процесс публикации',
      );
    const displayTemplateKey =
      dto.displayTemplateKey?.trim() || source.displayTemplateKey;
    const displayTemplateVersion =
      dto.displayTemplateVersion?.trim() || source.displayTemplateVersion;
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
    const redirect = await this.categoryRedirects?.findOne({
      where: { siteId, fromSlug: slug },
    });
    if (redirect && redirect.categoryId !== categoryId)
      throw new ConflictException(
        'Этот slug уже сохранён как прежний адрес другой рубрики',
      );
    const parentId =
      dto.parentId === undefined ? (source.parentId ?? null) : dto.parentId;
    const imageMediaId =
      dto.imageMediaId === undefined
        ? (source.imageMediaId ?? null)
        : dto.imageMediaId;
    await this.validateCategoryParent(siteId, parentId, categoryId);
    const ogImageMediaId =
      dto.ogImageMediaId === undefined
        ? (source.ogImageMediaId ?? null)
        : dto.ogImageMediaId;
    await this.validateCategoryImage(siteId, imageMediaId, ogImageMediaId);
    const changes = {
      name: dto.name.trim(),
      slug,
      description:
        dto.description === undefined
          ? source.description
          : dto.description?.trim() || null,
      sortOrder: dto.sortOrder ?? source.sortOrder ?? 0,
      color: dto.color ?? source.color,
      parentId,
      icon:
        dto.icon === undefined
          ? (source.icon ?? null)
          : dto.icon?.trim() || null,
      imageMediaId,
      seoTitle:
        dto.seoTitle === undefined
          ? (source.seoTitle ?? null)
          : dto.seoTitle?.trim() || null,
      seoDescription:
        dto.seoDescription === undefined
          ? (source.seoDescription ?? null)
          : dto.seoDescription?.trim() || null,
      canonicalUrl:
        dto.canonicalUrl === undefined
          ? (source.canonicalUrl ?? null)
          : dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
      noIndex: dto.noIndex ?? source.noIndex ?? false,
      ogTitle:
        dto.ogTitle === undefined
          ? (source.ogTitle ?? null)
          : dto.ogTitle?.trim() || null,
      ogDescription:
        dto.ogDescription === undefined
          ? (source.ogDescription ?? null)
          : dto.ogDescription?.trim() || null,
      ogImageMediaId,
      structuredData:
        dto.structuredData === undefined
          ? (source.structuredData ?? null)
          : dto.structuredData,
      displayTemplateKey,
      displayTemplateVersion,
      displayTemplateConfig:
        dto.displayTemplateConfig ?? source.displayTemplateConfig,
    };
    const baseline =
      !current &&
      (category.publicationState === PublicationState.PUBLISHED ||
        category.publicationState === PublicationState.HIDDEN)
        ? await this.revisions.importPublishedBaseline({
            siteId,
            resourceType: 'category',
            entityId: categoryId,
            snapshot: this.categoryRevisionSnapshot(category),
            actor,
          })
        : null;
    const changed = Object.assign(new CategoryEntity(), source, changes);
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: 'category',
      entityId: categoryId,
      snapshot: this.categoryRevisionSnapshot(changed),
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.categoryDraftView(
      category,
      this.categoryRevisionSnapshot(changed),
      next.id,
    );
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

  async getCategoryRevisionPreview(
    siteId: string,
    categoryId: string,
    revisionId: string,
    actor: Actor,
  ) {
    await this.assertVersionedCategory(siteId, categoryId, actor);
    return this.getCategoryPreview(siteId, categoryId, actor, revisionId);
  }

  async getCategoryPreview(
    siteId: string,
    categoryId: string,
    actor: Actor,
    revisionId?: string,
  ) {
    const site = await this.requireSiteModule(siteId, actor, 'categories');
    const category = await this.categories.findOne({
      where: { id: categoryId, siteId, deletedAt: IsNull() },
      relations: { imageMedia: true },
    });
    if (!category) throw new NotFoundException('Рубрика не найдена');
    const exact = revisionId
      ? await this.revisions?.getVersion(
          siteId,
          'category',
          categoryId,
          revisionId,
          actor,
        )
      : null;
    if (revisionId && !exact)
      throw new ServiceUnavailableException('История рубрики недоступна');
    const previewCategory = exact
      ? this.categoryDraftView(category, exact.snapshot, exact.id)
      : category;
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
      category: previewCategory,
      redirectTo: null,
      articles,
      children,
      pages,
    };
  }

  async publishCategoryRevision(
    siteId: string,
    categoryId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const category = await this.assertVersionedCategory(
      siteId,
      categoryId,
      actor,
    );
    let published: CategoryEntity | null = null;
    await this.revisions!.publish(
      siteId,
      'category',
      categoryId,
      revisionId,
      actor,
      async (manager, snapshot) => {
        const locked = await manager.findOne(CategoryEntity, {
          where: { id: categoryId, siteId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('Рубрика не найдена');
        if (
          typeof snapshot.name !== 'string' ||
          snapshot.name.trim().length < 2 ||
          typeof snapshot.slug !== 'string' ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(snapshot.slug)
        )
          throw new BadRequestException('Снимок рубрики несовместим');
        const candidate = Object.assign(
          new CategoryEntity(),
          locked,
          snapshot,
          {
            id: categoryId,
            siteId,
            name: snapshot.name.trim(),
            slug: snapshot.slug.trim().toLowerCase(),
          },
        );
        if (new Set(['404', 'privacy-policy', 'search']).has(candidate.slug))
          throw new ConflictException('Этот slug зарезервирован системой');
        await this.validateCategoryParent(
          siteId,
          candidate.parentId ?? null,
          categoryId,
        );
        await this.validateCategoryImage(
          siteId,
          candidate.imageMediaId ?? null,
          candidate.ogImageMediaId ?? null,
        );
        await this.lifecycle?.assertTemplate(
          siteId,
          ContentTemplateKind.CATEGORY,
          candidate.displayTemplateKey,
          candidate.displayTemplateVersion,
        );
        const duplicate = await manager.findOne(CategoryEntity, {
          where: { siteId, slug: candidate.slug },
        });
        if (duplicate && duplicate.id !== categoryId)
          throw new ConflictException('Такая рубрика уже существует');
        const targetRedirect = await manager.findOne(CategoryRedirectEntity, {
          where: { siteId, fromSlug: candidate.slug },
        });
        if (targetRedirect && targetRedirect.categoryId !== categoryId)
          throw new ConflictException(
            'Этот slug уже сохранён как прежний адрес другой рубрики',
          );
        const previousSlug = locked.slug;
        if (previousSlug !== candidate.slug) {
          const previousRedirect = await manager.findOne(
            CategoryRedirectEntity,
            { where: { siteId, fromSlug: previousSlug } },
          );
          if (previousRedirect && previousRedirect.categoryId !== categoryId)
            throw new ConflictException(
              'Прежний адрес принадлежит другой рубрике',
            );
          if (targetRedirect)
            await manager.delete(CategoryRedirectEntity, {
              id: targetRedirect.id,
            });
          await manager.upsert(
            CategoryRedirectEntity,
            { siteId, categoryId, fromSlug: previousSlug },
            ['siteId', 'fromSlug'],
          );
        }
        published = await manager.save(
          Object.assign(locked, this.categoryRevisionSnapshot(candidate), {
            id: categoryId,
            siteId,
            status: CategoryStatus.ACTIVE,
            publicationState: PublicationState.PUBLISHED,
            publishedAt: locked.publishedAt ?? new Date(),
            updatedByUserId: actor.userId,
          }),
        );
      },
    );
    return (
      published ?? {
        ...category,
        status: CategoryStatus.ACTIVE,
        publicationState: PublicationState.PUBLISHED,
      }
    );
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
      SitePermission.APPROVE,
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
    const rows = await this.authors.find({
      where: { siteId },
      order: { fullName: 'ASC' },
    });
    return Promise.all(
      rows.map(async (author) => {
        const current = this.revisions
          ? await this.revisions.current(siteId, 'author', author.id, actor)
          : null;
        return current?.draft
          ? this.authorDraftView(
              author,
              current.draft.snapshot,
              current.draft.id,
            )
          : author;
      }),
    );
  }

  private authorRevisionSnapshot(author: AuthorEntity) {
    return {
      fullName: author.fullName,
      email: author.email,
      bio: author.bio,
    };
  }

  private authorDraftView(
    author: AuthorEntity,
    snapshot: Record<string, unknown>,
    draftRevisionId: string,
  ) {
    return {
      ...author,
      ...snapshot,
      id: author.id,
      siteId: author.siteId,
      draftRevisionId,
    };
  }

  async assertVersionedAuthor(siteId: string, authorId: string, actor: Actor) {
    await this.requireSiteModule(siteId, actor, 'authors');
    const author = await this.authors.findOne({
      where: { id: authorId, siteId },
    });
    if (!author) throw new NotFoundException('Автор не найден');
    if (!this.revisions)
      throw new ServiceUnavailableException('История автора недоступна');
    return author;
  }

  async createAuthor(siteId: string, actor: Actor, dto: CreateAuthorDto) {
    await this.requireSiteModule(
      siteId,
      actor,
      'authors',
      SitePermission.EDIT_CONTENT,
    );
    if (!this.revisions)
      throw new ServiceUnavailableException('История автора недоступна');
    return this.authors.manager.transaction(async (manager) => {
      const author = await manager.save(
        manager.create(AuthorEntity, {
          siteId,
          fullName: dto.fullName.trim(),
          email: dto.email?.trim().toLowerCase() || null,
          bio: dto.bio?.trim() || null,
        }),
      );
      const draft = await this.revisions!.saveDraftUsingManager(manager, {
        siteId,
        resourceType: 'author',
        entityId: author.id,
        snapshot: this.authorRevisionSnapshot(author),
        expectedDraftRevisionId: null,
        actor,
      });
      return this.authorDraftView(
        author,
        this.authorRevisionSnapshot(author),
        draft.id,
      );
    });
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
    if (!this.revisions)
      throw new ServiceUnavailableException('История автора недоступна');
    const current = await this.revisions.current(
      siteId,
      'author',
      authorId,
      actor,
    );
    if (dto.expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    if (dto.expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const source = current?.draft
      ? Object.assign(new AuthorEntity(), author, current.draft.snapshot)
      : author;
    const baseline = !current
      ? await this.revisions.importPublishedBaseline({
          siteId,
          resourceType: 'author',
          entityId: authorId,
          snapshot: this.authorRevisionSnapshot(author),
          actor,
        })
      : null;
    const changed = Object.assign(new AuthorEntity(), source, {
      fullName: dto.fullName.trim(),
      email: dto.email?.trim().toLowerCase() || null,
      bio: dto.bio?.trim() || null,
    });
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: 'author',
      entityId: authorId,
      snapshot: this.authorRevisionSnapshot(changed),
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.authorDraftView(
      author,
      this.authorRevisionSnapshot(changed),
      next.id,
    );
  }

  async getAuthorRevisionPreview(
    siteId: string,
    authorId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const author = await this.assertVersionedAuthor(siteId, authorId, actor);
    const version = await this.revisions!.getVersion(
      siteId,
      'author',
      authorId,
      revisionId,
      actor,
    );
    return {
      ...version.snapshot,
      id: author.id,
      siteId: author.siteId,
      revisionId: version.id,
      versionNumber: version.versionNumber,
    };
  }

  async publishAuthorRevision(
    siteId: string,
    authorId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const author = await this.assertVersionedAuthor(siteId, authorId, actor);
    let published: AuthorEntity | null = null;
    await this.revisions!.publish(
      siteId,
      'author',
      authorId,
      revisionId,
      actor,
      async (manager, snapshot) => {
        const locked = await manager.findOne(AuthorEntity, {
          where: { id: authorId, siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('Автор не найден');
        const fullName =
          typeof snapshot.fullName === 'string' ? snapshot.fullName.trim() : '';
        const email =
          snapshot.email === null || typeof snapshot.email === 'string'
            ? snapshot.email?.trim().toLowerCase() || null
            : undefined;
        const bio =
          snapshot.bio === null || typeof snapshot.bio === 'string'
            ? snapshot.bio?.trim() || null
            : undefined;
        if (
          fullName.length < 2 ||
          fullName.length > 160 ||
          email === undefined ||
          (email !== null &&
            (email.length > 255 ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
          bio === undefined ||
          (bio !== null && bio.length > 500)
        )
          throw new BadRequestException('Снимок автора несовместим');
        published = await manager.save(
          Object.assign(locked, { fullName, email, bio }),
        );
      },
    );
    return published ?? author;
  }

  async deleteAuthor(siteId: string, authorId: string, actor: Actor) {
    await this.requireSiteModule(
      siteId,
      actor,
      'authors',
      SitePermission.APPROVE,
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
    const dimensions = readImageDimensions(file.buffer, detectedMimeType);
    if (!dimensions)
      throw new BadRequestException(
        'Не удалось определить размер загруженного изображения',
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
          width: dimensions.width,
          height: dimensions.height,
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

  private versionedPage(page: PageEntity) {
    return (
      page.kind === PageKind.HOMEPAGE ||
      (page.kind === PageKind.PAGE && !fixedSystemPageTitles.has(page.slug))
    );
  }

  async assertVersionedPage(siteId: string, pageId: string, actor: Actor) {
    await this.requireSite(siteId, actor);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    if (!this.versionedPage(page))
      throw new BadRequestException('Ревизии этой страницы недоступны');
    return page;
  }

  async getPageRevisionPreview(
    siteId: string,
    pageId: string,
    revisionId: string,
    actor: Actor,
  ) {
    await this.assertVersionedPage(siteId, pageId, actor);
    return this.getPagePreview(siteId, pageId, actor, revisionId);
  }

  private pageSnapshot(
    page: PageEntity,
    bannerAssignments?: PageBannerAssignmentSnapshot[],
  ): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {
      title: page.title,
      slug: page.slug,
      kind: page.kind,
      blocks: page.blocks,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      canonicalUrl: page.canonicalUrl,
      noIndex: page.noIndex,
      ogTitle: page.ogTitle,
      ogDescription: page.ogDescription,
      ogImageMediaId: page.ogImageMediaId,
      structuredData: page.structuredData,
      redirects: page.redirects,
    };
    if (bannerAssignments !== undefined)
      snapshot.bannerAssignments = bannerAssignments;
    return snapshot;
  }

  private pageDraftView(
    page: PageEntity,
    snapshot: Record<string, unknown>,
    draftRevisionId: string,
  ) {
    return {
      ...page,
      ...snapshot,
      id: page.id,
      siteId: page.siteId,
      status: page.status,
      draftRevisionId,
    };
  }

  async listPages(siteId: string, actor: Actor) {
    await this.requireSite(siteId, actor);
    const pages = await this.pages.find({
      where: { siteId },
      order: { kind: 'ASC', title: 'ASC' },
    });
    return Promise.all(
      pages.map(async (page) => {
        const current =
          this.revisions && this.versionedPage(page)
            ? await this.revisions.current(siteId, 'page', page.id, actor)
            : null;
        const view = current?.draft
          ? this.pageDraftView(page, current.draft.snapshot, current.draft.id)
          : page;
        return { ...view, bannerSlots: bannerSlotsForPage(page) };
      }),
    );
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
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        noIndex: true,
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
    await this.requireSite(siteId, actor, SitePermission.EDIT_CODE);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    const template = NOT_FOUND_TEMPLATES.find(
      (candidate) => candidate.key === dto.templateKey,
    );
    if (!template) throw new BadRequestException('Неизвестный шаблон 404');
    page.systemTemplateKey = template.key;
    page.systemTemplateVersion = template.version;
    await this.pages.save(page);
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'template_updated',
      `Шаблон 404 изменён на ${template.name}`,
      { templateKey: template.key, templateVersion: template.version },
    );
    return this.getNotFoundPage(siteId, actor);
  }

  async updateNotFoundSeo(
    siteId: string,
    actor: Actor,
    dto: UpdateNotFoundSeoDto,
  ) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    page.seoTitle = dto.seoTitle?.trim() || null;
    page.seoDescription = dto.seoDescription?.trim() || null;
    page.noIndex = true;
    await this.pages.save(page);
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'seo_updated',
      'SEO страницы 404 обновлено',
      { seoTitle: page.seoTitle, seoDescription: page.seoDescription },
    );
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
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'status_updated',
      'Страница 404 активирована',
    );
    return this.getNotFoundPage(siteId, actor);
  }

  async deactivateNotFoundPage(siteId: string, actor: Actor) {
    await this.requireSite(siteId, actor, SitePermission.APPROVE);
    const page = await this.pages.findOne({ where: { siteId, slug: '404' } });
    if (!page) throw new NotFoundException('Страница 404 не найдена');
    page.status = PageStatus.DRAFT;
    await this.pages.save(page);
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'status_updated',
      'Страница 404 деактивирована',
    );
    return this.getNotFoundPage(siteId, actor);
  }

  async createPage(siteId: string, actor: Actor, dto: CreatePageDto) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    await this.validatePageBlocks(siteId, dto);
    if (
      dto.ogImageMediaId &&
      !(await this.workspaceHasMedia(siteId, dto.ogImageMediaId))
    )
      throw new NotFoundException('OG-изображение этого сайта не найдено');
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
        ogTitle: dto.ogTitle?.trim() || null,
        ogDescription: dto.ogDescription?.trim() || null,
        ogImageMediaId: dto.ogImageMediaId ?? null,
        structuredData: dto.structuredData ?? null,
        redirects: dto.redirects ?? [],
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
    const staged = Boolean(this.revisions && this.versionedPage(page));
    await this.requireSite(
      siteId,
      actor,
      staged
        ? SitePermission.EDIT_CONTENT
        : page.status === PageStatus.PUBLISHED
          ? SitePermission.EDIT_PUBLISHED
          : SitePermission.EDIT_CONTENT,
    );
    if (dto.status !== page.status)
      throw new BadRequestException(
        'Статус страницы изменяется только через публикацию',
      );
    const current = staged
      ? await this.revisions!.current(siteId, 'page', pageId, actor)
      : null;
    if (staged) {
      if (dto.expectedDraftRevisionId === undefined)
        throw new BadRequestException('Укажите актуальную версию черновика');
      if (dto.expectedDraftRevisionId !== (current?.draft?.id ?? null))
        throw new ConflictException('Черновик уже изменён');
    }
    const source = current?.draft
      ? Object.assign(new PageEntity(), page, current.draft.snapshot)
      : page;
    const bannerAssignments = staged
      ? (this.pageBannerAssignmentsFromSnapshot(current?.draft?.snapshot) ??
        (await this.publicPageBannerAssignments(siteId, pageId)))
      : undefined;
    const fixedSystemTitle =
      page.kind === PageKind.PAGE
        ? fixedSystemPageTitles.get(page.slug)
        : undefined;
    const slug = fixedSystemTitle
      ? page.slug
      : dto.kind === PageKind.HOMEPAGE
        ? ''
        : dto.slug.trim().toLowerCase();
    if (
      staged &&
      (dto.kind !== page.kind ||
        (page.kind === PageKind.HOMEPAGE && slug !== '') ||
        (page.kind === PageKind.PAGE &&
          (fixedSystemPageTitles.has(slug) || !slug)))
    )
      throw new BadRequestException(
        'Тип версионируемой страницы нельзя изменить',
      );
    const duplicate = await this.pages.findOne({ where: { siteId, slug } });
    if (duplicate && duplicate.id !== page.id)
      throw new ConflictException('Такой адрес страницы уже используется');
    const changed = Object.assign(new PageEntity(), source, {
      title: fixedSystemTitle ?? dto.title.trim(),
      slug,
      kind: fixedSystemTitle ? PageKind.PAGE : dto.kind,
      blocks: dto.blocks,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
      canonicalUrl: dto.canonicalUrl?.trim().replace(/\/$/, '') || null,
      noIndex: dto.noIndex ?? false,
      ogTitle:
        dto.ogTitle === undefined
          ? (source.ogTitle ?? null)
          : dto.ogTitle?.trim() || null,
      ogDescription:
        dto.ogDescription === undefined
          ? (source.ogDescription ?? null)
          : dto.ogDescription?.trim() || null,
      ogImageMediaId:
        dto.ogImageMediaId === undefined
          ? (source.ogImageMediaId ?? null)
          : dto.ogImageMediaId,
      structuredData:
        dto.structuredData === undefined
          ? (source.structuredData ?? null)
          : dto.structuredData,
      redirects: dto.redirects ?? source.redirects ?? [],
    });
    if (
      changed.ogImageMediaId &&
      !(await this.workspaceHasMedia(siteId, changed.ogImageMediaId))
    )
      throw new NotFoundException('Open Graph изображение не найдено');
    if (staged) {
      const baseline =
        !current && page.status === PageStatus.PUBLISHED
          ? await this.revisions!.importPublishedBaseline({
              siteId,
              resourceType: 'page',
              entityId: pageId,
              snapshot: this.pageSnapshot(page, bannerAssignments),
              actor,
            })
          : null;
      const next = await this.revisions!.saveDraft({
        siteId,
        resourceType: 'page',
        entityId: pageId,
        snapshot: this.pageSnapshot(changed, bannerAssignments),
        expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
        actor,
      });
      return this.pageDraftView(
        page,
        this.pageSnapshot(changed, bannerAssignments),
        next.id,
      );
    }
    Object.assign(page, changed);
    const saved = await this.pages.save(page);
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'page_updated',
      page.kind === PageKind.HOMEPAGE
        ? 'Настройки главной страницы обновлены'
        : 'Страница обновлена',
      {
        seo: true,
        redirects: page.redirects.length,
        blocks: page.blocks.length,
      },
    );
    return saved;
  }

  async publishPageRevision(
    siteId: string,
    pageId: string,
    revisionId: string,
    actor: Actor,
  ) {
    const page = await this.assertVersionedPage(siteId, pageId, actor);
    if (!this.revisions)
      throw new ServiceUnavailableException('История страницы недоступна');
    let published: PageEntity | null = null;
    await this.revisions.publish(
      siteId,
      'page',
      pageId,
      revisionId,
      actor,
      async (manager, snapshot) => {
        const locked = await manager.findOne(PageEntity, {
          where: { id: pageId, siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || !this.versionedPage(locked))
          throw new NotFoundException('Страница не найдена');
        const snapshotAssignments =
          this.pageBannerAssignmentsFromSnapshot(snapshot) ??
          (await this.publicPageBannerAssignments(siteId, pageId, manager));
        const pageFields = { ...snapshot };
        delete pageFields.bannerAssignments;
        const homepageSnapshot =
          locked.kind === PageKind.HOMEPAGE &&
          pageFields.kind === PageKind.HOMEPAGE &&
          pageFields.slug === '';
        const ordinarySnapshot =
          locked.kind === PageKind.PAGE &&
          pageFields.kind === PageKind.PAGE &&
          typeof pageFields.slug === 'string' &&
          Boolean(pageFields.slug) &&
          !fixedSystemPageTitles.has(pageFields.slug);
        if (!homepageSnapshot && !ordinarySnapshot)
          throw new BadRequestException('Снимок страницы несовместим');
        const candidate = Object.assign(new PageEntity(), locked, pageFields);
        if (!Array.isArray(candidate.blocks))
          throw new BadRequestException('Снимок страницы несовместим');
        await this.validatePageBlocks(siteId, candidate as CreatePageDto, {
          key: locked.systemTemplateKey,
          version: locked.systemTemplateVersion,
        });
        if (
          candidate.ogImageMediaId &&
          !(await this.workspaceHasMedia(siteId, candidate.ogImageMediaId))
        )
          throw new NotFoundException('Open Graph изображение не найдено');
        if (
          !candidate.blocks.some(
            (block) =>
              Boolean(block.mediaId) ||
              Boolean(block.title?.trim()) ||
              Boolean(block.text?.trim()),
          )
        )
          throw new BadRequestException(
            'Перед публикацией добавьте содержимое страницы',
          );
        const duplicate = await manager.findOne(PageEntity, {
          where: { siteId, slug: candidate.slug },
        });
        if (duplicate && duplicate.id !== pageId)
          throw new ConflictException('Такой адрес страницы уже используется');
        for (const assignment of snapshotAssignments) {
          const slot = bannerSlotsForPage(candidate).find(
            ({ id }) => id === assignment.zone,
          );
          if (!slot)
            throw new BadRequestException(
              `Зона ${assignment.zone} больше не объявлена шаблоном страницы`,
            );
          const banner = await manager.findOne(BannerEntity, {
            where: { id: assignment.bannerId, siteId },
            relations: { media: true, mobileMedia: true },
          });
          if (!banner)
            throw new NotFoundException('Баннер этого сайта не найден');
          const compatibilityError = bannerSlotCompatibilityError(slot, banner);
          if (compatibilityError)
            throw new BadRequestException(
              `${slot.name}: ${compatibilityError}`,
            );
          await this.validateBannerSlotMedia(siteId, banner, slot);
        }
        published = await manager.save(
          Object.assign(locked, pageFields, {
            id: pageId,
            siteId,
            kind: locked.kind,
            status: PageStatus.PUBLISHED,
          }),
        );
        await manager.delete(PageBannerAssignmentEntity, { siteId, pageId });
        if (snapshotAssignments.length)
          await manager.upsert(
            PageBannerAssignmentEntity,
            snapshotAssignments.map(({ zone, bannerId }) => ({
              siteId,
              pageId,
              zone,
              bannerId,
            })),
            ['pageId', 'zone'],
          );
      },
    );
    return published ?? { ...page, status: PageStatus.PUBLISHED };
  }

  async deletePage(siteId: string, pageId: string, actor: Actor) {
    await this.requireSite(siteId, actor, SitePermission.EDIT_CONTENT);
    const page = await this.pages.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new NotFoundException('Страница не найдена');
    if (fixedSystemPageTitles.has(page.slug))
      throw new ConflictException('Системную страницу нельзя удалить');
    if (this.versionedPage(page) && this.revisions)
      throw new ConflictException(
        'Удаление версионируемой страницы пока недоступно',
      );
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
    if (this.versionedPage(page) && this.revisions)
      throw new BadRequestException(
        'Страница публикуется через согласованную ревизию',
      );
    if (page.slug === 'privacy-policy' && this.revisions)
      throw new BadRequestException(
        'Политика публикуется через согласованную ревизию',
      );
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
    const saved = await this.pages.save(page);
    await this.recordPageActivity(
      siteId,
      page.id,
      actor,
      'status_updated',
      dto.status === PageStatus.PUBLISHED
        ? 'Страница опубликована'
        : 'Страница снята с публикации',
      { status: dto.status },
    );
    return saved;
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
