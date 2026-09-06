import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePrivacyCompanyDto {
  @IsOptional()
  @IsIn(['', 'ip', 'ooo', 'self_employed', 'other'])
  organizationType?: '' | 'ip' | 'ooo' | 'self_employed' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ogrn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  legalAddress?: string;
}

export class UpdatePrivacySettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  dataCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  purposes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  services?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(6)
  @IsIn(
    [
      'web_forms',
      'account',
      'cookies',
      'analytics_systems',
      'direct_contact',
      'file_uploads',
    ],
    { each: true },
  )
  collectionMethods?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  otherServiceDescription?: string;

  @IsOptional()
  @IsBoolean()
  thirdPartyTransfer?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  thirdPartyDescription?: string;

  @IsOptional()
  @IsBoolean()
  cookies?: boolean;
}

export class GeneratePrivacyDocumentDto {
  @IsOptional()
  @IsBoolean()
  confirmManualReset?: boolean;
}

export class UpdatePrivacyManualDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  text!: string;
}

export class ResetPrivacyDocumentDto {
  @Equals(true)
  confirm!: true;
}

export class PrivacyLegalSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  body!: string;
}

export class PrivacyLegalRuleWhenDto {
  @IsOptional()
  @IsIn(['dataCategories', 'purposes', 'services', 'collectionMethods'])
  setting?: 'dataCategories' | 'purposes' | 'services' | 'collectionMethods';

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  hasAny?: string[];

  @IsOptional()
  @IsIn(['thirdPartyTransfer', 'cookies'])
  boolean?: 'thirdPartyTransfer' | 'cookies';
}

export class PrivacyLegalRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  sectionKey!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyLegalRuleWhenDto)
  when?: PrivacyLegalRuleWhenDto;
}

export class CreatePrivacyLegalModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  version!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrivacyLegalSectionDto)
  sections!: PrivacyLegalSectionDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PrivacyLegalRuleDto)
  rules!: PrivacyLegalRuleDto[];
}

export class UpdatePrivacyLegalModelDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrivacyLegalSectionDto)
  sections!: PrivacyLegalSectionDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PrivacyLegalRuleDto)
  rules!: PrivacyLegalRuleDto[];
}

export class ApprovePrivacyLegalModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  changeSummary!: string;
}

export class SelectPrivacyLegalModelDto {
  @IsUUID()
  modelId!: string;
}

export class UpdatePrivacyTemplateDto {
  @IsIn(['system-policy', 'compact-policy'])
  key!: 'system-policy' | 'compact-policy';

  @IsIn(['1'])
  version!: '1';

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
