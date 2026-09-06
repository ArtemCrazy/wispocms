import { BadRequestException } from '@nestjs/common';
import { PageKind, PageStatus, PlatformRole } from '../database/entities';
import { privacyFingerprint } from '../privacy/privacy-generator';
import { ContentService } from './content.service';

const actor = { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN };

function setup(privacyState: Record<string, unknown>) {
  const page = {
    id: 'page-1',
    siteId: 'site-1',
    title: 'Политика конфиденциальности',
    slug: 'privacy-policy',
    kind: PageKind.PAGE,
    status: PageStatus.DRAFT,
    blocks: [{ id: 'text', type: 'text', text: 'legacy' }],
  };
  const site = { id: 'site-1', workspaceId: 'workspace-1', globalData: {} };
  const sites = { findOne: jest.fn().mockResolvedValue(site) };
  const pages = {
    findOne: jest.fn().mockResolvedValue(page),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const privacyStates = {
    findOne: jest.fn().mockResolvedValue({
      pageId: page.id,
      settings: {},
      mode: 'automatic',
      automaticSnapshot: 'Сохранённый snapshot',
      manualSnapshot: null,
      legacyContentPreserved: false,
      displayTemplateKey: 'system-policy',
      displayTemplateVersion: '1',
      displayTemplateConfig: {},
      ...privacyState,
    }),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const media = { existsBy: jest.fn() };
  const empty = {};
  const service = new ContentService(
    sites as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    media as never,
    pages as never,
    empty as never,
    privacyStates as never,
  );
  return { service, page, pages, privacyStates };
}

describe('privacy policy contracts', () => {
  it('blocks a direct publish attempt while the selected legal model is draft', async () => {
    const { service, pages } = setup({
      legalModel: { version: 'draft-1', status: 'draft' },
    });
    await expect(
      service.changePageStatus('site-1', 'page-1', actor, {
        status: PageStatus.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('blocks publication with an approved but stale snapshot', async () => {
    const { service, pages } = setup({
      legalModel: { version: 'approved-1', status: 'approved' },
      inputFingerprint: 'stale',
    });
    await expect(
      service.changePageStatus('site-1', 'page-1', actor, {
        status: PageStatus.PUBLISHED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('publishes exactly the saved current snapshot for an approved model', async () => {
    const fingerprint = privacyFingerprint({}, {}, 'approved-1', {
      key: 'system-policy',
      version: '1',
      config: {},
    });
    const { service, page, pages, privacyStates } = setup({
      legalModel: { version: 'approved-1', status: 'approved' },
      inputFingerprint: fingerprint,
    });
    await service.changePageStatus('site-1', 'page-1', actor, {
      status: PageStatus.PUBLISHED,
    });
    expect(privacyStates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedSnapshot: 'Сохранённый snapshot',
        publishedLegalModelVersion: 'approved-1',
        publishedDisplayTemplateKey: 'system-policy',
      }),
    );
    expect(page.blocks).toEqual([
      {
        id: 'privacy-policy-document',
        type: 'text',
        text: 'Сохранённый snapshot',
      },
    ]);
    expect(pages.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PageStatus.PUBLISHED }),
    );
  });

  it('rejects generic page updates without saving privacy blocks', async () => {
    const { service, pages } = setup({
      legalModel: { version: 'draft-1', status: 'draft' },
    });
    await expect(
      service.updatePage('site-1', 'page-1', actor, {
        title: 'Попытка',
        slug: 'privacy-policy',
        kind: PageKind.PAGE,
        status: PageStatus.DRAFT,
        blocks: [{ id: 'new', type: 'text', text: 'Обход модели' }],
      }),
    ).rejects.toThrow('редактируйте через модуль политики');
    expect(pages.save).not.toHaveBeenCalled();
  });
});
