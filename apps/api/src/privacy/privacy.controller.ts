import {
  BadRequestException,
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
import { SiteResourceRevisionsService } from '../content/site-resource-revisions.service';
import { PrivacyService } from './privacy.service';

@Controller('sites/:siteId/content/privacy')
@UseGuards(JwtAuthGuard)
export class PrivacyController {
  constructor(
    private readonly privacyService: PrivacyService,
    private readonly revisions: SiteResourceRevisionsService,
  ) {}

  private expected(dto: { expectedDraftRevisionId?: string | null }) {
    if (dto.expectedDraftRevisionId === undefined)
      throw new BadRequestException('Укажите актуальную версию черновика');
    return dto.expectedDraftRevisionId;
  }

  private async checkpoint(
    siteId: string,
    request: AuthenticatedRequest,
    dto: { expectedDraftRevisionId?: string | null },
    mutation: () => Promise<unknown>,
  ) {
    const expectedDraftRevisionId = this.expected(dto);
    const preparedRevisionId = await this.revisions.prepareMutation(
      siteId,
      'site_privacy',
      request.auth!,
      expectedDraftRevisionId,
    );
    const snapshot = (await mutation()) as Record<string, unknown>;
    return this.revisions.save(siteId, 'site_privacy', request.auth!, {
      snapshot,
      expectedDraftRevisionId: preparedRevisionId,
    });
  }

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
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.updateCompany(siteId, request.auth!, dto),
    );
  }

  @Put('settings')
  updateSettings(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacySettingsDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.updateSettings(siteId, request.auth!, dto),
    );
  }

  @Put('template')
  updateTemplate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyTemplateDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.updateTemplate(siteId, request.auth!, dto),
    );
  }

  @Post('legal-model/accept')
  acceptLegalModel(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SelectPrivacyLegalModelDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.acceptLegalModel(siteId, request.auth!, dto),
    );
  }

  @Post('legal-model/defer')
  deferLegalModel(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: SelectPrivacyLegalModelDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.deferLegalModel(siteId, request.auth!, dto),
    );
  }

  @Post('generate')
  generate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: GeneratePrivacyDocumentDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.generate(siteId, request.auth!, dto),
    );
  }

  @Post('regenerate')
  regenerate(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: GeneratePrivacyDocumentDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.generate(siteId, request.auth!, dto),
    );
  }

  @Put('manual-document')
  updateManual(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePrivacyManualDocumentDto,
  ) {
    return this.checkpoint(siteId, request, dto, () =>
      this.privacyService.updateManual(siteId, request.auth!, dto),
    );
  }

  @Post('reset-to-automatic')
  reset(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() _dto: ResetPrivacyDocumentDto,
  ) {
    return this.checkpoint(siteId, request, _dto, () =>
      this.privacyService.resetToAutomatic(siteId, request.auth!),
    );
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
