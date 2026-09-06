import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PlatformRole, WorkspaceRole } from '../database/entities';
import { privacyFingerprint } from './privacy-generator';
import { PrivacyService } from './privacy.service';

function setup(
  overrides: {
    membership?: unknown;
    globals?: Record<string, unknown>;
    state?: Record<string, unknown>;
  } = {},
) {
  const globals = {
    organizationType: 'ooo',
    legalName: 'ООО «Тест»',
    inn: '123',
    ogrn: '456',
    legalAddress: 'Москва',
    ...overrides.globals,
  };
  const site = {
    id: 'site-1',
    workspaceId: 'workspace-1',
    globalData: globals,
  };
  const legalModel = {
    id: 'legal-1',
    version: 'draft-1',
    status: 'draft',
    sections: [],
    rules: [],
  };
  const settings = {
    dataCategories: ['email'],
    purposes: ['newsletter'],
    collectionMethods: ['web_forms'],
  };
  const state = {
    siteId: site.id,
    pageId: 'page-1',
    page: { id: 'page-1', status: 'draft', blocks: [] },
    legalModel,
    settings,
    mode: 'automatic',
    automaticSnapshot: 'automatic',
    manualSnapshot: null,
    publishedSnapshot: null,
    inputFingerprint: privacyFingerprint(
      globals,
      settings,
      legalModel.version,
      {
        key: 'system-policy',
        version: '1',
        config: {},
      },
    ),
    legacyContentPreserved: false,
    displayTemplateKey: 'system-policy',
    displayTemplateVersion: '1',
    displayTemplateConfig: {},
    legalModelId: legalModel.id,
    generatedAt: new Date(),
    updatedAt: new Date(),
    ...overrides.state,
  };
  const sites = {
    findOne: jest.fn().mockResolvedValue(site),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const memberships = {
    findOne: jest.fn().mockResolvedValue(overrides.membership ?? null),
  };
  const pages = { findOne: jest.fn() };
  const legalModels = {
    findOne: jest.fn().mockResolvedValue(null as any),
    existsBy: jest.fn().mockResolvedValue(false),
    create: jest.fn((value: unknown) => value),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
  };
  const policyStates = {
    findOne: jest.fn().mockResolvedValue(state),
    save: jest
      .fn()
      .mockImplementation((value: unknown) => Promise.resolve(value)),
    create: jest.fn((value: unknown) => value),
  };
  return {
    service: new PrivacyService(
      sites as never,
      memberships as never,
      pages as never,
      legalModels as never,
      policyStates as never,
    ),
    state,
    site,
    legalModels,
    policyStates,
  };
}

describe('PrivacyService', () => {
  it('preserves a manual snapshot when regeneration is not explicitly confirmed', async () => {
    const { service, state } = setup({
      state: { mode: 'manual', manualSnapshot: 'ручная версия' },
    });
    await expect(
      service.generate(
        'site-1',
        { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(state.manualSnapshot).toBe('ручная версия');
  });

  it('marks a preserved manual document stale after company data changes', async () => {
    const original = setup({
      state: { mode: 'manual', manualSnapshot: 'ручная версия' },
    });
    original.site.globalData.inn = 'changed';
    const result = await original.service.get('site-1', {
      userId: 'admin',
      platformRole: PlatformRole.WISPO_ADMIN,
    });
    expect(result.status).toBe('attention_required');
    expect(result.document).toBe('ручная версия');
  });

  it('denies an employee without membership in the site workspace', async () => {
    const { service } = setup();
    await expect(
      service.get('site-1', {
        userId: 'employee',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an employee with any explicit workspace membership', async () => {
    const { service } = setup({ membership: { role: WorkspaceRole.EMPLOYEE } });
    await expect(
      service.get('site-1', {
        userId: 'employee',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).resolves.toMatchObject({ siteId: 'site-1' });
  });

  it('preserves a manual document and requires review when accepting an approved model', async () => {
    const { service, state, legalModels, policyStates } = setup({
      state: { mode: 'manual', manualSnapshot: 'ручная версия' },
    });
    const approved = {
      id: 'legal-2',
      version: 'approved-2',
      status: 'approved',
      approvedAt: new Date(),
      changeSummary: 'Обновлён раздел',
      sections: [{ key: 'general', title: 'Общие положения', body: 'Текст' }],
      rules: [],
    };
    legalModels.findOne.mockResolvedValue(approved);
    const result = await service.acceptLegalModel(
      'site-1',
      { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN },
      { modelId: '00000000-0000-4000-8000-000000000002' },
    );
    expect(state.manualSnapshot).toBe('ручная версия');
    expect(state.modelReviewSourceVersion).toBe('draft-1');
    expect(policyStates.save).toHaveBeenCalledWith(state);
    expect(result.publicationAvailable).toBe(false);
    expect(result.manualModelReview).toMatchObject({
      sourceVersion: 'draft-1',
      targetVersion: 'approved-2',
    });
  });

  it('rejects approval of placeholder legal content', async () => {
    const { service, legalModels } = setup();
    legalModels.findOne.mockResolvedValue({
      id: 'legal-1',
      status: 'draft',
      sections: [{ key: 'general', title: 'Общие', body: 'PLACEHOLDER' }],
      rules: [],
    });
    await expect(
      service.approveLegalModel(
        'legal-1',
        { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN },
        { changeSummary: 'Готово' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps approved legal models immutable', async () => {
    const { service, legalModels } = setup();
    legalModels.findOne.mockResolvedValue({
      id: 'legal-1',
      status: 'approved',
      sections: [],
      rules: [],
    });
    await expect(
      service.updateLegalModel(
        'legal-1',
        { userId: 'admin', platformRole: PlatformRole.WISPO_ADMIN },
        { sections: [], rules: [] },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('restricts legal model administration to Wispo administrators', async () => {
    const { service } = setup();
    await expect(
      service.listLegalModels({
        userId: 'employee',
        platformRole: PlatformRole.EMPLOYEE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
