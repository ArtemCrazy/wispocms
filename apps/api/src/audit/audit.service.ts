import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  AuditLogEntity,
  PlatformRole,
  SiteAccessEntity,
  SiteEntity,
  UserEntity,
} from '../database/entities';
import {
  accessCoversSite,
  hasSitePermission,
  SitePermission,
} from '../content/content.permissions';

const secretKey =
  /password|passphrase|token|secret|authorization|cookie|hash|api.?key|encrypted.?key/i;

export function sanitizeAuditChanges(value: unknown) {
  const redactedFields: string[] = [];

  function visit(current: unknown, path: string): unknown {
    if (Array.isArray(current))
      return current.map((item, index) => visit(item, `${path}[${index}]`));
    if (!current || typeof current !== 'object') return current;

    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .filter(([key]) => {
          if (!secretKey.test(key)) return true;
          redactedFields.push(path ? `${path}.${key}` : key);
          return false;
        })
        .map(([key, nested]) => [
          key,
          visit(nested, path ? `${path}.${key}` : key),
        ]),
    );
  }

  const submittedValues = visit(value, '') as Record<string, unknown>;
  return {
    ...(Object.keys(submittedValues ?? {}).length ? { submittedValues } : {}),
    ...(redactedFields.length ? { redactedFields } : {}),
  };
}

type MutationContext = {
  actorUserId: string;
  platformRole: PlatformRole;
  method: string;
  path: string;
  params: Record<string, string | undefined>;
  body: unknown;
};

export type TemplatePackageAuditReason =
  'site_type_mismatch' | 'template_assignment_mismatch' | 'runtime_unavailable';

export type SystemAuditEvent = {
  event:
    | 'template_package_registered'
    | 'template_package_preflight'
    | 'template_package_deployed';
  entityId: string;
  workspaceId?: string;
  siteId?: string;
  packageId: string;
  packageVersion: string;
  releaseDigest: string;
  status: 'registered' | 'ready' | 'mismatch';
  reasons: TemplatePackageAuditReason[];
};

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(SiteAccessEntity)
    private readonly siteAccesses: Repository<SiteAccessEntity>,
  ) {}

  async recordRequest(request: AuthenticatedRequest) {
    if (
      !request.auth ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    )
      return;

    await this.recordMutation({
      actorUserId: request.auth.userId,
      platformRole: request.auth.platformRole,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      params: request.params as Record<string, string | undefined>,
      body: request.body,
    });
  }

  async recordMutation(context: MutationContext) {
    const actor = await this.users.findOne({
      where: { id: context.actorUserId },
      select: { id: true, fullName: true },
    });
    if (!actor) return;

    const siteId = context.params.siteId ?? null;
    const site = siteId
      ? await this.sites.findOne({
          where: { id: siteId },
          select: { id: true, workspaceId: true, name: true },
        })
      : null;
    const workspaceId = context.params.workspaceId ?? site?.workspaceId ?? null;
    const { entityType, entityId, action, description } = describeMutation(
      context.method,
      context.path,
      context.params,
    );
    const changes = sanitizeAuditChanges(context.body);

    await this.auditLogs.save(
      this.auditLogs.create({
        actorUserId: actor.id,
        actorName: actor.fullName,
        workspaceId,
        siteId,
        entityType,
        entityId,
        action,
        description,
        changes: Object.keys(changes).length ? changes : null,
      }),
    );
  }

  async recordSystemEvent(event: SystemAuditEvent, manager?: EntityManager) {
    const descriptions: Record<SystemAuditEvent['event'], string> = {
      template_package_registered: 'Зарегистрирована версия frontend-пакета',
      template_package_preflight: 'Проверена совместимость frontend-пакета',
      template_package_deployed:
        'Зафиксирована развёрнутая версия frontend-пакета',
    };
    const changes = sanitizeAuditChanges({
      packageId: event.packageId,
      packageVersion: event.packageVersion,
      releaseDigest: event.releaseDigest,
      status: event.status,
      reasons: event.reasons,
    });
    const auditLogs = manager?.getRepository(AuditLogEntity) ?? this.auditLogs;
    await auditLogs.save(
      auditLogs.create({
        actorUserId: null,
        actorName: 'Release pipeline',
        workspaceId: event.workspaceId ?? null,
        siteId: event.siteId ?? null,
        entityType: 'template_package_version',
        entityId: event.entityId,
        action: event.event,
        description: descriptions[event.event],
        changes,
      }),
    );
  }

  listAll(workspaceId?: string, siteId?: string, limit = 100) {
    return this.auditLogs.find({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(siteId ? { siteId } : {}),
      },
      relations: { workspace: true, site: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 250),
    });
  }

  async listSite(
    siteId: string,
    actor: { userId: string; platformRole: PlatformRole },
    limit = 100,
  ) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN) {
      const access = await this.siteAccesses.findOne({
        where: { userId: actor.userId, siteId },
      });
      if (
        !accessCoversSite(access, siteId) ||
        !hasSitePermission(actor.platformRole, access, SitePermission.READ)
      )
        throw new ForbiddenException('Нет доступа к этому сайту');
    }
    return this.auditLogs.find({
      where: { siteId },
      relations: { workspace: true, site: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 250),
    });
  }
}

export function describeMutation(
  method: string,
  path: string,
  params: Record<string, string | undefined>,
) {
  const parts = path.split('/').filter(Boolean);
  const entityNames: Record<string, string> = {
    articles: 'article',
    categories: 'category',
    authors: 'author',
    pages: 'page',
    banners: 'banner',
    media: 'media',
    workspaces: 'workspace',
    sites: 'site',
    users: 'user',
  };
  const entityId =
    params.articleId ??
    params.categoryId ??
    params.authorId ??
    params.pageId ??
    params.bannerId ??
    params.mediaId ??
    params.userId ??
    params.siteId ??
    params.workspaceId ??
    null;
  const action = path.endsWith('/status')
    ? 'status_change'
    : path.endsWith('/comments')
      ? 'comment'
      : path.endsWith('/password')
        ? 'password_reset'
        : path.endsWith('/workspaces') && params.userId
          ? 'access_change'
          : method === 'POST'
            ? 'create'
            : method === 'DELETE'
              ? 'delete'
              : 'update';
  const knownEntity = [...parts]
    .reverse()
    .find((part) => Object.hasOwn(entityNames, part));
  const entityType =
    action === 'access_change'
      ? 'user'
      : knownEntity
        ? entityNames[knownEntity]
        : 'section';
  const labels: Record<string, string> = {
    article: 'материал',
    category: 'рубрика',
    author: 'автор',
    page: 'страница',
    banner: 'баннер',
    media: 'медиафайл',
    workspace: 'рабочее пространство',
    site: 'сайт',
    user: 'пользователь',
    section: 'раздел',
  };
  const actions: Record<string, string> = {
    create: 'создан',
    update: 'обновлён',
    delete: 'удалён',
    status_change: 'изменён статус',
    comment: 'добавлен комментарий',
    password_reset: 'сброшен временный пароль',
    access_change: 'изменены доступы пользователя',
  };
  return {
    entityType,
    entityId,
    action,
    description: `${actions[action]}: ${labels[entityType] ?? entityType}`,
  };
}
