import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ManagedChunkListQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  categoryKey?: string;
}

export class CreateManagedChunkInstanceDto {
  @IsString()
  @Length(1, 160)
  displayName!: string;

  @IsUUID()
  contractId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}

export class SaveManagedChunkDraftDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  expectedDraftRevisionId!: string | null;
}

export class RequestManagedChunkChangesDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  reason!: string;
}

export class RestoreManagedChunkRevisionDto {
  @IsDefined()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  expectedDraftRevisionId!: string | null;
}
