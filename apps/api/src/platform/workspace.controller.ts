import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { CreateSiteDto } from './platform.dto';
import { PlatformService } from './platform.service';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly platformService: PlatformService) {}

  @Post(':workspaceId/sites')
  createSite(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateSiteDto,
  ) {
    return this.platformService.createWorkspaceSite(
      workspaceId,
      request.auth!,
      dto,
    );
  }
}
