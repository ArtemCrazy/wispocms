import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsHexColor,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ArticleStatus,
  BannerPlacement,
  CategoryStatus,
  EditorialState,
  PageKind,
  PageStatus,
  PublicationState,
} from '../database/entities';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @IsOptional()
  @IsEnum(PublicationState)
  publicationState?: PublicationState;

  @IsOptional()
  @IsString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  publishedAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string | null;

  @IsOptional()
  @IsUUID()
  imageMediaId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayTemplateKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayTemplateVersion?: string;

  @IsOptional()
  @IsObject()
  displayTemplateConfig?: Record<string, unknown>;
}

export class CreateAuthorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;
}

export class UpdateCategoryDto extends CreateCategoryDto {}

export class UpdateAuthorDto extends CreateAuthorDto {}

export class CreateArticleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  title!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsObject()
  bodyDocument?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsEnum(PublicationState)
  publicationState?: PublicationState;

  @IsOptional()
  @IsEnum(EditorialState)
  editorialState?: EditorialState;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsUUID()
  coverMediaId?: string;

  @IsOptional()
  @IsUUID()
  previewMediaId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  publishedAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayTemplateKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayTemplateVersion?: string;

  @IsOptional()
  @IsObject()
  displayTemplateConfig?: Record<string, unknown>;
}

export class UploadMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string;
}

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string | null;
}

export enum PageBlockType {
  HERO = 'hero',
  TEXT = 'text',
  CTA = 'cta',
}

export class PageBlockDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @IsEnum(PageBlockType)
  type!: PageBlockType;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  buttonLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  buttonUrl?: string;

  @IsOptional()
  @IsUUID()
  mediaId?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CreatePageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @Matches(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/)
  slug!: string;

  @IsEnum(PageKind)
  kind!: PageKind;

  @IsEnum(PageStatus)
  status!: PageStatus;

  @ValidateNested({ each: true })
  @Type(() => PageBlockDto)
  @IsArray()
  @ArrayMaxSize(50)
  blocks!: PageBlockDto[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;
}

export class UpdatePageDto extends CreatePageDto {}

export class ChangePageStatusDto {
  @IsEnum(PageStatus)
  status!: PageStatus;
}

export class UpdateNotFoundTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  templateKey!: string;
}

export class SubmitContactRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 ()-]{7,30}$/)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsBoolean()
  consent!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class SearchPublicContentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}

export class UpdateArticleDto extends CreateArticleDto {}

export class UpdateArticleBodyDto {
  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsObject()
  bodyDocument?: Record<string, unknown>;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class DeleteCategoryDto {
  @IsOptional()
  @IsUUID()
  moveToCategoryId?: string | null;
}

export class UpdateSiteSettingsDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  domain?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string | null;

  @IsOptional()
  @IsEmail()
  notificationEmail?: string | null;

  @IsOptional()
  @IsUUID()
  linkedCommercialSiteId?: string | null;
}

export class UpdateSiteSeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  canonicalUrl?: string | null;

  @IsOptional()
  @IsUUID()
  seoImageMediaId?: string | null;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;
}

export class UpdateSiteGlobalsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(?:ip|ooo|self_employed|other)?$/)
  organizationType?: 'ip' | 'ooo' | 'self_employed' | 'other' | '';

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

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  telegramUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  vkUrl?: string;
}

export class UpdateSiteLayoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  logoText?: string;

  @IsOptional()
  @IsUUID()
  logoMediaId?: string;

  @IsOptional()
  @IsBoolean()
  showPages?: boolean;

  @IsOptional()
  @IsBoolean()
  showArticles?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ctaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  footerDescription?: string;

  @IsOptional()
  @IsBoolean()
  showContacts?: boolean;

  @IsOptional()
  @IsBoolean()
  showSocials?: boolean;
}

export class CreateBannerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsEnum(BannerPlacement)
  placement!: BannerPlacement;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string | null;

  @IsOptional()
  @IsUUID()
  mediaId?: string | null;

  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(BannerPlacement)
  placement?: BannerPlacement;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string | null;

  @IsOptional()
  @IsUUID()
  mediaId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AddArticleCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

export class ChangeArticleStatusDto {
  @IsEnum(ArticleStatus)
  status!: ArticleStatus;
}

export class UpdatePublicationStateDto {
  @IsEnum(PublicationState)
  state!: PublicationState;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateEditorialStateDto {
  @IsEnum(EditorialState)
  state!: EditorialState;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SchedulePublicationDto extends UpdatePublicationStateDto {
  @IsISO8601({ strict: true })
  executeAt!: string;
}

export class UpdateRelatedArticlesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  articleIds!: string[];
}

export class DuplicateContentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  title?: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(160)
  slug!: string;
}

export class RestoreArticleVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class UpdateArticleSectionSettingsDto {
  @IsString()
  @MaxLength(80)
  templateKey!: string;

  @IsString()
  @MaxLength(40)
  templateVersion!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
