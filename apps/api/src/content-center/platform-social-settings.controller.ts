import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import {
  PlatformSocialSettingsService,
  socialNetwork,
} from './platform-social-settings.service';

class RevisionDto {
  @IsInt() @Min(0) revision!: number;
}
class SaveSocialSettingsDto extends RevisionDto {
  @IsString() @MinLength(16) @MaxLength(4096) secret!: string;
  @IsOptional() @IsString() @MaxLength(32) appId?: string;
  @IsOptional() @IsString() @MaxLength(512) redirectUri?: string;
}
@Controller('platform/settings/social/:network')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformSocialSettingsController {
  constructor(private readonly settings: PlatformSocialSettingsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status(@Param('network') network: string) {
    return this.settings.status(socialNetwork(network));
  }
  @Put()
  @Header('Cache-Control', 'no-store')
  save(
    @Param('network') network: string,
    @Body() input: SaveSocialSettingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.settings.save(socialNetwork(network), input, req.auth!.userId);
  }
  @Delete()
  @Header('Cache-Control', 'no-store')
  remove(
    @Param('network') network: string,
    @Body() input: RevisionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.settings.remove(
      socialNetwork(network),
      input.revision,
      req.auth!.userId,
    );
  }
}
