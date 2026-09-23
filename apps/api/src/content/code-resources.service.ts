import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { CmsRevisionResourceEntity } from '../database/entities';
import {
  CmsRevisionsService,
  type RevisionActor,
} from './cms-revisions.service';

export type CodeResourceKind = 'template' | 'chunk';
export type CodeParameterType = 'text' | 'image' | 'icon' | 'html';

export type CodeResourceParameter = {
  key: string;
  label: string;
  type: CodeParameterType;
};

export type SaveCodeResourceInput = {
  name: string;
  key: string;
  html: string;
  parameters?: CodeResourceParameter[];
  expectedDraftRevisionId?: string | null;
};

const forbiddenHtml = [
  /<\s*script\b/i,
  /<\s*style\b/i,
  /<\s*(?:iframe|object|embed|link|base|meta)\b/i,
  /\bon[a-z]+\s*=/i,
  /(?:href|src|action)\s*=\s*["']?\s*javascript\s*:/i,
];

export function validateCmsHtml(value: string) {
  if (typeof value !== 'string' || !value.trim())
    throw new BadRequestException('HTML-код не может быть пустым');
  if (value.length > 200000)
    throw new BadRequestException('HTML-код слишком большой');
  if (forbiddenHtml.some((pattern) => pattern.test(value)))
    throw new BadRequestException(
      'Разрешён только HTML без JavaScript, CSS и встраиваемых документов',
    );
  return value.trim();
}

function normalizeInput(
  id: string,
  kind: CodeResourceKind,
  input: SaveCodeResourceInput,
) {
  const name = input.name?.trim();
  const key = input.key?.trim().toLowerCase();
  if (!name || name.length > 160)
    throw new BadRequestException('Укажите название HTML-ресурса');
  if (!key || !/^[a-z][a-z0-9_-]*$/.test(key) || key.length > 100)
    throw new BadRequestException('Некорректный ключ HTML-ресурса');
  const parameters = (input.parameters ?? []).map((parameter) => {
    const parameterKey = parameter.key?.trim().toLowerCase();
    const label = parameter.label?.trim();
    if (
      !parameterKey ||
      !/^[a-z][a-z0-9_]*$/.test(parameterKey) ||
      !label ||
      !['text', 'image', 'icon', 'html'].includes(parameter.type)
    )
      throw new BadRequestException('Некорректный параметр чанка');
    return { key: parameterKey, label, type: parameter.type };
  });
  if (
    new Set(parameters.map((parameter) => parameter.key)).size !==
    parameters.length
  )
    throw new BadRequestException('Ключи параметров чанка не повторяются');
  return {
    id,
    kind,
    name,
    key,
    html: validateCmsHtml(input.html),
    parameters,
  };
}

@Injectable()
export class CodeResourcesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly revisions: CmsRevisionsService,
  ) {}

  private async ensureUniqueKey(
    siteId: string,
    kind: CodeResourceKind,
    key: string,
    actor: RevisionActor,
    exceptId?: string,
  ) {
    const rows = await this.list(siteId, kind, actor);
    if (
      rows.some(
        (row) =>
          row.id !== exceptId && (row as Record<string, unknown>).key === key,
      )
    )
      throw new ConflictException('Такой ключ уже используется');
  }

  async list(siteId: string, kind: CodeResourceKind, actor: RevisionActor) {
    const resources = await this.dataSource.manager.find(
      CmsRevisionResourceEntity,
      { where: { siteId, resourceType: kind } },
    );
    const rows = await Promise.all(
      resources.map(async (resource) => {
        const current = await this.revisions.current(
          siteId,
          kind,
          resource.entityId,
          actor,
        );
        if (!current?.draft) return null;
        return {
          ...current.draft.snapshot,
          id: resource.entityId,
          draftRevisionId: current.draft.id,
          draftVersionNumber: current.draft.versionNumber,
          approvedRevisionId: current.approvedRevisionId,
          publishedRevisionId: current.publishedRevisionId,
          reviewState: current.reviewState,
        };
      }),
    );
    return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
  }

  async create(
    siteId: string,
    kind: CodeResourceKind,
    actor: RevisionActor,
    input: SaveCodeResourceInput,
  ) {
    const id = randomUUID();
    const snapshot = normalizeInput(id, kind, input);
    await this.ensureUniqueKey(siteId, kind, snapshot.key, actor);
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: kind,
      entityId: id,
      snapshot,
      expectedDraftRevisionId: null,
      actor,
    });
    return {
      ...snapshot,
      draftRevisionId: next.id,
      draftVersionNumber: next.versionNumber,
      approvedRevisionId: null,
      publishedRevisionId: null,
      reviewState: 'draft',
    };
  }

  async update(
    siteId: string,
    kind: CodeResourceKind,
    id: string,
    actor: RevisionActor,
    input: SaveCodeResourceInput,
  ) {
    const current = await this.revisions.current(siteId, kind, id, actor);
    if (!current?.draft) throw new NotFoundException('HTML-ресурс не найден');
    if (input.expectedDraftRevisionId !== current.draft.id)
      throw new ConflictException('Черновик уже изменён');
    const snapshot = normalizeInput(id, kind, input);
    await this.ensureUniqueKey(siteId, kind, snapshot.key, actor, id);
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType: kind,
      entityId: id,
      snapshot,
      expectedDraftRevisionId: current.draft.id,
      actor,
    });
    return {
      ...snapshot,
      draftRevisionId: next.id,
      draftVersionNumber: next.versionNumber,
      approvedRevisionId: null,
      publishedRevisionId: current.publishedRevisionId,
      reviewState: 'draft',
    };
  }

  published(
    siteId: string,
    kind: CodeResourceKind,
    id: string,
    actor: RevisionActor,
  ) {
    return this.revisions.published(siteId, kind, id, actor);
  }
}
