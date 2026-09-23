import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Optional,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  AddArticleCommentDto,
  AssignPageBannerDto,
  ChangeArticleStatusDto,
  ChangePageStatusDto,
  CreateArticleDto,
  CreateAuthorDto,
  CreateBannerDto,
  CreateCategoryDto,
  CreateSiteVariableDto,
  ConfirmRecommendedSearchDto,
  DuplicateContentDto,
  RestoreArticleVersionDto,
  RequestArticleRevisionChangesDto,
  RestoreArticleRevisionDto,
  RestorePageRevisionDto,
  SchedulePublicationDto,
  UpdateArticleDto,
  UpdateArticleBodyDto,
  UpdateAuthorDto,
  UpdateBannerDto,
  UpdateCategoryDto,
  UpdateArticleSectionSettingsDto,
  UpdateEditorialStateDto,
  UpdateMediaDto,
  UpdatePageDto,
  UpdateNotFoundTemplateDto,
  UpdateNotFoundSeoDto,
  UpdatePublicationStateDto,
  UpdateRelatedArticlesDto,
  UpdateSiteSettingsDto,
  UpdateSiteGlobalsDto,
  UpdateSiteLayoutDto,
  UpdateSiteSeoDto,
  UpdateSearchSettingsDto,
  UpdateSiteVariableDto,
  UnassignPageBannerDto,
  UploadMediaDto,
} from './content.dto';
import { ContentEntityType, ContentEventType } from '../database/entities';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentService } from './content.service';
import { CmsRevisionsService } from './cms-revisions.service';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';

