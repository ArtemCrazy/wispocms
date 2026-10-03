import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { ReleaseTokenGuard } from './release-token.guard';
import {
  TemplatePackageCandidatesController,
  TemplatePackageController,
  TemplatePackageCurrentController,
} from './template-package.controller';
import { TemplatePackageService } from './template-package.service';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [
    TemplatePackageController,
    TemplatePackageCurrentController,
    TemplatePackageCandidatesController,
  ],
  providers: [TemplatePackageService, ReleaseTokenGuard, PlatformAdminGuard],
  exports: [TemplatePackageService],
})
export class TemplatePackageModule {}
