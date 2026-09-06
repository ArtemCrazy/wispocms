import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PageKind, PageStatus, PlatformRole } from '../database/entities';
import { ContentService } from './content.service';

const actor = { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN };

function setup(overrides: Record<string, unknown> = {}) {
  const site = {
    id: 'site-1',
    workspaceId: 'workspace-1',
    name: 'Wispo Media',
    slug: 'wispo-media',
    isActive: true,
    globalData: {},
    layoutSettings: {},
  };
  const page = {
    id: 'page-404',
    siteId: site.id,
    title: 'Страница 404',
    slug: '404',
    kind: PageKind.PAGE,
    status: PageStatus.DRAFT,
    blocks: [{ id: 'legacy', type: 'text', text: 'Старый контент' }],
    systemTemplateKey: 'signal',
    systemTemplateVersion: '1',
    publishedSystemTemplateKey: null,
    publishedSystemTemplateVersion: null,
    updatedAt: new Date('2026-09-05T00:00:00Z'),
    ...overrides,
  };
  const sites = { findOne: jest.fn().mockResolvedValue(site) };
  const pages = {
    findOne: jest.fn().mockResolvedValue(page),
    find: jest.fn().mockResolvedValue([]),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const articles = { find: jest.fn().mockResolvedValue([]) };
  const banners = { find: jest.fn().mockResolvedValue([]) };
  const service = new ContentService(
    sites as never,
    {} as never,
    {} as never,
    {} as never,
    articles as never,
    {} as never,
    { existsBy: jest.fn() } as never,
    pages as never,
    banners as never,
  );
  return { service, page, pages };
}

describe('404 system page contracts', () => {
  it('attaches a template without activating it or changing preserved blocks', async () => {
    const { service, page, pages } = setup();
    await service.updateNotFoundTemplate('site-1', actor, {
      templateKey: 'editorial',
    });
    expect(page).toEqual(
      expect.objectContaining({
        status: PageStatus.DRAFT,
        systemTemplateKey: 'editorial',
        publishedSystemTemplateKey: null,
        blocks: [{ id: 'legacy', type: 'text', text: 'Старый контент' }],
      }),
    );
    expect(pages.save).toHaveBeenCalledTimes(1);
  });

  it('activates an immutable published template reference separately', async () => {
    const { service, page } = setup({
      systemTemplateKey: 'editorial',
      systemTemplateVersion: '1',
    });
    await service.activateNotFoundPage('site-1', actor);
    expect(page).toEqual(
      expect.objectContaining({
        status: PageStatus.PUBLISHED,
        publishedSystemTemplateKey: 'editorial',
        publishedSystemTemplateVersion: '1',
      }),
    );
  });

  it('uses only the published template on the public fallback', async () => {
    const { service } = setup({
      status: PageStatus.PUBLISHED,
      systemTemplateKey: 'editorial',
      publishedSystemTemplateKey: 'signal',
      publishedSystemTemplateVersion: '1',
    });
    const result = await service.getPublicNotFoundPage('wispo-media');
    expect(result.active).toBe(true);
    expect(result.template.key).toBe('signal');
  });

  it('never leaks a saved draft template into the public fallback', async () => {
    const { service } = setup({
      status: PageStatus.DRAFT,
      systemTemplateKey: 'editorial',
      publishedSystemTemplateKey: 'editorial',
      publishedSystemTemplateVersion: '1',
    });
    const result = await service.getPublicNotFoundPage('wispo-media');
    expect(result.active).toBe(false);
    expect(result.template.key).toBe('signal');
  });

  it('rejects direct public and generic editor paths for the 404 row', async () => {
    const { service, pages } = setup();
    await expect(
      service.getPublicPage('wispo-media', '404'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updatePage('site-1', 'page-404', actor, {
        title: 'Обход',
        slug: '404',
        kind: PageKind.PAGE,
        status: PageStatus.DRAFT,
        blocks: [],
      }),
    ).rejects.toThrow('через модуль 404');
    await expect(
      service.changePageStatus('site-1', 'page-404', actor, {
        status: PageStatus.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('uses the selected draft template in authenticated preview', async () => {
    const { service } = setup({
      systemTemplateKey: 'editorial',
      systemTemplateVersion: '1',
    });
    const result = await service.getPagePreview('site-1', 'page-404', actor);
    expect(result.notFoundDisplay?.key).toBe('editorial');
  });
});
