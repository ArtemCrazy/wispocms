import Ajv from 'ajv';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import {
  CmsRevisionEntity,
  CmsRevisionEventEntity,
  CmsRevisionResourceEntity,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  MediaEntity,
  SiteEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  CmsRevisionsService,
  type RevisionActor,
} from '../content/cms-revisions.service';
import { SitePermission } from '../content/content.permissions';
import { ManagedChunkPersistenceRepository } from './managed-chunk-persistence.repository';
import { canonicalManagedChunkContract } from './managed-chunk-schema';
import type {
  ManagedChunkCategory,
  ManagedChunkDefinition,
  ManagedChunkField,
} from './managed-chunk.types';
import { assertValidManagedChunkManifestV2 } from './managed-chunk-validation';

const SUPPORTED_WIDGETS = new Set([
  'text',
  'textarea',
  'image',
  'number',
  'boolean',
]);

export type ChunkCatalog = {
  categories: Array<{
    key: string;
    title: string;
    order: number;
    iconKey: string;
    definitions: Array<{
      contractId: string;
      key: string;
      schemaVersion: string;
      title: string;
      fields: ManagedChunkField[];
    }>;
  }>;
};

export type ChunkInstanceSummary = {
  id: string;
  displayName: string;
  categoryKey: string;
  definitionKey: string;
  schemaVersion: string;
  reviewState: CmsRevisionResourceEntity['reviewState'];
  updatedAt: string;
};

export type ChunkInstanceDetail = ChunkInstanceSummary & {
  fields: ManagedChunkField[];
  published: {
    id: string;
    versionNumber: number;
    data: Record<string, unknown>;
  } | null;
  draft: {
    id: string;
    versionNumber: number;
    data: Record<string, unknown>;
  } | null;
  allowedActions: string[];
};

type ResolvedContract = {
  contract: ManagedChunkContractEntity;
  definition: ManagedChunkDefinition;
  category: ManagedChunkCategory;
};

