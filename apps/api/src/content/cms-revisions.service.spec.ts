import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  PlatformRole,
  SiteAccessEntity,
  SiteEntity,
  SiteRole,
} from '../database/entities';
import { CmsRevisionsService } from './cms-revisions.service';

describe('CMS revision storage', () => {
  const owner = { userId: 'owner-id', platformRole: PlatformRole.EMPLOYEE };
  const manager = { userId: 'manager-id', platformRole: PlatformRole.EMPLOYEE };
  const independentManager = {
    userId: 'independent-manager-id',
    platformRole: PlatformRole.EMPLOYEE,
  };
  const ownerReviewer = {
    userId: 'owner-reviewer-id',
    platformRole: PlatformRole.EMPLOYEE,
  };
  const outsider = {
    userId: 'outsider-id',
    platformRole: PlatformRole.EMPLOYEE,
  };

  function setup() {
    const resources: Record<string, unknown>[] = [];
    const revisions: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const operations: string[] = [];
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
      operations.push(
        'resourceType' in value
          ? 'resource'
          : 'snapshot' in value
            ? 'revision'
            : 'event',
      );
      const existing = collection.findIndex((row) => row.id === value.id);
      if (existing >= 0) collection[existing] = { ...value };
      else collection.push({ ...value });
      return value;
    };
    const siteAccessFor = (userId: string) => {
      if (userId === owner.userId)
        return {
          role: SiteRole.OWNER,
          siteId: 'site-1',
          requiresApproval: false,
        };
      if (userId === ownerReviewer.userId)
        return {
          role: SiteRole.OWNER,
          siteId: 'site-1',
          requiresApproval: false,
        };
      if (userId === manager.userId)
        return {
          role: SiteRole.CONTENT_MANAGER,
          siteId: 'site-1',
          requiresApproval: true,
        };
      if (userId === independentManager.userId)
        return {
          role: SiteRole.CONTENT_MANAGER,
          siteId: 'site-1',
          requiresApproval: false,
        };
      return null;
    };
    const db = {
      findOne: jest.fn(
        (
          entity: { name: string },
          options: { where: Record<string, unknown> },
        ) => {
          const name = entity.name;
          const where = options.where;
          if (name === 'SiteEntity')
            return { id: 'site-1', workspaceId: 'workspace-1' };
          if (name === 'SiteAccessEntity')
            return siteAccessFor(String(where.userId));
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
    const siteAccesses = {
      findOne: jest.fn((options: { where: { userId: string } }) =>
        siteAccessFor(options.where.userId),
      ),
    };
    const service = new CmsRevisionsService(
      dataSource as never,
      sites as never,
      siteAccesses as never,
    );
    return {
      service,
      resources,
      revisions,
      events,
      operations,
      db,
      dataSource,
      sites,
      siteAccesses,
    };
  }

  it.each(['chunk_instance', 'chunk_layout'] as const)(
    'rejects managed %s drafts through the public generic boundary before writes',
    async (resourceType) => {
      const { service, resources, revisions, events, dataSource } = setup();

      await expect(
        service.saveDraft({
          siteId: 'site-1',
          resourceType: resourceType as never,
          entityId: 'managed-1',
          snapshot: { formatVersion: 1, data: {} },
          expectedDraftRevisionId: null,
          actor: manager,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect({ resources, revisions, events }).toEqual({
        resources: [],
        revisions: [],
        events: [],
      });
    },
  );

  it.each(['chunk_instance', 'chunk_layout'] as const)(
    'rejects managed %s drafts through the ordinary manager boundary before authorization or writes',
    async (resourceType) => {
      const { service, db, resources, revisions, events } = setup();

      await expect(
        service.saveDraftUsingManager(db as never, {
          siteId: 'site-1',
          resourceType: resourceType as never,
          entityId: 'managed-1',
          snapshot: { formatVersion: 1, data: {} },
          expectedDraftRevisionId: null,
          actor: manager,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(db.findOne).not.toHaveBeenCalled();
      expect({ resources, revisions, events }).toEqual({
        resources: [],
        revisions: [],
        events: [],
      });
    },
  );

  it('uses transaction-bound authorization for public generic drafts', async () => {
    const { service, db, sites, siteAccesses } = setup();

    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-transaction-auth',
      snapshot: { title: 'Bound' },
      expectedDraftRevisionId: null,
      actor: manager,
    });

    expect(sites.findOne).not.toHaveBeenCalled();
    expect(siteAccesses.findOne).not.toHaveBeenCalled();
    expect(db.findOne.mock.calls[0]).toEqual([
      SiteEntity,
      { where: { id: 'site-1' } },
    ]);
    expect(db.findOne.mock.calls[1]).toEqual([
      SiteAccessEntity,
      expect.objectContaining({
        where: { userId: manager.userId, siteId: 'site-1' },
        lock: { mode: 'pessimistic_read' },
      }),
    ]);
  });

  it('uses transaction-bound authorization for ordinary manager drafts', async () => {
    const { service, db, sites, siteAccesses } = setup();

    await service.saveDraftUsingManager(db as never, {
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-manager-auth',
      snapshot: { title: 'Bound' },
      expectedDraftRevisionId: null,
      actor: manager,
    });

    expect(sites.findOne).not.toHaveBeenCalled();
    expect(siteAccesses.findOne).not.toHaveBeenCalled();
    expect(db.findOne.mock.calls[0][0]).toBe(SiteEntity);
    expect(db.findOne.mock.calls[1][1]).toEqual(
      expect.objectContaining({ lock: { mode: 'pessimistic_read' } }),
    );
  });

  it('locks managed write access before any site target lookup', async () => {
    const { service, db, sites, siteAccesses } = setup();

    await service.authorizeManagedWriteUsingManager(db as never, {
      siteId: 'site-1',
      resourceType: 'chunk_layout',
      actor: manager,
    });

    expect(sites.findOne).not.toHaveBeenCalled();
    expect(siteAccesses.findOne).not.toHaveBeenCalled();
    expect(db.findOne.mock.calls).toEqual([
      [
        SiteAccessEntity,
        expect.objectContaining({
          where: { userId: manager.userId, siteId: 'site-1' },
          lock: { mode: 'pessimistic_read' },
        }),
      ],
    ]);
  });

  it('denies a managed write before any site target lookup', async () => {
    const { service, db } = setup();

    await expect(
      service.authorizeManagedWriteUsingManager(db as never, {
        siteId: 'site-1',
        resourceType: 'chunk_instance',
        actor: outsider,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.findOne.mock.calls).toEqual([
      [
        SiteAccessEntity,
        expect.objectContaining({
          where: { userId: outsider.userId, siteId: 'site-1' },
          lock: { mode: 'pessimistic_read' },
        }),
      ],
    ]);
  });
  it('runs the mandatory managed revision hook after revision persistence and before pointer/event persistence', async () => {
    const { service, db, operations, sites, siteAccesses } = setup();
    const hook = jest.fn(
      (
        hookManager: unknown,
        revision: Record<string, unknown>,
        resource: Record<string, unknown>,
      ) => {
        operations.push('hook');
        expect(hookManager).toBe(db);
        expect(revision).toMatchObject({
          resourceId: resource.id,
          versionNumber: 1,
        });
        expect(resource).toMatchObject({
          resourceType: 'chunk_instance',
          entityId: 'instance-1',
          draftRevisionId: null,
        });
        return Promise.resolve();
      },
    );

    await service.saveManagedDraftUsingManager(
      db as never,
      {
        siteId: 'site-1',
        resourceType: 'chunk_instance',
        entityId: 'instance-1',
        snapshot: { formatVersion: 1, data: { headline: 'Safe' } },
        expectedDraftRevisionId: null,
        actor: manager,
      },
      hook,
    );

    expect(sites.findOne).not.toHaveBeenCalled();
    expect(siteAccesses.findOne).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(operations).toEqual([
      'resource',
      'revision',
      'hook',
      'resource',
      'event',
    ]);
  });

  it('rejects a missing managed hook before authorization or writes', async () => {
    const { service, db, operations } = setup();
    const callWithoutHook = service.saveManagedDraftUsingManager.bind(
      service,
    ) as unknown as (
      manager: unknown,
      input: Record<string, unknown>,
    ) => Promise<unknown>;

    await expect(
      callWithoutHook(db, {
        siteId: 'site-1',
        resourceType: 'chunk_instance',
        entityId: 'instance-1',
        snapshot: { formatVersion: 1, data: {} },
        expectedDraftRevisionId: null,
        actor: manager,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.findOne).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
  });

  it('propagates mandatory managed hook failures so the outer transaction rolls back every draft write', async () => {
    const committed = {
      resources: [] as Record<string, unknown>[],
      revisions: [] as Record<string, unknown>[],
      events: [] as Record<string, unknown>[],
    };
    const dataSource = {
      transaction: jest.fn(
        async (
          operation: (manager: Record<string, unknown>) => Promise<unknown>,
        ) => {
          const working = {
            resources: structuredClone(committed.resources),
            revisions: structuredClone(committed.revisions),
            events: structuredClone(committed.events),
          };
          const transactionManager = {
            findOne: jest.fn(
              (
                entity: { name: string },
                options: { where: Record<string, unknown> },
              ) => {
                if (entity.name === 'SiteEntity') return { id: 'site-1' };
                if (entity.name === 'SiteAccessEntity')
                  return {
                    role: SiteRole.CONTENT_MANAGER,
                    requiresApproval: true,
                  };
                return (
                  working.resources.find((row) =>
                    Object.entries(options.where).every(
                      ([key, value]) => row[key] === value,
                    ),
                  ) ?? null
                );
              },
            ),
            save: jest.fn((value: Record<string, unknown>) => {
              const rows =
                'resourceType' in value
                  ? working.resources
                  : 'snapshot' in value
                    ? working.revisions
                    : working.events;
              const existing = rows.findIndex((row) => row.id === value.id);
              if (existing >= 0) rows[existing] = { ...value };
              else rows.push({ ...value });
              return value;
            }),
          };
          const result = await operation(transactionManager);
          committed.resources = working.resources;
          committed.revisions = working.revisions;
          committed.events = working.events;
          return result;
        },
      ),
    };
    const service = new CmsRevisionsService(
      dataSource as never,
      {
        findOne: jest.fn(() => {
          throw new Error('Authorization escaped transaction');
        }),
      } as never,
      {
        findOne: jest.fn(() => {
          throw new Error('Authorization escaped transaction');
        }),
      } as never,
    );
    const failure = new Error('typed-link-save-failed');

    await expect(
      dataSource.transaction((db) =>
        service.saveManagedDraftUsingManager(
          db as never,
          {
            siteId: 'site-1',
            resourceType: 'chunk_instance',
            entityId: 'instance-1',
            snapshot: { formatVersion: 1, data: {} },
            expectedDraftRevisionId: null,
            actor: manager,
          },
          () => Promise.reject(failure),
        ),
      ),
    ).rejects.toBe(failure);
    expect(committed).toEqual({ resources: [], revisions: [], events: [] });
  });
  it('records owner publication atomically and preserves the prior baseline', async () => {
    const { service, db, revisions, events, resources } = setup();
    const input = {
      siteId: 'site-1',
      entityId: 'article-1',
      actor: owner,
      previousSnapshot: { title: 'Old' },
      snapshot: { title: 'New' },
    };
    await service.recordOwnerPublicationUsingManager(db as never, input);
    expect(revisions.map((revision) => revision.snapshot)).toEqual([
      { title: 'Old' },
      { title: 'New' },
    ]);
    expect(resources[0].draftRevisionId).toBe(resources[0].publishedRevisionId);
    expect(resources[0].approvedRevisionId).toBe(
      resources[0].publishedRevisionId,
    );
    expect(events.map((event) => event.eventType)).toContain('approved');
    expect(
      await service.published('site-1', 'article', 'article-1', owner),
    ).toEqual({ title: 'New' });
  });

  it('prevents employees and outsiders from bypassing approval through direct publication', async () => {
    const { service, db, revisions } = setup();
    for (const actor of [manager, outsider]) {
      await expect(
        service.recordOwnerPublicationUsingManager(db as never, {
          siteId: 'site-1',
          entityId: 'article-1',
          actor,
          previousSnapshot: null,
          snapshot: { title: 'Unapproved' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(revisions).toHaveLength(0);
  });

  it('never overwrites an outstanding CMS draft, even for the owner', async () => {
    const { service, db, revisions } = setup();
    await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      actor: manager,
      expectedDraftRevisionId: null,
      snapshot: { title: 'Work in progress' },
    });
    await expect(
      service.recordOwnerPublicationUsingManager(db as never, {
        siteId: 'site-1',
        entityId: 'article-1',
        actor: owner,
        previousSnapshot: null,
        snapshot: { title: 'Replacement' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].snapshot).toEqual({ title: 'Work in progress' });
  });

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
    await service.publish('site-1', 'article', 'article-1', first.id, owner);

    const second = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: { title: 'New title' },
      expectedDraftRevisionId: first.id,
      actor: independentManager,
    });

    expect(second.versionNumber).toBe(2);
    expect(
      await service.published('site-1', 'article', 'article-1', manager),
    ).toEqual({ title: 'Old title' });
    await service.submit('site-1', 'article', 'article-1', second.id, manager);
    await expect(
      service.publish('site-1', 'article', 'article-1', second.id, owner),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('publishes a manager draft directly when the assignment does not require approval', async () => {
    const { service } = setup();
    const draft = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-direct',
      snapshot: { title: 'Direct publication' },
      expectedDraftRevisionId: null,
      actor: manager,
    });

    await service.publish(
      'site-1',
      'article',
      'article-direct',
      draft.id,
      independentManager,
    );

    await expect(
      service.published(
        'site-1',
        'article',
        'article-direct',
        independentManager,
      ),
    ).resolves.toEqual({ title: 'Direct publication' });
  });

  it('blocks a content manager from publishing an owner-created template change', async () => {
    const { service } = setup();
    const baseline = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-structural',
      snapshot: {
        title: 'Live article',
        displayTemplateKey: 'standard-article',
        displayTemplateVersion: '1',
        displayTemplateConfig: {},
      },
      expectedDraftRevisionId: null,
      actor: owner,
    });
    await service.publish(
      'site-1',
      'article',
      'article-structural',
      baseline.id,
      owner,
    );
    const structural = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-structural',
      snapshot: {
        title: 'Updated article',
        displayTemplateKey: 'feature-article',
        displayTemplateVersion: '2',
        displayTemplateConfig: { hero: true },
      },
      expectedDraftRevisionId: baseline.id,
      actor: owner,
    });

    await expect(
      service.publish(
        'site-1',
        'article',
        'article-structural',
        structural.id,
        independentManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.published(
        'site-1',
        'article',
        'article-structural',
        independentManager,
      ),
    ).resolves.toEqual({
      title: 'Live article',
      displayTemplateKey: 'standard-article',
      displayTemplateVersion: '1',
      displayTemplateConfig: {},
    });
  });
  it('applies the structural publication guard to every template-bearing resource', async () => {
    const { service } = setup();
    const cases = [
      {
        resourceType: 'category' as const,
        entityId: 'category-structural',
        baseline: {
          title: 'Live category',
          displayTemplateKey: 'standard-category',
          displayTemplateVersion: '1',
          displayTemplateConfig: {},
        },
        structural: {
          title: 'Updated category',
          displayTemplateKey: 'feature-category',
          displayTemplateVersion: '2',
          displayTemplateConfig: { hero: true },
        },
      },
      {
        resourceType: 'site_privacy' as const,
        entityId: 'site-1',
        baseline: {
          document: 'Live policy',
          displayTemplate: {
            key: 'system-policy',
            version: '1',
            config: {},
          },
        },
        structural: {
          document: 'Updated policy',
          displayTemplate: {
            key: 'compact-policy',
            version: '2',
            config: { width: 'compact' },
          },
        },
      },
      {
        resourceType: 'site_not_found' as const,
        entityId: 'site-1',
        baseline: {
          status: 'published',
          templateKey: 'signal',
          templateVersion: '1',
        },
        structural: {
          status: 'published',
          templateKey: 'editorial',
          templateVersion: '2',
        },
      },
    ];

    for (const testCase of cases) {
      const baseline = await service.saveDraft({
        siteId: 'site-1',
        resourceType: testCase.resourceType,
        entityId: testCase.entityId,
        snapshot: testCase.baseline,
        expectedDraftRevisionId: null,
        actor: owner,
      });
      await service.publish(
        'site-1',
        testCase.resourceType,
        testCase.entityId,
        baseline.id,
        owner,
      );
      const structural = await service.saveDraft({
        siteId: 'site-1',
        resourceType: testCase.resourceType,
        entityId: testCase.entityId,
        snapshot: testCase.structural,
        expectedDraftRevisionId: baseline.id,
        actor: owner,
      });

      await expect(
        service.publish(
          'site-1',
          testCase.resourceType,
          testCase.entityId,
          structural.id,
          independentManager,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.published(
          'site-1',
          testCase.resourceType,
          testCase.entityId,
          independentManager,
        ),
      ).resolves.toEqual(testCase.baseline);
    }
  });
  it('allows direct manager publication when the template assignment is unchanged', async () => {
    const { service, db } = setup();
    const cases = [
      {
        resourceType: 'article' as const,
        entityId: 'article-content-only',
        baseline: {
          title: 'Live article',
          displayTemplateKey: 'standard-article',
          displayTemplateVersion: '1',
          displayTemplateConfig: { layout: 'default' },
        },
        next: {
          title: 'Updated article',
          displayTemplateKey: 'standard-article',
          displayTemplateVersion: '1',
          displayTemplateConfig: { layout: 'default' },
        },
      },
      {
        resourceType: 'category' as const,
        entityId: 'category-content-only',
        baseline: {
          title: 'Live category',
          displayTemplateKey: 'standard-category',
          displayTemplateVersion: '1',
          displayTemplateConfig: { layout: 'default' },
        },
        next: {
          title: 'Updated category',
          displayTemplateKey: 'standard-category',
          displayTemplateVersion: '1',
          displayTemplateConfig: { layout: 'default' },
        },
      },
      {
        resourceType: 'site_privacy' as const,
        entityId: 'site-1',
        baseline: {
          document: 'Live policy',
          displayTemplate: {
            key: 'system-policy',
            version: '1',
            config: { sections: ['intro'], width: 'wide' },
          },
        },
        next: {
          document: 'Updated policy',
          displayTemplate: {
            key: 'system-policy',
            version: '1',
            config: { width: 'wide', sections: ['intro'] },
          },
        },
      },
      {
        resourceType: 'site_not_found' as const,
        entityId: 'site-1',
        baseline: {
          title: 'Live 404',
          templateKey: 'signal',
          templateVersion: '1',
        },
        next: {
          title: 'Updated 404',
          templateKey: 'signal',
          templateVersion: '1',
        },
      },
    ];

    for (const testCase of cases) {
      const baseline = await service.saveDraft({
        siteId: 'site-1',
        resourceType: testCase.resourceType,
        entityId: testCase.entityId,
        snapshot: testCase.baseline,
        expectedDraftRevisionId: null,
        actor: owner,
      });
      await service.publish(
        'site-1',
        testCase.resourceType,
        testCase.entityId,
        baseline.id,
        owner,
      );
      const contentOnly = await service.saveDraft({
        siteId: 'site-1',
        resourceType: testCase.resourceType,
        entityId: testCase.entityId,
        snapshot: testCase.next,
        expectedDraftRevisionId: baseline.id,
        actor: independentManager,
      });

      await service.publish(
        'site-1',
        testCase.resourceType,
        testCase.entityId,
        contentOnly.id,
        independentManager,
      );
      await expect(
        service.published(
          'site-1',
          testCase.resourceType,
          testCase.entityId,
          independentManager,
        ),
      ).resolves.toEqual(testCase.next);
    }

    const transactionalSiteRead = db.findOne.mock.calls.find(
      ([entity]) => entity.name === 'SiteEntity',
    );
    const transactionalAccessRead = db.findOne.mock.calls.find(
      ([entity]) => entity.name === 'SiteAccessEntity',
    );
    expect(transactionalSiteRead?.[1]).toEqual({ where: { id: 'site-1' } });
    expect(transactionalAccessRead?.[1]).toMatchObject({
      where: { siteId: 'site-1' },
      lock: { mode: 'pessimistic_read' },
    });
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
    await service.publish('site-1', 'article', 'article-1', old.id, owner);
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
        owner,
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
      service.publish('site-1', 'article', 'article-1', draft.id, owner),
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
    await service.publish('site-1', 'article', 'article-1', first.id, owner);
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

  it('keeps the current template assignment when a content manager restores article content', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: {
        title: 'Original',
        displayTemplateKey: 'historic-article',
        displayTemplateVersion: '1',
        displayTemplateConfig: { hero: 'historic' },
      },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    const current = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'article',
      entityId: 'article-1',
      snapshot: {
        title: 'Current',
        displayTemplateKey: 'standard-article',
        displayTemplateVersion: '3',
        displayTemplateConfig: { hero: 'current' },
      },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });

    await service.restore(
      'site-1',
      'article',
      'article-1',
      first.id,
      current.id,
      manager,
    );

    await expect(
      service.current('site-1', 'article', 'article-1', manager),
    ).resolves.toMatchObject({
      draft: {
        snapshot: {
          title: 'Original',
          displayTemplateKey: 'standard-article',
          displayTemplateVersion: '3',
          displayTemplateConfig: { hero: 'current' },
        },
      },
    });
  });

  it('keeps the current category template when a content manager restores category content', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'category',
      entityId: 'category-1',
      snapshot: {
        name: 'Historic category',
        displayTemplateKey: 'historic-category',
        displayTemplateVersion: '1',
        displayTemplateConfig: { cards: 2 },
      },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    const current = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'category',
      entityId: 'category-1',
      snapshot: {
        name: 'Current category',
        displayTemplateKey: 'standard-category',
        displayTemplateVersion: '3',
        displayTemplateConfig: { cards: 5 },
      },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });

    await service.restore(
      'site-1',
      'category',
      'category-1',
      first.id,
      current.id,
      manager,
    );

    await expect(
      service.current('site-1', 'category', 'category-1', manager),
    ).resolves.toMatchObject({
      draft: {
        snapshot: {
          name: 'Historic category',
          displayTemplateKey: 'standard-category',
          displayTemplateVersion: '3',
          displayTemplateConfig: { cards: 5 },
        },
      },
    });
  });

  it('restores the historical template assignment for a site owner', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_privacy',
      entityId: 'privacy-1',
      snapshot: {
        title: 'Historic policy',
        displayTemplate: {
          key: 'historic-policy',
          version: '2',
          config: { legal: 'historic' },
        },
      },
      expectedDraftRevisionId: null,
      actor: owner,
    });
    const current = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_privacy',
      entityId: 'privacy-1',
      snapshot: {
        title: 'Current policy',
        displayTemplate: {
          key: 'system-policy',
          version: '4',
          config: { legal: 'current' },
        },
      },
      expectedDraftRevisionId: first.id,
      actor: owner,
    });

    await service.restore(
      'site-1',
      'site_privacy',
      'privacy-1',
      first.id,
      current.id,
      owner,
    );

    await expect(
      service.current('site-1', 'site_privacy', 'privacy-1', owner),
    ).resolves.toMatchObject({
      draft: {
        snapshot: {
          title: 'Historic policy',
          displayTemplate: {
            key: 'historic-policy',
            version: '2',
            config: { legal: 'historic' },
          },
        },
      },
    });
  });

  it('keeps the current privacy template when a content manager restores policy content', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_privacy',
      entityId: 'privacy-1',
      snapshot: {
        title: 'Historic policy',
        displayTemplate: {
          key: 'historic-policy',
          version: '2',
          config: { legal: 'historic' },
        },
      },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    const current = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_privacy',
      entityId: 'privacy-1',
      snapshot: {
        title: 'Current policy',
        displayTemplate: {
          key: 'system-policy',
          version: '4',
          config: { legal: 'current' },
        },
      },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });

    await service.restore(
      'site-1',
      'site_privacy',
      'privacy-1',
      first.id,
      current.id,
      manager,
    );

    await expect(
      service.current('site-1', 'site_privacy', 'privacy-1', manager),
    ).resolves.toMatchObject({
      draft: {
        snapshot: {
          title: 'Historic policy',
          displayTemplate: {
            key: 'system-policy',
            version: '4',
            config: { legal: 'current' },
          },
        },
      },
    });
  });

  it('keeps the current 404 template when a content manager restores its content', async () => {
    const { service } = setup();
    const first = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_not_found',
      entityId: 'not-found-1',
      snapshot: {
        title: 'Historic 404',
        templateKey: 'historic-not-found',
        templateVersion: '1',
      },
      expectedDraftRevisionId: null,
      actor: manager,
    });
    const current = await service.saveDraft({
      siteId: 'site-1',
      resourceType: 'site_not_found',
      entityId: 'not-found-1',
      snapshot: {
        title: 'Current 404',
        templateKey: 'system-not-found',
        templateVersion: '4',
      },
      expectedDraftRevisionId: first.id,
      actor: manager,
    });

    await service.restore(
      'site-1',
      'site_not_found',
      'not-found-1',
      first.id,
      current.id,
      manager,
    );

    await expect(
      service.current('site-1', 'site_not_found', 'not-found-1', manager),
    ).resolves.toMatchObject({
      draft: {
        snapshot: {
          title: 'Historic 404',
          templateKey: 'system-not-found',
          templateVersion: '4',
        },
      },
    });
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
