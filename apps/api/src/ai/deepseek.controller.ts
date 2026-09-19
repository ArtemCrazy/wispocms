import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Put,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import {
  DeepseekSettingsService,
  DEEPSEEK_MODELS,
} from './deepseek-settings.service';
import { DeepseekService } from './deepseek.service';

export class AiRevisionDto {
  @IsInt() @Min(0) revision!: number;
}
export class SaveDeepseekDto extends AiRevisionDto {
  @IsOptional() @IsString() @MaxLength(256) apiKey?: string;
  @IsIn(DEEPSEEK_MODELS) model!: string;
}

@Controller('platform/settings/deepseek')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class DeepseekController {
  private readonly checks = new SlidingWindowRateLimiter(60_000, 3);
  constructor(
    private readonly settings: DeepseekSettingsService,
    private readonly provider: DeepseekService,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status() {
    return this.settings.status();
  }
  @Put()
  @Header('Cache-Control', 'no-store')
  save(@Body() dto: SaveDeepseekDto, @Req() req: AuthenticatedRequest) {
    return this.settings.save(dto, req.auth!.userId);
  }
  @Delete()
  @Header('Cache-Control', 'no-store')
  remove(@Body() dto: AiRevisionDto, @Req() req: AuthenticatedRequest) {
    return this.settings.remove(dto.revision, req.auth!.userId);
  }
  @Post('check')
  @Header('Cache-Control', 'no-store')
  check(@Req() req: AuthenticatedRequest) {
    if (!this.checks.tryConsume(req.auth!.userId))
      throw new HttpException(
        'Проверять подключение можно не чаще трёх раз в минуту.',
        429,
      );
    return this.provider.checkConnection();
  }
}
