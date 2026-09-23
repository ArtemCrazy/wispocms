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

describe('site globals and layout revision routes', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const revisionId = '22222222-2222-4222-8222-222222222222';
  let app: INestApplication;
  const revisions = {
    current: jest
      .fn()
      .mockResolvedValue({ draft: { id: revisionId }, reviewState: 'draft' }),
    listVersions: jest.fn().mockResolvedValue([{ id: revisionId }]),
    submit: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockResolvedValue(undefined),
    requestChanges: jest.fn().mockResolvedValue(undefined),
    restore: jest.fn().mockResolvedValue({ id: revisionId }),
  };
  const content = {
    getSiteGlobals: jest
      .fn()
      .mockResolvedValue({ siteId, draftRevisionId: revisionId }),
    updateSiteGlobals: jest
      .fn()
      .mockResolvedValue({ siteId, draftRevisionId: revisionId }),
    getSiteLayoutSection: jest
      .fn()
      .mockResolvedValue({ siteId, draftRevisionId: revisionId }),
    updateSiteLayoutSection: jest
      .fn()
      .mockResolvedValue({ siteId, draftRevisionId: revisionId }),
    getSiteSettingsRevisionPreview: jest
      .fn()
      .mockResolvedValue({ site: { slug: 'skinova' } }),
    publishSiteSettingsRevision: jest.fn().mockResolvedValue({ siteId }),
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

  it('exposes staged globals and validates the expected draft id', async () => {
    const base = `/api/sites/${siteId}/content/globals`;
    await request(app.getHttpServer() as App)
      .get(base)
      .expect(200);
    await request(app.getHttpServer() as App)
      .patch(base)
      .send({ phone: '+7 900 000-00-00', expectedDraftRevisionId: revisionId })
      .expect(200);
    await request(app.getHttpServer() as App)
      .patch(base)
      .send({ phone: '+7 900 000-00-00', expectedDraftRevisionId: 'stale' })
      .expect(400);
  });

  it.each(['header', 'footer'] as const)(
    'exposes an independent staged %s resource',
    async (scope) => {
      const base = `/api/sites/${siteId}/content/layout/${scope}`;
      await request(app.getHttpServer() as App)
        .get(base)
        .expect(200);
      await request(app.getHttpServer() as App)
        .patch(base)
        .send(
          scope === 'header'
            ? { logoText: 'Draft', expectedDraftRevisionId: revisionId }
            : {
                footerDescription: 'Draft',
                expectedDraftRevisionId: revisionId,
              },
        )
        .expect(200);
    },
  );

  it.each([
    ['globals', 'site_globals'],
    ['layout/header', 'site_header'],
    ['layout/footer', 'site_footer'],
  ] as const)(
    'exposes current, history, exact preview and workflow for %s',
    async (path, resourceType) => {
      const revisionsBase = `/api/sites/${siteId}/content/${path}/revisions`;
      await request(app.getHttpServer() as App)
        .get(`${revisionsBase}/current`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(revisionsBase)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${revisionsBase}/${revisionId}/preview`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .post(`${revisionsBase}/${revisionId}/submit`)
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${revisionsBase}/${revisionId}/approve`)
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${revisionsBase}/${revisionId}/request-changes`)
        .send({ reason: 'Нужно исправить' })
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${revisionsBase}/${revisionId}/publish`)
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${revisionsBase}/${revisionId}/restore`)
        .send({ expectedDraftRevisionId: revisionId })
        .expect(201);
      expect(revisions.current).toHaveBeenCalledWith(
        siteId,
        resourceType,
        siteId,
        expect.anything(),
      );
    },
  );

  it('rejects an unknown layout revision scope', async () => {
    await request(app.getHttpServer() as App)
      .get(`/api/sites/${siteId}/content/layout/sidebar`)
      .expect(400);
  });
});
