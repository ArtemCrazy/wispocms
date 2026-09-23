import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentController } from './content.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentService } from './content.service';

describe('banner revision routes', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const bannerId = '22222222-2222-4222-8222-222222222222';
  const revisionId = '33333333-3333-4333-8333-333333333333';
  let app: INestApplication;
  const revisions = {
    current: jest.fn().mockResolvedValue({
      draft: { id: revisionId },
      reviewState: 'draft',
    }),
    listVersions: jest.fn().mockResolvedValue([{ id: revisionId }]),
    submit: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockResolvedValue(undefined),
    requestChanges: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue({ id: revisionId }),
  };
  const content = {
    assertVersionedBanner: jest.fn().mockResolvedValue(undefined),
    getBannerRevisionPreview: jest.fn().mockResolvedValue({ id: bannerId }),
    publishBannerRevision: jest.fn().mockResolvedValue({ id: bannerId }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: content },
        { provide: ContentLifecycleService, useValue: {} },
        { provide: CmsRevisionsService, useValue: revisions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => Record<string, unknown>;
          };
        }) => {
          context.switchToHttp().getRequest().auth = {
            userId: 'owner-id',
            platformRole: PlatformRole.WISPO_ADMIN,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes current, history, exact preview and publish', async () => {
    const base = `/api/sites/${siteId}/content/banners/${bannerId}/revisions`;
    await request(app.getHttpServer() as App)
      .get(`${base}/current`)
      .expect(200);
    await request(app.getHttpServer() as App)
      .get(base)
      .expect(200);
    await request(app.getHttpServer() as App)
      .get(`${base}/${revisionId}/preview`)
      .expect(200);
    await request(app.getHttpServer() as App)
      .post(`${base}/${revisionId}/publish`)
      .expect(201);
  });

  it('exposes submit, approve, changes and restore with validated body', async () => {
    const base = `/api/sites/${siteId}/content/banners/${bannerId}/revisions/${revisionId}`;
    await request(app.getHttpServer() as App)
      .post(`${base}/submit`)
      .expect(201);
    await request(app.getHttpServer() as App)
      .post(`${base}/approve`)
      .expect(201);
    await request(app.getHttpServer() as App)
      .post(`${base}/request-changes`)
      .send({ reason: 'Исправить изображение' })
      .expect(201);
    await request(app.getHttpServer() as App)
      .post(`${base}/request-changes`)
      .send({ reason: '  ' })
      .expect(400);
    await request(app.getHttpServer() as App)
      .post(`${base}/restore`)
      .send({ expectedDraftRevisionId: revisionId })
      .expect(201);
  });
});
