import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { ManagedChunkContentController } from './managed-chunk-content.controller';
import { ManagedChunkContentService } from './managed-chunk-content.service';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';

describe('ManagedChunkContentController', () => {
  let app: INestApplication;
  const service = {
    catalog: jest.fn().mockResolvedValue({ categories: [] }),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: INSTANCE_ID }),
    create: jest.fn().mockResolvedValue({ instanceId: INSTANCE_ID }),
    saveDraft: jest.fn().mockResolvedValue({ revisionId: REVISION_ID }),
    submit: jest.fn(),
    approve: jest.fn(),
    requestChanges: jest.fn(),
    publish: jest.fn(),
    restore: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ManagedChunkContentController],
      providers: [{ provide: ManagedChunkContentService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().auth = {
            userId: REVISION_ID,
            platformRole: PlatformRole.WISPO_ADMIN,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  afterAll(() => app.close());

  it('wires guarded read routes with UUID parsing', async () => {
    await request(app.getHttpServer())
      .get(`/sites/${SITE_ID}/content/chunks/catalog`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/sites/${SITE_ID}/content/chunks/instances`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/sites/${SITE_ID}/content/chunks/instances/${INSTANCE_ID}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/sites/not-a-uuid/content/chunks/catalog')
      .expect(400);
  });

  it('wires create, draft and typed workflow routes', async () => {
    await request(app.getHttpServer())
      .post(`/sites/${SITE_ID}/content/chunks/instances`)
      .send({ displayName: 'Hero', contractId: REVISION_ID, data: {} })
      .expect(201);
    await request(app.getHttpServer())
      .put(`/sites/${SITE_ID}/content/chunks/instances/${INSTANCE_ID}/draft`)
      .send({ data: {}, expectedDraftRevisionId: REVISION_ID })
      .expect(200);
    for (const action of [
      'submit',
      'approve',
      'request-changes',
      'publish',
      'restore',
    ]) {
      const body =
        action === 'request-changes'
          ? { reason: 'Fix it' }
          : action === 'restore'
            ? { expectedDraftRevisionId: REVISION_ID }
            : {};
      await request(app.getHttpServer())
        .post(
          `/sites/${SITE_ID}/content/chunks/instances/${INSTANCE_ID}/revisions/${REVISION_ID}/${action}`,
        )
        .send(body)
        .expect(201);
    }
  });

  it('rejects malformed DTOs before writes', async () => {
    service.create.mockClear();
    service.saveDraft.mockClear();
    await request(app.getHttpServer())
      .post(`/sites/${SITE_ID}/content/chunks/instances`)
      .send({ displayName: '', contractId: 'bad', data: [] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/sites/${SITE_ID}/content/chunks/instances/${INSTANCE_ID}/draft`)
      .send({ data: [], expectedDraftRevisionId: 'bad' })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.saveDraft).not.toHaveBeenCalled();
  });
});
