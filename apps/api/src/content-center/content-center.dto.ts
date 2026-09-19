import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class MaterialDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsIn(['text', 'file', 'url'])
  kind!: 'text' | 'file' | 'url';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2048)
  sourceUrl?: string;

  @IsOptional()
  @IsIn(['site', 'social', 'maps', 'marketplace', 'advertising', 'other'])
  urlCategory?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  fileName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40000)
  content?: string;
}

export class UpdateMaterialDto extends MaterialDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

export class PromptDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(12000)
  content!: string;
}

export class PreparationDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(12000)
  instruction!: string;

  @IsBoolean()
  withoutMaterials!: boolean;
}

export class PreparationDraftDto {
  @IsString()
  @MaxLength(12000)
  instruction!: string;

  @IsBoolean()
  withoutMaterials!: boolean;

  @IsInt()
  @Min(0)
  revision!: number;
}
