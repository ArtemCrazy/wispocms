import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SiteRole, SiteType } from '../database/entities';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;
}

export class CreateSiteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string;

  @IsEnum(SiteType)
  siteType!: SiteType;
}

export class UpdateSiteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string | null;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsEnum(SiteType)
  siteType?: SiteType;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class UpdateUserProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEmail()
  email!: string;
}

export enum ManagedUserRole {
  WISPO_ADMIN = 'wispo_admin',
  SITE_OWNER = 'site_owner',
  CONTENT_MANAGER = 'content_manager',
}

export class UpdateManagedUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEnum(ManagedUserRole)
  role!: ManagedUserRole;

  @IsArray()
  @IsUUID('4', { each: true })
  siteIds!: string[];

  @IsBoolean()
  requiresApproval!: boolean;

  @IsBoolean()
  isActive!: boolean;
}

export class SiteAccessAssignmentDto {
  @IsUUID('4')
  siteId!: string;

  @IsEnum(SiteRole)
  role!: SiteRole;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  password!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SiteAccessAssignmentDto)
  siteAccesses!: SiteAccessAssignmentDto[];
}

export class UpdateUserSiteAccessesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SiteAccessAssignmentDto)
  siteAccesses!: SiteAccessAssignmentDto[];
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class ResetUserPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}
