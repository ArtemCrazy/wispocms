import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  ArticleActivityEntity,
  ArticleEntity,
  ArticleRedirectEntity,
  AuthorEntity,
  BannerEntity,
  CategoryEntity,
  CategoryActivityEntity,
  CategoryRedirectEntity,
  MediaEntity,
  PageEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { ContentController } from './content.controller';
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
      PageEntity,
      PrivacyPolicyStateEntity,
      BannerEntity,
    ]),
    AuthModule,
  ],
  controllers: [ContentController, PublicSiteController],
  providers: [ContentService],
})
export class ContentModule {}
