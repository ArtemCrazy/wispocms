import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SitePermission } from './content.permissions';
import {
  CmsRevisionsService,
  type CmsResourceType,
  type RevisionActor,
} from './cms-revisions.service';

export type SiteRevisionResourceType = Extract<
  CmsResourceType,
  | 'site_variables'
  | 'site_seo'
  | 'site_search'
  | 'site_not_found'
  | 'site_privacy'
>;

export type SiteResourceDraftInput = {
  snapshot: Record<string, unknown>;
  expectedDraftRevisionId: string | null;
};

export interface SiteResourceAdapterRegistry {
  publishedSnapshot(
    siteId: string,
    resourceType: SiteRevisionResourceType,
  ): Promise<Record<string, unknown>>;
  normalizeSnapshot(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  presentSnapshot?(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  activate(
    manager: EntityManager,
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ): Promise<void>;
}

@Injectable()
export class SiteResourceRevisionsService {
  constructor(
    private readonly revisions: CmsRevisionsService,
    @Inject('SiteResourceAdapterRegistry')
    private readonly adapters: SiteResourceAdapterRegistry,
  ) {}

  private view(
    snapshot: Record<string, unknown>,
    current: Awaited<ReturnType<CmsRevisionsService['current']>>,
    next?: { id: string; versionNumber: number },
    baselineId?: string | null,
  ) {
    return {
      ...snapshot,
      draftRevisionId: next?.id ?? current?.draft?.id ?? null,
      draftVersionNumber:
        next?.versionNumber ?? current?.draft?.versionNumber ?? null,
      approvedRevisionId: next ? null : (current?.approvedRevisionId ?? null),
      publishedRevisionId: current?.publishedRevisionId ?? baselineId ?? null,
      reviewState: next ? 'draft' : (current?.reviewState ?? 'draft'),
    };
  }

  private present(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ) {
    return (
      this.adapters.presentSnapshot?.(siteId, resourceType, snapshot) ??
      Promise.resolve(snapshot)
    );
  }

  async get(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    actor: RevisionActor,
  ) {
    const current = await this.revisions.current(
      siteId,
      resourceType,
      siteId,
      actor,
    );
    const snapshot =
      current?.draft?.snapshot ??
      (await this.adapters.publishedSnapshot(siteId, resourceType));
    return this.view(
      await this.present(siteId, resourceType, snapshot),
      current,
    );
  }

  async save(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    actor: RevisionActor,
    input: SiteResourceDraftInput,
  ) {
    const current = await this.revisions.current(
      siteId,
      resourceType,
      siteId,
      actor,
    );
    if (input.expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    const source =
      current?.draft?.snapshot ??
      (await this.adapters.publishedSnapshot(siteId, resourceType));
    const snapshot = await this.adapters.normalizeSnapshot(
      siteId,
      resourceType,
      input.snapshot,
    );
    if (
      resourceType === 'site_not_found' &&
      (snapshot.templateKey !== source.templateKey ||
        snapshot.templateVersion !== source.templateVersion)
    )
      await this.revisions.assertSitePermission(
        siteId,
        actor,
        SitePermission.EDIT_CODE,
      );
    const baseline = !current
      ? await this.revisions.importPublishedBaseline({
          siteId,
          resourceType,
          entityId: siteId,
          snapshot: source,
          actor,
        })
      : null;
    const next = await this.revisions.saveDraft({
      siteId,
      resourceType,
      entityId: siteId,
      snapshot,
      expectedDraftRevisionId: current?.draft?.id ?? baseline?.id ?? null,
      actor,
    });
    return this.view(
      await this.present(siteId, resourceType, snapshot),
      current,
      next,
      baseline?.id,
    );
  }

  async prepareMutation(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    actor: RevisionActor,
    expectedDraftRevisionId: string | null,
  ) {
    const current = await this.revisions.current(
      siteId,
      resourceType,
      siteId,
      actor,
    );
    if (expectedDraftRevisionId !== (current?.draft?.id ?? null))
      throw new ConflictException('Черновик уже изменён');
    if (current?.draft?.id) return current.draft.id;
    const snapshot = await this.adapters.publishedSnapshot(
      siteId,
      resourceType,
    );
    const baseline = await this.revisions.importPublishedBaseline({
      siteId,
      resourceType,
      entityId: siteId,
      snapshot,
      actor,
    });
    return baseline.id;
  }

  preview(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    revisionId: string,
    actor: RevisionActor,
  ) {
    return this.revisions.getVersion(
      siteId,
      resourceType,
      siteId,
      revisionId,
      actor,
    );
  }

  async publish(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    revisionId: string,
    actor: RevisionActor,
  ) {
    await this.revisions.publish(
      siteId,
      resourceType,
      siteId,
      revisionId,
      actor,
      (manager, snapshot) =>
        this.adapters.activate(manager, siteId, resourceType, snapshot),
    );
    return { siteId, revisionId };
  }
}
