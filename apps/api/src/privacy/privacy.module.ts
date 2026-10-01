import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentModule } from '../content/content.module';
import {
  PageEntity,
  PrivacyLegalModelEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
  SiteAccessEntity,
} from '../database/entities';
import {
  PrivacyController,
  PrivacyLegalModelsController,
} from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [
    AuthModule,
    ContentModule,
    TypeOrmModule.forFeature([
      SiteEntity,
      SiteAccessEntity,
      PageEntity,
      PrivacyLegalModelEntity,
      PrivacyPolicyStateEntity,
    ]),
  ],
  controllers: [PrivacyController, PrivacyLegalModelsController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
