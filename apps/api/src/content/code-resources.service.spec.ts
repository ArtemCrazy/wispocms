import { BadRequestException } from '@nestjs/common';
import { PlatformRole } from '../database/entities';
import {
  CodeResourcesService,
  validateCmsHtml,
} from './code-resources.service';
import type { RevisionActor } from './cms-revisions.service';

describe('CMS HTML templates and chunks', () => {
  const actor: RevisionActor = {
    userId: 'developer-id',
    platformRole: PlatformRole.MEMBER,
  };

  it('accepts HTML with chunk placeholders and rejects executable markup', () => {
    expect(
      validateCmsHtml(
        '<section><h2>{{title}}</h2><img src="{{image}}" alt=""></section>',
      ),
    ).toContain('{{title}}');
    for (const unsafe of [
      '<script>alert(1)</script>',
      '<div onclick="alert(1)">x</div>',
      '<a href="javascript:alert(1)">x</a>',
      '<style>body{display:none}</style>',
    ])
      expect(() => validateCmsHtml(unsafe)).toThrow(BadRequestException);
  });

  it('creates a chunk as a draft revision with declared parameters', async () => {
    const revisions = {
      saveDraft: jest
        .fn()
        .mockResolvedValue({ id: 'revision-id', versionNumber: 1 }),
      current: jest.fn(),
    };
    const manager = { find: jest.fn().mockResolvedValue([]) };
    const service = new CodeResourcesService(
      { manager } as never,
      revisions as never,
    );

    const idMatcher: unknown = expect.any(String);
    await expect(
      service.create('site-id', 'chunk', actor, {
        name: 'Hero banner',
        key: 'hero_banner',
        html: '<section><h2>{{title}}</h2></section>',
        parameters: [{ key: 'title', label: 'Заголовок', type: 'text' }],
      }),
    ).resolves.toMatchObject({
      id: idMatcher,
      kind: 'chunk',
      draftRevisionId: 'revision-id',
    });
    const snapshotMatcher: unknown = expect.objectContaining({
      key: 'hero_banner',
      html: '<section><h2>{{title}}</h2></section>',
    });
    expect(revisions.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'chunk',
        expectedDraftRevisionId: null,
        snapshot: snapshotMatcher,
      }),
    );
  });

  it('requires compare-and-swap when editing HTML code', async () => {
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft: {
          id: 'current-id',
          versionNumber: 1,
          snapshot: {
            id: 'resource-id',
            kind: 'template',
            name: 'Page',
            key: 'page',
            html: '<main>Old</main>',
            parameters: [],
          },
        },
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      }),
      saveDraft: jest.fn(),
    };
    const service = new CodeResourcesService(
      { manager: {} } as never,
      revisions as never,
    );

    await expect(
      service.update('site-id', 'template', 'resource-id', actor, {
        name: 'Page',
        key: 'page',
        html: '<main>New</main>',
        parameters: [],
        expectedDraftRevisionId: 'stale-id',
      }),
    ).rejects.toThrow('Черновик уже изменён');
    expect(revisions.saveDraft).not.toHaveBeenCalled();
  });

  it('rejects a duplicate key found in another real revision resource', async () => {
    const revisions = {
      current: jest.fn().mockResolvedValue({
        draft: {
          id: 'existing-revision',
          versionNumber: 1,
          snapshot: {
            id: 'existing-id',
            kind: 'chunk',
            name: 'Existing',
            key: 'shared_key',
            html: '<div></div>',
            parameters: [],
          },
        },
        approvedRevisionId: null,
        publishedRevisionId: null,
        reviewState: 'draft',
      }),
      saveDraft: jest.fn(),
    };
    const service = new CodeResourcesService(
      {
        manager: {
          find: jest
            .fn()
            .mockResolvedValue([
              { entityId: 'existing-id', resourceType: 'chunk' },
            ]),
        },
      } as never,
      revisions as never,
    );

    await expect(
      service.create('site-id', 'chunk', actor, {
        name: 'Duplicate',
        key: 'shared_key',
        html: '<div></div>',
        parameters: [],
      }),
    ).rejects.toThrow('Такой ключ уже используется');
  });
});
