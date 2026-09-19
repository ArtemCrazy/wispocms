import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformPromptsService } from './platform-prompts.service';

export class PlatformPromptDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(12000)
  content!: string;
}
export class PromptRevisionDto {
  @IsInt()
  @Min(1)
  revision!: number;
}
export class UpdatePlatformPromptDto extends PlatformPromptDto {
  @IsInt()
  @Min(1)
  revision!: number;
}

@Controller('platform/prompts')
@UseGuards(JwtAuthGuard)
export class PlatformPromptsController {
  constructor(private readonly prompts: PlatformPromptsService) {}

  @Get()
  list() {
    return this.prompts.list();
  }

  @Post()
  @UseGuards(PlatformAdminGuard)
  create(@Body() dto: PlatformPromptDto) {
    return this.prompts.create(dto);
  }

  @Put(':id')
  @UseGuards(PlatformAdminGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformPromptDto,
  ) {
    return this.prompts.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PlatformAdminGuard)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromptRevisionDto,
  ) {
    return this.prompts.remove(id, dto.revision);
  }
}
