import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import {
  CreateManagedChunkInstanceDto,
  ManagedChunkListQueryDto,
  RequestManagedChunkChangesDto,
  RestoreManagedChunkRevisionDto,
  SaveManagedChunkDraftDto,
} from './managed-chunk-content.dto';
import { ManagedChunkContentService } from './managed-chunk-content.service';

@Controller('sites/:siteId/content/chunks')
@UseGuards(JwtAuthGuard)
export class ManagedChunkContentController {
  constructor(private readonly chunks: ManagedChunkContentService) {}

  @Get('catalog')
  catalog(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chunks.catalog(siteId, request.auth!);
  }

  @Get('instances')
  list(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Query() query: ManagedChunkListQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chunks.list(siteId, request.auth!, query.categoryKey);
  }

  @Get('instances/:instanceId')
  get(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.chunks.get(siteId, instanceId, request.auth!);
  }

  @Post('instances')
  create(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateManagedChunkInstanceDto,
  ) {
    return this.chunks.create(siteId, request.auth!, dto);
  }

  @Put('instances/:instanceId/draft')
  saveDraft(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveManagedChunkDraftDto,
  ) {
    return this.chunks.saveDraft(siteId, instanceId, request.auth!, dto);
  }

  @Post('instances/:instanceId/revisions/:revisionId/submit')
  async submit(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.chunks.submit(siteId, instanceId, revisionId, request.auth!);
    return { revisionId };
  }

  @Post('instances/:instanceId/revisions/:revisionId/approve')
  async approve(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.chunks.approve(siteId, instanceId, revisionId, request.auth!);
    return { revisionId };
  }

  @Post('instances/:instanceId/revisions/:revisionId/request-changes')
  async requestChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestManagedChunkChangesDto,
  ) {
    await this.chunks.requestChanges(
      siteId,
      instanceId,
      revisionId,
      request.auth!,
      dto.reason,
    );
    return { revisionId };
  }

  @Post('instances/:instanceId/revisions/:revisionId/publish')
  async publish(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.chunks.publish(siteId, instanceId, revisionId, request.auth!);
    return { revisionId };
  }

  @Post('instances/:instanceId/revisions/:revisionId/restore')
  restore(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreManagedChunkRevisionDto,
  ) {
    return this.chunks.restore(
      siteId,
      instanceId,
      revisionId,
      dto.expectedDraftRevisionId,
      request.auth!,
    );
  }
}
