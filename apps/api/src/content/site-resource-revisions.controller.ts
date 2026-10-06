import {
  BadRequestException,
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
import { IsDefined, IsObject, IsUUID, ValidateIf } from 'class-validator';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { CmsRevisionsService } from './cms-revisions.service';
import {
  RequestArticleRevisionChangesDto,
  RestoreArticleRevisionDto,
} from './content.dto';
import {
  SiteResourceRevisionsService,
  type SiteRevisionResourceType,
} from './site-resource-revisions.service';

class SaveSiteResourceDraftDto {
  @IsObject()
  snapshot!: Record<string, unknown>;

  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  expectedDraftRevisionId!: string | null;
}

@Controller('sites/:siteId/content')
@UseGuards(JwtAuthGuard)
export class SiteResourceRevisionsController {
  constructor(
    private readonly resources: SiteResourceRevisionsService,
    private readonly revisions: CmsRevisionsService,
  ) {}

  private resource(value: string): SiteRevisionResourceType {
    const map: Record<string, SiteRevisionResourceType> = {
      variables: 'site_variables',
      seo: 'site_seo',
      search: 'site_search',
      'not-found': 'site_not_found',
      privacy: 'site_privacy',
    };
    const result = map[value];
    if (!result) throw new BadRequestException('Неизвестный ресурс сайта');
    return result;
  }

  @Get('versioned/:resource')
  getResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resources.get(siteId, this.resource(resource), request.auth!);
  }

  @Put('versioned/:resource')
  saveResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveSiteResourceDraftDto,
  ) {
    return this.resources.save(
      siteId,
      this.resource(resource),
      request.auth!,
      dto,
    );
  }

  @Get('versioned/:resource/revisions/current')
  currentResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.current(
      siteId,
      this.resource(resource),
      siteId,
      request.auth!,
    );
  }

  @Get('versioned/:resource/revisions')
  resourceHistory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.listVersions(
      siteId,
      this.resource(resource),
      siteId,
      request.auth!,
    );
  }

  @Get('versioned/:resource/revisions/:revisionId/preview')
  previewResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resources.preview(
      siteId,
      this.resource(resource),
      revisionId,
      request.auth!,
    );
  }

  @Post('versioned/:resource/revisions/:revisionId/submit')
  async submitResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.revisions.submit(
      siteId,
      this.resource(resource),
      siteId,
      revisionId,
      request.auth!,
    );
    return { revisionId };
  }

  @Post('versioned/:resource/revisions/:revisionId/approve')
  async approveResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.revisions.approve(
      siteId,
      this.resource(resource),
      siteId,
      revisionId,
      request.auth!,
    );
    return { revisionId };
  }

  @Post('versioned/:resource/revisions/:revisionId/request-changes')
  async requestResourceChanges(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RequestArticleRevisionChangesDto,
  ) {
    await this.revisions.requestChanges(
      siteId,
      this.resource(resource),
      siteId,
      revisionId,
      request.auth!,
      dto.reason,
    );
    return { revisionId };
  }

  @Post('versioned/:resource/revisions/:revisionId/publish')
  publishResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.resources.publish(
      siteId,
      this.resource(resource),
      revisionId,
      request.auth!,
    );
  }

  @Post('versioned/:resource/revisions/:revisionId/restore')
  restoreResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: RestoreArticleRevisionDto,
  ) {
    return this.revisions.restore(
      siteId,
      this.resource(resource),
      siteId,
      revisionId,
      dto.expectedDraftRevisionId ?? null,
      request.auth!,
    );
  }
}