@Controller('sites/:siteId/content')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly lifecycleService: ContentLifecycleService,
    private readonly revisions: CmsRevisionsService,
    @Optional()
    private readonly versionedSiteResources?: SiteResourceRevisionsService,
    @Optional()
    private readonly metadataRevisions?: ContentMetadataRevisionsService,
  ) {}

  private metadata() {
    if (!this.metadataRevisions)
      throw new ServiceUnavailableException(
        'Сервис версий metadata-ресурсов недоступен',
      );
    return this.metadataRevisions;
  }

  private rejectLegacyVersionedMutation() {
    if (this.versionedSiteResources)
      throw new BadRequestException(
        'Этот раздел изменяется только через версионный черновик',
      );
  }

  private siteSettingsResource(scope?: string) {
    if (!scope) return 'site_globals' as const;
    if (scope === 'header') return 'site_header' as const;
    if (scope === 'footer') return 'site_footer' as const;
    throw new BadRequestException('Неизвестный раздел настроек сайта');
  }

  @Get('settings')
  settings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getSiteSettings(siteId, request.auth!);
  }

  @Patch('settings')
  updateSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteSettingsDto,
  ) {
    return this.contentService.updateSiteSettings(siteId, request.auth!, dto);
  }

  @Post('settings/test-email')
  testContactEmail(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.sendContactTestEmail(siteId, request.auth!);
  }

  @Post('settings/verify-domain')
  verifyDomain(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.verifySiteDomain(siteId, request.auth!);
  }

  @Get('settings/email-status')
  contactEmailStatus(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getContactEmailStatus(siteId, request.auth!);
  }

  @Get('globals')
  globals(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getSiteGlobals(siteId, request.auth!);
  }

  @Patch('globals')
  updateGlobals(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteGlobalsDto,
  ) {
    return this.contentService.updateSiteGlobals(siteId, request.auth!, dto);
  }

  @Get(['globals/revisions/current', 'layout/:scope/revisions/current'])
  siteSettingsRevisionCurrent(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.current(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      request.auth!,
    );
  }

  @Get(['globals/revisions', 'layout/:scope/revisions'])
  siteSettingsRevisionHistory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.listVersions(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      request.auth!,
    );
  }

  @Get([
    'globals/revisions/:revisionId/preview',
    'layout/:scope/revisions/:revisionId/preview',
  ])
  siteSettingsRevisionPreview(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getSiteSettingsRevisionPreview(
      siteId,
      this.siteSettingsResource(scope),
      revisionId,
      request.auth!,
    );
  }

  @Post([
    'globals/revisions/:revisionId/submit',
    'layout/:scope/revisions/:revisionId/submit',
  ])
  async submitSiteSettingsRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.revisions.submit(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      revisionId,
      request.auth!,
    );
    return { revisionId };
  }

  @Post([
    'globals/revisions/:revisionId/approve',
    'layout/:scope/revisions/:revisionId/approve',
  ])
  async approveSiteSettingsRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.revisions.approve(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      revisionId,
      request.auth!,
    );
    return { revisionId };
  }

  @Post([
    'globals/revisions/:revisionId/request-changes',
    'layout/:scope/revisions/:revisionId/request-changes',
  ])
  async requestSiteSettingsRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.revisions.requestChanges(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      revisionId,
      request.auth!,
      dto.reason,
    );
    return { revisionId };
  }

  @Post([
    'globals/revisions/:revisionId/publish',
    'layout/:scope/revisions/:revisionId/publish',
  ])
  publishSiteSettingsRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.publishSiteSettingsRevision(
      siteId,
      this.siteSettingsResource(scope),
      revisionId,
      request.auth!,
    );
  }

  @Post([
    'globals/revisions/:revisionId/restore',
    'layout/:scope/revisions/:revisionId/restore',
  ])
  restoreSiteSettingsRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string | undefined,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreArticleRevisionDto,
  ) {
    return this.revisions.restore(
      siteId,
      this.siteSettingsResource(scope),
      siteId,
      revisionId,
      dto.expectedDraftRevisionId ?? null,
      request.auth!,
    );
  }

  @Get('layout')
  layout(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.metadata().getLayoutBindings(siteId, request.auth!);
  }

  @Patch('layout')
  updateLayout(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteLayoutDto,
  ) {
    if (dto.expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    return this.metadata().saveLayoutBindings(siteId, request.auth!, {
      headerTemplateKey: dto.headerTemplateKey ?? '',
      headerTemplateVersion: dto.headerTemplateVersion ?? '',
      headerTemplateConfig: dto.headerTemplateConfig ?? {},
      footerTemplateKey: dto.footerTemplateKey ?? '',
      footerTemplateVersion: dto.footerTemplateVersion ?? '',
      footerTemplateConfig: dto.footerTemplateConfig ?? {},
      expectedDraftRevisionId: dto.expectedDraftRevisionId,
    });
  }

  @Get('layout/:scope')
  layoutSection(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const resourceType = this.siteSettingsResource(scope);
    return this.contentService.getSiteLayoutSection(
      siteId,
      resourceType === 'site_header' ? 'header' : 'footer',
      request.auth!,
    );
  }

  @Patch('layout/:scope')
  updateLayoutSection(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('scope') scope: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteLayoutDto,
  ) {
    const resourceType = this.siteSettingsResource(scope);
    return this.contentService.updateSiteLayoutSection(
      siteId,
      resourceType === 'site_header' ? 'header' : 'footer',
      request.auth!,
      dto,
    );
  }

  @Get('seo')
  seo(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getSiteSeo(siteId, request.auth!);
  }

  @Patch('seo')
  updateSeo(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteSeoDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.updateSiteSeo(siteId, request.auth!, dto);
  }

  @Get('banners')
  banners(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listBanners(siteId, request.auth!);
  }

  @Post('banners')
  createBanner(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBannerDto,
  ) {
    return this.contentService.createBanner(siteId, request.auth!, dto);
  }

  @Patch('banners/:bannerId')
  updateBanner(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateBannerDto,
  ) {
    return this.contentService.updateBanner(
      siteId,
      bannerId,
      request.auth!,
      dto,
    );
  }

  @Get('banners/:bannerId/revisions/current')
  async currentBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.current(siteId, 'banner', bannerId, request.auth!);
  }

  @Get('banners/:bannerId/revisions')
  async bannerRevisions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.listVersions(
      siteId,
      'banner',
      bannerId,
      request.auth!,
    );
  }

  @Get('banners/:bannerId/revisions/:revisionId/preview')
  previewBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getBannerRevisionPreview(
      siteId,
      bannerId,
      revisionId,
      request.auth!,
    );
  }

  @Post('banners/:bannerId/revisions/:revisionId/submit')
  async submitBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.submit(
      siteId,
      'banner',
      bannerId,
      revisionId,
      request.auth!,
    );
  }

  @Post('banners/:bannerId/revisions/:revisionId/approve')
  async approveBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.approve(
      siteId,
      'banner',
      bannerId,
      revisionId,
      request.auth!,
    );
  }

  @Post('banners/:bannerId/revisions/:revisionId/request-changes')
  async requestBannerRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.requestChanges(
      siteId,
      'banner',
      bannerId,
      revisionId,
      request.auth!,
      dto.reason,
    );
  }

  @Post('banners/:bannerId/revisions/:revisionId/publish')
  publishBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.publishBannerRevision(
      siteId,
      bannerId,
      revisionId,
      request.auth!,
    );
  }

  @Post('banners/:bannerId/revisions/:revisionId/restore')
  async restoreBannerRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestorePageRevisionDto,
  ) {
    await this.contentService.assertVersionedBanner(
      siteId,
      bannerId,
      request.auth!,
    );
    return this.revisions.restore(
      siteId,
      'banner',
      bannerId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }

  @Delete('banners/:bannerId')
  deleteBanner(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.deleteBanner(siteId, bannerId, request.auth!);
  }

  @Get('variables')
  variables(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listSiteVariables(siteId, request.auth!);
  }

  @Post('variables')
  createVariable(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSiteVariableDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.createSiteVariable(siteId, request.auth!, dto);
  }

  @Patch('variables/:variableId')
  updateVariable(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('variableId', ParseUUIDPipe) variableId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSiteVariableDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.updateSiteVariable(
      siteId,
      variableId,
      request.auth!,
      dto,
    );
  }

  @Delete('variables/:variableId')
  deleteVariable(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('variableId', ParseUUIDPipe) variableId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.deleteSiteVariable(
      siteId,
      variableId,
      request.auth!,
    );
  }

  @Get('search-settings')
  searchSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getSearchSettings(siteId, request.auth!);
  }

  @Patch('search-settings')
  updateSearchSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateSearchSettingsDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.updateSearchSettings(siteId, request.auth!, dto);
  }

  @Post('search-settings/recommendations/confirm')
  confirmRecommendedSearch(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ConfirmRecommendedSearchDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.confirmRecommendedSearch(
      siteId,
      request.auth!,
      dto,
    );
  }

  @Get('articles')
  articles(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listArticles(siteId, request.auth!);
  }

  @Get('templates')
  templates(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.listTemplates(siteId, request.auth!);
  }

  @Get('articles/settings')
  articleSectionSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.metadata().getArticleListSettings(siteId, request.auth!);
  }

  @Patch('articles/settings')
  updateArticleSectionSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateArticleSectionSettingsDto,
  ) {
    return this.metadata().saveArticleListSettings(siteId, request.auth!, {
      templateKey: dto.templateKey,
      templateVersion: dto.templateVersion,
      config: dto.config,
      expectedDraftRevisionId: dto.expectedDraftRevisionId,
    });
  }

  @Get('trash')
  trash(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.listTrash(siteId, request.auth!);
  }

  @Get('articles/:articleId/preview')
  previewArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getArticlePreview(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Get('articles/:articleId/revisions/:revisionId/preview')
  previewArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getArticlePreview(
      siteId,
      articleId,
      request.auth!,
      revisionId,
    );
  }

  @Get('articles/:articleId/revisions/current')
  currentArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.current(siteId, 'article', articleId, request.auth!);
  }

  @Get('articles/:articleId/revisions')
  articleRevisions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.listVersions(
      siteId,
      'article',
      articleId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/revisions/:revisionId/submit')
  submitArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.submit(
      siteId,
      'article',
      articleId,
      revisionId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/revisions/:revisionId/approve')
  approveArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.approve(
      siteId,
      'article',
      articleId,
      revisionId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/revisions/:revisionId/request-changes')
  requestArticleRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    return this.revisions.requestChanges(
      siteId,
      'article',
      articleId,
      revisionId,
      request.auth!,
      dto.reason,
    );
  }

  @Post('articles/:articleId/revisions/:revisionId/publish')
  publishArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.publishArticleRevision(
      siteId,
      articleId,
      revisionId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/revisions/:revisionId/restore')
  restoreArticleRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreArticleRevisionDto,
  ) {
    return this.revisions.restore(
      siteId,
      'article',
      articleId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }

  @Get('activity')
  activity(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listSiteActivity(siteId, request.auth!);
  }

  @Post('articles')
  createArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateArticleDto,
  ) {
    return this.contentService.createArticle(siteId, request.auth!, dto);
  }

  @Patch('articles/:articleId')
  updateArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.contentService.updateArticle(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Patch('articles/:articleId/body')
  updateArticleBody(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateArticleBodyDto,
  ) {
    return this.contentService.updateArticleBody(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Delete('articles/:articleId')
  deleteArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.softDeleteArticle(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/restore')
  restoreArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.restoreArticle(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/duplicate')
  duplicateArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: DuplicateContentDto,
  ) {
    return this.lifecycleService.duplicateArticle(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Post('articles/:articleId/publication')
  setArticlePublicationState(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePublicationStateDto,
  ) {
    return this.lifecycleService.setArticlePublicationState(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Post('articles/:articleId/editorial')
  setArticleEditorialState(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateEditorialStateDto,
  ) {
    return this.lifecycleService.setArticleEditorialState(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Post('articles/:articleId/schedule')
  scheduleArticle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SchedulePublicationDto,
  ) {
    return this.lifecycleService.schedulePublication(
      siteId,
      ContentEntityType.ARTICLE,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Delete('articles/:articleId/schedule')
  cancelArticleSchedule(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.cancelSchedule(
      siteId,
      ContentEntityType.ARTICLE,
      articleId,
      request.auth!,
    );
  }

  @Get('articles/:articleId/schedule')
  articleSchedule(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.getPendingSchedule(
      siteId,
      ContentEntityType.ARTICLE,
      articleId,
      request.auth!,
    );
  }

  @Get('articles/:articleId/events')
  articleEvents(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Query('eventType') eventType?: ContentEventType,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.lifecycleService.listEvents(
      siteId,
      ContentEntityType.ARTICLE,
      articleId,
      request.auth!,
      { eventType, actorUserId, from, to, search, groupId },
    );
  }

  @Get('articles/:articleId/versions')
  articleVersions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.listArticleVersions(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Get('articles/:articleId/versions/compare')
  compareArticleVersions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
  ) {
    return this.lifecycleService.compareArticleVersions(
      siteId,
      articleId,
      request.auth!,
      from,
      to,
    );
  }

  @Post('articles/:articleId/versions/:versionId/restore')
  restoreArticleVersion(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreArticleVersionDto,
  ) {
    return this.lifecycleService.restoreArticleVersion(
      siteId,
      articleId,
      versionId,
      request.auth!,
      dto.expectedRevision,
    );
  }

  @Get('articles/:articleId/related')
  relatedArticles(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.metadata().getRelatedArticles(siteId, articleId, request.auth!);
  }

  @Patch('articles/:articleId/related')
  updateRelatedArticles(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateRelatedArticlesDto,
  ) {
    return this.metadata().saveRelatedArticles(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Get('articles/:articleId/redirects')
  articleRedirects(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listArticleRedirects(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Delete('articles/:articleId/redirects/:redirectId')
  deleteArticleRedirect(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Param('redirectId', ParseUUIDPipe) redirectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.deleteArticleRedirect(
      siteId,
      articleId,
      redirectId,
      request.auth!,
    );
  }

  @Get('categories')
  categories(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listCategories(siteId, request.auth!);
  }

  @Post('categories')
  createCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.contentService.createCategory(siteId, request.auth!, dto);
  }

  @Patch('categories/:categoryId')
  updateCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.contentService.updateCategory(
      siteId,
      categoryId,
      request.auth!,
      dto,
    );
  }

  @Delete('categories/:categoryId')
  deleteCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.softDeleteCategory(
      siteId,
      categoryId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/restore')
  restoreCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.restoreCategory(
      siteId,
      categoryId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/duplicate')
  duplicateCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: DuplicateContentDto,
  ) {
    return this.lifecycleService.duplicateCategory(
      siteId,
      categoryId,
      request.auth!,
      dto,
    );
  }

  @Post('categories/:categoryId/publication')
  setCategoryPublicationState(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePublicationStateDto,
  ) {
    return this.lifecycleService.setCategoryPublicationState(
      siteId,
      categoryId,
      request.auth!,
      dto,
    );
  }

  @Post('categories/:categoryId/schedule')
  scheduleCategory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SchedulePublicationDto,
  ) {
    return this.lifecycleService.schedulePublication(
      siteId,
      ContentEntityType.CATEGORY,
      categoryId,
      request.auth!,
      dto,
    );
  }

  @Delete('categories/:categoryId/schedule')
  cancelCategorySchedule(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.cancelSchedule(
      siteId,
      ContentEntityType.CATEGORY,
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/schedule')
  categorySchedule(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.lifecycleService.getPendingSchedule(
      siteId,
      ContentEntityType.CATEGORY,
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/events')
  categoryEvents(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
    @Query('eventType') eventType?: ContentEventType,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.lifecycleService.listEvents(
      siteId,
      ContentEntityType.CATEGORY,
      categoryId,
      request.auth!,
      { eventType, actorUserId, from, to, search, groupId },
    );
  }

  @Get('categories/:categoryId/delete-summary')
  categoryDeleteSummary(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getCategoryDeleteSummary(
      siteId,
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/preview')
  categoryPreview(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getCategoryPreview(
      siteId,
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/revisions/current')
  async currentCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.current(
      siteId,
      'category',
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/revisions')
  async categoryRevisions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.listVersions(
      siteId,
      'category',
      categoryId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/revisions/:revisionId/preview')
  previewCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getCategoryRevisionPreview(
      siteId,
      categoryId,
      revisionId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/revisions/:revisionId/submit')
  async submitCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.submit(
      siteId,
      'category',
      categoryId,
      revisionId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/revisions/:revisionId/approve')
  async approveCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.approve(
      siteId,
      'category',
      categoryId,
      revisionId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/revisions/:revisionId/request-changes')
  async requestCategoryRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.requestChanges(
      siteId,
      'category',
      categoryId,
      revisionId,
      request.auth!,
      dto.reason,
    );
  }

  @Post('categories/:categoryId/revisions/:revisionId/publish')
  publishCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.publishCategoryRevision(
      siteId,
      categoryId,
      revisionId,
      request.auth!,
    );
  }

  @Post('categories/:categoryId/revisions/:revisionId/restore')
  async restoreCategoryRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestorePageRevisionDto,
  ) {
    await this.contentService.assertVersionedCategory(
      siteId,
      categoryId,
      request.auth!,
    );
    return this.revisions.restore(
      siteId,
      'category',
      categoryId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }

  @Get('categories/:categoryId/activity')
  categoryActivity(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listCategoryActivity(
      siteId,
      categoryId,
      request.auth!,
    );
  }

  @Delete('categories/:categoryId/redirects/:redirectId')
  deleteCategoryRedirect(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('redirectId', ParseUUIDPipe) redirectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.deleteCategoryRedirect(
      siteId,
      categoryId,
      redirectId,
      request.auth!,
    );
  }

  @Get('authors')
  authors(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listAuthors(siteId, request.auth!);
  }

  @Post('authors')
  createAuthor(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAuthorDto,
  ) {
    return this.contentService.createAuthor(siteId, request.auth!, dto);
  }

  @Patch('authors/:authorId')
  updateAuthor(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateAuthorDto,
  ) {
    return this.contentService.updateAuthor(
      siteId,
      authorId,
      request.auth!,
      dto,
    );
  }

  @Get('authors/:authorId/revisions/current')
  async currentAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.current(siteId, 'author', authorId, request.auth!);
  }

  @Get('authors/:authorId/revisions')
  async authorRevisions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.listVersions(
      siteId,
      'author',
      authorId,
      request.auth!,
    );
  }

  @Get('authors/:authorId/revisions/:revisionId/preview')
  previewAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getAuthorRevisionPreview(
      siteId,
      authorId,
      revisionId,
      request.auth!,
    );
  }

  @Post('authors/:authorId/revisions/:revisionId/submit')
  async submitAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.submit(
      siteId,
      'author',
      authorId,
      revisionId,
      request.auth!,
    );
  }

  @Post('authors/:authorId/revisions/:revisionId/approve')
  async approveAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.approve(
      siteId,
      'author',
      authorId,
      revisionId,
      request.auth!,
    );
  }

  @Post('authors/:authorId/revisions/:revisionId/request-changes')
  async requestAuthorRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.requestChanges(
      siteId,
      'author',
      authorId,
      revisionId,
      request.auth!,
      dto.reason,
    );
  }

  @Post('authors/:authorId/revisions/:revisionId/publish')
  publishAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.publishAuthorRevision(
      siteId,
      authorId,
      revisionId,
      request.auth!,
    );
  }

  @Post('authors/:authorId/revisions/:revisionId/restore')
  async restoreAuthorRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestorePageRevisionDto,
  ) {
    await this.contentService.assertVersionedAuthor(
      siteId,
      authorId,
      request.auth!,
    );
    return this.revisions.restore(
      siteId,
      'author',
      authorId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }

  @Delete('authors/:authorId')
  deleteAuthor(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('authorId', ParseUUIDPipe) authorId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.deleteAuthor(siteId, authorId, request.auth!);
  }

  @Get('media')
  async media(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const items = await this.contentService.listMedia(siteId, request.auth!);
    return this.metadata().applyDraftAlt(siteId, request.auth!, items);
  }

  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  uploadMedia(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @UploadedFile()
    file:
      | { originalname: string; mimetype: string; size: number; buffer: Buffer }
      | undefined,
    @Body() dto: UploadMediaDto,
  ) {
    if (!file) throw new BadRequestException('Выберите файл изображения');
    return this.contentService.uploadMedia(
      siteId,
      request.auth!,
      file,
      dto.altText,
    );
  }

  @Get('media/:mediaId/file')
  async mediaFile(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contentService.getMediaFile(
      siteId,
      mediaId,
      request.auth!,
    );
    response.type(file.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(createReadStream(file.path));
  }

  @Patch('media/:mediaId')
  updateMedia(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateMediaDto,
  ) {
    return this.metadata().saveMediaAlt(siteId, mediaId, request.auth!, dto);
  }

  @Delete('media/:mediaId')
  deleteMedia(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.deleteMedia(siteId, mediaId, request.auth!);
  }

  @Get('pages')
  pages(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listPages(siteId, request.auth!);
  }

  @Get('not-found')
  notFoundPage(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getNotFoundPage(siteId, request.auth!);
  }

  @Patch('not-found/template')
  updateNotFoundTemplate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateNotFoundTemplateDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.updateNotFoundTemplate(
      siteId,
      request.auth!,
      dto,
    );
  }

  @Patch('not-found/seo')
  updateNotFoundSeo(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateNotFoundSeoDto,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.updateNotFoundSeo(siteId, request.auth!, dto);
  }

  @Post('not-found/activate')
  activateNotFoundPage(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.activateNotFoundPage(siteId, request.auth!);
  }

  @Post('not-found/deactivate')
  deactivateNotFoundPage(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.rejectLegacyVersionedMutation();
    return this.contentService.deactivateNotFoundPage(siteId, request.auth!);
  }

  @Get('pages/:pageId/preview')
  previewPage(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getPagePreview(siteId, pageId, request.auth!);
  }

  @Get('pages/:pageId/revisions/current')
  async currentPageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.current(siteId, 'page', pageId, request.auth!);
  }

  @Get('pages/:pageId/revisions')
  async pageRevisions(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.listVersions(siteId, 'page', pageId, request.auth!);
  }

  @Get('pages/:pageId/revisions/:revisionId/preview')
  previewPageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.getPageRevisionPreview(
      siteId,
      pageId,
      revisionId,
      request.auth!,
    );
  }

  @Post('pages/:pageId/revisions/:revisionId/submit')
  async submitPageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.submit(
      siteId,
      'page',
      pageId,
      revisionId,
      request.auth!,
    );
  }

  @Post('pages/:pageId/revisions/:revisionId/approve')
  async approvePageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.approve(
      siteId,
      'page',
      pageId,
      revisionId,
      request.auth!,
    );
  }

  @Post('pages/:pageId/revisions/:revisionId/request-changes')
  async requestPageRevisionChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.requestChanges(
      siteId,
      'page',
      pageId,
      revisionId,
      request.auth!,
      dto.reason,
    );
  }

  @Post('pages/:pageId/revisions/:revisionId/publish')
  publishPageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.publishPageRevision(
      siteId,
      pageId,
      revisionId,
      request.auth!,
    );
  }

  @Post('pages/:pageId/revisions/:revisionId/restore')
  async restorePageRevision(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestorePageRevisionDto,
  ) {
    await this.contentService.assertVersionedPage(
      siteId,
      pageId,
      request.auth!,
    );
    return this.revisions.restore(
      siteId,
      'page',
      pageId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }

  @Patch('pages/:pageId')
  updatePage(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePageDto,
  ) {
    return this.contentService.updatePage(siteId, pageId, request.auth!, dto);
  }

  @Get('pages/:pageId/banner-assignments')
  pageBannerAssignments(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listPageBannerAssignments(
      siteId,
      pageId,
      request.auth!,
    );
  }

  @Put('pages/:pageId/banner-assignments')
  assignPageBanner(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AssignPageBannerDto,
  ) {
    return this.contentService.assignPageBanner(
      siteId,
      pageId,
      request.auth!,
      dto,
    );
  }

  @Delete('pages/:pageId/banner-assignments/:zone')
  unassignPageBanner(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Param('zone') zone: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UnassignPageBannerDto,
  ) {
    return this.contentService.unassignPageBanner(
      siteId,
      pageId,
      zone,
      request.auth!,
      dto,
    );
  }

  @Get('pages/:pageId/history')
  pageHistory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listPageActivity(siteId, pageId, request.auth!);
  }

  @Post('pages/:pageId/status')
  changePageStatus(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePageStatusDto,
  ) {
    return this.contentService.changePageStatus(
      siteId,
      pageId,
      request.auth!,
      dto,
    );
  }

  @Get('articles/:articleId/activity')
  articleActivity(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentService.listArticleActivity(
      siteId,
      articleId,
      request.auth!,
    );
  }

  @Post('articles/:articleId/comments')
  addArticleComment(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddArticleCommentDto,
  ) {
    return this.contentService.addArticleComment(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }

  @Post('articles/:articleId/status')
  changeArticleStatus(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('articleId', ParseUUIDPipe) articleId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangeArticleStatusDto,
  ) {
    return this.contentService.changeArticleStatus(
      siteId,
      articleId,
      request.auth!,
      dto,
    );
  }
}
