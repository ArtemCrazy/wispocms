import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { databaseEntities } from './entities';
import { InitialSchema1787511997646 } from './migrations/1787511997646-InitialSchema';
import { GlobalSiteSlug1787592504647 } from './migrations/1787592504647-GlobalSiteSlug';
import { RequireExplicitSiteType1787596200000 } from './migrations/1787596200000-RequireExplicitSiteType';
import { TrackSiteCreator1788462000000 } from './migrations/1788462000000-TrackSiteCreator';
import { AddCategoryHierarchy1788548400000 } from './migrations/1788548400000-AddCategoryHierarchy';
import { SeedMediaHomepageTemplates1788634800000 } from './migrations/1788634800000-SeedMediaHomepageTemplates';
import { SeedMediaSystemPages1788638400000 } from './migrations/1788638400000-SeedMediaSystemPages';
import { SimplifyAccessAndAddAudit1788724800000 } from './migrations/1788724800000-SimplifyAccessAndAddAudit';
import { AddPrivacyPolicyModel1788811200000 } from './migrations/1788811200000-AddPrivacyPolicyModel';
import { BackfillMediaSystemPages1788897600000 } from './migrations/1788897600000-BackfillMediaSystemPages';
import { ExpandPrivacyPolicyLifecycle1788984000000 } from './migrations/1788984000000-ExpandPrivacyPolicyLifecycle';
import { AddNotFoundTemplateBinding1789070400000 } from './migrations/1789070400000-AddNotFoundTemplateBinding';
import { ExpandMediaArticleLifecycle1789156800000 } from './migrations/1789156800000-ExpandMediaArticleLifecycle';
import { CompleteArticleCategoryLifecycle1789243200000 } from './migrations/1789243200000-CompleteArticleCategoryLifecycle';
import { WorkspaceContentCenterAndDomains1789329600000 } from './migrations/1789329600000-WorkspaceContentCenterAndDomains';
import { ArticlePublishingPlatform1789416000000 } from './migrations/1789416000000-ArticlePublishingPlatform';
import { SeedArmaturexHomepage1789502400000 } from './migrations/1789502400000-SeedArmaturexHomepage';
import { MoveArmaturexToPakWorkspace1789588800000 } from './migrations/1789588800000-MoveArmaturexToPakWorkspace';
import { SetArmaturexEcommerceSiteType1789675200000 } from './migrations/1789675200000-SetArmaturexEcommerceSiteType';
import { ExpandMediaSiteToolkit1789761600000 } from './migrations/1789761600000-ExpandMediaSiteToolkit';
import { ImportSkinovaMediaSite1789848000000 } from './migrations/1789848000000-ImportSkinovaMediaSite';
import { CanonicalBannerSlots1789934400000 } from './migrations/1789934400000-CanonicalBannerSlots';

export function createDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: databaseEntities,
    migrations: [
      InitialSchema1787511997646,
      GlobalSiteSlug1787592504647,
      RequireExplicitSiteType1787596200000,
      TrackSiteCreator1788462000000,
      AddCategoryHierarchy1788548400000,
      SeedMediaHomepageTemplates1788634800000,
      SeedMediaSystemPages1788638400000,
      SimplifyAccessAndAddAudit1788724800000,
      AddPrivacyPolicyModel1788811200000,
      BackfillMediaSystemPages1788897600000,
      ExpandPrivacyPolicyLifecycle1788984000000,
      AddNotFoundTemplateBinding1789070400000,
      ExpandMediaArticleLifecycle1789156800000,
      CompleteArticleCategoryLifecycle1789243200000,
      WorkspaceContentCenterAndDomains1789329600000,
      ArticlePublishingPlatform1789416000000,
      SeedArmaturexHomepage1789502400000,
      MoveArmaturexToPakWorkspace1789588800000,
      SetArmaturexEcommerceSiteType1789675200000,
      ExpandMediaSiteToolkit1789761600000,
      ImportSkinovaMediaSite1789848000000,
      CanonicalBannerSlots1789934400000,
    ],
    migrationsRun: true,
    migrationsTransactionMode: 'all',
    synchronize: false,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

export default new DataSource(createDataSourceOptions());
