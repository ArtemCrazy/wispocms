import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { MaterialUploadGuard } from './material-upload.guard';
import { MATERIAL_FILE_LIMIT } from './material-file';
import type { MaterialUpload } from './material-file';
import {
  ClusterDto,
  CorrectionDto,
  CreationRevisionDto,
  CreationRunDto,
  CreationSettingsDto,
  ProposalDecisionDto,
  PublishCreatedArticleDto,
  RestoreCreatedVersionDto,
  RestructureClustersDto,
} from './creation.dto';
import { CreationService } from './creation.service';
import { CreationRunsService } from './creation-runs.service';
import { CreationPublicationService } from './creation-publication.service';

async function payload<T extends object>(
  type: new () => T,
  raw: unknown,
): Promise<T> {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new BadRequestException('Неверный формат запуска');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new BadRequestException('Неверные параметры запуска');
  const dto = plainToInstance(type, parsed);
  if (
    (await validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
      .length
  )
    throw new BadRequestException('Проверьте поля запуска и ограничения длины');
  return dto;
}

@Controller('workspaces/:workspaceId/content-center/creation')
@UseGuards(JwtAuthGuard)
export class CreationController {
  constructor(
    private readonly service: CreationService,
    private readonly runs: CreationRunsService,
    private readonly publication: CreationPublicationService,
  ) {}
  @Get() async overview(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return {
      ...(await this.service.overview(w, r.auth!)),
      ai: {
        connected: this.runs.ai.connected,
        supportsFiles: this.runs.ai.supportsFiles,
      },
    };
  }
  @Put('settings') settings(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: CreationSettingsDto,
  ) {
    return this.service.saveSettings(w, r.auth!, dto);
  }
  @Post('clusters') addCluster(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: ClusterDto,
  ) {
    return this.service.saveCluster(w, r.auth!, dto);
  }
  @Put('clusters/:id') editCluster(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: ClusterDto,
  ) {
    return this.service.saveCluster(w, r.auth!, dto, id);
  }
  @Post('clusters/restructure') restructure(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: RestructureClustersDto,
  ) {
    return this.service.restructure(w, r.auth!, dto);
  }
  @Get('history') history(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.history(w, r.auth!);
  }
  @Get('articles/:id') article(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.details(w, r.auth!, id);
  }
  @Get('articles/:id/versions/:number') version(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('number', ParseIntPipe) number: number,
    @Req() r: AuthenticatedRequest,
  ) {
    return this.service.getVersion(w, r.auth!, id, number);
  }
  @Post('articles/:id/decisions') decide(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: ProposalDecisionDto,
  ) {
    return this.service.decide(w, r.auth!, id, dto);
  }
  @Post('articles/:id/restore') restore(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: RestoreCreatedVersionDto,
  ) {
    return this.service.restore(w, r.auth!, id, dto.revision, dto.number);
  }
  @Post('articles/:id/publish') publish(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: PublishCreatedArticleDto,
  ) {
    return this.publication.publish(w, r.auth!, id, dto);
  }
  @Post('articles/:id/unpublish') unpublish(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body() dto: CreationRevisionDto,
  ) {
    return this.publication.unpublish(w, r.auth!, id, dto.revision);
  }
  @Post('runs')
  @UseGuards(MaterialUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MATERIAL_FILE_LIMIT,
        files: 1,
        fields: 1,
        fieldSize: 50000,
      },
    }),
  )
  async start(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Req() r: AuthenticatedRequest,
    @Body('payload') raw: unknown,
    @UploadedFile() file?: MaterialUpload,
  ) {
    return this.runs.start(
      w,
      r.auth!,
      await payload(CreationRunDto, raw),
      file,
    );
  }
  @Post('articles/:id/correct')
  @UseGuards(MaterialUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MATERIAL_FILE_LIMIT,
        files: 1,
        fields: 1,
        fieldSize: 50000,
      },
    }),
  )
  async correct(
    @Param('workspaceId', ParseUUIDPipe) w: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() r: AuthenticatedRequest,
    @Body('payload') raw: unknown,
    @UploadedFile() file?: MaterialUpload,
  ) {
    return this.runs.correct(
      w,
      r.auth!,
      id,
      await payload(CorrectionDto, raw),
      file,
    );
  }
}
