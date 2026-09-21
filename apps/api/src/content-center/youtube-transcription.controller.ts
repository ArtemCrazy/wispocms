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
  GROQ_WHISPER_MODELS,
  YoutubeTranscriptionSettingsService,
} from './youtube-transcription-settings.service';
import { YoutubeWhisperService } from './youtube-whisper.service';

class RevisionDto {
  @IsInt() @Min(0) revision!: number;
}
class SaveYoutubeTranscriptionDto extends RevisionDto {
  @IsOptional() @IsString() @MaxLength(256) apiKey?: string;
  @IsIn(GROQ_WHISPER_MODELS) model!: string;
}

@Controller('platform/settings/youtube-transcription')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class YoutubeTranscriptionController {
  private readonly checks = new SlidingWindowRateLimiter(60_000, 3);

  constructor(
    private readonly settings: YoutubeTranscriptionSettingsService,
    private readonly whisper: YoutubeWhisperService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  status() {
    return this.settings.status();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  save(
    @Body() dto: SaveYoutubeTranscriptionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.settings.save(dto, req.auth!.userId);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  remove(@Body() dto: RevisionDto, @Req() req: AuthenticatedRequest) {
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
    return this.whisper.checkConnection();
  }
}
