import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentCenterController } from './content-center.controller';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import { MaterialUploadGuard } from './material-upload.guard';
import { ResearchService } from './research.service';
import { ResearchSearchService } from './research-search.service';
import { ResearchController } from './research.controller';

@Module({
  imports: [AuthModule],
  controllers: [ContentCenterController, ResearchController],
  providers: [
    ContentCenterService,
    PreparationAiService,
    MaterialUploadGuard,
    ResearchService,
    ResearchSearchService,
  ],
})
export class ContentCenterModule {}
