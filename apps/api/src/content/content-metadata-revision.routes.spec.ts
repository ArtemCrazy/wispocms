import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentMetadataRevisionsController } from './content-metadata-revisions.controller';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';

describe('remaining metadata revision workflow routes', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const entityId = '22222222-2222-4222-8222-222222222222';
  const revisionId = '33333333-3333-4333-8333-333333333333';
  let app: INestApplication;
  const metadata = { publish: jest.fn().mockResolvedValue(undefined) };
  const revisions = {
    current: jest.fn().mockResolvedValue({ draft: { id: revisionId } }),
    listVersions: jest.fn().mockResolvedValue([{ id: revisionId }]),
    getVersion: jest.fn().mockResolvedValue({ id: revisionId, snapshot: {} }),
    submit: jest.fn(),
    approve: jest.fn(),
    requestChanges: jest.fn(),
    restore: jest.fn().mockResolvedValue({ id: revisionId }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentMetadataRevisionsController],
      providers: [
        { provide: ContentMetadataRevisionsService, useValue: metadata },
        { provide: CmsRevisionsService, useValue: revisions },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app?.close());

  it.each([
    ['layout-bindings', siteId, 'site_layout_bindings'],
    ['article-list', siteId, 'site_article_list'],
    ['media-alt', entityId, 'media_alt'],
  ] as const)(
    'exposes the full %s approval workflow',
    async (slug, id, type) => {
      const base = `/api/sites/${siteId}/content/metadata/${slug}/${id}`;
      await request(app.getHttpServer() as App)
        .get(`${base}/revisions/current`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${base}/revisions`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${base}/revisions/${revisionId}/preview`)
        .expect(200);
      for (const action of ['submit', 'approve', 'publish'])
        await request(app.getHttpServer() as App)
          .post(`${base}/revisions/${revisionId}/${action}`)
          .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${base}/revisions/${revisionId}/request-changes`)
        .send({ reason: 'Исправить' })
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${base}/revisions/${revisionId}/restore`)
        .send({ expectedDraftRevisionId: revisionId })
        .expect(201);
      expect(revisions.current).toHaveBeenCalledWith(
        siteId,
        type,
        id,
        expect.anything(),
      );
    },
  );

  it('does not allow a site-scoped metadata id for another site', async () => {
    await request(app.getHttpServer() as App)
      .get(
        `/api/sites/${siteId}/content/metadata/layout-bindings/${entityId}/revisions/current`,
      )
      .expect(400);
  });

  it('requires a non-empty reason when changes are requested', async () => {
    await request(app.getHttpServer() as App)
      .post(
        `/api/sites/${siteId}/content/metadata/media-alt/${entityId}/revisions/${revisionId}/request-changes`,
      )
      .send({ reason: '   ' })
      .expect(400);
  });
});
