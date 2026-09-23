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
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  WorkspaceRole,
} from '../database/entities';
import { normalizeHostnameInput } from './site-domain';
import {
  CreateSiteDto,
  CreateSiteUserDto,
  CreateUserDto,
  CreateWorkspaceDto,
  ResetUserPasswordDto,
  UpdateSiteDto,
  UpdateUserStatusDto,
  UpdateUserProfileDto,
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

  async setWorkspaceMember(workspaceId: string, userId: string) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.accountKind && user.accountKind !== 'legacy')
      throw new BadRequestException(
        'Назначайте этому пользователю конкретные сайты',
      );
    if (!(await this.workspaces.existsBy({ id: workspaceId })))
      throw new NotFoundException('Рабочее пространство не найдено');
    if (user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Администратор Wispo уже имеет доступ ко всем проектам',
      );
    const membership =
      (await this.memberships.findOne({ where: { workspaceId, userId } })) ??
      this.memberships.create({
        workspaceId,
        userId,
        role: WorkspaceRole.EMPLOYEE,
      });
    membership.role = WorkspaceRole.EMPLOYEE;
    const savedMembership = await this.memberships.save(membership);
    return {
      id: savedMembership.id,
      workspaceId,
      userId,
      role: savedMembership.role,
    };
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    const membership = await this.memberships.findOne({
      where: { workspaceId, userId },
    });
    if (!membership)
      throw new NotFoundException('Назначение пользователя не найдено');
    await this.memberships.remove(membership);
    return { ok: true };
  }

  async listUsers() {
    const users = await this.users.find({
      relations: { memberships: { workspace: true } },
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
      accountKind: user.accountKind,
      homeSiteId: user.homeSiteId,
    }));
  }

  async createUser(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.existsBy({ email }))
      throw new ConflictException('Пользователь с такой почтой уже существует');
    const siteIds = [...new Set(dto.siteIds)];
    const siteAccounts = [
      WorkspaceRole.SITE_OWNER,
      WorkspaceRole.SITE_CONTENT_MANAGER,
      WorkspaceRole.SITE_DEVELOPER,
    ];
    const wispoAccounts = [
      WorkspaceRole.WISPO_MANAGER,
      WorkspaceRole.WISPO_DEVELOPER,
    ];
    if (!siteAccounts.includes(dto.role) && !wispoAccounts.includes(dto.role))
      throw new BadRequestException('Недопустимая роль пользователя');
    const isSiteAccount = siteAccounts.includes(dto.role);
    if (isSiteAccount && siteIds.length !== 1)
      throw new BadRequestException(
        'Пользователь сайта может работать только с одним сайтом',
      );
    if (!siteIds.length)
      throw new BadRequestException('Укажите хотя бы один сайт');
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

    const user = await this.users.save(
      this.users.create({
        email,
        fullName: dto.fullName.trim(),
        passwordHash: await hash(dto.password, 12),
        platformRole: PlatformRole.EMPLOYEE,
        accountKind: isSiteAccount ? 'site' : 'wispo',
        homeSiteId: isSiteAccount ? siteIds[0] : null,
        isActive: true,
      }),
    );
    await this.memberships.save(
      [...sitesByWorkspace.entries()].map(([workspaceId, assignedSiteIds]) =>
        this.memberships.create({
          userId: user.id,
          workspaceId,
          role: dto.role,
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
  }

  async createSiteUser(
    siteId: string,
    actor: { userId: string; platformRole: PlatformRole },
    dto: CreateSiteUserDto,
  ) {
    if (
      dto.role !== WorkspaceRole.SITE_CONTENT_MANAGER &&
      dto.role !== WorkspaceRole.SITE_DEVELOPER
    )
      throw new BadRequestException(
        'Владелец может создать только менеджера контента или разработчика',
      );
    await this.assertSiteOwner(siteId, actor);
    return this.createUser({ ...dto, siteIds: [siteId] });
  }

  private async assertSiteOwner(
    siteId: string,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const site = (
      await this.sites.find({
        where: { id: In([siteId]) },
        select: { id: true, workspaceId: true },
      })
    )[0];
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN) {
      const membership = await this.memberships.findOne({
        where: { userId: actor.userId, workspaceId: site.workspaceId },
        select: { role: true, siteIds: true },
      });
      if (
        membership?.role !== WorkspaceRole.SITE_OWNER ||
        !membership.siteIds?.includes(siteId)
      )
        throw new ForbiddenException(
          'Недостаточно прав для управления пользователями сайта',
        );
    }
    return site;
  }

  async listSiteUsers(
    siteId: string,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    await this.assertSiteOwner(siteId, actor);
    const users = await this.users.find({
      where: { accountKind: 'site', homeSiteId: siteId },
      relations: { memberships: true },
      order: { fullName: 'ASC' },
    });
    return users.flatMap((user) => {
      const role = user.memberships.find((membership) =>
        membership.siteIds?.includes(siteId),
      )?.role;
      if (
        role !== WorkspaceRole.SITE_CONTENT_MANAGER &&
        role !== WorkspaceRole.SITE_DEVELOPER
      )
        return [];
      return [
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          isActive: user.isActive,
          role,
        },
      ];
    });
  }

  private async assertManageableSiteUser(
    siteId: string,
    userId: string,
    actor: { userId: string; platformRole: PlatformRole },
  ) {
    const site = await this.assertSiteOwner(siteId, actor);
    const user = await this.users.findOneBy({ id: userId });
    if (!user || user.accountKind !== 'site' || user.homeSiteId !== siteId)
      throw new ForbiddenException('Пользователь не принадлежит этому сайту');
    const membership = await this.memberships.findOne({
      where: { userId, workspaceId: site.workspaceId },
    });
    if (
      !membership?.siteIds?.includes(siteId) ||
      (membership.role !== WorkspaceRole.SITE_CONTENT_MANAGER &&
        membership.role !== WorkspaceRole.SITE_DEVELOPER)
    )
      throw new ForbiddenException('Этого пользователя нельзя изменить');
  }

  async updateSiteUserStatus(
    siteId: string,
    userId: string,
    actor: { userId: string; platformRole: PlatformRole },
    dto: UpdateUserStatusDto,
  ) {
    await this.assertManageableSiteUser(siteId, userId, actor);
    return this.updateUserStatus(userId, actor.userId, dto);
  }

  async updateSiteUserProfile(
    siteId: string,
    userId: string,
    actor: { userId: string; platformRole: PlatformRole },
    dto: UpdateUserProfileDto,
  ) {
    await this.assertManageableSiteUser(siteId, userId, actor);
    return this.updateUserProfile(userId, dto);
  }

  async resetSiteUserPassword(
    siteId: string,
    userId: string,
    actor: { userId: string; platformRole: PlatformRole },
    dto: ResetUserPasswordDto,
  ) {
    await this.assertManageableSiteUser(siteId, userId, actor);
    return this.resetUserPassword(userId, actor.userId, dto);
  }

  async updateUserWorkspaces(userId: string, workspaceIds: string[]) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.accountKind && user.accountKind !== 'legacy')
      throw new BadRequestException(
        'Для этого аккаунта назначайте конкретные сайты, а не пространства',
      );
    if (user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Администратор Wispo уже имеет доступ ко всем проектам',
      );

    const uniqueWorkspaceIds = [...new Set(workspaceIds)];
    const workspaceChecks = await Promise.all(
      uniqueWorkspaceIds.map((id) => this.workspaces.existsBy({ id })),
    );
    if (workspaceChecks.some((exists) => !exists))
      throw new NotFoundException('Одно из рабочих пространств не найдено');

    await this.memberships.manager.transaction(async (manager) => {
      await manager.delete(WorkspaceMembershipEntity, { userId });
      if (uniqueWorkspaceIds.length)
        await manager.save(
          WorkspaceMembershipEntity,
          uniqueWorkspaceIds.map((workspaceId) =>
            manager.create(WorkspaceMembershipEntity, {
              userId,
              workspaceId,
              role: WorkspaceRole.EMPLOYEE,
            }),
          ),
        );
      if (user.platformRole !== PlatformRole.EMPLOYEE)
        await manager.update(UserEntity, userId, {
          platformRole: PlatformRole.EMPLOYEE,
        });
    });

    return { userId, workspaceIds: uniqueWorkspaceIds };
  }

  async updateUserSites(userId: string, siteIds: string[]) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (
      user.accountKind !== 'wispo' ||
      user.platformRole === PlatformRole.WISPO_ADMIN
    )
      throw new BadRequestException(
        'Менять список сайтов можно только сотруднику Wispo',
      );
    const membership = await this.memberships.findOne({ where: { userId } });
    if (
      membership?.role !== WorkspaceRole.WISPO_MANAGER &&
      membership?.role !== WorkspaceRole.WISPO_DEVELOPER
    )
      throw new BadRequestException(
        'У аккаунта нет допустимой роли сотрудника Wispo',
      );
    const uniqueSiteIds = [...new Set(siteIds)];
    const sites = uniqueSiteIds.length
      ? await this.sites.find({
          where: { id: In(uniqueSiteIds) },
          select: { id: true, workspaceId: true },
        })
      : [];
    if (sites.length !== uniqueSiteIds.length)
      throw new NotFoundException('Один из сайтов не найден');
    const sitesByWorkspace = new Map<string, string[]>();
    for (const site of sites) {
      const assigned = sitesByWorkspace.get(site.workspaceId) ?? [];
      assigned.push(site.id);
      sitesByWorkspace.set(site.workspaceId, assigned);
    }
    await this.memberships.manager.transaction(async (manager) => {
      await manager.delete(WorkspaceMembershipEntity, { userId });
      if (sitesByWorkspace.size)
        await manager.save(
          WorkspaceMembershipEntity,
          [...sitesByWorkspace.entries()].map(
            ([workspaceId, assignedSiteIds]) =>
              manager.create(WorkspaceMembershipEntity, {
                userId,
                workspaceId,
                role: membership.role,
                siteIds: assignedSiteIds,
              }),
          ),
        );
    });
    return { userId, siteIds: uniqueSiteIds };
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