type InstanceContext = {
  instance: ManagedChunkInstanceEntity;
  resource: CmsRevisionResourceEntity;
  contract: ResolvedContract;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

@Injectable()
export class ManagedChunkContentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly persistence: ManagedChunkPersistenceRepository,
    private readonly revisions: CmsRevisionsService,
  ) {}

  private async authorizeRead(
    siteId: string,
    actor: RevisionActor,
  ): Promise<void> {
    await this.revisions.assertSitePermission(
      siteId,
      actor,
      SitePermission.READ,
    );
  }

  private corrupt(): never {
    throw new ConflictException('Каталог управляемого контента недоступен');
  }

  private notFound(): never {
    throw new NotFoundException('Экземпляр чанка не найден');
  }

  private async site(
    manager: EntityManager,
    siteId: string,
  ): Promise<SiteEntity> {
    const site = await manager.findOne(SiteEntity, { where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (!site.templatePackageId) this.corrupt();
    return site;
  }

  private async resolveContract(
    manager: EntityManager,
    site: SiteEntity,
    contractId: string,
  ): Promise<ResolvedContract> {
    const contract = await manager.findOne(ManagedChunkContractEntity, {
      where: { id: contractId },
    });
    if (!contract || contract.templatePackageId !== site.templatePackageId)
      this.corrupt();
    const version = await manager.findOne(TemplatePackageVersionEntity, {
      where: {
        id: contract.firstSeenTemplatePackageVersionId,
        templatePackageId: contract.templatePackageId,
        manifestVersion: 2,
      },
    });
    if (!version) this.corrupt();
    let validated;
    try {
      validated = assertValidManagedChunkManifestV2(version.manifest);
    } catch {
      this.corrupt();
    }
    const definitions = validated.definitions.filter(
      (definition) =>
        definition.key === contract.definitionKey &&
        definition.schemaVersion === contract.schemaVersion,
    );
    if (definitions.length !== 1) this.corrupt();
    const definition = definitions[0];
    if (
      definition.contractDigest !== contract.contractDigest ||
      canonicalJson(
        JSON.parse(canonicalManagedChunkContract(definition.fields)) as Record<
          string,
          unknown
        >,
      ) !== canonicalJson(contract.fieldContract) ||
      canonicalJson(definition.dataSchema) !==
        canonicalJson(contract.dataSchema) ||
      definition.fields.some((field) => !SUPPORTED_WIDGETS.has(field.widget))
    )
      this.corrupt();
    const categories = validated.manifest.chunkCategories.filter(
      (category) => category.key === definition.categoryKey,
    );
    if (categories.length !== 1) this.corrupt();
    return {
      contract,
      definition: structuredClone(definition),
      category: structuredClone(categories[0]),
    };
  }

  private async referencedContracts(
    manager: EntityManager,
    siteId: string,
    site: SiteEntity,
  ): Promise<ResolvedContract[]> {
    const instances = await manager.find(ManagedChunkInstanceEntity, {
      where: { siteId, isArchived: false },
    });
    const ids = new Set<string>();
    for (const instance of instances) {
      const resource = await manager.findOne(CmsRevisionResourceEntity, {
        where: {
          id: instance.revisionResourceId,
          siteId,
          resourceType: 'chunk_instance',
          entityId: instance.id,
        },
      });
      if (!resource) this.corrupt();
      for (const revisionId of new Set(
        [resource.draftRevisionId, resource.publishedRevisionId].filter(
          (value): value is string => Boolean(value),
        ),
      )) {
        const link = await manager.findOne(ManagedChunkInstanceRevisionEntity, {
          where: {
            revisionId,
            revisionResourceId: resource.id,
            siteId,
            instanceId: instance.id,
          },
        });
        if (!link) this.corrupt();
        ids.add(link.contractId);
      }
    }
    const resolved: ResolvedContract[] = [];
    for (const id of [...ids].sort())
      resolved.push(await this.resolveContract(manager, site, id));
    return resolved;
  }

  async catalog(siteId: string, actor: RevisionActor): Promise<ChunkCatalog> {
    await this.authorizeRead(siteId, actor);
    const manager = this.dataSource.manager;
    const site = await this.site(manager, siteId);
    const contracts = await this.referencedContracts(manager, siteId, site);
    const categories = new Map<string, ChunkCatalog['categories'][number]>();
    const categoryPresentations = new Map<string, string>();
    for (const { contract, definition, category } of contracts) {
      const presentation = canonicalJson({
        title: category.title,
        order: category.order,
        iconKey: category.iconKey ?? null,
      });
      const knownPresentation = categoryPresentations.get(category.key);
      if (
        knownPresentation !== undefined &&
        knownPresentation !== presentation
      ) {
        this.corrupt();
      }
      categoryPresentations.set(category.key, presentation);
      let output = categories.get(category.key);
      if (!output) {
        output = {
          key: category.key,
          title: category.title,
          order: category.order,
          iconKey: category.iconKey ?? 'content',
          definitions: [],
        };
        categories.set(category.key, output);
      }
      output.definitions.push({
        contractId: contract.id,
        key: definition.key,
        schemaVersion: definition.schemaVersion,
        title: definition.title,
        fields: structuredClone(definition.fields),
      });
    }
    const result = [...categories.values()].sort(
      (left, right) =>
        left.order - right.order || left.key.localeCompare(right.key),
    );
    result.forEach((category) =>
      category.definitions.sort(
        (left, right) =>
          left.title.localeCompare(right.title) ||
          left.key.localeCompare(right.key),
      ),
    );
    return { categories: structuredClone(result) };
  }

  private async instanceContext(
    manager: EntityManager,
    siteId: string,
    instanceId: string,
  ): Promise<InstanceContext> {
    const site = await this.site(manager, siteId);
    const instance = await manager.findOne(ManagedChunkInstanceEntity, {
      where: { id: instanceId, siteId, isArchived: false },
    });
    if (!instance) this.notFound();
    const resource = await manager.findOne(CmsRevisionResourceEntity, {
      where: {
        id: instance.revisionResourceId,
        siteId,
        resourceType: 'chunk_instance',
        entityId: instanceId,
      },
    });
    if (!resource) this.notFound();
    const currentRevisionId =
      resource.draftRevisionId ?? resource.publishedRevisionId;
    if (!currentRevisionId) this.corrupt();
    const link = await manager.findOne(ManagedChunkInstanceRevisionEntity, {
      where: {
        revisionId: currentRevisionId,
        revisionResourceId: resource.id,
        siteId,
        instanceId,
      },
    });
    if (!link) this.corrupt();
    return {
      instance,
      resource,
      contract: await this.resolveContract(manager, site, link.contractId),
    };
  }

  private async revisionData(
    manager: EntityManager,
    resource: CmsRevisionResourceEntity,
    revisionId: string | null,
  ) {
    if (!revisionId) return null;
    const revision = await manager.findOne(CmsRevisionEntity, {
      where: { id: revisionId, resourceId: resource.id },
    });
    if (!revision) this.corrupt();
    const data = revision.snapshot?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data))
      this.corrupt();
    return {
      id: revision.id,
      versionNumber: revision.versionNumber,
      data: structuredClone(data as Record<string, unknown>),
    };
  }

  private snapshotData(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const data = snapshot.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Данные чанка не соответствуют контракту');
    }
    return structuredClone(data as Record<string, unknown>);
  }

  private async readModelUpdatedAt(
    manager: EntityManager,
    instance: ManagedChunkInstanceEntity,
    resource: CmsRevisionResourceEntity,
  ): Promise<string> {
    const timestamps = [instance.updatedAt];
    const revisionIds = new Set(
      [
        resource.draftRevisionId,
        resource.approvedRevisionId,
        resource.publishedRevisionId,
      ].filter((value): value is string => Boolean(value)),
    );
    for (const revisionId of revisionIds) {
      const revision = await manager.findOne(CmsRevisionEntity, {
        where: { id: revisionId, resourceId: resource.id },
      });
      if (revision?.createdAt) timestamps.push(revision.createdAt);
    }
    const events = await manager.find(CmsRevisionEventEntity, {
      where: { resourceId: resource.id },
    });
    for (const event of events) {
      if (event.createdAt) timestamps.push(event.createdAt);
    }
    return new Date(
      Math.max(...timestamps.map((timestamp) => timestamp.getTime())),
    ).toISOString();
  }

  private async can(
    siteId: string,
    actor: RevisionActor,
    permission: SitePermission,
  ): Promise<boolean> {
    try {
      await this.revisions.assertSitePermission(siteId, actor, permission);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async actions(
    siteId: string,
    actor: RevisionActor,
    resource: CmsRevisionResourceEntity,
  ): Promise<string[]> {
    const [edit, approve, publish] = await Promise.all([
      this.can(siteId, actor, SitePermission.EDIT_CONTENT),
      this.can(siteId, actor, SitePermission.APPROVE),
      this.can(siteId, actor, SitePermission.PUBLISH_CONTENT),
    ]);
    const actions: string[] = [];
    if (edit) actions.push('save');
    if (
      edit &&
      resource.draftRevisionId &&
      ['draft', 'changes_requested'].includes(resource.reviewState)
    )
      actions.push('submit');
    if (
      approve &&
      resource.draftRevisionId &&
      resource.reviewState === 'in_review'
    )
      actions.push('approve', 'request_changes');
    const publishCandidateRevisionId =
      resource.reviewState === 'approved'
        ? resource.approvedRevisionId
        : resource.draftRevisionId;
    if (
      publish &&
      resource.draftRevisionId &&
      publishCandidateRevisionId !== resource.publishedRevisionId &&
      (resource.reviewState === 'approved' || resource.reviewState === 'draft')
    )
      actions.push('publish');
    if (edit && resource.publishedRevisionId) actions.push('restore');
    return actions;
  }

  private async detailFromContext(
    manager: EntityManager,
    siteId: string,
    actor: RevisionActor,
    context: InstanceContext,
  ): Promise<ChunkInstanceDetail> {
    const { instance, resource, contract } = context;
    return {
      id: instance.id,
      displayName: instance.displayName,
      categoryKey: contract.definition.categoryKey,
      definitionKey: contract.definition.key,
      schemaVersion: contract.definition.schemaVersion,
      fields: structuredClone(contract.definition.fields),
      reviewState: resource.reviewState,
      published: await this.revisionData(
        manager,
        resource,
        resource.publishedRevisionId,
      ),
      draft: await this.revisionData(
        manager,
        resource,
        resource.draftRevisionId,
      ),
      allowedActions: await this.actions(siteId, actor, resource),
      updatedAt: await this.readModelUpdatedAt(manager, instance, resource),
    };
  }

  async list(
    siteId: string,
    actor: RevisionActor,
    categoryKey?: string,
  ): Promise<ChunkInstanceSummary[]> {
    await this.authorizeRead(siteId, actor);
    const manager = this.dataSource.manager;
    if (categoryKey) {
      const site = await this.site(manager, siteId);
      const contracts = await this.referencedContracts(manager, siteId, site);
      if (
        !contracts.some(
          (contract) => contract.definition.categoryKey === categoryKey,
        )
      ) {
        throw new BadRequestException('Неизвестная категория чанков');
      }
    }
    const instances = await manager.find(ManagedChunkInstanceEntity, {
      where: { siteId, isArchived: false },
    });
    const result: ChunkInstanceSummary[] = [];
    for (const instance of instances) {
      const context = await this.instanceContext(manager, siteId, instance.id);
      if (
        categoryKey &&
        context.contract.definition.categoryKey !== categoryKey
      )
        continue;
      result.push({
        id: instance.id,
        displayName: instance.displayName,
        categoryKey: context.contract.definition.categoryKey,
        definitionKey: context.contract.definition.key,
        schemaVersion: context.contract.definition.schemaVersion,
        reviewState: context.resource.reviewState,
        updatedAt: await this.readModelUpdatedAt(
          manager,
          instance,
          context.resource,
        ),
      });
    }
    return structuredClone(result);
  }

  async get(
    siteId: string,
    instanceId: string,
    actor: RevisionActor,
  ): Promise<ChunkInstanceDetail> {
    await this.authorizeRead(siteId, actor);
    const manager = this.dataSource.manager;
    return this.detailFromContext(
      manager,
      siteId,
      actor,
      await this.instanceContext(manager, siteId, instanceId),
    );
  }

  private async validateData(
    manager: EntityManager,
    siteId: string,
    resolved: ResolvedContract,
    data: Record<string, unknown>,
    lockMedia = false,
  ): Promise<void> {
    try {
      const validate = new Ajv({ allErrors: true, strict: true }).compile(
        resolved.contract.dataSchema,
      );
      if (!validate(data)) throw new Error('schema');
    } catch {
      throw new BadRequestException('Данные чанка не соответствуют контракту');
    }
    for (const field of resolved.definition.fields) {
      if (field.widget !== 'image') continue;
      const value = data[field.key];
      if (value === null || value === undefined) continue;
      const mediaId = (value as Record<string, unknown>).mediaId;
      if (typeof mediaId !== 'string' || !isUUID(mediaId)) {
        throw new BadRequestException('Изображение недоступно для этого сайта');
      }
      const media = await manager.findOne(MediaEntity, {
        where: { id: mediaId, siteId },
        ...(lockMedia ? { lock: { mode: 'pessimistic_read' as const } } : {}),
      });
      if (!media || !media.mimeType.startsWith('image/')) {
        throw new BadRequestException('Изображение недоступно для этого сайта');
      }
    }
  }

  private async catalogContract(
    siteId: string,
    actor: RevisionActor,
    contractId: string,
  ): Promise<ResolvedContract> {
    await this.authorizeRead(siteId, actor);
    const manager = this.dataSource.manager;
    const site = await this.site(manager, siteId);
    const contracts = await this.referencedContracts(manager, siteId, site);
    const resolved = contracts.find(
      (entry) => entry.contract.id === contractId,
    );
    if (!resolved) throw new NotFoundException('Контракт чанка не найден');
    return resolved;
  }

  async create(
    siteId: string,
    actor: RevisionActor,
    input: {
      displayName: string;
      contractId: string;
      data: Record<string, unknown>;
    },
  ) {
    const resolved = await this.catalogContract(
      siteId,
      actor,
      input.contractId,
    );
    await this.validateData(
      this.dataSource.manager,
      siteId,
      resolved,
      input.data,
    );
    return this.persistence.createInstanceDraft({
      siteId,
      displayName: input.displayName,
      contractId: input.contractId,
      data: structuredClone(input.data),
      sanitizerPolicyVersion: null,
      actor,
      validateUsingManager: (manager) =>
        this.validateData(manager, siteId, resolved, input.data, true),
    });
  }

  async saveDraft(
    siteId: string,
    instanceId: string,
    actor: RevisionActor,
    input: {
      data: Record<string, unknown>;
      expectedDraftRevisionId: string | null;
    },
  ) {
    await this.authorizeRead(siteId, actor);
    const context = await this.instanceContext(
      this.dataSource.manager,
      siteId,
      instanceId,
    );
    await this.validateData(
      this.dataSource.manager,
      siteId,
      context.contract,
      input.data,
    );
    return this.persistence.saveInstanceDraft({
      siteId,
      instanceId,
      data: structuredClone(input.data),
      expectedDraftRevisionId: input.expectedDraftRevisionId,
      actor,
      validateUsingManager: (manager) =>
        this.validateData(manager, siteId, context.contract, input.data, true),
    });
  }

  submit(
    siteId: string,
    instanceId: string,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.persistence.submitInstanceRevision({
      siteId,
      instanceId,
      revisionId,
      actor,
    });
  }
  approve(
    siteId: string,
    instanceId: string,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.persistence.approveInstanceRevision({
      siteId,
      instanceId,
      revisionId,
      actor,
    });
  }
  requestChanges(
    siteId: string,
    instanceId: string,
    revisionId: string,
    actor: RevisionActor,
    reason: string,
  ) {
    return this.persistence.requestInstanceRevisionChanges({
      siteId,
      instanceId,
      revisionId,
      actor,
      reason,
    });
  }
  publish(
    siteId: string,
    instanceId: string,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.persistence.publishInstanceRevision({
      siteId,
      instanceId,
      revisionId,
      actor,
    });
  }
  restore(
    siteId: string,
    instanceId: string,
    sourceRevisionId: string,
    expectedDraftRevisionId: string | null,
    actor: RevisionActor,
  ) {
    return this.persistence.restoreInstanceRevision({
      siteId,
      instanceId,
      sourceRevisionId,
      expectedDraftRevisionId,
      actor,
      validateUsingManager: async (manager, snapshot, contractId) => {
        const site = await this.site(manager, siteId);
        const resolved = await this.resolveContract(manager, site, contractId);
        await this.validateData(
          manager,
          siteId,
          resolved,
          this.snapshotData(snapshot),
          true,
        );
      },
    });
  }
}
