import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { compare } from 'bcryptjs';
import {
  PageEntity,
  PlatformRole,
  SiteEntity,
  WorkspaceRole,
} from '../database/entities';
import type {
  UserEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { PlatformService } from './platform.service';

describe('PlatformService user access', () => {
  const users = {
    existsBy: jest.fn(),
    create: jest.fn((user: Partial<UserEntity>) => user as UserEntity),
    findOneBy: jest.fn(),
    save: jest.fn((user: UserEntity) => Promise.resolve(user)),
  };
  const service = new PlatformService(
    users as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not let an administrator disable their own account', async () => {
    await expect(
      service.updateUserStatus('self-id', 'self-id', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(users.findOneBy).not.toHaveBeenCalled();
  });

  it('does not disable a Wispo platform administrator', async () => {
    users.findOneBy.mockResolvedValue({
      id: 'admin-id',
      platformRole: PlatformRole.WISPO_ADMIN,
      isActive: true,
    });
    await expect(
      service.updateUserStatus('admin-id', 'actor-id', { isActive: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates a regular member status', async () => {
    const user = {
      id: 'member-id',
      platformRole: PlatformRole.MEMBER,
      isActive: true,
    } as UserEntity;
    users.findOneBy.mockResolvedValue(user);
    await expect(
      service.updateUserStatus('member-id', 'actor-id', { isActive: false }),
    ).resolves.toEqual({ id: 'member-id', isActive: false });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'member-id', isActive: false }),
    );
  });

  it('returns not found for an unknown member', async () => {
    users.findOneBy.mockResolvedValue(null);
    await expect(
      service.updateUserStatus('missing-id', 'actor-id', { isActive: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resets a regular member password', async () => {
    const user = {
      id: 'member-id',
      platformRole: PlatformRole.MEMBER,
      passwordHash: 'old-hash',
    } as UserEntity;
    users.findOneBy.mockResolvedValue(user);

    await expect(
      service.resetUserPassword('member-id', 'actor-id', {
        password: 'new-temporary-password',
      }),
    ).resolves.toEqual({ id: 'member-id', ok: true });
    expect(users.save).toHaveBeenCalledWith(user);
    await expect(
      compare('new-temporary-password', user.passwordHash),
    ).resolves.toBe(true);
  });

  it('does not reset the actor password or another Wispo administrator', async () => {
    await expect(
      service.resetUserPassword('actor-id', 'actor-id', {
        password: 'new-temporary-password',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    users.findOneBy.mockResolvedValue({
      id: 'admin-id',
      platformRole: PlatformRole.WISPO_ADMIN,
    });
    await expect(
      service.resetUserPassword('admin-id', 'actor-id', {
        password: 'new-temporary-password',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates a client login without exposing or replacing the password', async () => {
    const user = {
      id: 'client-id',
      fullName: 'Old Client',
      email: 'old@example.ru',
      passwordHash: 'kept-password-hash',
    } as UserEntity;
    users.findOneBy.mockResolvedValueOnce(user).mockResolvedValueOnce(null);

    await expect(
      service.updateUserProfile('client-id', {
        fullName: ' New Client ',
        email: ' CLIENT@EXAMPLE.RU ',
      }),
    ).resolves.toEqual({
      id: 'client-id',
      fullName: 'New Client',
      email: 'client@example.ru',
    });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'kept-password-hash' }),
    );
  });
});

describe('PlatformService workspace and site management', () => {
  const transactionManager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn(),
  };
  const workspaces = {
    existsBy: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((workspace) => Promise.resolve(workspace)),
  };
  const sites = {
    existsBy: jest.fn(),
    countBy: jest.fn(),
    create: jest.fn((site: Partial<SiteEntity>) => site as SiteEntity),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    save: jest.fn((site) => Promise.resolve({ id: 'site-id', ...site })),
    manager: {
      transaction: jest.fn(
        (callback: (manager: typeof transactionManager) => Promise<unknown>) =>
          callback(transactionManager),
      ),
    },
  };
  const pages = {
    create: jest.fn((page: Partial<PageEntity>) => page as PageEntity),
    find: jest.fn(),
    save: jest.fn((page: PageEntity | PageEntity[]) => Promise.resolve(page)),
  };
  const memberships = { findOne: jest.fn() };
  const service = new PlatformService(
    {} as never,
    workspaces as never,
    sites as never,
    pages as never,
    memberships as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sites.countBy.mockResolvedValue(0);
    sites.findOne.mockResolvedValue(null);
    pages.find.mockResolvedValue([]);
    transactionManager.query.mockResolvedValue(undefined);
    transactionManager.getRepository.mockImplementation((entity) =>
      entity === SiteEntity ? sites : pages,
    );
  });

  it('updates a workspace name without changing its system slug', async () => {
    workspaces.findOneBy.mockResolvedValue({
      id: 'workspace-id',
      name: 'Old name',
      slug: 'crazy-studio',
    });

    await expect(
      service.updateWorkspace('workspace-id', { name: '  Crazy Studio  ' }),
    ).resolves.toEqual({
      id: 'workspace-id',
      name: 'Crazy Studio',
      slug: 'crazy-studio',
    });
    expect(workspaces.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Crazy Studio', slug: 'crazy-studio' }),
    );
  });

  it('updates site details and publication availability', async () => {
    sites.findOneBy.mockResolvedValue({
      id: 'site-id',
      name: 'Old site',
      slug: 'wispo-media',
      domain: null,
      siteType: 'media',
      isActive: true,
    });

    await expect(
      service.updateSite('site-id', {
        name: ' Wispo Media ',
        domain: ' WISPO.MEDIA ',
        isActive: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'site-id',
        name: 'Wispo Media',
        slug: 'wispo-media',
        domain: 'wispo.media',
        siteType: 'media',
        isActive: false,
      }),
    );
    expect(sites.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Wispo Media',
        domain: 'wispo.media',
        isActive: false,
      }),
    );
  });

  it('blocks cross-workspace site moves to preserve shared content ownership', async () => {
    sites.findOneBy.mockResolvedValue({
      id: 'site-id',
      workspaceId: 'old-workspace-id',
      name: 'Media',
      slug: 'media',
      domain: null,
      siteType: 'media',
      isActive: true,
    });
    workspaces.existsBy.mockResolvedValue(true);

    await expect(
      service.updateSite('site-id', {
        name: 'Corporate',
        domain: null,
        siteType: 'corporate' as never,
        workspaceId: 'new-workspace-id',
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('blocks disabling or retyping a commercial target while Media links to it', async () => {
    sites.findOneBy.mockResolvedValue({
      id: 'commercial-id',
      workspaceId: 'workspace-id',
      name: 'Commercial',
      slug: 'commercial',
      domain: null,
      siteType: 'corporate',
      isActive: true,
      linkedCommercialSiteId: null,
    });
    sites.countBy.mockResolvedValue(1);

    await expect(
      service.updateSite('commercial-id', {
        name: 'Commercial',
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateSite('commercial-id', {
        name: 'Commercial',
        isActive: true,
        siteType: 'media' as never,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('adds missing media system pages once and returns refreshed structure', async () => {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Corporate',
      slug: 'corporate',
      domain: null,
      siteType: 'corporate',
      isActive: true,
    } as SiteEntity;
    const existingPages = [
      {
        id: 'custom-id',
        siteId: 'site-id',
        title: 'О компании',
        slug: 'about',
        kind: 'page',
        status: 'published',
      },
      {
        id: 'privacy-id',
        siteId: 'site-id',
        title: 'Моя политика',
        slug: 'privacy-policy',
        kind: 'page',
        status: 'draft',
      },
    ] as PageEntity[];
    const createdPages: PageEntity[] = [];
    sites.findOneBy.mockResolvedValue(site);
    pages.find
      .mockResolvedValueOnce(existingPages)
      .mockImplementation(() =>
        Promise.resolve([...existingPages, ...createdPages]),
      );
    pages.save.mockImplementationOnce((rows: PageEntity[]) => {
      createdPages.push(...rows);
      return Promise.resolve(rows);
    });
    const mediaUpdate = {
      name: 'Corporate',
      domain: null,
      siteType: 'media' as never,
      workspaceId: 'workspace-id',
      isActive: true,
    };

    const firstResult = await service.updateSite('site-id', mediaUpdate);
    const savesAfterFirstUpdate = pages.save.mock.calls.length;
    const secondResult = await service.updateSite('site-id', mediaUpdate);
    const corporateResult = await service.updateSite('site-id', {
      ...mediaUpdate,
      siteType: 'corporate' as never,
    });
    const ecommerceResult = await service.updateSite('site-id', {
      ...mediaUpdate,
      siteType: 'ecommerce' as never,
    });

    expect(createdPages.map((page) => page.slug)).toEqual([
      '404',
      'thank-you',
      'capture-form',
    ]);
    expect(createdPages.find((page) => page.slug === '404')).toEqual(
      expect.objectContaining({
        systemTemplateKey: 'signal',
        systemTemplateVersion: '1',
      }),
    );
    expect(pages.save).toHaveBeenCalledTimes(savesAfterFirstUpdate);
    expect(firstResult.pages.map((page) => page.slug)).toEqual(
      expect.arrayContaining([
        'about',
        'privacy-policy',
        '404',
        'thank-you',
        'capture-form',
      ]),
    );
    expect(secondResult.pages).toHaveLength(firstResult.pages.length);
    expect(corporateResult.pages).toHaveLength(firstResult.pages.length);
    expect(ecommerceResult.pages).toHaveLength(firstResult.pages.length);
    expect(pages.save).toHaveBeenCalledTimes(savesAfterFirstUpdate);
    expect(existingPages[0]).toEqual(
      expect.objectContaining({ slug: 'about', title: 'О компании' }),
    );
  });

  it('returns not found for an unknown site', async () => {
    sites.findOneBy.mockResolvedValue(null);
    await expect(
      service.updateSite('missing-id', {
        name: 'Site',
        domain: null,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a site slug already used by another project', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    sites.existsBy.mockResolvedValue(true);

    await expect(
      service.createSite('workspace-id', {
        name: 'Shared address',
        slug: 'shared-site',
        siteType: 'media' as never,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sites.existsBy).toHaveBeenCalledWith({ slug: 'shared-site' });
    expect(sites.save).not.toHaveBeenCalled();
  });

  it('bootstraps all default content contracts for a newly created Media site', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    sites.existsBy.mockResolvedValue(false);

    await service.createSite('workspace-id', {
      name: 'New Media',
      slug: 'new-media',
      siteType: 'media' as never,
    });

    expect(sites.manager.transaction).toHaveBeenCalledTimes(1);
    const bootstrapCalls = transactionManager.query.mock.calls as Array<
      [string, unknown[]?]
    >;
    const sql = bootstrapCalls
      .map(([statement]) => String(statement))
      .join('\n');
    for (const key of [
      'editorial-feed',
      'standard-article',
      'standard-category',
      'standard-header',
      'standard-footer',
    ])
      expect(bootstrapCalls[0]?.[1]).toContain(key);
    expect(sql).toContain('INSERT INTO "article_section_settings"');
    expect(sql).toContain('ON CONFLICT ("site_id") DO NOTHING');
    const savedSites = sites.save.mock.calls.map(
      ([savedSite]) => savedSite as SiteEntity,
    );
    expect(
      savedSites.some(
        (savedSite) =>
          savedSite.layoutSettings?.headerTemplateKey === 'standard-header' &&
          savedSite.layoutSettings?.footerTemplateKey === 'standard-footer',
      ),
    ).toBe(true);
  });

  it('bootstraps content when a corporate site transitions to Media', async () => {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Corporate',
      slug: 'corporate',
      domain: null,
      siteType: 'corporate',
      isActive: true,
      layoutSettings: {},
    } as SiteEntity;
    sites.findOneBy.mockResolvedValue(site);

    await service.updateSite('site-id', {
      name: 'Media',
      siteType: 'media' as never,
      isActive: true,
    });

    expect(sites.manager.transaction).toHaveBeenCalledTimes(1);
    expect(site.siteType).toBe('media');
    expect(site.layoutSettings).toMatchObject({
      headerTemplateKey: 'standard-header',
      footerTemplateKey: 'standard-footer',
    });
  });

  it('is retry-safe and never overwrites existing Media template settings', async () => {
    const site = {
      id: 'site-id',
      workspaceId: 'workspace-id',
      name: 'Media',
      slug: 'media',
      domain: null,
      siteType: 'media',
      isActive: true,
      layoutSettings: {
        headerTemplateKey: 'custom-header',
        headerTemplateVersion: '7',
        headerTemplateConfig: { brand: 'preserved' },
        footerTemplateKey: 'custom-footer',
        footerTemplateVersion: '4',
        footerTemplateConfig: { columns: 3 },
      },
    } as SiteEntity;
    sites.findOneBy.mockResolvedValue(site);
    const update = { name: 'Media', isActive: true };

    await service.updateSite('site-id', update);
    await service.updateSite('site-id', update);

    expect(sites.manager.transaction).toHaveBeenCalledTimes(2);
    expect(
      transactionManager.query.mock.calls
        .map(([statement]) => String(statement))
        .join('\n'),
    ).toContain('ON CONFLICT ("site_id", "kind", "key", "version") DO NOTHING');
    expect(site.layoutSettings).toEqual({
      headerTemplateKey: 'custom-header',
      headerTemplateVersion: '7',
      headerTemplateConfig: { brand: 'preserved' },
      footerTemplateKey: 'custom-footer',
      footerTemplateVersion: '4',
      footerTemplateConfig: { columns: 3 },
    });
  });

  it.each(['corporate', 'ecommerce', 'landing'] as const)(
    'creates a safe homepage for a %s site without media-only system pages',
    async (siteType) => {
      workspaces.existsBy.mockResolvedValue(true);
      sites.existsBy.mockResolvedValue(false);

      await expect(
        service.createSite('workspace-id', {
          name: `New ${siteType}`,
          slug: `new-${siteType}`,
          siteType: siteType as never,
        }),
      ).resolves.toEqual(expect.objectContaining({ siteType }));
      expect(pages.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'homepage', status: 'draft' }),
      );
      expect(pages.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'privacy-policy' }),
      );
    },
  );

  it('lets a workspace administrator add a site only to their project', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.WORKSPACE_ADMIN,
    });
    sites.existsBy.mockResolvedValue(false);

    await expect(
      service.createWorkspaceSite(
        'workspace-id',
        { userId: 'client-admin-id', platformRole: PlatformRole.MEMBER },
        {
          name: ' New media ',
          slug: 'new-media',
          siteType: 'media' as never,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        name: 'New media',
        slug: 'new-media',
        createdByUserId: 'client-admin-id',
      }),
    );
    expect(memberships.findOne).toHaveBeenCalledWith({
      select: { id: true },
      where: { userId: 'client-admin-id', workspaceId: 'workspace-id' },
    });
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-id',
        kind: 'homepage',
        status: 'draft',
      }),
    );
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-id',
        slug: 'privacy-policy',
        noIndex: false,
      }),
    );
    expect(pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-id',
        slug: '404',
        noIndex: true,
      }),
    );
  });

  it('lets any assigned employee create a site in their project', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.CONTENT_MANAGER,
    });

    await expect(
      service.createWorkspaceSite(
        'workspace-id',
        { userId: 'manager-id', platformRole: PlatformRole.MEMBER },
        { name: 'New media', slug: 'new-media', siteType: 'media' as never },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ workspaceId: 'workspace-id' }),
    );
    expect(sites.save).toHaveBeenCalled();
  });

  it('lets a Wispo administrator add a site without project membership', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    sites.existsBy.mockResolvedValue(false);

    await expect(
      service.createWorkspaceSite(
        'workspace-id',
        { userId: 'wispo-admin-id', platformRole: PlatformRole.WISPO_ADMIN },
        {
          name: 'Media',
          slug: 'media',
          siteType: 'media' as never,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        createdByUserId: 'wispo-admin-id',
      }),
    );
    expect(memberships.findOne).not.toHaveBeenCalled();
  });

  it('rejects a legacy agency member without project membership', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    sites.existsBy.mockResolvedValue(false);
    memberships.findOne.mockResolvedValue(null);

    await expect(
      service.createWorkspaceSite(
        'workspace-id',
        {
          userId: 'agency-member-id',
          platformRole: PlatformRole.AGENCY_MEMBER,
        },
        { name: 'Media', slug: 'media', siteType: 'media' as never },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(memberships.findOne).toHaveBeenCalled();
  });
});

