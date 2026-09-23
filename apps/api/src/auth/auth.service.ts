import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { In, Repository } from 'typeorm';
import {
  PlatformRole,
  SiteEntity,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import { canAccessContentCenter } from '../content-center/workspace-access';
import {
  hasSitePermission,
  SitePermission,
} from '../content/content.permissions';

@Injectable()
export class AuthService {
  private readonly loginAttempts = new SlidingWindowRateLimiter(
    10 * 60 * 1000,
    5,
  );

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string, clientKey = 'unknown') {
    const normalizedEmail = email.trim().toLowerCase();
    const rateKey = `${clientKey}:${normalizedEmail}`;
    if (this.loginAttempts.isBlocked(rateKey))
      throw new HttpException(
        'Слишком много попыток входа. Попробуйте через 10 минут',
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const user = await this.users.findOne({
      where: { email: normalizedEmail, isActive: true },
    });
    if (!user || !(await compare(password, user.passwordHash))) {
      this.loginAttempts.record(rateKey);
      throw new UnauthorizedException('Неверная почта или пароль');
    }

    this.loginAttempts.clear(rateKey);

    const token = await this.jwtService.signAsync({
      sub: user.id,
      role: user.platformRole,
    });
    return { token, session: await this.getSession(user.id) };
  }

  async getSession(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    const isAdministrator = user.platformRole === PlatformRole.WISPO_ADMIN;
    const ownMemberships = await this.memberships.find({
      where: { userId },
      relations: { workspace: true },
    });
    const grantedMemberships = ownMemberships.filter(
      (membership) =>
        membership.siteIds?.length &&
        hasSitePermission(
          user.platformRole,
          membership.role,
          SitePermission.READ,
        ),
    );
    const workspaceRows = isAdministrator
      ? await this.workspaces.find({ order: { name: 'ASC' } })
      : grantedMemberships.map((row) => row.workspace);
    const allowedSiteIds = new Set(
      grantedMemberships.flatMap((membership) => membership.siteIds),
    );

    const workspaceIds = workspaceRows.map((workspace) => workspace.id);
    const projectMemberships = workspaceIds.length
      ? await this.memberships.find({
          where: { workspaceId: In(workspaceIds) },
          relations: { user: true },
          order: { createdAt: 'ASC' },
        })
      : [];
    const sites = workspaceIds.length
      ? await this.sites
          .createQueryBuilder('site')
          .leftJoinAndSelect('site.createdBy', 'createdBy')
          .leftJoinAndSelect(
            'site.linkedCommercialSite',
            'linkedCommercialSite',
          )
          .where('site.workspace_id IN (:...workspaceIds)', { workspaceIds })
          .orderBy('site.name', 'ASC')
          .getMany()
      : [];

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        platformRole: isAdministrator
          ? PlatformRole.WISPO_ADMIN
          : PlatformRole.EMPLOYEE,
      },
      workspaces: workspaceRows.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        canUseContentCenter: canAccessContentCenter(
          user.platformRole,
          ownMemberships.find(
            (membership) => membership.workspaceId === workspace.id,
          ),
          sites
            .filter((site) => site.workspaceId === workspace.id)
            .map((site) => site.id),
        ),
        role:
          ownMemberships.find(
            (membership) => membership.workspaceId === workspace.id,
          )?.role ?? null,
        members: projectMemberships
          .filter(
            (membership) =>
              membership.workspaceId === workspace.id &&
              membership.user?.isActive &&
              (isAdministrator ||
                membership.siteIds?.some((siteId) =>
                  allowedSiteIds.has(siteId),
                )),
          )
          .map((membership) => ({
            id: membership.user.id,
            fullName: membership.user.fullName,
            email: membership.user.email,
            role: membership.role,
          })),
        sites: sites
          .filter(
            (site) =>
              site.workspaceId === workspace.id &&
              (isAdministrator || allowedSiteIds.has(site.id)),
          )
          .map((site) => ({
            id: site.id,
            name: site.name,
            slug: site.slug,
            domain: site.domain,
            domainStatus: site.domainStatus,
            domainCheckedAt: site.domainCheckedAt,
            domainStatusMessage: site.domainStatusMessage,
            siteType: site.siteType,
            linkedCommercialSiteId: site.linkedCommercialSiteId,
            linkedCommercialSite: site.linkedCommercialSite
              ? {
                  id: site.linkedCommercialSite.id,
                  name: site.linkedCommercialSite.name,
                  slug: site.linkedCommercialSite.slug,
                  domain: site.linkedCommercialSite.domain,
                }
              : null,
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
      })),
    };
  }

  async getActiveIdentity(userId: string) {
    return this.users.findOne({
      where: { id: userId, isActive: true },
      select: { id: true, platformRole: true },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.users.findOne({
      where: { id: userId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    if (!(await compare(currentPassword, user.passwordHash)))
      throw new BadRequestException('Текущий пароль указан неверно');
    if (await compare(newPassword, user.passwordHash))
      throw new BadRequestException(
        'Новый пароль должен отличаться от текущего',
      );

    user.passwordHash = await hash(newPassword, 12);
    await this.users.save(user);
    return { ok: true };
  }
}
