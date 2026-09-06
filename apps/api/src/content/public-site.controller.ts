import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Request, Response } from 'express';
import { SearchPublicContentDto, SubmitContactRequestDto } from './content.dto';
import { ContentService } from './content.service';

@Controller('public/sites')
export class PublicSiteController {
  constructor(private readonly contentService: ContentService) {}

  @Get('resolve-host')
  resolveHost(@Query('host') host?: string) {
    return this.contentService.resolvePublicSiteByHost(host);
  }

  @Get(':siteSlug')
  site(@Param('siteSlug') siteSlug: string) {
    return this.contentService.getPublicSite(siteSlug);
  }

  @Get(':siteSlug/manifest')
  manifest(@Param('siteSlug') siteSlug: string) {
    return this.contentService.getPublicIntegrationManifest(siteSlug);
  }

  @Get(':siteSlug/articles/:articleSlug')
  article(
    @Param('siteSlug') siteSlug: string,
    @Param('articleSlug') articleSlug: string,
  ) {
    return this.contentService.getPublicArticle(siteSlug, articleSlug);
  }

  @Get(':siteSlug/categories/:categorySlug')
  category(
    @Param('siteSlug') siteSlug: string,
    @Param('categorySlug') categorySlug: string,
  ) {
    return this.contentService.getPublicCategory(siteSlug, categorySlug);
  }

  @Get(':siteSlug/pages/:pageSlug')
  page(
    @Param('siteSlug') siteSlug: string,
    @Param('pageSlug') pageSlug: string,
  ) {
    return this.contentService.getPublicPage(siteSlug, pageSlug);
  }

  @Get(':siteSlug/not-found')
  notFoundPage(@Param('siteSlug') siteSlug: string) {
    return this.contentService.getPublicNotFoundPage(siteSlug);
  }

  @Get(':siteSlug/search')
  search(
    @Param('siteSlug') siteSlug: string,
    @Req() request: Request,
    @Query() dto: SearchPublicContentDto,
  ) {
    const forwarded = request.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
    const ip = address?.split(',').at(-1)?.trim() || request.ip || 'unknown';
    return this.contentService.searchPublicContent(siteSlug, dto.q, ip);
  }

  @Post(':siteSlug/contact')
  @HttpCode(200)
  contact(
    @Param('siteSlug') siteSlug: string,
    @Req() request: Request,
    @Body() dto: SubmitContactRequestDto,
  ) {
    const forwarded = request.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
    const ip = address?.split(',').at(-1)?.trim() || request.ip || 'unknown';
    return this.contentService.submitContactRequest(siteSlug, ip, dto);
  }

  @Get(':siteSlug/media/:mediaId')
  async media(
    @Param('siteSlug') siteSlug: string,
    @Param('mediaId') mediaId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.contentService.getPublicMedia(siteSlug, mediaId);
    response.type(file.mimeType);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(createReadStream(file.path));
  }
}
