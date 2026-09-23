import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Equals, IsInt, Min } from 'class-validator';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { ContentCenterService } from './content-center.service';
import { VkConnectionService } from './vk-connection.service';

class VkRevisionDto {
  @IsInt() @Min(1) revision!: number;
}
class VkConnectDto extends VkRevisionDto {
  @Equals(true) consent!: boolean;
}

@Controller('workspaces/:workspaceId/content-center/materials/:id/vk')
@UseGuards(JwtAuthGuard)
export class VkConnectionController {
  constructor(
    private readonly content: ContentCenterService,
    private readonly vk: VkConnectionService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async status(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.content.access(workspaceId, req.auth!);
    return this.vk.status(workspaceId, id);
  }
  @Put()
  @Header('Cache-Control', 'private, no-store')
  async connect(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: VkConnectDto,
  ) {
    await this.content.access(workspaceId, req.auth!);
    return this.vk.connect(workspaceId, id, dto.revision);
  }
  @Delete()
  @Header('Cache-Control', 'private, no-store')
  async disconnect(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: VkRevisionDto,
  ) {
    await this.content.access(workspaceId, req.auth!);
    return this.vk.disconnect(workspaceId, id, dto.revision);
  }
}
