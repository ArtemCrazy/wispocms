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
  PrivacyPolicyStateEntity,
  SiteEntity,
  SiteContentTemplateEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { ContentController } from './content.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentService } from './content.service';
import { PublicSiteController } from './public-site.controller';

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
      PrivacyPolicyStateEntity,
      BannerEntity,
    ]),
    AuthModule,
  ],
  controllers: [ContentController, PublicSiteController],
  providers: [ContentService, ContentLifecycleService],
})
export class ContentModule {}
