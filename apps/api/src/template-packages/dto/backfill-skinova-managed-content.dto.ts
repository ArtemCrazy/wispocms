import { IsUUID } from 'class-validator';

export class BackfillSkinovaManagedContentDto {
  @IsUUID()
  siteId!: string;
}
