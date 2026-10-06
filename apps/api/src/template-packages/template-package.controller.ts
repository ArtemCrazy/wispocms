import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { RegisterTemplatePackageDto } from './template-package.dto';
import { ReleaseTokenGuard } from './release-token.guard';
import { TemplatePackageService } from './template-package.service';

class TemplatePackageVersionDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  packageId!: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}$/)
  packageVersion!: string;
}

@Controller('internal')
@UseGuards(ReleaseTokenGuard)
export class TemplatePackageController {
  constructor(private readonly templatePackages: TemplatePackageService) {}

  @Post('template-packages/register')
  register(@Body() dto: RegisterTemplatePackageDto) {
    return this.templatePackages.register(dto.manifest);
  }

  @Post('sites/:siteSlug/template-package/preflight')
  preflight(
    @Param('siteSlug') siteSlug: string,
    @Body() dto: TemplatePackageVersionDto,
  ) {
    return this.templatePackages.preflight(siteSlug, dto);
  }

  @Put('sites/:siteSlug/template-package/deployed')
  reportDeployed(
    @Param('siteSlug') siteSlug: string,
    @Body() dto: TemplatePackageVersionDto,
  ) {
    return this.templatePackages.reportDeployed(siteSlug, dto);
  }
}

@Controller('sites/:siteId/template-package')
@UseGuards(JwtAuthGuard)
export class TemplatePackageCurrentController {
  constructor(private readonly templatePackages: TemplatePackageService) {}

  @Get('current')
  current(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.templatePackages.current(siteId, request.auth!);
  }
}

@Controller('platform/sites/:siteId/template-package')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class TemplatePackageCandidatesController {
  constructor(private readonly templatePackages: TemplatePackageService) {}

  @Get('candidates')
  candidates(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.templatePackages.candidates(siteId, request.auth!);
  }
}
