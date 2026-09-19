import {
  Body,
  Controller,
  Delete,
  Get,
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

class RestoreVersionDto {
  @IsInt()
  @Min(1)
  currentNumber!: number;
}

@Controller('workspaces/:workspaceId/content-center')
@UseGuards(JwtAuthGuard)
export class ContentCenterController {
  constructor(private readonly service: ContentCenterService) {}

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
