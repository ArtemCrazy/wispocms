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

describe('article revision routes', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const articleId = '22222222-2222-4222-8222-222222222222';
  const revisionId = '33333333-3333-4333-8333-333333333333';
  let app: INestApplication;
  const httpServer = () => app.getHttpServer() as App;
  const revisions = {
    submit: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockResolvedValue(undefined),
    requestChanges: jest.fn().mockResolvedValue(undefined),
    current: jest.fn().mockResolvedValue({
      draft: { id: revisionId, versionNumber: 2, snapshot: { title: 'New' } },
      approvedRevisionId: null,
      publishedRevisionId: null,
      reviewState: 'in_review',
    }),
    listVersions: jest
      .fn()
      .mockResolvedValue([
        { id: revisionId, versionNumber: 2, snapshot: { title: 'New' } },
      ]),
    restore: jest.fn().mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
      versionNumber: 3,
    }),
  };
  const lifecycle = {
    publishArticleRevision: jest.fn().mockResolvedValue({
      id: articleId,
      title: 'New',
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: {} },
        { provide: ContentLifecycleService, useValue: lifecycle },
        { provide: CmsRevisionsService, useValue: revisions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
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

  it('exposes a version-specific review request and current revision state', async () => {
    const base = `/api/sites/${siteId}/content/articles/${articleId}/revisions`;
    await request(httpServer())
      .post(`${base}/${revisionId}/submit`)
      .expect(201);
    const response = await request(httpServer())
      .get(`${base}/current`)
      .expect(200);
    const body = response.body as {
      draft?: { id?: string };
      reviewState?: string;
    };
    expect(body.draft?.id).toBe(revisionId);
    expect(body.reviewState).toBe('in_review');
  });

  it('requires a reason when returning an exact revision for changes', async () => {
    const base = `/api/sites/${siteId}/content/articles/${articleId}/revisions/${revisionId}`;
    await request(httpServer()).post(`${base}/approve`).expect(201);
    await request(httpServer())
      .post(`${base}/request-changes`)
      .send({ reason: 'Correct the headline' })
      .expect(201);
    await request(httpServer())
      .post(`${base}/request-changes`)
      .send({ reason: '   ' })
      .expect(400);
  });

  it('publishes the requested approved article revision through the lifecycle', async () => {
    const response = await request(httpServer())
      .post(
        `/api/sites/${siteId}/content/articles/${articleId}/revisions/${revisionId}/publish`,
      )
      .expect(201);
    expect(response.body).toEqual(
      expect.objectContaining({ id: articleId, title: 'New' }),
    );
  });

  it('lists history and restores a selected snapshot only against an expected draft', async () => {
    const base = `/api/sites/${siteId}/content/articles/${articleId}/revisions`;
    const history = await request(httpServer()).get(base).expect(200);
    expect(history.body).toEqual([
      expect.objectContaining({ id: revisionId, versionNumber: 2 }),
    ]);
    const restored = await request(httpServer())
      .post(`${base}/${revisionId}/restore`)
      .send({ expectedDraftRevisionId: revisionId })
      .expect(201);
    expect(restored.body).toEqual(
      expect.objectContaining({ versionNumber: 3 }),
    );
    await request(httpServer())
      .post(`${base}/${revisionId}/restore`)
      .send({ expectedDraftRevisionId: 'not-a-uuid' })
      .expect(400);
  });
});
