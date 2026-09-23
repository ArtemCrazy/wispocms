import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreationRevisionDto {
  @IsInt() @Min(0) revision!: number;
}
export class ClusterQueryDto {
  @IsString() @MinLength(1) @MaxLength(240) text!: string;
  @IsInt() @Min(0) @Max(2147483647) general!: number;
  @IsInt() @Min(0) @Max(2147483647) exact!: number;
  @IsBoolean() primary!: boolean;
}
export class ClusterDto extends CreationRevisionDto {
  @IsString() @MaxLength(160) direction!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ClusterQueryDto)
  queries!: ClusterQueryDto[];
  @IsBoolean() archived!: boolean;
}
export class PlatformRulesDto {
  @IsUUID() siteId!: string;
  @IsString() @MaxLength(12000) rules!: string;
}
export class CreationSettingsDto extends CreationRevisionDto {
  @IsString() @MaxLength(16000) rules!: string;
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((p: PlatformRulesDto) => p.siteId)
  @ValidateNested({ each: true })
  @Type(() => PlatformRulesDto)
  platforms!: PlatformRulesDto[];
}
export class CreationRunDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  clusterIds!: string[];
  @IsString() @MaxLength(12000) instruction!: string;
  @IsOptional() @IsUUID() retryRunId?: string;
}
export class CorrectionDto extends CreationRevisionDto {
  @IsString() @MinLength(1) @MaxLength(12000) instruction!: string;
  @IsOptional() @IsString() @MaxLength(100) target?: string;
  @IsOptional() @IsString() @MaxLength(12000) fragment?: string;
}
export class ProposalDecisionDto extends CreationRevisionDto {
  @IsUUID() correctionId!: string;
  @IsUUID() proposalId!: string;
  @IsIn(['accepted', 'rejected']) decision!: 'accepted' | 'rejected';
}
export class RestoreCreatedVersionDto extends CreationRevisionDto {
  @IsInt() @Min(1) number!: number;
}
export class PublishCreatedArticleDto extends CreationRevisionDto {
  @IsOptional() @IsBoolean() confirmMove?: boolean;
  @IsUUID() siteId!: string;
  @IsUUID() categoryId!: string;
  @IsString()
  @MaxLength(160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
  @IsString() @MinLength(1) @MaxLength(80) templateKey!: string;
  @IsString() @MinLength(1) @MaxLength(40) templateVersion!: string;
}
export class RestructureClustersDto {
  @IsIn(['split', 'merge']) kind!: 'split' | 'merge';
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids!: string[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  revisions!: number[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClusterDto)
  clusters!: ClusterDto[];
}
