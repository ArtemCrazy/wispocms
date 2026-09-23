import {
  ArrayUnique,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SiteType, WorkspaceRole } from '../database/entities';

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

  @IsIn([
    WorkspaceRole.SITE_OWNER,
    WorkspaceRole.WISPO_MANAGER,
    WorkspaceRole.SITE_CONTENT_MANAGER,
    WorkspaceRole.WISPO_DEVELOPER,
    WorkspaceRole.SITE_DEVELOPER,
  ])
  role!: WorkspaceRole;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  siteIds!: string[];
}

export class CreateSiteUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10)
  password!: string;

  @IsIn([WorkspaceRole.SITE_CONTENT_MANAGER, WorkspaceRole.SITE_DEVELOPER])
  role!: WorkspaceRole;
}

export class UpdateUserWorkspacesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  workspaceIds!: string[];
}

export class UpdateUserSitesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  siteIds!: string[];
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
