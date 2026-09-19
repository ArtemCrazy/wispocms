import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentCenterController } from './content-center.controller';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import { MaterialUploadGuard } from './material-upload.guard';
import { ResearchService } from './research.service';
import { ResearchSearchService } from './research-search.service';
import { ResearchController } from './research.controller';
import { ContentModule } from '../content/content.module';
import { CreationController } from './creation.controller';
import { CreationService } from './creation.service';
import { CreationAiService } from './creation-ai.service';
import { CreationRunsService } from './creation-runs.service';
import { CreationPublicationService } from './creation-publication.service';

@Module({
  imports: [AuthModule, ContentModule],
  controllers: [
    ContentCenterController,
    ResearchController,
    CreationController,
  ],
  providers: [
    ContentCenterService,
    PreparationAiService,
    MaterialUploadGuard,
    ResearchService,
    ResearchSearchService,
    CreationService,
    CreationAiService,
    CreationRunsService,
    CreationPublicationService,
  ],
})
export class ContentCenterModule {}
