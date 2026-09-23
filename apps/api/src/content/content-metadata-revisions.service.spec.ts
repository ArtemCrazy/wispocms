import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import { ContentMetadataRevisionsService } from './content-metadata-revisions.service';
import { SitePermission } from './content.permissions';

describe('ContentMetadataRevisionsService', () => {
  const actor = { userId: 'editor-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup(current: Record<string, unknown> | null = null) {
    const sites = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
    };
    const articles = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'article-id', siteId: 'site-id' }),
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'related-id', siteId: 'site-id' }]),
    };
    const related = {
      find: jest
        .fn()
        .mockResolvedValue([
          { articleId: 'article-id', relatedArticleId: 'old-id', sortOrder: 0 },
        ]),
    };
    const templates = {
      findOne: jest.fn().mockResolvedValue({ key: 'list', version: '2' }),
    };
    const settings = {
      findOne: jest.fn().mockResolvedValue({
        siteId: 'site-id',
        listTemplateKey: 'old',
        listTemplateVersion: '1',
        listTemplateConfig: {},
      }),
    };
    const media = {
      findOne: jest.fn().mockResolvedValue({
        id: 'media-id',
        siteId: 'site-id',
        workspaceId: 'workspace-id',
        altText: 'Published alt',
      }),
    };
    const revisions = {
      assertSitePermission: jest.fn().mockResolvedValue(undefined),
      current: jest.fn().mockResolvedValue(current),
      importPublishedBaseline: jest
        .fn()
        .mockResolvedValue({ id: 'baseline-id', versionNumber: 1 }),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'draft-next', versionNumber: 2 }),
      getVersion: jest.fn(),
      publish: jest.fn(),
    };
    const query = jest.fn().mockResolvedValue([{ count: 0 }]);
    const dataSource = { manager: { query } };
    const service = new ContentMetadataRevisionsService(
      dataSource as never,
      sites as never,
      articles as never,
      related as never,
      templates as never,
      settings as never,
      media as never,
      revisions as never,
    );
    return {
      service,
      revisions,
      sites,
      articles,
      related,
      templates,
      settings,
      media,
      query,
    };
  }

  it('stages article-list template settings without changing the public row', async () => {
    const { service, revisions, settings } = setup();
    await expect(
      service.saveArticleListSettings('site-id', actor, {
        templateKey: 'list',
        templateVersion: '2',
        config: { columns: 3 },
        expectedDraftRevisionId: null,
      }),
    ).resolves.toMatchObject({
      draftRevisionId: 'draft-next',
      listTemplateKey: 'list',
    });
    expect(settings).not.toHaveProperty('upsert');
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'site_article_list',
        entityId: 'site-id',
        snapshot: {
          listTemplateKey: 'list',
          listTemplateVersion: '2',
          listTemplateConfig: { columns: 3 },
        },
      }),
    );
    expect(revisions.assertSitePermission).toHaveBeenCalledWith(
      'site-id',
      actor,
      SitePermission.EDIT_CODE,
    );
  });

  it('revalidates both active layout templates when bindings are published', async () => {
    const { service, revisions } = setup();
    const manager = {
      findOne: jest.fn((entity: { name?: string }) =>
        entity.name === 'SiteEntity'
          ? { id: 'site-id', layoutSettings: {} }
          : null,
      ),
      save: jest.fn(),
    };
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          manager: unknown,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) =>
        activate(manager, {
          headerTemplateKey: 'header',
          headerTemplateVersion: '1',
          headerTemplateConfig: {},
          footerTemplateKey: 'footer',
          footerTemplateVersion: '1',
          footerTemplateConfig: {},
        }),
    );

    await expect(
      service.publish(
        'site-id',
        'site_layout_bindings',
        'site-id',
        'revision-id',
        actor,
      ),
    ).rejects.toThrow('Шаблон шапки или подвала не найден');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects stale related-article edits before creating a revision', async () => {
    const { service, revisions } = setup({
      draft: {
        id: 'current-id',
        versionNumber: 2,
        snapshot: { articleIds: [] },
      },
      approvedRevisionId: null,
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });
    await expect(
      service.saveRelatedArticles('site-id', 'article-id', actor, {
        articleIds: ['related-id'],
        expectedDraftRevisionId: 'stale-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('stages media alt text without mutating the media entity', async () => {
    const { service, revisions, media } = setup();
    await expect(
      service.saveMediaAlt('site-id', 'media-id', actor, {
        altText: ' Draft alt ',
        isDecorative: false,
        expectedDraftRevisionId: null,
      }),
    ).resolves.toMatchObject({
      altText: 'Draft alt',
      draftRevisionId: 'draft-next',
    });
    expect(media).not.toHaveProperty('save');
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'media_alt',
        entityId: 'media-id',
        snapshot: { altText: 'Draft alt', isDecorative: false },
      }),
    );
  });

  it('denies related-article reads before revealing whether the article exists', async () => {
    const { service, revisions, articles } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    articles.findOne.mockResolvedValue(null);

    await expect(
      service.getRelatedArticles('site-id', 'missing-id', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies related-article writes before revealing whether the article exists', async () => {
    const { service, revisions, articles } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    articles.findOne.mockResolvedValue(null);

    await expect(
      service.saveRelatedArticles('site-id', 'missing-id', actor, {
        articleIds: [],
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies media-alt reads before revealing whether the media exists', async () => {
    const { service, revisions, media } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    media.findOne.mockResolvedValue(null);

    await expect(
      service.getMediaAlt('site-id', 'missing-id', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies media-alt writes before revealing whether the media exists', async () => {
    const { service, revisions, media } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    media.findOne.mockResolvedValue(null);

    await expect(
      service.saveMediaAlt('site-id', 'missing-id', actor, {
        altText: 'Alt',
        isDecorative: false,
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies layout-binding reads before revealing whether the site exists', async () => {
    const { service, revisions, sites } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    sites.findOne.mockResolvedValue(null);

    await expect(
      service.getLayoutBindings('missing-id', actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies layout-binding writes before revealing whether the site exists', async () => {
    const { service, revisions, sites } = setup();
    revisions.assertSitePermission.mockRejectedValue(
      new ForbiddenException('Нет доступа'),
    );
    sites.findOne.mockResolvedValue(null);

    await expect(
      service.saveLayoutBindings('missing-id', actor, {
        headerTemplateKey: 'header',
        headerTemplateVersion: '1',
        headerTemplateConfig: {},
        footerTemplateKey: 'footer',
        footerTemplateVersion: '1',
        footerTemplateConfig: {},
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks alt drafts when the media is used only by another site', async () => {
    const { service, revisions, query } = setup();
    query.mockResolvedValue([{ count: 1 }]);

    await expect(
      service.saveMediaAlt('site-id', 'media-id', actor, {
        altText: 'Shared image',
        isDecorative: false,
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'media-id',
      'site-id',
    ]);
    const [usageQuery] = query.mock.calls[0] as [string, unknown[]];
    const compactUsageQuery = usageQuery.replace(/\s+/g, ' ');
    expect(compactUsageQuery).toContain('jsonb_path_exists( COALESCE("blocks"');
    expect(compactUsageQuery).toContain(
      'jsonb_path_exists( COALESCE("body_document"',
    );
    expect(compactUsageQuery).toContain(
      'jsonb_path_exists( COALESCE("layout_settings"',
    );
  });

  it('rechecks media ownership and sharing when an approved alt revision is published', async () => {
    const { service, revisions } = setup();
    const manager = {
      findOne: jest.fn((entity: { name?: string }) =>
        entity.name === 'SiteEntity'
          ? { id: 'site-id', workspaceId: 'workspace-id' }
          : {
              id: 'media-id',
              siteId: 'site-id',
              workspaceId: 'workspace-id',
              altText: 'Published alt',
              isDecorative: false,
            },
      ),
      query: jest.fn().mockResolvedValue([{ count: 2 }]),
      save: jest.fn(),
    };
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          manager: unknown,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) => activate(manager, { altText: 'Approved alt', isDecorative: false }),
    );

    await expect(
      service.publish('site-id', 'media_alt', 'media-id', 'revision-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reports a missing alt text when an approved media-alt revision is published', async () => {
    const { service, revisions } = setup();
    const manager = {
      findOne: jest.fn((entity: { name?: string }) =>
        entity.name === 'SiteEntity'
          ? { id: 'site-id', workspaceId: 'workspace-id' }
          : {
              id: 'media-id',
              siteId: 'site-id',
              workspaceId: 'workspace-id',
              altText: 'Published alt',
              isDecorative: false,
            },
      ),
      query: jest.fn().mockResolvedValue([{ count: 0 }]),
      save: jest.fn(),
    };
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          manager: unknown,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) => activate(manager, { altText: null, isDecorative: false }),
    );

    await expect(
      service.publish('site-id', 'media_alt', 'media-id', 'revision-id', actor),
    ).rejects.toThrow(
      'Добавьте alt-текст или отметьте изображение декоративным',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });
});
