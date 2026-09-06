import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { AuditService } from './audit.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('platform/audit')
  @UseGuards(PlatformAdminGuard)
  listAll(
    @Query('workspaceId') workspaceId?: string,
    @Query('siteId') siteId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.listAll(workspaceId, siteId, Number(limit) || 100);
  }

  @Get('sites/:siteId/audit')
  listSite(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.listSite(
      siteId,
      request.auth!,
      Number(limit) || 100,
    );
  }
}
