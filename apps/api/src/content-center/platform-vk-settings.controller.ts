import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import { PlatformVkSettingsService } from './platform-vk-settings.service';

class VkSettingsRevisionDto {
  @IsInt() @Min(0) revision!: number;
}
class SaveVkSettingsDto extends VkSettingsRevisionDto {
  @IsString() @MinLength(16) @MaxLength(1024) token!: string;
}
class CheckVkSettingsDto {
  @IsString() @MaxLength(512) sourceUrl!: string;
}

@Controller('platform/settings/vk')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformVkSettingsController {
  private readonly checks = new SlidingWindowRateLimiter(60_000, 3);
  constructor(private readonly settings: PlatformVkSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status() {
    return this.settings.status();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  save(@Body() dto: SaveVkSettingsDto, @Req() req: AuthenticatedRequest) {
    return this.settings.save(dto, req.auth!.userId);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  remove(@Body() dto: VkSettingsRevisionDto, @Req() req: AuthenticatedRequest) {
    return this.settings.remove(dto.revision, req.auth!.userId);
  }

  @Post('check')
  @Header('Cache-Control', 'no-store')
  check(@Body() dto: CheckVkSettingsDto, @Req() req: AuthenticatedRequest) {
    if (!this.checks.tryConsume(req.auth!.userId))
      throw new HttpException(
        'Проверять подключение можно не чаще трёх раз в минуту.',
        429,
      );
    return this.settings.check(dto.sourceUrl);
  }
}
