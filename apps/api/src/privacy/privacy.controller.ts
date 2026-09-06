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
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import {
  ApprovePrivacyLegalModelDto,
  CreatePrivacyLegalModelDto,
  GeneratePrivacyDocumentDto,
  ResetPrivacyDocumentDto,
  SelectPrivacyLegalModelDto,
  UpdatePrivacyLegalModelDto,
  UpdatePrivacyCompanyDto,
  UpdatePrivacyManualDocumentDto,
  UpdatePrivacySettingsDto,
  UpdatePrivacyTemplateDto,
} from './privacy.dto';
import { PrivacyService } from './privacy.service';

@Controller('sites/:siteId/content/privacy')
@UseGuards(JwtAuthGuard)
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get()
  get(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.privacyService.get(siteId, request.auth!);
  }

  @Put('company')
  updateCompany(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyCompanyDto,
  ) {
    return this.privacyService.updateCompany(siteId, request.auth!, dto);
  }

  @Put('settings')
  updateSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacySettingsDto,
  ) {
    return this.privacyService.updateSettings(siteId, request.auth!, dto);
  }

  @Put('template')
  updateTemplate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyTemplateDto,
  ) {
    return this.privacyService.updateTemplate(siteId, request.auth!, dto);
  }

  @Post('legal-model/accept')
  acceptLegalModel(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SelectPrivacyLegalModelDto,
  ) {
    return this.privacyService.acceptLegalModel(siteId, request.auth!, dto);
  }

  @Post('legal-model/defer')
  deferLegalModel(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SelectPrivacyLegalModelDto,
  ) {
    return this.privacyService.deferLegalModel(siteId, request.auth!, dto);
  }

  @Post('generate')
  generate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: GeneratePrivacyDocumentDto,
  ) {
    return this.privacyService.generate(siteId, request.auth!, dto);
  }

  @Post('regenerate')
  regenerate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: GeneratePrivacyDocumentDto,
  ) {
    return this.privacyService.generate(siteId, request.auth!, dto);
  }

  @Put('manual-document')
  updateManual(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyManualDocumentDto,
  ) {
    return this.privacyService.updateManual(siteId, request.auth!, dto);
  }

  @Post('reset-to-automatic')
  reset(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() _dto: ResetPrivacyDocumentDto,
  ) {
    void _dto;
    return this.privacyService.resetToAutomatic(siteId, request.auth!);
  }
}

@Controller('platform/privacy-legal-models')
@UseGuards(JwtAuthGuard)
export class PrivacyLegalModelsController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.privacyService.listLegalModels(request.auth!);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePrivacyLegalModelDto,
  ) {
    return this.privacyService.createLegalModel(request.auth!, dto);
  }

  @Put(':modelId')
  update(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyLegalModelDto,
  ) {
    return this.privacyService.updateLegalModel(modelId, request.auth!, dto);
  }

  @Post(':modelId/approve')
  approve(
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ApprovePrivacyLegalModelDto,
  ) {
    return this.privacyService.approveLegalModel(modelId, request.auth!, dto);
  }
}
