import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BootstrapService } from './bootstrap.service';
import {
  SiteEntity,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
} from './database/entities';
import { PlatformModule } from './platform/platform.module';
import { ContentModule } from './content/content.module';
import { createDataSourceOptions } from './database/data-source';
import { AuditModule } from './audit/audit.module';
import { PrivacyModule } from './privacy/privacy.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(createDataSourceOptions()),
    TypeOrmModule.forFeature([
      UserEntity,
      WorkspaceEntity,
      SiteEntity,
      WorkspaceMembershipEntity,
    ]),
    AuthModule,
    PlatformModule,
    ContentModule,
    AuditModule,
    PrivacyModule,
  ],
  controllers: [AppController],
  providers: [AppService, BootstrapService],
})
export class AppModule {}
