import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  PageEntity,
  PrivacyLegalModelEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import {
  PrivacyController,
  PrivacyLegalModelsController,
} from './privacy.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      SiteEntity,
      WorkspaceMembershipEntity,
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
