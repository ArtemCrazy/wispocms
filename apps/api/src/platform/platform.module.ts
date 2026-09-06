import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  PageEntity,
  SiteEntity,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { WorkspaceController } from './workspace.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      WorkspaceEntity,
      SiteEntity,
      PageEntity,
      WorkspaceMembershipEntity,
    ]),
    AuthModule,
  ],
  controllers: [PlatformController, WorkspaceController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
