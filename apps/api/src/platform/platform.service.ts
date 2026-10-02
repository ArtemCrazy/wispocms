import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { In, Repository } from 'typeorm';
import {
  DomainStatus,
  ContentTemplateKind,
  PlatformRole,
  PageEntity,
  PageKind,
  PageStatus,
  SiteType,
  SiteEntity,
  SiteAccessEntity,
  SiteRole,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  WorkspaceRole,
} from '../database/entities';
import { normalizeHostnameInput } from './site-domain';
import {
  CreateSiteDto,
  CreateUserDto,
  CreateWorkspaceDto,
  ManagedUserRole,
  ResetUserPasswordDto,
  UpdateSiteDto,
  SiteAccessAssignmentDto,
  UpdateUserStatusDto,
  UpdateUserProfileDto,
  UpdateManagedUserDto,
  UpdateWorkspaceDto,
} from './platform.dto';
import {
  DEFAULT_NOT_FOUND_TEMPLATE_KEY,
  DEFAULT_NOT_FOUND_TEMPLATE_VERSION,
} from '../content/not-found-templates';

const MEDIA_SYSTEM_PAGE_TEMPLATES: Array<
  Pick<PageEntity, 'title' | 'slug' | 'blocks' | 'noIndex'>
> = [
  {
    title: 'Политика конфиденциальности',
    slug: 'privacy-policy',
    blocks: [
      {
        id: 'media-system-v1-privacy',
        type: 'text',
        title: 'Политика конфиденциальности',
        text: '',
      },
    ],
    noIndex: false,
  },
  {
    title: 'Страница 404',
    slug: '404',
    blocks: [
      {
        id: 'media-system-v1-404',
        type: 'hero',
        title: 'Страница не найдена',
        text: 'Проверьте адрес или вернитесь на главную страницу.',
        buttonLabel: 'На главную',
        buttonUrl: '/',
      },
    ],
    noIndex: true,
  },
  {
    title: 'Спасибо',
    slug: 'thank-you',
    blocks: [],
    noIndex: true,
  },
  {
    title: 'Форма захвата',
    slug: 'capture-form',
    blocks: [],
    noIndex: true,
  },
];

const MEDIA_CONTENT_TEMPLATES = [
  {
    kind: ContentTemplateKind.ARTICLES_LIST,
    key: 'editorial-feed',
    name: 'Редакционная лента',
  },
  {
    kind: ContentTemplateKind.ARTICLE,
    key: 'standard-article',
    name: 'Стандартная статья',
  },
  {
    kind: ContentTemplateKind.CATEGORY,
    key: 'standard-category',
    name: 'Стандартная категория',
  },
  {
    kind: ContentTemplateKind.HEADER,
    key: 'standard-header',
    name: 'Стандартная шапка',
  },
  {
    kind: ContentTemplateKind.FOOTER,
    key: 'standard-footer',
    name: 'Стандартный подвал',
  },
] as const;

