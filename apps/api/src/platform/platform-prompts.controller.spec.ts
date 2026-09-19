import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthService } from '../auth/auth.service';
import { PlatformPromptsController } from './platform-prompts.controller';
import { PlatformPromptsService } from './platform-prompts.service';
import { createOriginProtection } from '../security/origin-protection.middleware';

describe('global prompt library permissions', () => {
  let app: INestApplication<Server>;
  const list = jest.fn().mockResolvedValue([]);
  const create = jest.fn().mockResolvedValue({ id: 'created' });
  const update = jest.fn().mockResolvedValue({ revision: 2 });
  const remove = jest.fn().mockResolvedValue({ removed: true });
  const path = '/platform/prompts';
  const id = 'd9100000-0000-4000-8000-000000000001';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformPromptsController],
      providers: [
        {
          provide: PlatformPromptsService,
          useValue: { list, create, update, remove },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: (token: string) => Promise.resolve({ sub: token }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            getActiveIdentity: (key: string) =>
              Promise.resolve(
                key === 'disabled'
                  ? null
                  : {
                      id: key,
                      platformRole:
                        key === 'admin' ? 'wispo_admin' : 'employee',
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

  it('allows active employees to read but only admins to mutate', async () => {
    for (const method of ['get', 'post', 'put', 'delete'] as const) {
      const url = path + (['put', 'delete'].includes(method) ? '/' + id : '');
      await request(app.getHttpServer())[method](url).expect(401);
      await request(app.getHttpServer())
        [method](url)
        .set('Cookie', 'wispo_session=disabled')
        .expect(401);
      await request(app.getHttpServer())
        [method](url)
        .set('Cookie', 'wispo_session=employee')
        .expect(method === 'get' ? 200 : 403);
    }
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('validates admin CRUD and rejects stale-contract and cross-site inputs', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post(path)
      .set('Cookie', 'wispo_session=admin')
      .send({ title: ' Common ', content: ' Task ' })
      .expect(201);
    expect(create).toHaveBeenCalledWith({ title: 'Common', content: 'Task' });
    await request(http)
      .put(path + '/' + id)
      .set('Cookie', 'wispo_session=admin')
      .send({ title: 'Changed', content: 'Text', revision: 1 })
      .expect(200);
    await request(http)
      .delete(path + '/' + id)
      .set('Cookie', 'wispo_session=admin')
      .send({ revision: 2 })
      .expect(200);
    for (const data of [
      { title: ' ', content: 'Text' },
      { title: 'Title', content: 'x'.repeat(12001) },
    ]) {
      await request(http)
        .post(path)
        .set('Cookie', 'wispo_session=admin')
        .send(data)
        .expect(400);
    }
    await request(http)
      .put(path + '/' + id)
      .set('Cookie', 'wispo_session=admin')
      .send({ title: 'Title', content: 'Text' })
      .expect(400);
    await request(http)
      .delete(path + '/' + id)
      .set('Cookie', 'wispo_session=admin')
      .set('Origin', 'https://evil.example')
      .send({ revision: 2 })
      .expect(403);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
