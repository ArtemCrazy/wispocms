import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  AuditLogEntity,
  SiteEntity,
  UserEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      AuditLogEntity,
      UserEntity,
      SiteEntity,
      WorkspaceMembershipEntity,
    ]),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    PlatformAdminGuard,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
