import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PageStatus,
  PrivacyLegalModelEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
} from '../database/entities';
import {
  SiteResourceAdapterRegistryService,
  normalizeSiteResourceSnapshot,
} from './site-resource-adapter-registry';

describe('site resource adapters', () => {
  it.each([
    [
      'site_seo',
      {
        seoTitle: '  Title  ',
        seoDescription: '  Description  ',
        canonicalUrl: 'https://example.test/',
        seoImageMediaId: null,
        noIndex: false,
      },
      {
        seoTitle: 'Title',
        seoDescription: 'Description',
        canonicalUrl: 'https://example.test',
        seoImageMediaId: null,
        noIndex: false,
      },
    ],
    [
      'site_search',
      {
        searchableSections: ['articles', 'pages'],
        popularQueries: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            query: '  News  ',
          },
        ],
        recommendedQueries: [],
      },
      {
        searchableSections: ['articles', 'pages'],
        popularQueries: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            query: 'News',
          },
        ],
        recommendedQueries: [],
      },
    ],
    [
      'site_not_found',
      {
        status: PageStatus.PUBLISHED,
        seoTitle: '  Not found  ',
        seoDescription: '',
        templateKey: 'signal',
        templateVersion: '1',
      },
      {
        status: PageStatus.PUBLISHED,
        seoTitle: 'Not found',
        seoDescription: null,
        templateKey: 'signal',
        templateVersion: '1',
      },
    ],
  ] as const)(
    'normalizes %s without changing the caller snapshot',
    (type, input, expected) => {
      const source = structuredClone(input) as Record<string, unknown>;
      expect(normalizeSiteResourceSnapshot(type, source)).toEqual(expected);
      expect(source).toEqual(input);
    },
  );

  it('rejects duplicate variable identifiers before a revision is saved', () => {
    expect(() =>
      normalizeSiteResourceSnapshot('site_variables', {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Phone',
            identifier: 'phone',
            value: '1',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Another phone',
            identifier: 'phone',
            value: '2',
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed, duplicate variable ids and one-character names', () => {
    expect(() =>
      normalizeSiteResourceSnapshot('site_variables', {
        items: [
          {
            id: 'not-a-uuid',
            name: 'X',
            identifier: 'phone',
            value: '1',
          },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeSiteResourceSnapshot('site_variables', {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Phone',
            identifier: 'phone',
            value: '1',
          },
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Email',
            identifier: 'email',
            value: '2',
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed SEO identifiers, URLs and boolean flags', () => {
    expect(() =>
      normalizeSiteResourceSnapshot('site_seo', {
        seoTitle: null,
        seoDescription: null,
        canonicalUrl: 'not-a-url',
        seoImageMediaId: 'not-a-uuid',
        noIndex: 'false',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed and oversized search snapshots', () => {
    expect(() =>
      normalizeSiteResourceSnapshot('site_search', {
        searchableSections: ['articles'],
        popularQueries: Array.from({ length: 31 }, (_, index) => ({
          id: `${index}`,
          query: 'x',
        })),
        recommendedQueries: [],
      }),
    ).toThrow(BadRequestException);
  });

  it('publishes SEO into the live site row only from the approved snapshot', async () => {
    const site = { id: 'site-id', workspaceId: 'workspace-id' };
    const manager = {
      findOne: jest.fn().mockResolvedValue(site),
      save: jest
        .fn()
        .mockImplementation((_entity: unknown, value: unknown) => value),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await service.activate(manager as never, 'site-id', 'site_seo', {
      seoTitle: 'Published title',
      seoDescription: 'Published description',
      canonicalUrl: 'https://example.test',
      seoImageMediaId: null,
      noIndex: false,
    });

    expect(manager.save).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        seoTitle: 'Published title',
        seoDescription: 'Published description',
      }),
    );
  });

  it('rejects an SEO image that does not belong to the site workspace', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 'site-id', workspaceId: 'workspace-id' })
        .mockResolvedValueOnce(null),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await expect(
      service.normalizeSnapshot('site-id', 'site_seo', {
        seoTitle: 'Title',
        seoDescription: null,
        canonicalUrl: null,
        seoImageMediaId: '11111111-1111-4111-8111-111111111111',
        noIndex: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not publish removal of a variable that is still used by content', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          identifier: 'phone',
        },
      ]),
      query: jest.fn().mockResolvedValue([{ count: '2' }]),
      delete: jest.fn(),
      save: jest.fn(),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await expect(
      service.activate(manager as never, 'site-id', 'site_variables', {
        items: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('decorates variable draft responses with current usage counts', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([{ count: '3' }]),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await expect(
      service.presentSnapshot('site-id', 'site_variables', {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Phone',
            identifier: 'phone',
            value: '1',
          },
        ],
      }),
    ).resolves.toMatchObject({ items: [{ usageCount: 3 }] });
  });

  it('preserves fresh search recommendations and removes only promoted queries', async () => {
    const manager = {
      findOne: jest.fn().mockResolvedValue({
        siteId: 'site-id',
        recommendedQueries: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            query: 'Fresh',
            hits: 7,
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            query: 'Promoted',
            hits: 3,
          },
        ],
      }),
      upsert: jest.fn(),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await service.activate(manager as never, 'site-id', 'site_search', {
      searchableSections: ['articles'],
      popularQueries: [
        { id: '33333333-3333-4333-8333-333333333333', query: 'Promoted' },
      ],
      recommendedQueries: [],
    });

    expect(manager.upsert).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        recommendedQueries: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            query: 'Fresh',
            hits: 7,
          },
        ],
      }),
      ['siteId'],
    );
  });

  it('publishes an approved privacy revision even when its source page was still a draft', async () => {
    const page = { id: 'page-id', status: PageStatus.DRAFT, blocks: [] };
    const site = { id: 'site-id', globalData: { companyName: 'Public name' } };
    const legalModel = {
      id: 'legal-id',
      version: 'legal-v1',
      status: 'approved',
    };
    const state = {
      page,
      legalModel,
      settings: {},
      publishedSnapshot: null,
      publishedAt: null,
      publishedLegalModelVersion: null,
      publishedDisplayTemplateKey: null,
      publishedDisplayTemplateVersion: null,
      publishedDisplayTemplateConfig: null,
    };
    const manager = {
      findOne: jest.fn().mockImplementation((entity) => {
        if (entity === PrivacyPolicyStateEntity) return Promise.resolve(state);
        if (entity === PrivacyLegalModelEntity)
          return Promise.resolve(legalModel);
        if (entity === SiteEntity) return Promise.resolve(site);
        return Promise.resolve(null);
      }),
      save: jest
        .fn()
        .mockImplementation((_entity: unknown, value: unknown) => value),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await service.activate(manager as never, 'site-id', 'site_privacy', {
      pageStatus: PageStatus.DRAFT,
      document: 'Approved policy',
      legalModel: { id: 'legal-id', version: 'legal-v1', status: 'approved' },
      displayTemplate: { key: 'system-policy', version: '1', config: {} },
      company: {
        organizationType: 'ooo',
        legalName: 'Approved company',
        inn: '123',
        ogrn: '456',
        legalAddress: 'Moscow',
      },
      settings: {
        dataCategories: ['email'],
        purposes: ['feedback'],
        collectionMethods: ['web_forms'],
        cookies: true,
      },
      mode: 'automatic',
      automaticSnapshot: 'Approved policy',
    });

    expect(page.status).toBe(PageStatus.PUBLISHED);
    expect(page.blocks).toEqual([
      { id: 'privacy-policy-document', type: 'text', text: 'Approved policy' },
    ]);
    expect(state.publishedSnapshot).toBe('Approved policy');
    expect(state.settings).toMatchObject({ cookies: true });
    expect(site.globalData).toMatchObject({ legalName: 'Approved company' });
  });

  it('rejects a forged privacy legal-model status at publication', async () => {
    const state = {
      page: { id: 'page-id', status: PageStatus.DRAFT, blocks: [] },
      legalModel: { id: 'legal-id', version: 'legal-v1', status: 'draft' },
    };
    const manager = {
      findOne: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve(entity === PrivacyPolicyStateEntity ? state : null),
        ),
      save: jest.fn(),
    };
    const service = new SiteResourceAdapterRegistryService({
      manager,
    } as never);

    await expect(
      service.activate(manager as never, 'site-id', 'site_privacy', {
        document: 'Forged policy',
        legalModel: { id: 'legal-id', version: 'legal-v1', status: 'approved' },
        displayTemplate: { key: 'system-policy', version: '1', config: {} },
        company: { legalName: 'Company' },
        settings: {},
        mode: 'automatic',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
