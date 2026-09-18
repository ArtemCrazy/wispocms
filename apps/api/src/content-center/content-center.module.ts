import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentCenterController } from './content-center.controller';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';

@Module({
  imports: [AuthModule],
  controllers: [ContentCenterController],
  providers: [ContentCenterService, PreparationAiService],
})
export class ContentCenterModule {}
