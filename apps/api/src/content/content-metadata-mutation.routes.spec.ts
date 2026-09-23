import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';
import { ContentController } from './content.controller';
import { ContentLifecycleService } from './content-lifecycle.service';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';
import { ContentService } from './content.service';
import { SiteResourceRevisionsService } from './site-resource-revisions.service';

describe('remaining metadata mutations use revision drafts', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const articleId = '22222222-2222-4222-8222-222222222222';
  const mediaId = '33333333-3333-4333-8333-333333333333';
  let app: INestApplication;
  const content = {
    getSiteLayout: jest.fn().mockResolvedValue({}),
    updateSiteLayout: jest.fn().mockResolvedValue({}),
    listMedia: jest.fn().mockResolvedValue([{ id: mediaId }]),
    updateMedia: jest.fn().mockResolvedValue({}),
  };
  const lifecycle = {
    getArticleSectionSettings: jest.fn().mockResolvedValue({}),
    updateArticleSectionSettings: jest.fn().mockResolvedValue({}),
    getRelatedArticles: jest.fn().mockResolvedValue([]),
    updateRelatedArticles: jest.fn().mockResolvedValue({}),
  };
  const metadata = {
    getLayoutBindings: jest.fn().mockResolvedValue({ draftRevisionId: null }),
    saveLayoutBindings: jest
      .fn()
      .mockResolvedValue({ draftRevisionId: 'draft-id' }),
    getArticleListSettings: jest
      .fn()
      .mockResolvedValue({ draftRevisionId: null }),
    saveArticleListSettings: jest
      .fn()
      .mockResolvedValue({ draftRevisionId: 'draft-id' }),
    getRelatedArticles: jest.fn().mockResolvedValue([]),
    saveRelatedArticles: jest
      .fn()
      .mockResolvedValue({ draftRevisionId: 'draft-id' }),
    applyDraftAlt: jest
      .fn()
      .mockResolvedValue([{ id: mediaId, draftRevisionId: 'draft-id' }]),
    saveMediaAlt: jest.fn().mockResolvedValue({ draftRevisionId: 'draft-id' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ContentController],
      providers: [
        { provide: ContentService, useValue: content },
        { provide: ContentLifecycleService, useValue: lifecycle },
        { provide: CmsRevisionsService, useValue: {} },
        { provide: SiteResourceRevisionsService, useValue: {} },
        { provide: ContentMetadataRevisionsService, useValue: metadata },
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

  it('stages layout bindings instead of mutating site layout', async () => {
    await request(app.getHttpServer() as App)
      .patch(`/api/sites/${siteId}/content/layout`)
      .send({
        headerTemplateKey: 'header',
        headerTemplateVersion: '1',
        headerTemplateConfig: {},
        footerTemplateKey: 'footer',
        footerTemplateVersion: '1',
        footerTemplateConfig: {},
        expectedDraftRevisionId: null,
      })
      .expect(200);
    expect(metadata.saveLayoutBindings).toHaveBeenCalled();
    expect(content.updateSiteLayout).not.toHaveBeenCalled();
  });

  it('requires exact CAS when layout bindings are staged', async () => {
    metadata.saveLayoutBindings.mockClear();
    await request(app.getHttpServer() as App)
      .patch(`/api/sites/${siteId}/content/layout`)
      .send({
        headerTemplateKey: 'header',
        headerTemplateVersion: '1',
        headerTemplateConfig: {},
        footerTemplateKey: 'footer',
        footerTemplateVersion: '1',
        footerTemplateConfig: {},
      })
      .expect(400);
    expect(metadata.saveLayoutBindings).not.toHaveBeenCalled();
  });

  it('stages article-list settings instead of mutating the public row', async () => {
    await request(app.getHttpServer() as App)
      .patch(`/api/sites/${siteId}/content/articles/settings`)
      .send({
        templateKey: 'list',
        templateVersion: '1',
        config: {},
        expectedDraftRevisionId: null,
      })
      .expect(200);
    expect(metadata.saveArticleListSettings).toHaveBeenCalled();
    expect(lifecycle.updateArticleSectionSettings).not.toHaveBeenCalled();
  });

  it('stages related articles inside the article revision', async () => {
    await request(app.getHttpServer() as App)
      .patch(`/api/sites/${siteId}/content/articles/${articleId}/related`)
      .send({ articleIds: [], expectedDraftRevisionId: null })
      .expect(200);
    expect(metadata.saveRelatedArticles).toHaveBeenCalled();
    expect(lifecycle.updateRelatedArticles).not.toHaveBeenCalled();
  });

  it('returns draft alt state in the media list and stages alt changes', async () => {
    const response = await request(app.getHttpServer() as App)
      .get(`/api/sites/${siteId}/content/media`)
      .expect(200);
    const responseBody: unknown = response.body;
    expect(
      Array.isArray(responseBody) ? (responseBody as unknown[])[0] : null,
    ).toMatchObject({ draftRevisionId: 'draft-id' });
    await request(app.getHttpServer() as App)
      .patch(`/api/sites/${siteId}/content/media/${mediaId}`)
      .send({
        altText: 'Draft alt',
        isDecorative: false,
        expectedDraftRevisionId: null,
      })
      .expect(200);
    expect(metadata.saveMediaAlt).toHaveBeenCalled();
    expect(content.updateMedia).not.toHaveBeenCalled();
  });
});