describe('PlatformService project team assignments', () => {
  const users = { findOneBy: jest.fn() };
  const workspaces = { existsBy: jest.fn() };
  const memberships = {
    findOne: jest.fn(),
    create: jest.fn(
      (membership: Partial<WorkspaceMembershipEntity>) =>
        membership as WorkspaceMembershipEntity,
    ),
    save: jest.fn((membership: WorkspaceMembershipEntity) =>
      Promise.resolve({ id: 'membership-id', ...membership }),
    ),
    remove: jest.fn(),
  };
  const service = new PlatformService(
    users as never,
    workspaces as never,
    {} as never,
    {} as never,
    memberships as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('assigns an agency teammate to a workspace explicitly', async () => {
    workspaces.existsBy.mockResolvedValue(true);
    users.findOneBy.mockResolvedValue({
      id: 'agency-id',
      platformRole: PlatformRole.AGENCY_MEMBER,
    });
    memberships.findOne.mockResolvedValue(null);

    await expect(
      service.setWorkspaceMember('workspace-id', 'agency-id'),
    ).resolves.toEqual({
      id: 'membership-id',
      workspaceId: 'workspace-id',
      userId: 'agency-id',
      role: WorkspaceRole.EMPLOYEE,
    });
    expect(memberships.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        userId: 'agency-id',
        role: WorkspaceRole.EMPLOYEE,
      }),
    );
  });
});
