import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthService } from '../auth/auth.service';
import { DeepseekController } from './deepseek.controller';
import { DeepseekSettingsService } from './deepseek-settings.service';
import { DeepseekService } from './deepseek.service';
import { createOriginProtection } from '../security/origin-protection.middleware';

describe('admin-only DeepSeek settings routes', () => {
  let app: INestApplication<Server>;
  const status = jest.fn().mockResolvedValue({ configured: false });
  const save = jest.fn().mockResolvedValue({ configured: true });
  const remove = jest.fn().mockResolvedValue({ configured: false });
  const checkConnection = jest.fn().mockResolvedValue({ configured: true });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DeepseekController],
      providers: [
        {
          provide: DeepseekSettingsService,
          useValue: { status, save, remove },
        },
        { provide: DeepseekService, useValue: { checkConnection } },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: (token: string) => Promise.resolve({ sub: token }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getActiveIdentity: (id: string) =>
              Promise.resolve(
                id === 'disabled'
                  ? null
                  : {
                      id,
                      platformRole: id === 'admin' ? 'wispo_admin' : 'employee',
                    },
              ),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use(createOriginProtection(['https://cms.example']));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  const path = '/platform/settings/deepseek';
  it('rejects unauthenticated, disabled and employee users on every route', async () => {
    for (const method of ['get', 'put', 'delete', 'post'] as const) {
      const url = path + (method === 'post' ? '/check' : '');
      await request(app.getHttpServer())[method](url).expect(401);
      await request(app.getHttpServer())
        [method](url)
        .set('Cookie', 'wispo_session=disabled')
        .expect(401);
      await request(app.getHttpServer())
        [method](url)
        .set('Cookie', 'wispo_session=employee')
        .expect(403);
    }
    expect(save).not.toHaveBeenCalled();
    expect(checkConnection).not.toHaveBeenCalled();
  });
  it('allows admin metadata reads and validated writes, protects cross-site writes', async () => {
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', 'wispo_session=admin')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    await request(app.getHttpServer())
      .put(path)
      .set('Cookie', 'wispo_session=admin')
      .send({
        revision: 0,
        model: 'deepseek-flash',
        apiKey: 'sk-test-only-key',
      })
      .expect(200);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 0, model: 'deepseek-flash' }),
      'admin',
    );
    await request(app.getHttpServer())
      .put(path)
      .set('Cookie', 'wispo_session=admin')
      .send({ revision: -1, model: 'bad' })
      .expect(400);
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', 'wispo_session=admin')
      .set('Origin', 'https://evil.example')
      .send({ revision: 1 })
      .expect(403);
    expect(remove).not.toHaveBeenCalled();
  });
  it('rate limits the separate connection check', async () => {
    for (let n = 0; n < 3; n++)
      await request(app.getHttpServer())
        .post(path + '/check')
        .set('Cookie', 'wispo_session=admin')
        .expect(201);
    await request(app.getHttpServer())
      .post(path + '/check')
      .set('Cookie', 'wispo_session=admin')
      .expect(429);
  });
});
