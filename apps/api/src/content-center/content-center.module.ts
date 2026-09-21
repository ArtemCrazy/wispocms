import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentCenterController } from './content-center.controller';
import { ContentCenterService } from './content-center.service';
import {
  PreparationAiService,
  PREPARATION_PROVIDER,
} from './preparation-ai.service';
import { MaterialUploadGuard } from './material-upload.guard';
import { ResearchService } from './research.service';
import { ResearchSearchService } from './research-search.service';
import { ResearchController } from './research.controller';
import { ContentModule } from '../content/content.module';
import { CreationController } from './creation.controller';
import { CreationService } from './creation.service';
import { CreationAiService, CREATION_PROVIDER } from './creation-ai.service';
import { AiModule } from '../ai/ai.module';
import { DeepseekService } from '../ai/deepseek.service';
import { CreationRunsService } from './creation-runs.service';
import { CreationPublicationService } from './creation-publication.service';
import { PreparationCollectionService } from './preparation-collection.service';
import { VkConnectionController } from './vk-connection.controller';
import { VkConnectionService } from './vk-connection.service';
import { VkSourceClient } from './vk-source';
import { PlatformVkSettingsService } from './platform-vk-settings.service';
import { PlatformVkSettingsController } from './platform-vk-settings.controller';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { PlatformSocialSettingsService } from './platform-social-settings.service';
import { PlatformSocialSettingsController } from './platform-social-settings.controller';
import { InstagramConnectionService } from './instagram-connection.service';
import { InstagramSourceClient } from './instagram-source';
import { YoutubeSourceClient } from './youtube-source';
import {
  SocialConnectionController,
  InstagramCallbackController,
} from './social-connection.controller';
import { YoutubeTranscriptionController } from './youtube-transcription.controller';
import { YoutubeTranscriptionSettingsService } from './youtube-transcription-settings.service';
import { YoutubeWhisperService } from './youtube-whisper.service';
import { YandexMapSourceClient } from './yandex-map-source';
import { TwoGisMapSourceClient } from './2gis-map-source';

@Module({
  imports: [AuthModule, ContentModule, AiModule],
  controllers: [
    ContentCenterController,
    VkConnectionController,
    PlatformVkSettingsController,
    PlatformSocialSettingsController,
    SocialConnectionController,
    InstagramCallbackController,
    YoutubeTranscriptionController,
    ResearchController,
    CreationController,
  ],
  providers: [
    { provide: PREPARATION_PROVIDER, useExisting: DeepseekService },
    { provide: CREATION_PROVIDER, useExisting: DeepseekService },
    ContentCenterService,
    PreparationAiService,
    PreparationCollectionService,
    VkConnectionService,
    VkSourceClient,
    PlatformVkSettingsService,
    PlatformSocialSettingsService,
    InstagramConnectionService,
    InstagramSourceClient,
    YoutubeSourceClient,
    YandexMapSourceClient,
    TwoGisMapSourceClient,
    YoutubeTranscriptionSettingsService,
    YoutubeWhisperService,
    PlatformAdminGuard,
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
