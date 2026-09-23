import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  ArticleActivityEntity,
  ArticleEntity,
  ArticleRelatedItemEntity,
  ArticleRedirectEntity,
  ArticleSectionSettingsEntity,
  ArticleVersionEntity,
  AuthorEntity,
  BannerEntity,
  CategoryEntity,
  CategoryActivityEntity,
  CategoryRedirectEntity,
  ContentEventEntity,
  ContentStatusScheduleEntity,
  MediaEntity,
  PageEntity,
  PageActivityEntity,
  PageBannerAssignmentEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
  SiteSearchSettingsEntity,
  SiteVariableEntity,
  SiteContentTemplateEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { ContentController } from './content.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentService } from './content.service';
import { PublicSiteController } from './public-site.controller';
import { SiteResourceAdapterRegistryService } from './site-resource-adapter-registry';
import { SiteResourceRevisionsController } from './site-resource-revisions.controller';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';
import { CodeResourcesService } from './code-resources.service';
import { ContentMetadataRevisionsController } from './content-metadata-revisions.controller';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SiteEntity,
      WorkspaceMembershipEntity,
      CategoryEntity,
      CategoryActivityEntity,
      CategoryRedirectEntity,
      AuthorEntity,
      MediaEntity,
      ArticleEntity,
      ArticleRedirectEntity,
      ArticleActivityEntity,
      ArticleRelatedItemEntity,
      ArticleVersionEntity,
      ArticleSectionSettingsEntity,
      SiteContentTemplateEntity,
      ContentEventEntity,
      ContentStatusScheduleEntity,
      PageEntity,
      PageActivityEntity,
      PageBannerAssignmentEntity,
      PrivacyPolicyStateEntity,
      BannerEntity,
      SiteVariableEntity,
      SiteSearchSettingsEntity,
    ]),
    AuthModule,
  ],
  controllers: [
    ContentController,
    PublicSiteController,
    SiteResourceRevisionsController,
    ContentMetadataRevisionsController,
  ],
  providers: [
    ContentService,
    ContentLifecycleService,
    CmsRevisionsService,
    SiteResourceAdapterRegistryService,
    {
      provide: 'SiteResourceAdapterRegistry',
      useExisting: SiteResourceAdapterRegistryService,
    },
    SiteResourceRevisionsService,
    CodeResourcesService,
    ContentMetadataRevisionsService,
  ],
  exports: [ContentLifecycleService, SiteResourceRevisionsService],
})
export class ContentModule {}
