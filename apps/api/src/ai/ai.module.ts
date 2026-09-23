import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { DeepseekSettingsService } from './deepseek-settings.service';
import { DeepseekService } from './deepseek.service';
import { DeepseekController } from './deepseek.controller';

@Module({
  imports: [AuthModule],
  controllers: [DeepseekController],
  providers: [DeepseekSettingsService, DeepseekService, PlatformAdminGuard],
  exports: [DeepseekService],
})
export class AiModule {}
