import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import type { Response } from 'express';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import { ContentCenterService } from './content-center.service';
import { InstagramConnectionService } from './instagram-connection.service';
import { PlatformSocialSettingsService } from './platform-social-settings.service';
import { isSocialUrl } from './social-address';

class ConnectionRevisionDto {
  @IsInt() @Min(1) revision!: number;
}
@Controller('workspaces/:workspaceId/content-center/materials/:id/social')
@UseGuards(JwtAuthGuard)
export class SocialConnectionController {
  private readonly starts = new SlidingWindowRateLimiter(60_000, 5);
  constructor(
    private readonly content: ContentCenterService,
    private readonly instagram: InstagramConnectionService,
    private readonly settings: PlatformSocialSettingsService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async status(
    @Param('workspaceId', ParseUUIDPipe) workspace: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const material = await this.content.getMaterial(workspace, id, req.auth!);
    if (material.kind !== 'url' || material.url_category !== 'social')
      throw new BadRequestException('Выберите социальный источник.');
    if (isSocialUrl(material.source_url, 'instagram'))
      return this.instagram.status(workspace, id);
    if (!isSocialUrl(material.source_url, 'youtube'))
      throw new BadRequestException('Источник не поддерживается.');
    const settings = await this.settings.status('youtube');
    return {
      ready: settings.configured,
      platformConfigured: settings.configured,
    };
  }
  @Post('connect')
  @Header('Cache-Control', 'private, no-store')
  async connect(
    @Param('workspaceId', ParseUUIDPipe) workspace: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConnectionRevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.content.access(workspace, req.auth!);
    if (!this.starts.tryConsume(req.auth!.userId))
      throw new HttpException('Повторите подключение через минуту.', 429);
    return this.instagram.start(
      workspace,
      id,
      dto.revision,
      req.auth!.userId,
      req.get('origin') ?? '',
    );
  }
  @Delete()
  @Header('Cache-Control', 'private, no-store')
  async disconnect(
    @Param('workspaceId', ParseUUIDPipe) workspace: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConnectionRevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.content.access(workspace, req.auth!);
    return this.instagram.disconnect(workspace, id, dto.revision);
  }
}

@Controller('social/instagram')
@UseGuards(JwtAuthGuard)
export class InstagramCallbackController {
  constructor(
    private readonly instagram: InstagramConnectionService,
    private readonly content: ContentCenterService,
  ) {}
  @Get('callback')
  async callback(
    @Query('state') state: unknown,
    @Query('code') code: unknown,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    try {
      const workspace = await this.instagram.complete(
        typeof state === 'string' ? state : '',
        typeof code === 'string' ? code : '',
        req.auth!.userId,
        (id) => this.content.access(id, req.auth!),
      );
      res.redirect(
        303,
        `/?workspace=${encodeURIComponent(workspace)}&view=content-center&cc=preparation&instagram=connected`,
      );
    } catch {
      // No provider message, code, state, token or raw exception in response/logs.
      res
        .status(400)
        .type('text/plain')
        .send(
          'Instagram не подключён. Возможные причины: доступ отменён, выбран другой профиль, ссылка изменена или срок подключения истёк. Вернитесь в CMS и повторите подключение из информации об источнике.',
        );
    }
  }
}
