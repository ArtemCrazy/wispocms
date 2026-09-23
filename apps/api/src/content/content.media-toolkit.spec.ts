import { ConflictException, NotFoundException } from '@nestjs/common';
import { BannerPlacement, PlatformRole, SiteType } from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService Media site toolkit', () => {
  const actor = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };

  function setup(usageCount = '0', activityRows: unknown[] = []) {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
      }),
    };
    const pages = {
      existsBy: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 'page-id',
        siteId: 'site-id',
        kind: 'homepage',
        systemTemplateKey: 'skinova-home',
        systemTemplateVersion: '1',
      }),
    };
    const banners = {
      existsBy: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({
        id: 'banner-id',
        siteId: 'site-id',
        placement: null,
        mediaId: null,
        mobileMediaId: null,
        title: 'Акция',
        subtitle: null,
        buttonText: null,
        linkUrl: null,
        sortOrder: 0,
        isActive: true,
      }),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    };
    const media = {
      existsBy: jest.fn().mockResolvedValue(true),
      findOne: jest.fn().mockResolvedValue({
        id: 'media-id',
        workspaceId: 'workspace-id',
        storageNamespace: 'files',
        storedName: 'banner.webp',
        width: 1800,
        height: 480,
      }),
      save: jest.fn((value: Record<string, unknown>) => Promise.resolve(value)),
    };
    const assignments = {
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const variables = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'variable-id',
        siteId: 'site-id',
        identifier: 'phone',
      }),
      manager: {
        query: jest.fn().mockResolvedValue([{ count: usageCount }]),
      },
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const pageActivities = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue(activityRows),
    };
    const revisions = {
      current: jest.fn().mockResolvedValue(null),
      importPublishedBaseline: jest
        .fn()
        .mockResolvedValue({ id: 'baseline-id', versionNumber: 1 }),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'draft-id', versionNumber: 2 }),
      saveDraftUsingManager: jest
        .fn()
        .mockResolvedValue({ id: 'created-draft-id', versionNumber: 1 }),
      publish: jest.fn(),
      getVersion: jest.fn(),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      media as never,
      pages as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignments as never,
      variables as never,
      undefined,
      pageActivities as never,
      revisions as never,
    );
    return {
      service,
      assignments,
      variables,
      pageActivities,
      banners,
      media,
      pages,
      revisions,
    };
  }

  it('stages one banner per page zone without changing public assignments', async () => {
    const { service, assignments, revisions } = setup();
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_top',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).resolves.toEqual({ assignments: [], draftRevisionId: 'draft-id' });
    expect(assignments.upsert).not.toHaveBeenCalled();
    expect(revisions.saveDraft).toHaveBeenCalled();
  });

  it('returns developer-owned slots with the bound homepage', async () => {
    const { service, pages } = setup();
    const page = {
      id: 'page-id',
      siteId: 'site-id',
      kind: 'homepage',
      systemTemplateKey: 'skinova-home',
      systemTemplateVersion: '1',
    };
    pages.find.mockResolvedValue([page]);
    const result = await service.listPages('site-id', actor);
    expect(result[0]?.id).toBe('page-id');
    expect(result[0]?.bannerSlots.map((slot) => slot.id)).toEqual([
      'homepage_top',
      'homepage_middle',
    ]);
  });

  it('rejects a zone not declared by the bound page template', async () => {
    const { service, assignments } = setup();
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'invented_zone',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow('Шаблон страницы не содержит такой зоны баннера');
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [
      'empty',
      {
        id: 'banner-id',
        siteId: 'site-id',
        mediaId: null,
        mobileMediaId: null,
        title: null,
        subtitle: null,
        buttonText: null,
      },
    ],
    [
      'image-only',
      {
        id: 'banner-id',
        siteId: 'site-id',
        mediaId: 'media-id',
        mobileMediaId: null,
        title: null,
        subtitle: null,
        buttonText: null,
      },
    ],
  ])('rejects %s content in the text-only promo slot', async (_name, row) => {
    const { service, assignments, banners } = setup();
    banners.findOne.mockResolvedValue(row);
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_top',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('rejects assigning a banner owned by another site', async () => {
    const { service, assignments, banners } = setup();
    banners.findOne.mockResolvedValue(null);
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_middle',
        bannerId: 'foreign-banner-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow('Баннер этого сайта не найден');
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('requires a desktop asset when the declared slot requires one', async () => {
    const { service, assignments, banners } = setup();
    banners.findOne.mockResolvedValue({
      id: 'banner-id',
      siteId: 'site-id',
      mediaId: null,
      mobileMediaId: null,
      title: 'Акция',
      subtitle: null,
      buttonText: null,
    });
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_middle',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow('Для этой зоны требуется изображение для компьютера');
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('accepts a compatible banner with exact slot geometry', async () => {
    const { service, assignments, banners, revisions } = setup();
    banners.findOne.mockResolvedValue({
      id: 'banner-id',
      siteId: 'site-id',
      mediaId: 'media-id',
      mobileMediaId: null,
      title: null,
      subtitle: null,
      buttonText: null,
    });
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_middle',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).resolves.toEqual({ assignments: [], draftRevisionId: 'draft-id' });
    expect(assignments.upsert).not.toHaveBeenCalled();
    expect(revisions.saveDraft).toHaveBeenCalled();
  });

  it('rejects an image whose actual geometry misses the slot contract', async () => {
    const { service, assignments, banners, media } = setup();
    banners.findOne.mockResolvedValue({
      id: 'banner-id',
      siteId: 'site-id',
      mediaId: 'media-id',
      mobileMediaId: null,
      title: null,
      subtitle: null,
      buttonText: null,
    });
    media.findOne.mockResolvedValue({
      id: 'media-id',
      workspaceId: 'workspace-id',
      width: 1200,
      height: 400,
    });
    await expect(
      service.assignPageBanner('site-id', 'page-id', actor, {
        zone: 'homepage_middle',
        bannerId: 'banner-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow(
      'ожидается не меньше 1800 × 480 px, формат 15:4, получено 1200 × 400 px',
    );
    expect(assignments.upsert).not.toHaveBeenCalled();
  });

  it('rejects removing the required desktop asset from an assigned active banner', async () => {
    const { service, assignments, banners } = setup();
    banners.findOne.mockResolvedValue({
      id: 'banner-id',
      siteId: 'site-id',
      placement: null,
      mediaId: 'media-id',
      mobileMediaId: null,
      title: null,
      subtitle: null,
      buttonText: null,
      linkUrl: null,
      sortOrder: 0,
      isActive: true,
    });
    assignments.find.mockResolvedValue([
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_middle',
        page: {
          id: 'page-id',
          siteId: 'site-id',
          kind: 'homepage',
          systemTemplateKey: 'skinova-home',
          systemTemplateVersion: '1',
        },
      },
    ]);

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        mediaId: null,
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow('Для этой зоны требуется изображение для компьютера');
    expect(banners.save).not.toHaveBeenCalled();
  });

  it('rejects incompatible geometry when replacing an assigned banner asset', async () => {
    const { service, assignments, banners, media } = setup();
    banners.findOne.mockResolvedValue({
      id: 'banner-id',
      siteId: 'site-id',
      placement: null,
      mediaId: 'media-id',
      mobileMediaId: null,
      title: null,
      subtitle: null,
      buttonText: null,
      linkUrl: null,
      sortOrder: 0,
      isActive: true,
    });
    assignments.find.mockResolvedValue([
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_middle',
        page: {
          id: 'page-id',
          siteId: 'site-id',
          kind: 'homepage',
          systemTemplateKey: 'skinova-home',
          systemTemplateVersion: '1',
        },
      },
    ]);
    media.findOne.mockResolvedValue({
      id: 'bad-media-id',
      workspaceId: 'workspace-id',
      width: 1200,
      height: 400,
    });

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        mediaId: 'bad-media-id',
        expectedDraftRevisionId: null,
      }),
    ).rejects.toThrow(
      'ожидается не меньше 1800 × 480 px, формат 15:4, получено 1200 × 400 px',
    );
    expect(banners.save).not.toHaveBeenCalled();
  });

  it.each([
    ['image-only', { title: null, mediaId: 'media-id' }],
    ['empty', { title: null }],
  ])('rejects making an assigned top banner %s', async (_name, update) => {
    const { service, assignments, banners } = setup();
    assignments.find.mockResolvedValue([
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_top',
        page: {
          id: 'page-id',
          siteId: 'site-id',
          kind: 'homepage',
          systemTemplateKey: 'skinova-home',
          systemTemplateVersion: '1',
        },
      },
    ]);

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        ...update,
        expectedDraftRevisionId: null,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(banners.save).not.toHaveBeenCalled();
  });

  it('accepts a compatible update to an assigned active banner', async () => {
    const { service, assignments, banners, revisions } = setup();
    assignments.find.mockResolvedValue([
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_top',
        page: {
          id: 'page-id',
          siteId: 'site-id',
          kind: 'homepage',
          systemTemplateKey: 'skinova-home',
          systemTemplateVersion: '1',
        },
      },
    ]);

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        title: 'Новая акция',
        expectedDraftRevisionId: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Новая акция' }));
    expect(banners.save).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      title: 'Новая акция',
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'banner',
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('allows an invalid assigned draft only while inactive and validates reactivation', async () => {
    const { service, assignments, banners, revisions } = setup();
    const existing = {
      id: 'banner-id',
      siteId: 'site-id',
      placement: null,
      mediaId: null,
      mobileMediaId: null,
      title: 'Акция',
      subtitle: null,
      buttonText: null,
      linkUrl: null,
      sortOrder: 0,
      isActive: true,
    };
    banners.findOne.mockResolvedValue(existing);
    assignments.find.mockResolvedValue([
      {
        siteId: 'site-id',
        pageId: 'page-id',
        bannerId: 'banner-id',
        zone: 'homepage_top',
        page: {
          id: 'page-id',
          siteId: 'site-id',
          kind: 'homepage',
          systemTemplateKey: 'skinova-home',
          systemTemplateVersion: '1',
        },
      },
    ]);

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        title: null,
        isActive: false,
        expectedDraftRevisionId: null,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ isActive: false, title: null }),
    );
    revisions.saveDraft.mockClear();
    revisions.current.mockResolvedValue({
      draft: {
        id: 'draft-id',
        versionNumber: 2,
        snapshot: { ...existing, title: null, isActive: false },
      },
      approvedRevisionId: null,
      publishedRevisionId: 'baseline-id',
      reviewState: 'draft',
    });

    await expect(
      service.updateBanner('site-id', 'banner-id', actor, {
        isActive: true,
        expectedDraftRevisionId: 'draft-id',
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('keeps the legacy article sidebar placement while editing its content', async () => {
    const { service, banners, revisions } = setup();
    const existing = {
      id: 'sidebar-banner-id',
      siteId: 'site-id',
      placement: BannerPlacement.ARTICLE_SIDEBAR,
      title: 'До изменения',
      subtitle: null,
      buttonText: null,
      linkUrl: null,
      mediaId: null,
      mobileMediaId: null,
      sortOrder: 0,
      isActive: true,
    };
    banners.findOne.mockResolvedValue(existing);
    await service.updateBanner('site-id', 'sidebar-banner-id', actor, {
      title: 'После изменения',
      expectedDraftRevisionId: null,
    });
    expect(existing.placement).toBe(BannerPlacement.ARTICLE_SIDEBAR);
    expect(banners.save).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      title: 'После изменения',
      placement: BannerPlacement.ARTICLE_SIDEBAR,
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('rejects foreign media and executable links before banner creation', async () => {
    const { service, media, banners } = setup();
    media.existsBy.mockResolvedValue(false);
    await expect(
      service.createBanner('site-id', actor, {
        name: 'Чужой файл',
        mediaId: 'foreign-media-id',
      }),
    ).rejects.toThrow('Изображение рабочего пространства не найдено');
    media.existsBy.mockResolvedValue(true);
    await expect(
      service.createBanner('site-id', actor, {
        name: 'Опасная ссылка',
        linkUrl: 'javascript:alert(1)',
      }),
    ).rejects.toThrow('Недопустимый адрес баннера');
    expect(banners.save).not.toHaveBeenCalled();
  });

  it('protects variables used in SEO, structured data, or template config by scanning complete rows', async () => {
    const { service, variables } = setup('2');
    await expect(
      service.deleteSiteVariable('site-id', 'variable-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(variables.remove).not.toHaveBeenCalled();
    const calls = variables.manager.query.mock.calls as Array<
      [string, unknown[]]
    >;
    const [sql, parameters] = calls[0];
    expect(sql).toContain('to_jsonb(entry)::text');
    expect(sql).toContain('"site_content_templates"');
    expect(sql).toContain('"article_section_settings"');
    expect(sql).toContain('FROM "pages" entry');
    expect(parameters).toEqual(['site-id', '%{{phone}}%']);
  });

  it('escapes wildcard characters in variable usage lookup', async () => {
    const { service, variables } = setup('1');
    variables.findOneBy.mockResolvedValue({
      id: 'variable-id',
      siteId: 'site-id',
      identifier: 'support_phone',
    });
    await expect(
      service.deleteSiteVariable('site-id', 'variable-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    const calls = variables.manager.query.mock.calls as Array<
      [string, unknown[]]
    >;
    expect(calls[0][1]).toEqual(['site-id', '%{{support\\_phone}}%']);
  });

  it('returns page history without sensitive user fields', async () => {
    const activity = {
      id: 'activity-id',
      action: 'seo_updated',
      description: 'SEO updated',
      changes: { seoTitle: 'New' },
      createdAt: new Date('2026-09-09T12:00:00Z'),
      user: {
        id: 'user-id',
        fullName: 'Editor',
        email: 'secret@example.ru',
        passwordHash: 'never-expose',
        platformRole: 'wispo_admin',
        isActive: true,
      },
    };
    const { service } = setup('0', [activity]);
    const result = await service.listPageActivity('site-id', 'page-id', actor);
    expect(result).toEqual([
      {
        id: activity.id,
        action: activity.action,
        description: activity.description,
        changes: activity.changes,
        createdAt: activity.createdAt,
        user: { id: 'user-id', fullName: 'Editor' },
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /passwordHash|platformRole|email/,
    );
  });

  it('does not publish an unassigned universal banner image', async () => {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        slug: 'media',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
        seoImageMediaId: null,
      }),
    };
    const banners = { exists: jest.fn().mockResolvedValue(false) };
    const assignments = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'media-id',
          workspaceId: 'workspace-id',
          storageNamespace: 'files',
          storedName: 'banner.webp',
          mimeType: 'image/webp',
        }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      banners as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      assignments as never,
    );

    await expect(
      service.getPublicMedia('media', 'media-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(assignments.find).toHaveBeenCalled();
    expect(banners.exists).toHaveBeenCalledWith({
      where: [
        {
          siteId: 'site-id',
          isActive: true,
          placement: BannerPlacement.ARTICLE_SIDEBAR,
          mediaId: 'media-id',
        },
        {
          siteId: 'site-id',
          isActive: true,
          placement: BannerPlacement.ARTICLE_SIDEBAR,
          mobileMediaId: 'media-id',
        },
      ],
    });
  });

  it('publishes an active legacy article sidebar banner image', async () => {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-id',
        slug: 'media',
        workspaceId: 'workspace-id',
        siteType: SiteType.MEDIA,
        seoImageMediaId: null,
      }),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'media-id',
          workspaceId: 'workspace-id',
          storageNamespace: 'files',
          storedName: 'sidebar.webp',
          mimeType: 'image/webp',
        }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { exists: jest.fn().mockResolvedValue(true) } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { find: jest.fn().mockResolvedValue([]) } as never,
    );

    const result = await service.getPublicMedia('media', 'media-id');
    expect(result.mimeType).toBe('image/webp');
    expect(result.path).toContain('sidebar.webp');
  });
});
