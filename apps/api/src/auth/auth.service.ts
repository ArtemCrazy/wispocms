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
  SiteAccessEntity,
  SiteEntity,
  UserEntity,
  WorkspaceEntity,
} from '../database/entities';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';

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
    @InjectRepository(SiteAccessEntity)
    private readonly siteAccesses: Repository<SiteAccessEntity>,
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
      sessionVersion: user.sessionVersion ?? 0,
    });
    return { token, session: await this.getSession(user.id) };
  }

  async getSession(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');

    const isAdministrator = user.platformRole === PlatformRole.WISPO_ADMIN;
    const ownAccesses = await this.siteAccesses.find({
      where: { userId },
      relations: { site: { workspace: true } },
    });
    const workspaceRows = isAdministrator
      ? await this.workspaces.find({ order: { name: 'ASC' } })
      : Array.from(
          new Map(
            ownAccesses.map((access) => [
              access.site.workspace.id,
              access.site.workspace,
            ]),
          ).values(),
        );
    const allowedSiteIds = new Set(ownAccesses.map((access) => access.siteId));

    const workspaceIds = workspaceRows.map((workspace) => workspace.id);
    const projectAccesses = workspaceIds.length
      ? await this.siteAccesses.find({
          where: { site: { workspaceId: In(workspaceIds) } },
          relations: { user: true, site: true },
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
        canUseContentCenter:
          isAdministrator ||
          sites
            .filter((site) => site.workspaceId === workspace.id)
            .every((site) => allowedSiteIds.has(site.id)),
        members: Array.from(
          new Map(
            projectAccesses
              .filter(
                (access) =>
                  access.site.workspaceId === workspace.id &&
                  access.user?.isActive &&
                  (isAdministrator || allowedSiteIds.has(access.siteId)),
              )
              .map((access) => [access.user.id, access]),
          ).values(),
        ).map((access) => ({
          id: access.user.id,
          fullName: access.user.fullName,
          email: access.user.email,
          role: access.role,
        })),
        sites: sites
          .filter(
            (site) =>
              site.workspaceId === workspace.id &&
              (isAdministrator || allowedSiteIds.has(site.id)),
          )
          .map((site) => {
            const access = ownAccesses.find(
              (assignment) => assignment.siteId === site.id,
            );
            return {
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
              access: isAdministrator
                ? null
                : {
                    role: access!.role,
                    canEditCode: access!.canEditCode,
                    requiresApproval: access!.requiresApproval,
                  },
            };
          }),
      })),
    };
  }

  async getActiveIdentity(userId: string) {
    return this.users.findOne({
      where: { id: userId, isActive: true },
      select: { id: true, platformRole: true, sessionVersion: true },
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
    if (user.platformRole === PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Администратор Wispo меняет пароль только после подтверждения по email',
      );
    if (!(await compare(currentPassword, user.passwordHash)))
      throw new BadRequestException('Текущий пароль указан неверно');
    if (await compare(newPassword, user.passwordHash))
      throw new BadRequestException(
        'Новый пароль должен отличаться от текущего',
      );

    user.passwordHash = await hash(newPassword, 12);
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await this.users.save(user);
    return { ok: true };
  }
}
