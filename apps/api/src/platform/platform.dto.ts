import {
  ArrayUnique,
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
} from 'class-validator';
import { SiteType } from '../database/entities';

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
  @ArrayUnique()
  @IsUUID('4', { each: true })
  workspaceIds!: string[];
}

export class UpdateUserWorkspacesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  workspaceIds!: string[];
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
