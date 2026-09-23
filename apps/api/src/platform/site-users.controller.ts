import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  CreateSiteUserDto,
  ResetUserPasswordDto,
  UpdateUserProfileDto,
  UpdateUserStatusDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

@Controller('sites/:siteId/users')
@UseGuards(JwtAuthGuard)
export class SiteUsersController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  listUsers(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.platformService.listSiteUsers(siteId, request.auth!);
  }

  @Post()
  createUser(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSiteUserDto,
  ) {
    return this.platformService.createSiteUser(siteId, request.auth!, dto);
  }

  @Patch(':userId/status')
  updateStatus(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.platformService.updateSiteUserStatus(
      siteId,
      userId,
      request.auth!,
      dto,
    );
  }

  @Patch(':userId/profile')
  updateProfile(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.platformService.updateSiteUserProfile(
      siteId,
      userId,
      request.auth!,
      dto,
    );
  }

  @Patch(':userId/password')
  resetPassword(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.platformService.resetSiteUserPassword(
      siteId,
      userId,
      request.auth!,
      dto,
    );
  }
}
