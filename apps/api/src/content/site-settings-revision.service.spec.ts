import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  PageKind,
  PageStatus,
  PlatformRole,
  SiteType,
} from '../database/entities';
import { ContentService } from './content.service';

describe('site globals and layout revision adapters', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };
  const publicGlobals = {
    companyName: 'Published company',
    phone: '+7 900 000-00-00',
    email: 'published@example.test',
  };
  const publicLayout = {
    logoText: 'Published logo',
    showPages: true,
    showArticles: true,
    ctaLabel: 'Published action',
    ctaUrl: '#contact',
    footerDescription: 'Published footer',
    showContacts: true,
    showSocials: true,
    headerTemplateKey: 'skinova-header',
    headerTemplateVersion: '1',
    headerTemplateConfig: { sticky: true },
    footerTemplateKey: 'skinova-footer',
    footerTemplateVersion: '1',
    footerTemplateConfig: { columns: 3 },
  };
  const homepage = {
    id: 'homepage-id',
    siteId: 'site-id',
    title: 'Homepage',
    slug: '',
    kind: PageKind.HOMEPAGE,
    status: PageStatus.PUBLISHED,
    blocks: [{ id: 'hero', type: 'hero', title: 'Published homepage' }],
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    noIndex: false,
    ogTitle: null,
    ogDescription: null,
    ogImageMediaId: null,
    structuredData: null,
    redirects: [],
    systemTemplateKey: 'skinova-home',
    systemTemplateVersion: '1',
  };

  function setup() {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      siteType: SiteType.MEDIA,
      name: 'Skinova',
      slug: 'skinova',
      domain: null,
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      seoImageMediaId: null,
      noIndex: true,
      globalData: { ...publicGlobals },
      layoutSettings: structuredClone(publicLayout),
    };
    const sites = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value: unknown) => value),
    };
    const pages = {
      findOne: jest.fn().mockResolvedValue({ ...homepage }),
      find: jest.fn().mockResolvedValue([{ ...homepage }]),
    };
    const emptyFind = { find: jest.fn().mockResolvedValue([]) };
    const media = { existsBy: jest.fn().mockResolvedValue(true) };
    const bannerAssignments = { find: jest.fn().mockResolvedValue([]) };
    const currentByType: Record<string, unknown> = {
      site_globals: {
        draft: {
          id: 'globals-draft-id',
          versionNumber: 2,
          snapshot: { ...publicGlobals, phone: '+7 911 111-11-11' },
        },
        approvedRevisionId: null,
        publishedRevisionId: 'globals-baseline-id',
        reviewState: 'draft',
      },
      site_header: {
        draft: {
          id: 'header-draft-id',
          versionNumber: 3,
          snapshot: {
            logoText: 'Draft logo',
            showPages: false,
            showArticles: true,
            ctaLabel: 'Draft action',
            ctaUrl: '#draft',
          },
        },
        approvedRevisionId: null,
        publishedRevisionId: 'header-baseline-id',
        reviewState: 'draft',
      },
      site_footer: {
        draft: {
          id: 'footer-draft-id',
          versionNumber: 4,
          snapshot: {
            footerDescription: 'Draft footer',
            showContacts: false,
            showSocials: true,
          },
        },
        approvedRevisionId: null,
        publishedRevisionId: 'footer-baseline-id',
        reviewState: 'draft',
      },
    };
    const versionByType: Record<string, Record<string, unknown>> = {
      site_globals: {
        companyName: 'Exact company',
        phone: '+7 922 222-22-22',
        email: 'exact@example.test',
      },
      site_header: {
        logoText: 'Exact logo',
        showPages: false,
        showArticles: true,
        ctaLabel: 'Exact action',
        ctaUrl: '#exact',
      },
      site_footer: {
        footerDescription: 'Exact footer',
        showContacts: false,
        showSocials: false,
      },
    };
    const revisions = {
      current: jest
        .fn()
        .mockImplementation((_siteId: string, type: string) =>
          Promise.resolve(currentByType[type] ?? null),
        ),
      getVersion: jest
        .fn()
        .mockImplementation((_siteId: string, type: string) =>
          Promise.resolve({
            id: 'exact-id',
            versionNumber: 1,
            snapshot: versionByType[type],
          }),
        ),
      importPublishedBaseline: jest
        .fn()
        .mockResolvedValue({ id: 'baseline-id', versionNumber: 1 }),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'next-draft-id', versionNumber: 5 }),
      publish: jest.fn(),
    };
    const service = new ContentService(
      sites as never,
      {} as never,
      emptyFind as never,
      {} as never,
      emptyFind as never,
      {} as never,
      media as never,
      pages as never,
      emptyFind as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      bannerAssignments as never,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return {
      service,
      site,
      sites,
      pages,
      revisions,
      currentByType,
      versionByType,
    };
  }

  it('shows the globals draft without changing public site data', async () => {
    const { service, site } = setup();

    await expect(service.getSiteGlobals('site-id', actor)).resolves.toEqual(
      expect.objectContaining({
        siteId: 'site-id',
        phone: '+7 911 111-11-11',
        draftRevisionId: 'globals-draft-id',
      }),
    );
    expect(site.globalData).toEqual(publicGlobals);
  });

  it('saves global data only as a new revision and rejects a stale window', async () => {
    const { service, sites, revisions } = setup();

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '  +7 933 333-33-33  ',
        expectedDraftRevisionId: 'globals-draft-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        phone: '+7 933 333-33-33',
        draftRevisionId: 'next-draft-id',
      }),
    );
    expect(sites.save).not.toHaveBeenCalled();
    const snapshotMatcher: unknown = expect.objectContaining({
      phone: '+7 933 333-33-33',
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'site_globals',
        entityId: 'site-id',
        expectedDraftRevisionId: 'globals-draft-id',
        snapshot: snapshotMatcher,
      }),
    );

    await expect(
      service.updateSiteGlobals('site-id', actor, {
        phone: '+7 944 444-44-44',
        expectedDraftRevisionId: 'stale-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps header and footer drafts independent and blocks the direct content path', async () => {
    const { service, sites, revisions } = setup();
    const adapter = service as unknown as {
      updateSiteLayoutSection: (
        siteId: string,
        scope: 'header' | 'footer',
        actor: typeof actor,
        dto: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };

    await expect(
      adapter.updateSiteLayoutSection('site-id', 'header', actor, {
        logoText: '  Next logo  ',
        showPages: false,
        expectedDraftRevisionId: 'header-draft-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        logoText: 'Next logo',
        draftRevisionId: 'next-draft-id',
      }),
    );
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'site_header',
        snapshot: {
          logoText: 'Next logo',
          logoMediaId: undefined,
          showPages: false,
          showArticles: true,
          ctaLabel: 'Draft action',
          ctaUrl: '#draft',
        },
      }),
    );
    expect(sites.save).not.toHaveBeenCalled();

    await expect(
      service.updateSiteLayout('site-id', actor, {
        footerDescription: 'Bypass',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes globals transactionally without changing layout settings', async () => {
    const { service, site, revisions } = setup();
    const manager = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value: unknown) => value),
    };
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) => activate(manager, { ...publicGlobals, phone: '+7 955 555-55-55' }),
    );
    const adapter = service as unknown as {
      publishSiteSettingsRevision: (
        siteId: string,
        type: 'site_globals',
        revisionId: string,
        actor: typeof actor,
      ) => Promise<Record<string, unknown>>;
    };

    await expect(
      adapter.publishSiteSettingsRevision(
        'site-id',
        'site_globals',
        'approved-id',
        actor,
      ),
    ).resolves.toEqual(expect.objectContaining({ phone: '+7 955 555-55-55' }));
    const globalDataMatcher: unknown = expect.objectContaining({
      phone: '+7 955 555-55-55',
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        globalData: globalDataMatcher,
        layoutSettings: publicLayout,
      }),
    );
  });

  it('publishes one layout section while preserving the other section and template bindings', async () => {
    const { service, site, revisions } = setup();
    const manager = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest.fn().mockImplementation((value: unknown) => value),
    };
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) =>
        activate(manager, {
          logoText: 'Approved logo',
          showPages: false,
          showArticles: true,
          ctaLabel: 'Approved action',
          ctaUrl: '#approved',
        }),
    );
    const adapter = service as unknown as {
      publishSiteSettingsRevision: (
        siteId: string,
        type: 'site_header',
        revisionId: string,
        actor: typeof actor,
      ) => Promise<Record<string, unknown>>;
    };

    await adapter.publishSiteSettingsRevision(
      'site-id',
      'site_header',
      'approved-id',
      actor,
    );
    const layoutSettingsMatcher: unknown = expect.objectContaining({
      logoText: 'Approved logo',
      footerDescription: 'Published footer',
      headerTemplateKey: 'skinova-header',
      footerTemplateKey: 'skinova-footer',
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        layoutSettings: layoutSettingsMatcher,
      }),
    );
  });

  it.each([
    ['site_globals', 'globalData', 'phone', '+7 922 222-22-22'],
    ['site_header', 'layoutSettings', 'logoText', 'Exact logo'],
    ['site_footer', 'layoutSettings', 'footerDescription', 'Exact footer'],
  ] as const)(
    'previews the exact %s revision through the homepage renderer',
    async (type, group, field, expected) => {
      const { service, site } = setup();
      const adapter = service as unknown as {
        getSiteSettingsRevisionPreview: (
          siteId: string,
          type: typeof type,
          revisionId: string,
          actor: typeof actor,
        ) => Promise<{ site: Record<string, Record<string, unknown>> }>;
      };

      const preview = await adapter.getSiteSettingsRevisionPreview(
        'site-id',
        type,
        'exact-id',
        actor,
      );
      expect(preview.site[group]?.[field]).toBe(expected);
      expect(site.globalData).toEqual(publicGlobals);
      expect(site.layoutSettings).toEqual(publicLayout);
    },
  );
});
