import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import {
  CmsRevisionsService,
  type CmsResourceType,
} from './cms-revisions.service';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';
import {
  RequestArticleRevisionChangesDto,
  RestoreArticleRevisionDto,
} from './content.dto';

@Controller('sites/:siteId/content/metadata')
@UseGuards(JwtAuthGuard)
export class ContentMetadataRevisionsController {
  constructor(
    private readonly metadata: ContentMetadataRevisionsService,
    private readonly revisions: CmsRevisionsService,
  ) {}

  private resource(
    slug: string,
    siteId: string,
    entityId: string,
  ): CmsResourceType {
    const type = {
      'layout-bindings': 'site_layout_bindings',
      'article-list': 'site_article_list',
      'media-alt': 'media_alt',
    }[slug] as CmsResourceType | undefined;
    if (!type) throw new BadRequestException('Неизвестный metadata-ресурс');
    if (type !== 'media_alt' && entityId !== siteId)
      throw new BadRequestException('Ресурс не принадлежит этому сайту');
    return type;
  }

  @Get(':resource/:entityId/revisions/current')
  current(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.current(
      siteId,
      this.resource(resource, siteId, entityId),
      entityId,
      request.auth!,
    );
  }

  @Get(':resource/:entityId/revisions')
  history(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.listVersions(
      siteId,
      this.resource(resource, siteId, entityId),
      entityId,
      request.auth!,
    );
  }

  @Get(':resource/:entityId/revisions/:revisionId/preview')
  preview(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.revisions.getVersion(
      siteId,
      this.resource(resource, siteId, entityId),
      entityId,
      revisionId,
      request.auth!,
    );
  }

  @Post(':resource/:entityId/revisions/:revisionId/:action')
  async workflow(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Param('resource') resource: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Param('action') action: string,
    @Req() request: AuthenticatedRequest,
    @Body()
    body: Partial<RequestArticleRevisionChangesDto & RestoreArticleRevisionDto>,
  ) {
    const type = this.resource(resource, siteId, entityId);
    if (action === 'submit')
      await this.revisions.submit(
        siteId,
        type,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'approve')
      await this.revisions.approve(
        siteId,
        type,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'request-changes') {
      if (!body.reason?.trim())
        throw new BadRequestException('Укажите причину возврата');
      await this.revisions.requestChanges(
        siteId,
        type,
        entityId,
        revisionId,
        request.auth!,
        body.reason,
      );
    } else if (action === 'publish')
      await this.metadata.publish(
        siteId,
        type,
        entityId,
        revisionId,
        request.auth!,
      );
    else if (action === 'restore') {
      if (body.expectedDraftRevisionId === undefined)
        throw new BadRequestException('Укажите актуальную версию черновика');
      return this.revisions.restore(
        siteId,
        type,
        entityId,
        revisionId,
        body.expectedDraftRevisionId ?? null,
        request.auth!,
      );
    } else throw new BadRequestException('Неизвестное действие');
    return { revisionId };
  }
}
