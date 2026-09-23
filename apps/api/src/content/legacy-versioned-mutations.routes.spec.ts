import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentController } from './content.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentService } from './content.service';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';

describe('legacy direct mutations for versioned resources', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const variableId = '22222222-2222-4222-8222-222222222222';
  let app: INestApplication;
  const content = {
    updateSiteSeo: jest.fn().mockResolvedValue({}),
    createSiteVariable: jest.fn().mockResolvedValue({}),
    updateSiteVariable: jest.fn().mockResolvedValue({}),
    deleteSiteVariable: jest.fn().mockResolvedValue({}),
    updateSearchSettings: jest.fn().mockResolvedValue({}),
    confirmRecommendedSearch: jest.fn().mockResolvedValue({}),
    updateNotFoundTemplate: jest.fn().mockResolvedValue({}),
    updateNotFoundSeo: jest.fn().mockResolvedValue({}),
    activateNotFoundPage: jest.fn().mockResolvedValue({}),
    deactivateNotFoundPage: jest.fn().mockResolvedValue({}),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: content },
        { provide: ContentLifecycleService, useValue: {} },
        { provide: CmsRevisionsService, useValue: {} },
        { provide: SiteResourceRevisionsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest().auth = {
            userId: 'admin-id',
            platformRole: PlatformRole.WISPO_ADMIN,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app?.close());

  it.each([
    ['patch', `/api/sites/${siteId}/content/seo`, {}],
    ['post', `/api/sites/${siteId}/content/variables`, {}],
    ['patch', `/api/sites/${siteId}/content/variables/${variableId}`, {}],
    [
      'delete',
      `/api/sites/${siteId}/content/variables/${variableId}`,
      undefined,
    ],
    ['patch', `/api/sites/${siteId}/content/search-settings`, {}],
    [
      'post',
      `/api/sites/${siteId}/content/search-settings/recommendations/confirm`,
      {},
    ],
    ['patch', `/api/sites/${siteId}/content/not-found/template`, {}],
    ['patch', `/api/sites/${siteId}/content/not-found/seo`, {}],
    ['post', `/api/sites/${siteId}/content/not-found/activate`, undefined],
    ['post', `/api/sites/${siteId}/content/not-found/deactivate`, undefined],
  ] as const)(
    'returns 400 for %s %s instead of bypassing approval',
    async (method, url, body) => {
      const call = request(app.getHttpServer() as App)[method](url);
      if (body !== undefined) call.send(body);
      await call.expect(400);
    },
  );
});
