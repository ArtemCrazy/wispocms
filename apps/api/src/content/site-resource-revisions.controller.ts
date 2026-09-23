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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { CmsRevisionsService } from './cms-revisions.service';
import {
  CodeResourcesService,
  type CodeResourceKind,
} from './code-resources.service';
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

class CodeResourceParameterDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(100)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;

  @IsIn(['text', 'image', 'icon', 'html'])
  type!: 'text' | 'image' | 'icon' | 'html';
}

class SaveCodeResourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_-]*$/)
  @MaxLength(100)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  html!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeResourceParameterDto)
  parameters!: CodeResourceParameterDto[];

  @IsOptional()
  @IsUUID()
  expectedDraftRevisionId?: string | null;
}

@Controller('sites/:siteId/content')
@UseGuards(JwtAuthGuard)
export class SiteResourceRevisionsController {
  constructor(
    private readonly resources: SiteResourceRevisionsService,
    private readonly revisions: CmsRevisionsService,
    private readonly code: CodeResourcesService,
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

  private kind(value: string): CodeResourceKind {
    if (value !== 'template' && value !== 'chunk')
      throw new BadRequestException('Неизвестный тип HTML-ресурса');
    return value;
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

  @Get('code-resources/:kind')
  codeResources(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.code.list(siteId, this.kind(kind), request.auth!);
  }

  @Post('code-resources/:kind')
  createCodeResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveCodeResourceDto,
  ) {
    return this.code.create(siteId, this.kind(kind), request.auth!, dto);
  }

  @Put('code-resources/:kind/:entityId')
  updateCodeResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveCodeResourceDto,
  ) {
    return this.code.update(
      siteId,
      this.kind(kind),
      entityId,
      request.auth!,
      dto,
    );
  }

  @Get('code-resources/:kind/:entityId/published')
  publishedCodeResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.code.published(
      siteId,
      this.kind(kind),
      entityId,
      request.auth!,
    );
  }

  @Get('code-resources/:kind/:entityId/revisions/current')
  currentCodeResource(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.current(
      siteId,
      this.kind(kind),
      entityId,
      request.auth!,
    );
  }

  @Get('code-resources/:kind/:entityId/revisions')
  codeResourceHistory(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.listVersions(
      siteId,
      this.kind(kind),
      entityId,
      request.auth!,
    );
  }

  @Get('code-resources/:kind/:entityId/revisions/:revisionId/preview')
  codeResourcePreview(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kind: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.getVersion(
      siteId,
      this.kind(kind),
      entityId,
      revisionId,
      request.auth!,
    );
  }

  @Post('code-resources/:kind/:entityId/revisions/:revisionId/:action')
  async codeWorkflow(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('kind') kindValue: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Param('action') action: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: Partial<RequestArticleRevisionChangesDto & RestoreArticleRevisionDto>,
  ) {
    const kind = this.kind(kindValue);
    if (action === 'submit')
      await this.revisions.submit(
        siteId,
        kind,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'approve')
      await this.revisions.approve(
        siteId,
        kind,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'request-changes') {
      if (!body.reason?.trim())
        throw new BadRequestException('Укажите причину');
      await this.revisions.requestChanges(
        siteId,
        kind,
        entityId,
        revisionId,
        request.auth!,
        body.reason,
      );
    } else if (action === 'publish')
      await this.revisions.publish(
        siteId,
        kind,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'restore')
      return this.revisions.restore(
        siteId,
        kind,
        entityId,
        revisionId,
        body.expectedDraftRevisionId ?? null,
        request.auth!,
      );
    else throw new BadRequestException('Неизвестное действие');
    return { revisionId };
  }
}
