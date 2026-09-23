import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ResearchCategoryDto {
  @IsString() @Matches(/^[a-z0-9-]{1,64}$/) id!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsBoolean() enabled!: boolean;
}
export class ResearchSourceDto {
  @IsUUID() id!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @Transform(trim) @IsString() @MaxLength(2048) url!: string;
  @IsString() @MaxLength(64) categoryId!: string;
  @IsBoolean() included!: boolean;
  @Transform(trim) @IsString() @MaxLength(500) description!: string;
}
export class ResearchDraftDto {
  @IsInt() @Min(0) revision!: number;
  @IsIn(['conclusions', 'full']) contextKind!: 'conclusions' | 'full';
  @Transform(trim) @IsString() @MaxLength(8000) direction!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique((c: ResearchCategoryDto) => c.id)
  @ValidateNested({ each: true })
  @Type(() => ResearchCategoryDto)
  categories!: ResearchCategoryDto[];
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((s: ResearchSourceDto) => s.id)
  @ValidateNested({ each: true })
  @Type(() => ResearchSourceDto)
  sources!: ResearchSourceDto[];
}
export class ResearchRevisionDto {
  @IsInt() @Min(1) revision!: number;
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  preparationVersionId!: string | null;
}
