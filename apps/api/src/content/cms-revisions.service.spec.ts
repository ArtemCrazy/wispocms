import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PlatformRole, WorkspaceRole } from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';

describe('CMS revision storage', () => {
  const owner = { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE };
  const manager = { userId: 'manager-id', platformRole: PlatformRole.EMPLOYEE };
  const outsider = {
    userId: 'outsider-id',
    platformRole: PlatformRole.EMPLOYEE,
  };

  function setup() {
    const resources: Record<string, unknown>[] = [];
    const revisions: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const saved = (value: Record<string, unknown>) => {
      if (
        'resourceType' in value &&
        value.draftRevisionId &&
        !revisions.some(
          (revision) =>
            revision.id === value.draftRevisionId &&
            revision.resourceId === value.id,
        )
      )
        throw new Error('FK draft revision must exist in the same resource');
      if (
        'snapshot' in value &&
        !resources.some((resource) => resource.id === value.resourceId)
      )
        throw new Error('FK resource must exist before revision');
      const collection =
        'resourceType' in value
          ? resources
          : 'snapshot' in value
            ? revisions
            : events;
      const existing = collection.findIndex((row) => row.id === value.id);
      if (existing >= 0) collection[existing] = { ...value };
      else collection.push({ ...value });
      return value;
    };
    const db = {
      findOne: jest.fn(
        (
          entity: { name: string },
          options: { where: Record<string, unknown> },
        ) => {
          const name = entity.name;
          const where = options.where;
          const rows = name.includes('Resource') ? resources : revisions;
          return (
            rows.find((row) =>
              Object.entries(where).every(([key, value]) => row[key] === value),
            ) ?? null
          );
        },
      ),
      save: jest.fn(saved),
      find: jest.fn(
        (_entity: unknown, options: { where: { resourceId: string } }) =>
          revisions
            .filter(
              (revision) => revision.resourceId === options.where.resourceId,
            )
            .sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber)),
      ),
    };
    const dataSource = {
      transaction: jest.fn(
        (operation: (manager: typeof db) => Promise<unknown>) => operation(db),
      ),
    };
    const sites = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'site-1', workspaceId: 'workspace-1' }),
    };
    const memberships = {
      findOne: jest.fn((options: { where: { userId: string } }) => {
        const userId = options.where.userId;
        if (userId === owner.userId)
          return { role: WorkspaceRole.SITE_OWNER, siteIds: ['site-1'] };
        if (userId === manager.userId)
          return { role: WorkspaceRole.WISPO_MANAGER, siteIds: ['site-1'] };
        return null;
      }),
    };
    const service = new CmsRevisionsService(
      dataSource as never,
      sites as never,
      memberships as never,
    );
    return { service, resources, revisions, events };
  }

  it('keeps the published snapshot while a newer draft is reviewed', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Old title' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', first.id, manager);
    await service.approve('site-1', 'article', 'article-1', first.id, owner);
    await service.publish('site-1', 'article', 'article-1', first.id, manager);

    const second = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'New title' },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });

    expect(second.versionNumber).toBe(2);
    expect(
      await service.published('site-1', 'article', 'article-1', manager),
    ).toEqual({ title: 'Old title' });
    await expect(
      service.publish('site-1', 'article', 'article-1', second.id, manager),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not switch the public pointer when applying a release fails', async () => {
    const { service } = setup();
    const old = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Live' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', old.id, manager);
    await service.approve('site-1', 'article', 'article-1', old.id, owner);
    await service.publish('site-1', 'article', 'article-1', old.id, manager);
    const next = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Proposed' },
      expectedDraftRevisionId: old.id,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', next.id, manager);
    await service.approve('site-1', 'article', 'article-1', next.id, owner);

    await expect(
      service.publish(
        'site-1',
        'article',
        'article-1',
        next.id,
        manager,
        (_db, snapshot) => {
          expect(snapshot).toEqual({ title: 'Proposed' });
          return Promise.reject(new Error('Release failed'));
        },
      ),
    ).rejects.toThrow('Release failed');
    expect(
      await service.published('site-1', 'article', 'article-1', manager),
    ).toEqual({ title: 'Live' });
  });

  it('imports the current live article once without claiming a new author', async () => {
    const { service, revisions } = setup();
    const first = await service.importPublishedBaseline({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Existing live article' },
      actor: manager,
    });
    const again = await service.importPublishedBaseline({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Must not overwrite baseline' },
      actor: manager,
    });
    expect(again.id).toBe(first.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].actorUserId).toBeNull();
    expect(
      await service.published('site-1', 'article', 'article-1', manager),
    ).toEqual({ title: 'Existing live article' });
  });

  it('reads an exact historical revision only within its article and site', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'First version' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Second version' },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });
    const reader = service as unknown as {
      getVersion: (...args: unknown[]) => Promise<unknown>;
    };
    await expect(
      reader.getVersion('site-1', 'article', 'article-1', first.id, manager),
    ).resolves.toMatchObject({
      id: first.id,
      snapshot: { title: 'First version' },
    });
    await expect(
      reader.getVersion('site-1', 'article', 'article-2', first.id, manager),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      reader.getVersion('site-1', 'article', 'article-1', first.id, outsider),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the latest draft separately from the published snapshot', async () => {
    const { service } = setup();
    const baseline = await service.importPublishedBaseline({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Live' },
      actor: manager,
    });
    const draft = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Work in progress' },
      expectedDraftRevisionId: baseline.id,
      actor: manager,
    });
    expect(
      await service.current('site-1', 'article', 'article-1', manager),
    ).toEqual({
      draft: {
        id: draft.id,
        versionNumber: 2,
        snapshot: { title: 'Work in progress' },
      },
      approvedRevisionId: null,
      publishedRevisionId: baseline.id,
      reviewState: 'draft',
    });
  });

  it('denies owner-only approval to a manager', async () => {
    const { service } = setup();
    const draft = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Draft' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', draft.id, manager);
    await expect(
      service.approve('site-1', 'article', 'article-1', draft.id, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose another site even through a direct resource ID', async () => {
    const { service } = setup();
    await expect(
      service.published('site-1', 'article', 'article-1', outsider),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason and keeps the previous publication after return', async () => {
    const { service } = setup();
    const draft = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Needs review' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', draft.id, manager);
    await expect(
      service.requestChanges(
        'site-1',
        'article',
        'article-1',
        draft.id,
        owner,
        '  ',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.requestChanges(
      'site-1',
      'article',
      'article-1',
      draft.id,
      owner,
      'Correct title',
    );
    await expect(
      service.publish('site-1', 'article', 'article-1', draft.id, manager),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('restores an old snapshot as a new unapproved draft', async () => {
    const { service, resources } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Original' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.submit('site-1', 'article', 'article-1', first.id, manager);
    await service.approve('site-1', 'article', 'article-1', first.id, owner);
    await service.publish('site-1', 'article', 'article-1', first.id, manager);
    const second = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Changed' },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });
    const restored = await service.restore(
      'site-1',
      'article',
      'article-1',
      first.id,
      second.id,
      manager,
    );
    expect(restored.versionNumber).toBe(3);
    expect(resources[0].approvedRevisionId).toBeNull();
    expect(
      await service.published('site-1', 'article', 'article-1', manager),
    ).toEqual({ title: 'Original' });
  });

  it('does not let a content manager edit a code resource', async () => {
    const { service } = setup();
    await expect(
      service.saveDraft({
        siteId: 'site-1',
        resourceType: 'chunk',
        entityId: 'chunk-1',
        snapshot: { html: '<div>Restricted</div>' },
        expectedDraftRevisionId: null,
        actor: manager,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reveal code history to a content manager', async () => {
    const { service } = setup();
    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'chunk',
      entityId: 'chunk-1',
      snapshot: { html: '<h1>Private source</h1>' },
      expectedDraftRevisionId: null,
      actor: owner,
    });
    await expect(
      service.listVersions('site-1', 'chunk', 'chunk-1', manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists the immutable snapshots of only the requested resource newest first', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'First' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'Second' },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });
    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'other-article',
      snapshot: { title: 'Other' },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    const history = await service.listVersions(
      'site-1',
      'article',
      'article-1',
      owner,
    );
    expect(history.map((version) => version.snapshot)).toEqual([
      { title: 'Second' },
      { title: 'First' },
    ]);
  });
});
