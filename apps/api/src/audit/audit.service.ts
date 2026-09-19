import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import {
  AuditLogEntity,
  PlatformRole,
  SiteEntity,
  UserEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';

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

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
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
      const membership = await this.memberships.findOne({
        where: { userId: actor.userId, workspaceId: site.workspaceId },
        select: { id: true },
      });
      if (!membership)
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
