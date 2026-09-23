import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';
import { CodeResourcesService } from './code-resources.service';
import { SiteResourceRevisionsController } from './site-resource-revisions.controller';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';

describe('remaining CMS resource revision routes', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const revisionId = '22222222-2222-4222-8222-222222222222';
  const entityId = '33333333-3333-4333-8333-333333333333';
  let app: INestApplication;
  const resources = {
    get: jest.fn().mockResolvedValue({ draftRevisionId: revisionId }),
    save: jest.fn().mockResolvedValue({ draftRevisionId: revisionId }),
    preview: jest.fn().mockResolvedValue({ id: revisionId, snapshot: {} }),
    publish: jest.fn().mockResolvedValue({ revisionId }),
  };
  const revisions = {
    current: jest.fn().mockResolvedValue({ draft: { id: revisionId } }),
    listVersions: jest.fn().mockResolvedValue([{ id: revisionId }]),
    getVersion: jest.fn().mockResolvedValue({ id: revisionId, snapshot: {} }),
    submit: jest.fn(),
    approve: jest.fn(),
    requestChanges: jest.fn(),
    restore: jest.fn().mockResolvedValue({ id: revisionId }),
    publish: jest.fn(),
  };
  const code = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: entityId }),
    update: jest.fn().mockResolvedValue({ id: entityId }),
    published: jest.fn().mockResolvedValue({ html: '<main></main>' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SiteResourceRevisionsController],
      providers: [
        { provide: SiteResourceRevisionsService, useValue: resources },
        { provide: CmsRevisionsService, useValue: revisions },
        { provide: CodeResourcesService, useValue: code },
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
    ['variables', 'site_variables'],
    ['seo', 'site_seo'],
    ['search', 'site_search'],
    ['not-found', 'site_not_found'],
    ['privacy', 'site_privacy'],
  ] as const)('exposes one complete workflow for %s', async (slug, type) => {
    const base = `/api/sites/${siteId}/content/versioned/${slug}`;
    await request(app.getHttpServer() as App)
      .get(base)
      .expect(200);
    await request(app.getHttpServer() as App)
      .put(base)
      .send({ snapshot: {}, expectedDraftRevisionId: null })
      .expect(200);
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
    expect(resources.get).toHaveBeenCalledWith(siteId, type, expect.anything());
  });

  it('requires an explicit expected draft id when a generic resource is saved', async () => {
    resources.save.mockClear();
    await request(app.getHttpServer() as App)
      .put(`/api/sites/${siteId}/content/versioned/seo`)
      .send({ snapshot: {} })
      .expect(400);
    expect(resources.save).not.toHaveBeenCalled();
  });

  it.each(['template', 'chunk'] as const)(
    'exposes HTML-only %s CRUD and code approval workflow',
    async (kind) => {
      const base = `/api/sites/${siteId}/content/code-resources/${kind}`;
      await request(app.getHttpServer() as App)
        .get(base)
        .expect(200);
      await request(app.getHttpServer() as App)
        .post(base)
        .send({
          name: 'Block',
          key: 'block',
          html: '<section></section>',
          parameters: [],
        })
        .expect(201);
      await request(app.getHttpServer() as App)
        .put(`${base}/${entityId}`)
        .send({
          name: 'Block',
          key: 'block',
          html: '<section>Next</section>',
          parameters: [],
          expectedDraftRevisionId: revisionId,
        })
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${base}/${entityId}/revisions/current`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${base}/${entityId}/revisions`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .get(`${base}/${entityId}/revisions/${revisionId}/preview`)
        .expect(200);
      await request(app.getHttpServer() as App)
        .post(`${base}/${entityId}/revisions/${revisionId}/submit`)
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${base}/${entityId}/revisions/${revisionId}/approve`)
        .expect(201);
      await request(app.getHttpServer() as App)
        .post(`${base}/${entityId}/revisions/${revisionId}/publish`)
        .expect(201);
    },
  );
});
