import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ContentModule } from '../content/content.module';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { ReleaseTokenGuard } from './release-token.guard';
import {
  TemplatePackageCandidatesController,
  TemplatePackageController,
  TemplatePackageCurrentController,
} from './template-package.controller';
import { ManagedChunkContentController } from './managed-chunk-content.controller';
import { ManagedChunkContentService } from './managed-chunk-content.service';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import { SkinovaManagedBackfillService } from './skinova-managed-backfill.service';
import { TemplatePackageService } from './template-package.service';

@Module({
  imports: [AuditModule, AuthModule, ContentModule],
  controllers: [
    TemplatePackageController,
    TemplatePackageCurrentController,
    TemplatePackageCandidatesController,
    ManagedChunkContentController,
  ],
  providers: [
    TemplatePackageService,
    ManagedChunkContentService,
    ManagedChunkPersistenceRepository,
    SkinovaManagedBackfillService,
    ReleaseTokenGuard,
    PlatformAdminGuard,
  ],
  exports: [TemplatePackageService, ManagedChunkPersistenceRepository],
})
export class TemplatePackageModule {}
