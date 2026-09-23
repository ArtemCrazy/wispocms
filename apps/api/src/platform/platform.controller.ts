import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import {
  CreateSiteDto,
  CreateUserDto,
  CreateWorkspaceDto,
  ResetUserPasswordDto,
  UpdateSiteDto,
  UpdateUserStatusDto,
  UpdateUserProfileDto,
  UpdateUserSitesDto,
  UpdateUserWorkspacesDto,
  UpdateWorkspaceDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('workspaces')
  workspaces() {
    return this.platformService.listWorkspaces();
  }

  @Post('workspaces')
  createWorkspace(@Body() dto: CreateWorkspaceDto) {
    return this.platformService.createWorkspace(dto);
  }

  @Patch('workspaces/:workspaceId')
  updateWorkspace(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.platformService.updateWorkspace(workspaceId, dto);
  }

  @Post('workspaces/:workspaceId/sites')
  createSite(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSiteDto,
  ) {
    return this.platformService.createSite(
      workspaceId,
      dto,
      request.auth!.userId,
    );
  }

  @Patch('sites/:siteId')
  updateSite(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.platformService.updateSite(siteId, dto);
  }

  @Get('users')
  users() {
    return this.platformService.listUsers();
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.platformService.createUser(dto);
  }

  @Patch('users/:userId/status')
  updateUserStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.platformService.updateUserStatus(
      userId,
      request.auth!.userId,
      dto,
    );
  }

  @Patch('users/:userId/profile')
  updateUserProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.platformService.updateUserProfile(userId, dto);
  }

  @Put('users/:userId/workspaces')
  updateUserWorkspaces(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserWorkspacesDto,
  ) {
    return this.platformService.updateUserWorkspaces(userId, dto.workspaceIds);
  }

  @Put('users/:userId/sites')
  updateUserSites(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserSitesDto,
  ) {
    return this.platformService.updateUserSites(userId, dto.siteIds);
  }

  @Post('workspaces/:workspaceId/members/:userId')
  setWorkspaceMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.platformService.setWorkspaceMember(workspaceId, userId);
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  removeWorkspaceMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.platformService.removeWorkspaceMember(workspaceId, userId);
  }

  @Patch('users/:userId/password')
  resetUserPassword(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.platformService.resetUserPassword(
      userId,
      request.auth!.userId,
      dto,
    );
  }
}
