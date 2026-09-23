import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AuthorEntity,
  PlatformRole,
  SiteType,
  WorkspaceRole,
} from '../database/entities';
import { ContentService } from './content.service';

describe('author revision adapter', () => {
  const admin = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const publishedAuthor = Object.assign(new AuthorEntity(), {
    id: 'author-id',
    siteId: 'site-id',
    fullName: 'Published Author',
    email: 'published@example.test',
    bio: 'Published biography',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  });

  function setup(author = publishedAuthor) {
    const draft = {
      id: 'draft-id',
      versionNumber: 2,
      snapshot: {
        fullName: 'Draft Author',
        email: 'draft@example.test',
        bio: 'Draft biography',
      },
    };
    const manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const authors = {
      find: jest.fn().mockResolvedValue([{ ...author }]),
      findOne: jest.fn().mockResolvedValue({ ...author }),
      create: jest.fn((value: object) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      remove: jest.fn().mockResolvedValue(undefined),
      manager: {
        transaction: jest.fn((work: (db: typeof manager) => Promise<unknown>) =>
          work(manager),
        ),
      },
    };
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft,
        approvedRevisionId: null,
        publishedRevisionId: 'baseline-id',
        reviewState: 'draft',
      }),
      importPublishedBaseline: jest.fn(),
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'next-id', versionNumber: 3 }),
      saveDraftUsingManager: jest
        .fn()
        .mockResolvedValue({ id: 'created-draft-id', versionNumber: 1 }),
      publish: jest.fn(),
      getVersion: jest.fn().mockResolvedValue(draft),
    };
    const memberships = {
      findOne: jest.fn().mockResolvedValue({
        role: WorkspaceRole.SITE_CONTENT_MANAGER,
        siteIds: ['site-id'],
      }),
    };
    const service = new ContentService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'site-id',
          workspaceId: 'workspace-id',
          name: 'Media',
          slug: 'media',
          siteType: SiteType.MEDIA,
        }),
      } as never,
      memberships as never,
      {} as never,
      authors as never,
      { count: jest.fn().mockResolvedValue(0) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      revisions as never,
    );
    return { service, authors, manager, revisions, memberships };
  }

  it('lists draft author fields without changing the public row', async () => {
    const { service, authors } = setup();
    const [author] = await service.listAuthors('site-id', admin);
    expect(author).toEqual(
      expect.objectContaining({
        fullName: 'Draft Author',
        email: 'draft@example.test',
        bio: 'Draft biography',
        draftRevisionId: 'draft-id',
      }),
    );
    expect(authors.save).not.toHaveBeenCalled();
  });

  it('creates an author and its first draft revision atomically', async () => {
    const { service, manager, revisions } = setup();
    manager.save.mockImplementation((value: AuthorEntity) =>
      Promise.resolve(Object.assign(value, { id: 'created-author-id' })),
    );
    const result = await service.createAuthor('site-id', admin, {
      fullName: 'New Author',
      email: 'new@example.test',
      bio: 'Biography',
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'created-author-id',
        draftRevisionId: 'created-draft-id',
      }),
    );
    expect(revisions.saveDraftUsingManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        resourceType: 'author',
        entityId: 'created-author-id',
        expectedDraftRevisionId: null,
      }),
    );
  });

  it('saves an author edit only as a new revision', async () => {
    const { service, authors, revisions } = setup();
    const result = await service.updateAuthor('site-id', 'author-id', admin, {
      fullName: 'Next Author',
      email: null,
      bio: null,
      expectedDraftRevisionId: 'draft-id',
    });
    expect(result).toEqual(
      expect.objectContaining({
        fullName: 'Next Author',
        email: null,
        bio: null,
        draftRevisionId: 'next-id',
      }),
    );
    expect(authors.save).not.toHaveBeenCalled();
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'author',
        entityId: 'author-id',
        snapshot: {
          fullName: 'Next Author',
          email: null,
          bio: null,
        },
        expectedDraftRevisionId: 'draft-id',
      }),
    );
  });

  it('rejects a stale author edit before saving a revision', async () => {
    const { service, revisions } = setup();
    await expect(
      service.updateAuthor('site-id', 'author-id', admin, {
        fullName: 'Stale Author',
        expectedDraftRevisionId: 'old-id',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('previews one exact author revision', async () => {
    const { service, revisions } = setup();
    revisions.getVersion.mockResolvedValue({
      id: 'old-id',
      versionNumber: 1,
      snapshot: {
        id: 'foreign-author-id',
        siteId: 'foreign-site-id',
        fullName: 'Old Author',
        email: null,
        bio: 'Old biography',
      },
    });
    await expect(
      service.getAuthorRevisionPreview('site-id', 'author-id', 'old-id', admin),
    ).resolves.toEqual({
      id: 'author-id',
      siteId: 'site-id',
      fullName: 'Old Author',
      email: null,
      bio: 'Old biography',
      revisionId: 'old-id',
      versionNumber: 1,
    });
  });

  it('publishes the exact approved author snapshot', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne.mockResolvedValue({ ...publishedAuthor });
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) =>
        activate(manager, {
          fullName: 'Approved Author',
          email: null,
          bio: 'Approved biography',
        }),
    );
    await expect(
      service.publishAuthorRevision(
        'site-id',
        'author-id',
        'approved-id',
        admin,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        fullName: 'Approved Author',
        email: null,
        bio: 'Approved biography',
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'author-id',
        siteId: 'site-id',
        fullName: 'Approved Author',
      }),
    );
  });

  it('keeps the public author unchanged when a snapshot is invalid', async () => {
    const { service, manager, revisions } = setup();
    manager.findOne.mockResolvedValue({ ...publishedAuthor });
    revisions.publish.mockImplementation(
      async (
        _siteId: string,
        _type: string,
        _entityId: string,
        _revisionId: string,
        _actor: unknown,
        activate: (
          db: typeof manager,
          snapshot: Record<string, unknown>,
        ) => Promise<void>,
      ) => activate(manager, { fullName: '', email: null, bio: null }),
    );
    await expect(
      service.publishAuthorRevision(
        'site-id',
        'author-id',
        'approved-id',
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('allows only an approver to delete an unused author', async () => {
    const { service, memberships, authors } = setup();
    await expect(
      service.deleteAuthor('site-id', 'author-id', {
        userId: 'manager-id',
        platformRole: PlatformRole.MEMBER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authors.remove).not.toHaveBeenCalled();

    memberships.findOne.mockResolvedValue({
      role: WorkspaceRole.SITE_OWNER,
      siteIds: ['site-id'],
    });
    await expect(
      service.deleteAuthor('site-id', 'author-id', {
        userId: 'owner-id',
        platformRole: PlatformRole.MEMBER,
      }),
    ).resolves.toEqual({ id: 'author-id' });
  });
});