@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(PageEntity)
    private readonly pages: Repository<PageEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(SiteAccessEntity)
    private readonly siteAccesses: Repository<SiteAccessEntity>,
  ) {}

  private async assertDomainAvailable(domain: string | null, siteId?: string) {
    if (!domain) return;
    const owner = await this.sites.findOne({ where: { domain } });
    if (owner && owner.id !== siteId)
      throw new ConflictException('Этот домен уже назначен другому сайту');
  }

  private async ensureMediaSystemPages(
    siteId: string,
    pages: Repository<PageEntity> = this.pages,
  ) {
    const existingPages = await pages.find({ where: { siteId } });
    const existingSlugs = new Set(existingPages.map((page) => page.slug));
    const missingPages = MEDIA_SYSTEM_PAGE_TEMPLATES.filter(
      (template) => !existingSlugs.has(template.slug),
    );

    if (missingPages.length > 0) {
      await pages.save(
        missingPages.map((template) =>
          pages.create({
            siteId,
            ...template,
            ...(template.slug === '404'
              ? {
                  systemTemplateKey: DEFAULT_NOT_FOUND_TEMPLATE_KEY,
                  systemTemplateVersion: DEFAULT_NOT_FOUND_TEMPLATE_VERSION,
                }
              : {}),
            kind: PageKind.PAGE,
            status: PageStatus.DRAFT,
            seoTitle: null,
            seoDescription: null,
            canonicalUrl: null,
          }),
        ),
      );
    }

    const notFoundPage = existingPages.find((page) => page.slug === '404');
    if (
      notFoundPage &&
      (!notFoundPage.systemTemplateKey || !notFoundPage.systemTemplateVersion)
    ) {
      notFoundPage.systemTemplateKey = DEFAULT_NOT_FOUND_TEMPLATE_KEY;
      notFoundPage.systemTemplateVersion = DEFAULT_NOT_FOUND_TEMPLATE_VERSION;
      await pages.save(notFoundPage);
    }

    return pages.find({
      where: { siteId },
      order: { kind: 'ASC', title: 'ASC' },
    });
  }

  private async ensureMediaContent(site: SiteEntity) {
    return this.sites.manager.transaction(async (manager) => {
      const templateValues = MEDIA_CONTENT_TEMPLATES.map(
        (_, index) =>
          `($1, $${index * 3 + 2}, $${index * 3 + 3}, '1', $${index * 3 + 4}, '{}'::jsonb)`,
      ).join(', ');
      const templateParameters = [
        site.id,
        ...MEDIA_CONTENT_TEMPLATES.flatMap(({ kind, key, name }) => [
          kind,
          key,
          name,
        ]),
      ];
      await manager.query(
        `INSERT INTO "site_content_templates" ("site_id", "kind", "key", "version", "name", "config")
         VALUES ${templateValues}
         ON CONFLICT ("site_id", "kind", "key", "version") DO NOTHING`,
        templateParameters,
      );
      await manager.query(
        `INSERT INTO "article_section_settings" ("site_id", "list_template_key", "list_template_version", "list_template_config")
         VALUES ($1, 'editorial-feed', '1', '{}'::jsonb)
         ON CONFLICT ("site_id") DO NOTHING`,
        [site.id],
      );
      site.layoutSettings = {
        headerTemplateKey: 'standard-header',
        headerTemplateVersion: '1',
        headerTemplateConfig: {},
        footerTemplateKey: 'standard-footer',
        footerTemplateVersion: '1',
        footerTemplateConfig: {},
        ...site.layoutSettings,
      };
      await manager.getRepository(SiteEntity).save(site);
      return this.ensureMediaSystemPages(
        site.id,
        manager.getRepository(PageEntity),
      );
    });
  }

  async listWorkspaces() {
    const workspaces = await this.workspaces.find({
      relations: { sites: { createdBy: true }, memberships: true },
      order: { name: 'ASC' },
    });
    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      memberCount: workspace.memberships.length,
      sites: workspace.sites.map((site) => ({
        id: site.id,
        name: site.name,
        slug: site.slug,
        domain: site.domain,
        domainStatus: site.domainStatus,
        linkedCommercialSiteId: site.linkedCommercialSiteId,
        siteType: site.siteType,
        isActive: site.isActive,
        createdAt: site.createdAt,
        creator: site.createdBy
          ? {
              id: site.createdBy.id,
              fullName: site.createdBy.fullName,
              email: site.createdBy.email,
            }
          : null,
      })),
    }));
  }

  async createWorkspace(dto: CreateWorkspaceDto) {
    const slug = dto.slug.trim().toLowerCase();
    if (await this.workspaces.existsBy({ slug }))
      throw new ConflictException('Такой slug пространства уже используется');
    return this.workspaces.save(
      this.workspaces.create({ name: dto.name.trim(), slug }),
    );
  }

  async updateWorkspace(workspaceId: string, dto: UpdateWorkspaceDto) {
    const workspace = await this.workspaces.findOneBy({ id: workspaceId });
    if (!workspace)
      throw new NotFoundException('Рабочее пространство не найдено');
    workspace.name = dto.name.trim();
    await this.workspaces.save(workspace);
    return { id: workspace.id, name: workspace.name, slug: workspace.slug };
  }

  async createSite(
    workspaceId: string,
    dto: CreateSiteDto,
    createdByUserId?: string,
  ) {
    if (!(await this.workspaces.existsBy({ id: workspaceId })))
      throw new NotFoundException('Рабочее пространство не найдено');
    const slug = dto.slug.trim().toLowerCase();
    if (await this.sites.existsBy({ slug }))
      throw new ConflictException(
        'Такой системный адрес уже используется другим сайтом',
      );
    const domain = normalizeHostnameInput(dto.domain);
    await this.assertDomainAvailable(domain);
    const site = await this.sites.save(
      this.sites.create({
        workspaceId,
        name: dto.name.trim(),
        slug,
        domain,
        domainStatus: domain
          ? DomainStatus.PENDING
          : DomainStatus.NOT_CONFIGURED,
        domainCheckedAt: null,
        domainStatusMessage: null,
        linkedCommercialSiteId: null,
        siteType: dto.siteType,
        isActive: true,
        createdByUserId: createdByUserId ?? null,
      }),
    );
    await this.pages.save(
      this.pages.create({
        siteId: site.id,
        title: 'Главная',
        slug: '',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.DRAFT,
        blocks: [
          {
            id: 'media-homepage-v1-hero',
            type: 'hero',
            title: site.name,
            text: '',
            buttonLabel: '',
            buttonUrl: '',
          },
          {
            id: 'media-homepage-v1-intro',
            type: 'text',
            title: 'О сайте',
            text: '',
          },
        ],
        seoTitle: null,
        seoDescription: null,
        canonicalUrl: null,
        noIndex: false,
      }),
    );
    if (site.siteType === SiteType.MEDIA) await this.ensureMediaContent(site);
    return site;
  }

  async createWorkspaceSite(
    workspaceId: string,
    actor: { userId: string; platformRole: PlatformRole },
    dto: CreateSiteDto,
  ) {
    if (!(await this.workspaces.existsBy({ id: workspaceId })))
      throw new NotFoundException('Рабочее пространство не найдено');

    if (actor.platformRole !== PlatformRole.WISPO_ADMIN)
      throw new ForbiddenException(
        'Создавать сайты может только администратор Wispo',
      );

    return this.createSite(workspaceId, dto, actor.userId);
  }

  async updateSite(siteId: string, dto: UpdateSiteDto) {
    const site = await this.sites.findOneBy({ id: siteId });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (dto.workspaceId && dto.workspaceId !== site.workspaceId)
      throw new ConflictException(
        'Перенос сайта между рабочими пространствами отключён: сначала перенесите или удалите связи и общий контент',
      );
    const nextWorkspaceId = dto.workspaceId ?? site.workspaceId;
    const nextType = dto.siteType ?? site.siteType;
    const isCommercialType = (type: SiteType) =>
      type === SiteType.CORPORATE ||
      type === SiteType.ECOMMERCE ||
      type === SiteType.LANDING;
    if (
      site.linkedCommercialSiteId &&
      (nextWorkspaceId !== site.workspaceId || nextType !== SiteType.MEDIA)
    )
      throw new ConflictException(
        'Сначала отключите связанный коммерческий сайт в настройках Media',
      );
    if (
      (nextWorkspaceId !== site.workspaceId ||
        !isCommercialType(nextType) ||
        dto.isActive === false) &&
      (await this.sites.countBy({ linkedCommercialSiteId: site.id })) > 0
    )
      throw new ConflictException(
        'Сайт связан с Media. Сначала отключите связь в настройках Media',
      );
    const domain =
      dto.domain === undefined
        ? site.domain
        : normalizeHostnameInput(dto.domain);
    await this.assertDomainAvailable(domain, site.id);
    const domainChanged = dto.domain !== undefined && domain !== site.domain;
    site.name = dto.name.trim();
    if (dto.domain !== undefined) site.domain = domain;
    if (domainChanged) {
      site.domainStatus = domain
        ? DomainStatus.PENDING
        : DomainStatus.NOT_CONFIGURED;
      site.domainCheckedAt = null;
      site.domainStatusMessage = null;
    }
    site.isActive = dto.isActive;
    if (dto.siteType) site.siteType = dto.siteType;
    if (dto.workspaceId) site.workspaceId = dto.workspaceId;
    let structurePages: PageEntity[] | undefined;
    if (nextType === SiteType.MEDIA)
      structurePages = await this.ensureMediaContent(site);
    else await this.sites.save(site);
    structurePages ??= await this.pages.find({
      where: { siteId: site.id },
      order: { kind: 'ASC', title: 'ASC' },
    });
    return {
      id: site.id,
      workspaceId: site.workspaceId,
      name: site.name,
      slug: site.slug,
      domain: site.domain,
      domainStatus: site.domainStatus,
      linkedCommercialSiteId: site.linkedCommercialSiteId,
      siteType: site.siteType,
      isActive: site.isActive,
      pages: structurePages.map(({ id, title, slug, kind, status }) => ({
        id,
        title,
        slug,
        kind,
        status,
      })),
    };
  }

  async updateUserProfile(userId: string, dto: UpdateUserProfileDto) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const email = dto.email.trim().toLowerCase();
    const emailOwner = await this.users.findOneBy({ email });
    if (emailOwner && emailOwner.id !== userId)
      throw new ConflictException('Пользователь с такой почтой уже существует');
    user.fullName = dto.fullName.trim();
    user.email = email;
    await this.users.save(user);
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
    };
  }

  async updateManagedUser(
    userId: string,
    actorUserId: string,
    dto: UpdateManagedUserDto,
  ) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');

    const administrator = dto.role === ManagedUserRole.WISPO_ADMIN;
    if (userId === actorUserId && (!administrator || !dto.isActive))
      throw new BadRequestException(
        'Нельзя снять собственные права администратора или отключить аккаунт',
      );
    if (administrator && !dto.isActive)
      throw new BadRequestException(
        'Администратора Wispo нельзя отключить через этот экран',
      );

    const siteIds = administrator ? [] : dto.siteIds;
    if (!administrator && siteIds.length === 0)
      throw new BadRequestException('Укажите хотя бы один сайт');
    if (new Set(siteIds).size !== siteIds.length)
      throw new BadRequestException('Один сайт нельзя назначить дважды');
    if (dto.role === ManagedUserRole.SITE_OWNER && siteIds.length !== 1)
      throw new BadRequestException(
        'Аккаунт владельца можно назначить только одному сайту',
      );

    const sites = siteIds.length
      ? await this.sites.find({
          where: { id: In(siteIds) },
          select: { id: true, workspaceId: true },
        })
      : [];
    if (sites.length !== siteIds.length)
      throw new NotFoundException('Один из сайтов не найден');

    const sitesByWorkspace = new Map<string, string[]>();
    for (const site of sites) {
      const assigned = sitesByWorkspace.get(site.workspaceId) ?? [];
      assigned.push(site.id);
      sitesByWorkspace.set(site.workspaceId, assigned);
    }

    user.fullName = dto.fullName.trim();
    user.platformRole = administrator
      ? PlatformRole.WISPO_ADMIN
      : PlatformRole.EMPLOYEE;
    user.accountKind =
      dto.role === ManagedUserRole.SITE_OWNER ? 'site' : 'wispo';
    user.homeSiteId =
      dto.role === ManagedUserRole.SITE_OWNER ? siteIds[0] : null;
    user.isActive = dto.isActive;

    return this.users.manager.transaction(async (manager) => {
      await manager.delete(SiteAccessEntity, { userId });
      await manager.delete(WorkspaceMembershipEntity, { userId });

      const siteAccesses = administrator
        ? []
        : siteIds.map((siteId) => ({
            userId,
            siteId,
            role:
              dto.role === ManagedUserRole.SITE_OWNER
                ? SiteRole.OWNER
                : SiteRole.CONTENT_MANAGER,
            requiresApproval:
              dto.role === ManagedUserRole.CONTENT_MANAGER
                ? dto.requiresApproval
                : false,
          }));
      if (siteAccesses.length)
        await manager.save(
          SiteAccessEntity,
          siteAccesses.map((access) =>
            manager.create(SiteAccessEntity, access),
          ),
        );
      if (sitesByWorkspace.size)
        await manager.save(
          WorkspaceMembershipEntity,
          [...sitesByWorkspace.entries()].map(
            ([workspaceId, assignedSiteIds]) =>
              manager.create(WorkspaceMembershipEntity, {
                userId,
                workspaceId,
                role: WorkspaceRole.EMPLOYEE,
                siteIds: assignedSiteIds,
              }),
          ),
        );
      await manager.save(UserEntity, user);
      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        platformRole: user.platformRole,
        isActive: user.isActive,
        accountKind: user.accountKind,
        homeSiteId: user.homeSiteId,
        siteAccesses,
      };
    });
  }

  async listUsers() {
    const users = await this.users.find({
      relations: {
        memberships: { workspace: true },
        siteAccesses: { site: { workspace: true } },
      },
      order: { fullName: 'ASC' },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      platformRole: user.platformRole,
      isActive: user.isActive,
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspace.name,
        role: membership.role,
        siteIds: membership.siteIds,
      })),
      siteAccesses: user.siteAccesses.map((access) => ({
        siteId: access.siteId,
        siteName: access.site.name,
        workspaceId: access.site.workspaceId,
        workspaceName: access.site.workspace.name,
        role: access.role,
        requiresApproval: access.requiresApproval,
      })),
      accountKind: user.accountKind,
      homeSiteId: user.homeSiteId,
    }));
  }

  async createUser(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.existsBy({ email }))
      throw new ConflictException('Пользователь с такой почтой уже существует');
    const siteIds = dto.siteAccesses.map((access) => access.siteId);
    if (!siteIds.length)
      throw new BadRequestException('Укажите хотя бы один сайт');
    if (new Set(siteIds).size !== siteIds.length)
      throw new BadRequestException('Один сайт нельзя назначить дважды');
    const ownerAccesses = dto.siteAccesses.filter(
      (access) => access.role === SiteRole.OWNER,
    );
    if (
      ownerAccesses.length > 0 &&
      (ownerAccesses.length !== 1 || dto.siteAccesses.length !== 1)
    )
      throw new BadRequestException(
        'Аккаунт владельца можно назначить только одному сайту',
      );
    const isSiteOwner = ownerAccesses.length === 1;
    const sites = await this.sites.find({
      where: { id: In(siteIds) },
      select: { id: true, workspaceId: true },
    });
    if (sites.length !== siteIds.length)
      throw new NotFoundException('Один из сайтов не найден');
    const sitesByWorkspace = new Map<string, string[]>();
    for (const site of sites) {
      const assigned = sitesByWorkspace.get(site.workspaceId) ?? [];
      assigned.push(site.id);
      sitesByWorkspace.set(site.workspaceId, assigned);
    }

    const passwordHash = await hash(dto.password, 12);
    return this.users.manager.transaction(async (manager) => {
      const user = await manager.save(
        UserEntity,
        manager.create(UserEntity, {
          email,
          fullName: dto.fullName.trim(),
          passwordHash,
          platformRole: PlatformRole.EMPLOYEE,
          accountKind: isSiteOwner ? 'site' : 'wispo',
          homeSiteId: isSiteOwner ? siteIds[0] : null,
          isActive: true,
        }),
      );
      await manager.save(
        SiteAccessEntity,
        dto.siteAccesses.map((access) =>
          manager.create(SiteAccessEntity, {
            userId: user.id,
            siteId: access.siteId,
            role: access.role,
            requiresApproval:
              access.role === SiteRole.OWNER
                ? false
                : (access.requiresApproval ?? false),
          }),
        ),
      );
      await manager.save(
        WorkspaceMembershipEntity,
        [...sitesByWorkspace.entries()].map(([workspaceId, assignedSiteIds]) =>
          manager.create(WorkspaceMembershipEntity, {
            userId: user.id,
            workspaceId,
            role: WorkspaceRole.EMPLOYEE,
            siteIds: assignedSiteIds,
          }),
        ),
      );
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        platformRole: user.platformRole,
        accountKind: user.accountKind,
        homeSiteId: user.homeSiteId,
      };
    });
  }

  async updateUserSiteAccesses(
    userId: string,
    assignments: SiteAccessAssignmentDto[],
  ) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Администратор Wispo уже имеет доступ ко всем сайтам',
      );
    const siteIds = assignments.map((access) => access.siteId);
    if (new Set(siteIds).size !== siteIds.length)
      throw new BadRequestException('Один сайт нельзя назначить дважды');
    const ownerAccesses = assignments.filter(
      (access) => access.role === SiteRole.OWNER,
    );
    if (
      ownerAccesses.length > 0 &&
      (ownerAccesses.length !== 1 || assignments.length !== 1)
    )
      throw new BadRequestException(
        'Аккаунт владельца можно назначить только одному сайту',
      );
    const sites = siteIds.length
      ? await this.sites.find({
          where: { id: In(siteIds) },
          select: { id: true, workspaceId: true },
        })
      : [];
    if (sites.length !== siteIds.length)
      throw new NotFoundException('Один из сайтов не найден');
    const sitesByWorkspace = new Map<string, string[]>();
    for (const site of sites) {
      const assigned = sitesByWorkspace.get(site.workspaceId) ?? [];
      assigned.push(site.id);
      sitesByWorkspace.set(site.workspaceId, assigned);
    }

    const isSiteOwner = ownerAccesses.length === 1;
    user.accountKind = isSiteOwner ? 'site' : 'wispo';
    user.homeSiteId = isSiteOwner ? siteIds[0] : null;
    return this.users.manager.transaction(async (manager) => {
      await manager.delete(SiteAccessEntity, { userId });
      await manager.delete(WorkspaceMembershipEntity, { userId });
      if (assignments.length)
        await manager.save(
          SiteAccessEntity,
          assignments.map((access) =>
            manager.create(SiteAccessEntity, {
              userId,
              siteId: access.siteId,
              role: access.role,
              requiresApproval:
                access.role === SiteRole.OWNER
                  ? false
                  : (access.requiresApproval ?? false),
            }),
          ),
        );
      if (sitesByWorkspace.size)
        await manager.save(
          WorkspaceMembershipEntity,
          [...sitesByWorkspace.entries()].map(
            ([workspaceId, assignedSiteIds]) =>
              manager.create(WorkspaceMembershipEntity, {
                userId,
                workspaceId,
                role: WorkspaceRole.EMPLOYEE,
                siteIds: assignedSiteIds,
              }),
          ),
        );
      await manager.save(UserEntity, user);
      return { userId, siteAccesses: assignments };
    });
  }

  async updateUserStatus(
    userId: string,
    actorUserId: string,
    dto: UpdateUserStatusDto,
  ) {
    if (!dto.isActive && userId === actorUserId)
      throw new BadRequestException('Нельзя отключить собственный аккаунт');
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (!dto.isActive && user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Администратора Wispo нельзя отключить через этот экран',
      );
    user.isActive = dto.isActive;
    await this.users.save(user);
    return {
      id: user.id,
      isActive: user.isActive,
    };
  }

  async resetUserPassword(
    userId: string,
    actorUserId: string,
    dto: ResetUserPasswordDto,
  ) {
    if (userId === actorUserId)
      throw new BadRequestException(
        'Собственный пароль нужно менять через меню профиля',
      );
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Пароль администратора Wispo нельзя сбросить через этот экран',
      );
    user.passwordHash = await hash(dto.password, 12);
    await this.users.save(user);
    return { id: user.id, ok: true };
  }
}
