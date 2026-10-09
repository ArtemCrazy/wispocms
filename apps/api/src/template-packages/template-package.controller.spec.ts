import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import {
  TemplatePackageCandidatesController,
  TemplatePackageController,
  TemplatePackageCurrentController,
} from './template-package.controller';
import { SkinovaManagedBackfillService } from './skinova-managed-backfill.service';
import { TemplatePackageService } from './template-package.service';

function manifest() {
  const value = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../web/template-packages/skinova/manifest.template.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return {
    ...value,
    source: {
      ...(value.source as Record<string, unknown>),
      revision: '0123456789abcdef0123456789abcdef01234567',
    },
    build: {
      ...(value.build as Record<string, unknown>),
      releaseDigest: 'a'.repeat(64),
      artifactDigest: null,
      builtAt: '2026-10-02T09:30:00Z',
    },
  };
}

describe('TemplatePackageController', () => {
  let app: INestApplication<Server>;
  const service = {
    register: jest.fn().mockResolvedValue({ status: 'registered' }),
    preflight: jest.fn().mockResolvedValue({ status: 'ready', reasons: [] }),
    reportDeployed: jest
      .fn()
      .mockResolvedValue({ status: 'ready', reasons: [] }),
    current: jest.fn((_siteId: string, actor: { userId: string }) =>
      actor.userId === 'manager-id'
        ? Promise.reject(new ForbiddenException())
        : Promise.resolve({ templatePackage: null }),
    ),
    candidates: jest.fn().mockResolvedValue([]),
  };
  const backfill = {
    backfill: jest.fn().mockResolvedValue({
      siteId: '11111111-1111-4111-8111-111111111111',
      status: 'created',
    }),
  };

  beforeAll(async () => {
    process.env.WISPO_RELEASE_TOKEN = 'release-only-secret';
    const builder = Test.createTestingModule({
      controllers: [
        TemplatePackageController,
        TemplatePackageCurrentController,
        TemplatePackageCandidatesController,
      ],
      providers: [
        { provide: TemplatePackageService, useValue: service },
        { provide: SkinovaManagedBackfillService, useValue: backfill },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const request = context.switchToHttp().getRequest<{
            headers: Record<string, string | undefined>;
            auth?: { userId: string; platformRole: PlatformRole };
          }>();
          request.auth = {
            userId: request.headers['x-user-id'] ?? 'owner-id',
            platformRole:
              request.headers['x-role'] === PlatformRole.WISPO_ADMIN
                ? PlatformRole.WISPO_ADMIN
                : PlatformRole.EMPLOYEE,
          };
          return true;
        },
      })
      .overrideGuard(PlatformAdminGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const request = context.switchToHttp().getRequest<{
            auth?: { platformRole: PlatformRole };
          }>();
          if (request.auth?.platformRole !== PlatformRole.WISPO_ADMIN)
            throw new ForbiddenException();
          return true;
        },
      });
    const module = await builder.compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    delete process.env.WISPO_RELEASE_TOKEN;
    await app.close();
  });

  it('uses only the release token for all internal endpoints', async () => {
    const http = app.getHttpServer();
    const registeredManifest = manifest();
    const version = { packageId: 'skinova-media', packageVersion: '1' };

    await request(http)
      .post('/api/internal/template-packages/register')
      .set('Cookie', 'wispo_session=admin')
      .send({ manifest: registeredManifest })
      .expect(401);
    await request(http)
      .post('/api/internal/template-packages/register')
      .set('x-wispo-release-token', 'release-only-secret')
      .send({ manifest: registeredManifest })
      .expect(201);
    await request(http)
      .post('/api/internal/sites/skinova/template-package/preflight')
      .set('x-wispo-release-token', 'release-only-secret')
      .send(version)
      .expect(201);
    await request(http)
      .put('/api/internal/sites/skinova/template-package/deployed')
      .set('x-wispo-release-token', 'release-only-secret')
      .send(version)
      .expect(200);

    expect(service.register).toHaveBeenCalledWith(registeredManifest);
    expect(service.preflight).toHaveBeenCalledWith('skinova', version);
    expect(service.reportDeployed).toHaveBeenCalledWith('skinova', version);
  });

  it('protects and validates the explicit Skinova managed backfill command', async () => {
    const http = app.getHttpServer();
    const siteId = '11111111-1111-4111-8111-111111111111';

    await request(http)
      .post('/api/internal/template-packages/skinova/backfill-managed-content')
      .send({ siteId })
      .expect(401);
    await request(http)
      .post('/api/internal/template-packages/skinova/backfill-managed-content')
      .set('x-wispo-release-token', 'release-only-secret')
      .send({ siteId: 'not-a-uuid' })
      .expect(400);
    await request(http)
      .post('/api/internal/template-packages/skinova/backfill-managed-content')
      .set('x-wispo-release-token', 'release-only-secret')
      .send({ siteId })
      .expect(201);

    expect(backfill.backfill).toHaveBeenCalledTimes(1);
    expect(backfill.backfill).toHaveBeenCalledWith(siteId);
  });

  it('does not expose activation or rollback routes', async () => {
    const http = app.getHttpServer();
    for (const action of ['activate', 'rollback']) {
      await request(http)
        .post(`/api/internal/sites/skinova/template-package/${action}`)
        .set('x-wispo-release-token', 'release-only-secret')
        .send({ packageId: 'skinova-media', packageVersion: '1' })
        .expect(404);
    }
  });

  it('keeps the release-only backfill dependency out of user controllers', () => {
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        TemplatePackageCurrentController,
      ),
    ).toEqual([TemplatePackageService]);
    expect(
      Reflect.getMetadata(
        'design:paramtypes',
        TemplatePackageCandidatesController,
      ),
    ).toEqual([TemplatePackageService]);
  });

  it('keeps current state behind user auth and candidates behind Wispo admin auth', async () => {
    const http = app.getHttpServer();
    const siteId = '11111111-1111-4111-8111-111111111111';

    await request(http)
      .get(`/api/sites/${siteId}/template-package/current`)
      .set('x-user-id', 'owner-id')
      .expect(200);
    await request(http)
      .get(`/api/sites/${siteId}/template-package/current`)
      .set('x-user-id', 'manager-id')
      .expect(403);
    await request(http)
      .get(`/api/platform/sites/${siteId}/template-package/candidates`)
      .set('x-user-id', 'owner-id')
      .expect(403);
    await request(http)
      .get(`/api/platform/sites/${siteId}/template-package/candidates`)
      .set('x-user-id', 'admin-id')
      .set('x-role', PlatformRole.WISPO_ADMIN)
      .expect(200);

    expect(service.current).toHaveBeenCalledWith(siteId, {
      userId: 'owner-id',
      platformRole: PlatformRole.EMPLOYEE,
    });
    expect(service.candidates).toHaveBeenCalledWith(siteId, {
      userId: 'admin-id',
      platformRole: PlatformRole.WISPO_ADMIN,
    });
  });
});
