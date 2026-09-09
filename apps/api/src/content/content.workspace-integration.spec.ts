import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DomainStatus,
  PlatformRole,
  SiteType,
  type SiteEntity,
} from '../database/entities';
import { ContentService } from './content.service';

describe('ContentService workspace integration', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup() {
    const source = {
      id: 'media-id',
      workspaceId: 'workspace-a',
      name: 'Media',
      slug: 'media',
      domain: null,
      domainStatus: DomainStatus.NOT_CONFIGURED,
      domainCheckedAt: null,
      domainStatusMessage: null,
      siteType: SiteType.MEDIA,
      linkedCommercialSiteId: null,
      notificationEmail: null,
      seoTitle: null,
      seoDescription: null,
    } as SiteEntity;
    const target = {
      id: 'commercial-id',
      workspaceId: 'workspace-a',
      name: 'Commercial',
      slug: 'commercial',
      domain: null,
      domainStatus: DomainStatus.NOT_CONFIGURED,
      siteType: SiteType.CORPORATE,
      isActive: true,
    } as SiteEntity;
    const sites = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where?: Partial<SiteEntity> }) => {
          if (where?.domain) return Promise.resolve(null);
          if (where?.id === target.id) return Promise.resolve(target);
          return Promise.resolve(source);
        }),
      findOneBy: jest.fn().mockResolvedValue(target),
      find: jest.fn().mockResolvedValue([target]),
      save: jest
        .fn()
        .mockImplementation((site: SiteEntity) => Promise.resolve(site)),
      createQueryBuilder: jest.fn(),
    };
    const empty = {};
    const service = new ContentService(
      sites as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
      empty as never,
    );
    return { service, sites, source, target };
  }

  it('links Media only to an active commercial site in the same workspace', async () => {
    const { service, source } = setup();
    await expect(
      service.updateSiteSettings('media-id', actor, {
        name: 'Media',
        domain: null,
        linkedCommercialSiteId: 'commercial-id',
      }),
    ).resolves.toMatchObject({
      linkedCommercialSiteId: 'commercial-id',
      linkedCommercialSite: { id: 'commercial-id' },
    });
    expect(source.linkedCommercialSiteId).toBe('commercial-id');
  });

  it('rejects a commercial target from another workspace', async () => {
    const { service, sites, target } = setup();
    sites.findOneBy.mockResolvedValue({
      ...target,
      workspaceId: 'workspace-b',
    });
    await expect(
      service.updateSiteSettings('media-id', actor, {
        name: 'Media',
        linkedCommercialSiteId: 'commercial-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a normalized domain already owned by another site', async () => {
    const { service, sites } = setup();
    sites.findOne.mockImplementation(
      ({ where }: { where?: Partial<SiteEntity> }) =>
        Promise.resolve(
          where?.domain
            ? ({ id: 'other-site', domain: where.domain } as SiteEntity)
            : ({
                id: 'media-id',
                workspaceId: 'workspace-a',
                siteType: SiteType.MEDIA,
                domain: null,
              } as SiteEntity),
        ),
    );
    await expect(
      service.updateSiteSettings('media-id', actor, {
        name: 'Media',
        domain: 'HTTPS://EXAMPLE.COM/path',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves only a verified exact custom host', async () => {
    const { service, sites } = setup();
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        id: 'media-id',
        slug: 'media',
        siteType: SiteType.MEDIA,
      }),
    };
    sites.createQueryBuilder.mockReturnValue(query);
    await expect(
      service.resolvePublicSiteByHost('Media.Example.com:443'),
    ).resolves.toEqual({
      id: 'media-id',
      slug: 'media',
      siteType: SiteType.MEDIA,
    });
    expect(query.where).toHaveBeenCalledWith('lower(site.domain) = :host', {
      host: 'media.example.com',
    });
    await expect(
      service.resolvePublicSiteByHost('media.example.com/path'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves shared media publicly only when the requested site uses it', async () => {
    const sites = {
      findOne: jest.fn().mockResolvedValue({
        id: 'site-a',
        workspaceId: 'workspace-a',
        siteType: SiteType.MEDIA,
        isActive: true,
        seoImageMediaId: null,
      }),
    };
    const media = {
      findOne: jest.fn().mockResolvedValue({
        id: 'shared-media',
        workspaceId: 'workspace-a',
        siteId: 'site-b',
        storageNamespace: 'workspace-a',
        storedName: 'shared.png',
        mimeType: 'image/png',
      }),
    };
    const pages = {
      find: jest
        .fn()
        .mockResolvedValue([{ blocks: [{ mediaId: 'shared-media' }] }]),
    };
    const banners = {
      existsBy: jest.fn().mockResolvedValue(false),
      exists: jest.fn().mockResolvedValue(false),
    };
    const articles = { find: jest.fn().mockResolvedValue([]) };
    const categories = { find: jest.fn().mockResolvedValue([]) };
    const service = new ContentService(
      sites as never,
      {} as never,
      categories as never,
      {} as never,
      articles as never,
      {} as never,
      media as never,
      pages as never,
      banners as never,
    );

    const publicFile = await service.getPublicMedia('site-a', 'shared-media');
    expect(publicFile.path).toMatch(/[\\/]workspace-a[\\/]shared\.png$/);
    expect(publicFile.mimeType).toBe('image/png');
    expect(media.findOne).toHaveBeenCalledWith({
      where: { id: 'shared-media', workspaceId: 'workspace-a' },
    });

    pages.find.mockResolvedValue([]);
    await expect(
      service.getPublicMedia('site-a', 'shared-media'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
