import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsInt, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  MaterialDto,
  PreparationDraftDto,
  PreparationDto,
  PromptDto,
  UpdateMaterialDto,
} from './content-center.dto';
import { ContentCenterService } from './content-center.service';
import { MaterialUploadGuard } from './material-upload.guard';
import { MATERIAL_FILE_LIMIT } from './material-file';
import type { MaterialUpload } from './material-file';
import { YoutubeWhisperService } from './youtube-whisper.service';

class RestoreVersionDto {
  @IsInt()
  @Min(1)
  currentNumber!: number;
}

class RefreshSourceDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

@Controller('workspaces/:workspaceId/content-center')
@UseGuards(JwtAuthGuard)
export class ContentCenterController {
  constructor(
    private readonly service: ContentCenterService,
    private readonly youtubeWhisper: YoutubeWhisperService,
  ) {}

  @Post('files')
  @UseGuards(MaterialUploadGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MATERIAL_FILE_LIMIT, files: 1, fields: 0 },
    }),
  )
  upload(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: MaterialUpload,
  ) {
    return this.service.uploadFile(workspaceId, req.auth!, file);
  }

  @Get('materials/:id/file')
  async file(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.getFile(workspaceId, id, req.auth!);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.data, {
      type: file.mediaType,
      disposition: `attachment; filename="material"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      length: file.data.length,
    });
  }

  @Get()
  overview(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.overview(workspaceId, req.auth!);
  }
  @Get('materials/:id')
  material(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getMaterial(workspaceId, id, req.auth!);
  }
  @Post('materials')
  addMaterial(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: MaterialDto,
  ) {
    return this.service.saveMaterial(workspaceId, req.auth!, dto);
  }
  @Post('materials/:id/refresh')
  @HttpCode(202)
  refreshSource(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: RefreshSourceDto,
  ) {
    return this.service.refreshSource(workspaceId, id, req.auth!, dto.revision);
  }
  @Get('materials/:id/transcriptions')
  async transcriptions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.service.access(workspaceId, req.auth!);
    return this.youtubeWhisper.list(workspaceId, id);
  }
  @Post('materials/:id/transcriptions')
  @HttpCode(202)
  enqueueTranscriptions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: RefreshSourceDto,
  ) {
    return this.service
      .access(workspaceId, req.auth!)
      .then(() => this.youtubeWhisper.enqueue(workspaceId, id, dto.revision));
  }
  @Post('materials/:id/transcriptions/retry')
  @HttpCode(202)
  retryTranscriptions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service
      .access(workspaceId, req.auth!)
      .then(() => this.youtubeWhisper.retry(workspaceId, id));
  }
  @Put('materials/:id')
  updateMaterial(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMaterialDto,
  ) {
    return this.service.saveMaterial(workspaceId, req.auth!, dto, id);
  }
  @Delete('materials/:id')
  deleteMaterial(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('revision', ParseIntPipe) revision: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.deleteMaterial(workspaceId, id, revision, req.auth!);
  }
  @Post('prompts')
  createPrompt(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: PromptDto,
  ) {
    return this.service.createPrompt(workspaceId, req.auth!, dto);
  }
  @Put('draft')
  draft(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreparationDraftDto,
  ) {
    return this.service.saveDraft(workspaceId, req.auth!, dto);
  }
  @Post('runs')
  start(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreparationDto,
  ) {
    return this.service.start(workspaceId, req.auth!, dto);
  }
  @Get('versions/:id')
  version(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getVersion(workspaceId, id, req.auth!);
  }
  @Post('versions/:id/restore')
  restore(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: RestoreVersionDto,
  ) {
    return this.service.restore(workspaceId, id, req.auth!, dto.currentNumber);
  }
}
