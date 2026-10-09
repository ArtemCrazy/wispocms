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
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import { SkinovaManagedBackfillService } from './skinova-managed-backfill.service';
import { TemplatePackageService } from './template-package.service';

@Module({
  imports: [AuditModule, AuthModule, ContentModule],
  controllers: [
    TemplatePackageController,
    TemplatePackageCurrentController,
    TemplatePackageCandidatesController,
  ],
  providers: [
    TemplatePackageService,
    ManagedChunkPersistenceRepository,
    SkinovaManagedBackfillService,
    ReleaseTokenGuard,
    PlatformAdminGuard,
  ],
  exports: [TemplatePackageService, ManagedChunkPersistenceRepository],
})
export class TemplatePackageModule {}
