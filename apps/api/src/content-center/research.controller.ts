import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ResearchDraftDto, ResearchRevisionDto } from './research.dto';
import { ResearchService } from './research.service';

@Controller('workspaces/:workspaceId/content-center/research')
@UseGuards(JwtAuthGuard)
export class ResearchController {
  constructor(private readonly service: ResearchService) {}
  @Get() overview(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.overview(workspaceId, req.auth!);
  }
  @Put('draft') save(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ResearchDraftDto,
  ) {
    return this.service.save(workspaceId, req.auth!, dto);
  }
  @Post('confirmations') confirm(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ResearchRevisionDto,
  ) {
    return this.service.confirm(workspaceId, req.auth!, dto);
  }
  @Get('confirmations/:id') confirmation(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.confirmation(workspaceId, req.auth!, id);
  }
  @Post('search') search(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ResearchRevisionDto,
  ) {
    return this.service.search(workspaceId, req.auth!, dto);
  }
}
