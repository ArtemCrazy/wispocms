import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PageEntity,
  PageStatus,
  PlatformRole,
  PrivacyLegalModelEntity,
  type PrivacyLegalRule,
  type PrivacyLegalSection,
  type PrivacyModelSectionDiff,
  PrivacyPolicyStateEntity,
  type PrivacySettings,
  SiteEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import {
  hasSitePermission,
  SitePermission,
} from '../content/content.permissions';
import {
  ApprovePrivacyLegalModelDto,
  CreatePrivacyLegalModelDto,
  GeneratePrivacyDocumentDto,
  SelectPrivacyLegalModelDto,
  UpdatePrivacyLegalModelDto,
  UpdatePrivacyCompanyDto,
  UpdatePrivacyManualDocumentDto,
  UpdatePrivacySettingsDto,
  UpdatePrivacyTemplateDto,
} from './privacy.dto';
import {
  generatePrivacyDraft,
  privacyFingerprint,
  privacyMissingFields,
} from './privacy-generator';

type Actor = { userId: string; platformRole: PlatformRole };

const placeholderLegalText =
  'Текст раздела будет добавлен после юридического утверждения.';

function isPlaceholderLegalBody(body: string) {
  const normalized = body.trim();
  return (
    !normalized ||
    normalized === placeholderLegalText ||
    /\b(?:placeholder|todo|tbd)\b/i.test(normalized)
  );
}

const privacyDisplayTemplates = [
  {
    key: 'system-policy',
    version: '1',
    title: 'Стандартный',
    description: 'Полная ширина страницы и выраженные заголовки разделов.',
  },
  {
    key: 'compact-policy',
    version: '1',
    title: 'Компактный',
    description: 'Узкая текстовая колонка для длинного юридического документа.',
  },
] as const;

function templateFingerprint(state: PrivacyPolicyStateEntity) {
  return {
    key: state.displayTemplateKey,
    version: state.displayTemplateVersion,
    config: state.displayTemplateConfig ?? {},
  };
}

function compareLegalModels(
  source: PrivacyLegalModelEntity,
  target: PrivacyLegalModelEntity,
): PrivacyModelSectionDiff[] {
  const sourceSections = new Map(
    source.sections.map((section) => [section.key, section]),
  );
  const targetSections = new Map(
    target.sections.map((section) => [section.key, section]),
  );
  const keys = [
    ...new Set([...sourceSections.keys(), ...targetSections.keys()]),
  ].sort();
  const rulesFor = (model: PrivacyLegalModelEntity, key: string) =>
    model.rules
      .filter((rule) => rule.sectionKey === key)
      .map((rule) => JSON.stringify(rule))
      .sort();

  return keys.map((key) => {
    const sourceSection = sourceSections.get(key);
    const targetSection = targetSections.get(key);
    const status = !sourceSection
      ? 'added'
      : !targetSection
        ? 'removed'
        : sourceSection.title !== targetSection.title ||
            sourceSection.body !== targetSection.body ||
            JSON.stringify(rulesFor(source, key)) !==
              JSON.stringify(rulesFor(target, key))
          ? 'changed'
          : 'unchanged';
    return {
      key,
      status,
      sourceTitle: sourceSection?.title ?? null,
      targetTitle: targetSection?.title ?? null,
    };
  });
}

@Injectable()
export class PrivacyService {
  constructor(
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
    @InjectRepository(PageEntity)
    private readonly pages: Repository<PageEntity>,
    @InjectRepository(PrivacyLegalModelEntity)
    private readonly legalModels: Repository<PrivacyLegalModelEntity>,
    @InjectRepository(PrivacyPolicyStateEntity)
    private readonly policyStates: Repository<PrivacyPolicyStateEntity>,
  ) {}

  private requireAdministrator(actor: Actor) {
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN)
      throw new ForbiddenException(
        'Управление юридическими моделями доступно только администратору Wispo',
      );
  }

  private normalizeLegalModel(
    dto: Pick<CreatePrivacyLegalModelDto, 'sections' | 'rules'>,
  ) {
    const sections: PrivacyLegalSection[] = dto.sections.map((section) => ({
      key: section.key.trim(),
      title: section.title.trim(),
      body: section.body.trim(),
    }));
    const sectionKeys = new Set(sections.map((section) => section.key));
    if (!sections.length || sectionKeys.size !== sections.length)
      throw new BadRequestException(
        'Юридическая модель должна содержать разделы с уникальными ключами',
      );
    const rules: PrivacyLegalRule[] = dto.rules.map((rule) => {
      if (!sectionKeys.has(rule.sectionKey.trim()))
        throw new BadRequestException(
          `Правило ссылается на неизвестный раздел ${rule.sectionKey}`,
        );
      if (!rule.when) return { sectionKey: rule.sectionKey.trim() };
      const hasSetting = Boolean(rule.when.setting);
      const hasBoolean = Boolean(rule.when.boolean);
      if (hasSetting === hasBoolean)
        throw new BadRequestException(
          'Условие правила должно содержать setting или boolean',
        );
      return hasSetting
        ? {
            sectionKey: rule.sectionKey.trim(),
            when: {
              setting: rule.when.setting!,
              ...(rule.when.hasAny?.length && {
                hasAny: rule.when.hasAny.map((value) => value.trim()),
              }),
            },
          }
        : {
            sectionKey: rule.sectionKey.trim(),
            when: { boolean: rule.when.boolean! },
          };
    });
    return { sections, rules };
  }

  private latestApprovedModel() {
    return this.legalModels.findOne({
      where: { status: 'approved' },
      order: { approvedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  private async requireSite(
    siteId: string,
    actor: Actor,
    permission = SitePermission.READ,
  ) {
    const site = await this.sites.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN) {
      const membership = await this.memberships.findOne({
        select: { role: true },
        where: { userId: actor.userId, workspaceId: site.workspaceId },
      });
      if (
        !hasSitePermission(
          actor.platformRole,
          membership?.role ?? null,
          permission,
        )
      )
        throw new ForbiddenException('Недостаточно прав для этого действия');
    }
    return site;
  }

  private async ensureState(site: SiteEntity) {
    let state = await this.policyStates.findOne({
      where: { siteId: site.id },
      relations: { legalModel: true, page: true },
    });
    if (state) return state;
    const [page, approvedModel, latestModel] = await Promise.all([
      this.pages.findOne({
        where: { siteId: site.id, slug: 'privacy-policy' },
      }),
      this.latestApprovedModel(),
      this.legalModels
        .find({ order: { createdAt: 'DESC' }, take: 1 })
        .then(([model]) => model ?? null),
    ]);
    const legalModel = approvedModel ?? latestModel;
    if (!page)
      throw new NotFoundException('Системная страница политики не найдена');
    if (!legalModel)
      throw new NotFoundException('Юридическая модель политики не найдена');
    state = await this.policyStates.save(
      this.policyStates.create({
        siteId: site.id,
        pageId: page.id,
        legalModelId: legalModel.id,
        settings: {},
        displayTemplateKey: 'system-policy',
        displayTemplateVersion: '1',
        displayTemplateConfig: {},
        automaticSnapshot: null,
        manualSnapshot: null,
        publishedSnapshot: null,
        publishedAt: null,
        publishedLegalModelVersion: null,
        publishedDisplayTemplateKey: null,
        publishedDisplayTemplateVersion: null,
        publishedDisplayTemplateConfig: null,
        deferredLegalModelId: null,
        modelReviewSourceVersion: null,
        modelReviewComparison: null,
        mode: 'automatic',
        inputFingerprint: null,
        legacyContentPreserved:
          page.status === PageStatus.PUBLISHED ||
          (page.blocks?.length ?? 0) > 0,
        generatedAt: null,
      }),
    );
    state.legalModel = legalModel;
    state.page = page;
    return state;
  }

  private normalizeSettings(
    current: PrivacySettings,
    dto: UpdatePrivacySettingsDto,
  ): PrivacySettings {
    const cleanArray = (values?: string[]) =>
      values?.map((value) => value.trim()).filter(Boolean);
    const cleanText = (value?: string) => value?.trim() || undefined;
    return {
      ...current,
      ...(dto.dataCategories !== undefined && {
        dataCategories: cleanArray(dto.dataCategories),
      }),
      ...(dto.purposes !== undefined && { purposes: cleanArray(dto.purposes) }),
      ...(dto.services !== undefined && { services: cleanArray(dto.services) }),
      ...(dto.collectionMethods !== undefined && {
        collectionMethods: cleanArray(dto.collectionMethods),
      }),
      ...(dto.otherServiceDescription !== undefined && {
        otherServiceDescription: cleanText(dto.otherServiceDescription),
      }),
      ...(dto.thirdPartyTransfer !== undefined && {
        thirdPartyTransfer: dto.thirdPartyTransfer,
      }),
      ...(dto.thirdPartyDescription !== undefined && {
        thirdPartyDescription: cleanText(dto.thirdPartyDescription),
      }),
      ...(dto.cookies !== undefined && { cookies: dto.cookies }),
    };
  }

  private async serialize(site: SiteEntity, state: PrivacyPolicyStateEntity) {
    const latestApproved = await this.latestApprovedModel();
    const fingerprint = privacyFingerprint(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel.version,
      templateFingerprint(state),
    );
    const missingFields = privacyMissingFields(
      site.globalData ?? {},
      state.settings ?? {},
    );
    const stale = Boolean(
      state.legacyContentPreserved ||
      state.modelReviewSourceVersion ||
      (state.inputFingerprint && state.inputFingerprint !== fingerprint),
    );
    const hasDocument = Boolean(
      state.automaticSnapshot || state.manualSnapshot,
    );
    const updateAvailable =
      latestApproved && latestApproved.id !== state.legalModelId
        ? {
            deferred: state.deferredLegalModelId === latestApproved.id,
            sourceModelId: state.legalModelId,
            sourceVersion: state.legalModel.version,
            targetModelId: latestApproved.id,
            targetVersion: latestApproved.version,
            changeSummary: latestApproved.changeSummary,
            comparison: compareLegalModels(state.legalModel, latestApproved),
          }
        : null;
    const publicationBlockedReason =
      state.legalModel.status !== 'approved'
        ? 'Юридическая модель политики ещё не утверждена'
        : !hasDocument
          ? 'Сначала сформируйте и сохраните документ политики'
          : state.modelReviewSourceVersion
            ? 'Ручную версию нужно сверить с принятой юридической моделью'
            : stale
              ? 'Политика требует внимания. Актуализируйте документ'
              : missingFields.length
                ? `Заполните обязательные данные: ${missingFields.join(', ')}`
                : null;
    const status = stale
      ? 'attention_required'
      : !hasDocument && missingFields.length
        ? 'not_configured'
        : state.mode === 'manual' && state.manualSnapshot
          ? 'manual_changes'
          : state.legalModel.status === 'draft'
            ? 'draft'
            : 'current';
    return {
      siteId: site.id,
      pageId: state.pageId,
      pageStatus: state.page.status,
      company: {
        organizationType: site.globalData?.organizationType ?? '',
        legalName:
          site.globalData?.legalName ?? site.globalData?.companyName ?? '',
        inn: site.globalData?.inn ?? '',
        ogrn: site.globalData?.ogrn ?? '',
        legalAddress:
          site.globalData?.legalAddress ?? site.globalData?.address ?? '',
      },
      settings: state.settings ?? {},
      legalModel: {
        id: state.legalModel.id,
        version: state.legalModel.version,
        status: state.legalModel.status,
        approvedAt: state.legalModel.approvedAt,
        changeSummary: state.legalModel.changeSummary,
        sections: state.legalModel.sections.map(({ key, title }) => ({
          key,
          title,
        })),
      },
      displayTemplate: {
        key: state.displayTemplateKey,
        version: state.displayTemplateVersion,
        config: state.displayTemplateConfig ?? {},
        title:
          privacyDisplayTemplates.find(
            (template) => template.key === state.displayTemplateKey,
          )?.title ?? state.displayTemplateKey,
        status: 'active',
      },
      displayTemplates: privacyDisplayTemplates,
      mode: state.mode,
      status,
      missingFields,
      document:
        state.mode === 'manual'
          ? state.manualSnapshot
          : state.automaticSnapshot,
      automaticSnapshot: state.automaticSnapshot,
      publishedSnapshot: state.publishedSnapshot,
      generatedAt: state.generatedAt,
      updatedAt: state.updatedAt,
      latestApprovedModel: latestApproved
        ? {
            id: latestApproved.id,
            version: latestApproved.version,
            approvedAt: latestApproved.approvedAt,
            changeSummary: latestApproved.changeSummary,
          }
        : null,
      availableUpdate: updateAvailable,
      manualModelReview: state.modelReviewSourceVersion
        ? {
            sourceVersion: state.modelReviewSourceVersion,
            targetVersion: state.legalModel.version,
            comparison: state.modelReviewComparison ?? [],
          }
        : null,
      published: {
        status: state.page.status,
        at: state.publishedAt,
        legalModelVersion: state.publishedLegalModelVersion,
        templateKey: state.publishedDisplayTemplateKey,
        templateVersion: state.publishedDisplayTemplateVersion,
      },
      publicationAvailable: publicationBlockedReason === null,
      publicationBlockedReason,
      draftNotice: !latestApproved
        ? 'Утверждённая юридическая модель отсутствует. Публикация недоступна до импорта и утверждения текста специалистом.'
        : state.legalModel.status === 'draft'
          ? 'Текущая юридическая основа — черновик. Примите утверждённую модель перед публикацией.'
          : null,
    };
  }

  async get(siteId: string, actor: Actor) {
    const site = await this.requireSite(siteId, actor);
    return this.serialize(site, await this.ensureState(site));
  }

  async updateCompany(
    siteId: string,
    actor: Actor,
    dto: UpdatePrivacyCompanyDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const clean = (value?: string) => value?.trim() || undefined;
    site.globalData = {
      ...(site.globalData ?? {}),
      ...(dto.organizationType !== undefined && {
        organizationType: dto.organizationType || undefined,
      }),
      ...(dto.legalName !== undefined && { legalName: clean(dto.legalName) }),
      ...(dto.inn !== undefined && { inn: clean(dto.inn) }),
      ...(dto.ogrn !== undefined && { ogrn: clean(dto.ogrn) }),
      ...(dto.legalAddress !== undefined && {
        legalAddress: clean(dto.legalAddress),
      }),
    };
    await this.sites.save(site);
    return this.serialize(site, await this.ensureState(site));
  }

  async updateSettings(
    siteId: string,
    actor: Actor,
    dto: UpdatePrivacySettingsDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    state.settings = this.normalizeSettings(state.settings ?? {}, dto);
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async generate(
    siteId: string,
    actor: Actor,
    dto: GeneratePrivacyDocumentDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    if (
      state.mode === 'manual' &&
      state.manualSnapshot &&
      !dto.confirmManualReset
    )
      throw new ConflictException(
        'В документ внесены ручные изменения. Подтвердите их замену при перегенерации',
      );
    const missing = privacyMissingFields(
      site.globalData ?? {},
      state.settings ?? {},
    );
    if (missing.length)
      throw new BadRequestException(
        `Заполните обязательные данные: ${missing.join(', ')}`,
      );
    state.automaticSnapshot = generatePrivacyDraft(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel,
    );
    state.manualSnapshot = null;
    state.mode = 'automatic';
    state.inputFingerprint = privacyFingerprint(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel.version,
      templateFingerprint(state),
    );
    state.legacyContentPreserved = false;
    state.modelReviewSourceVersion = null;
    state.modelReviewComparison = null;
    state.generatedAt = new Date();
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async updateManual(
    siteId: string,
    actor: Actor,
    dto: UpdatePrivacyManualDocumentDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    if (!state.automaticSnapshot)
      throw new BadRequestException(
        'Сначала сформируйте автоматический документ',
      );
    const manualSnapshot = dto.text.trim();
    if (!manualSnapshot)
      throw new BadRequestException('Ручной документ не может быть пустым');
    state.manualSnapshot = manualSnapshot;
    state.mode = 'manual';
    state.inputFingerprint = privacyFingerprint(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel.version,
      templateFingerprint(state),
    );
    state.modelReviewSourceVersion = null;
    state.modelReviewComparison = null;
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async resetToAutomatic(siteId: string, actor: Actor) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    const missing = privacyMissingFields(
      site.globalData ?? {},
      state.settings ?? {},
    );
    if (missing.length)
      throw new BadRequestException(
        `Заполните обязательные данные: ${missing.join(', ')}`,
      );
    state.automaticSnapshot = generatePrivacyDraft(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel,
    );
    state.manualSnapshot = null;
    state.mode = 'automatic';
    state.inputFingerprint = privacyFingerprint(
      site.globalData ?? {},
      state.settings ?? {},
      state.legalModel.version,
      templateFingerprint(state),
    );
    state.modelReviewSourceVersion = null;
    state.modelReviewComparison = null;
    state.legacyContentPreserved = false;
    state.generatedAt = new Date();
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async updateTemplate(
    siteId: string,
    actor: Actor,
    dto: UpdatePrivacyTemplateDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const template = privacyDisplayTemplates.find(
      (candidate) =>
        candidate.key === dto.key && candidate.version === dto.version,
    );
    if (!template) throw new BadRequestException('Шаблон политики недоступен');
    const config = dto.config ?? {};
    const normalizedConfig = {
      showSectionNumbers: config.showSectionNumbers === true,
      accentTone: config.accentTone === 'neutral' ? 'neutral' : 'violet',
    };
    const state = await this.ensureState(site);
    state.displayTemplateKey = template.key;
    state.displayTemplateVersion = template.version;
    state.displayTemplateConfig = normalizedConfig;
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async acceptLegalModel(
    siteId: string,
    actor: Actor,
    dto: SelectPrivacyLegalModelDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    const target = await this.legalModels.findOne({
      where: { id: dto.modelId, status: 'approved' },
    });
    if (!target)
      throw new NotFoundException('Утверждённая юридическая модель не найдена');
    if (target.id === state.legalModelId) return this.serialize(site, state);
    const comparison = compareLegalModels(state.legalModel, target);
    const sourceVersion = state.legalModel.version;
    const keepsManual = state.mode === 'manual' && state.manualSnapshot;
    const missing = keepsManual
      ? []
      : privacyMissingFields(site.globalData ?? {}, state.settings ?? {});
    if (missing.length)
      throw new BadRequestException(
        `Заполните обязательные данные перед принятием модели: ${missing.join(', ')}`,
      );

    state.legalModelId = target.id;
    state.legalModel = target;
    state.deferredLegalModelId = null;
    if (keepsManual) {
      state.modelReviewSourceVersion = sourceVersion;
      state.modelReviewComparison = comparison;
    } else {
      state.automaticSnapshot = generatePrivacyDraft(
        site.globalData ?? {},
        state.settings ?? {},
        target,
      );
      state.inputFingerprint = privacyFingerprint(
        site.globalData ?? {},
        state.settings ?? {},
        target.version,
        templateFingerprint(state),
      );
      state.generatedAt = new Date();
      state.modelReviewSourceVersion = null;
      state.modelReviewComparison = null;
      state.legacyContentPreserved = false;
    }
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async deferLegalModel(
    siteId: string,
    actor: Actor,
    dto: SelectPrivacyLegalModelDto,
  ) {
    const site = await this.requireSite(
      siteId,
      actor,
      SitePermission.EDIT_CONTENT,
    );
    const state = await this.ensureState(site);
    const target = await this.legalModels.findOne({
      where: { id: dto.modelId, status: 'approved' },
    });
    if (!target || target.id === state.legalModelId)
      throw new BadRequestException('Обновление юридической модели недоступно');
    state.deferredLegalModelId = target.id;
    await this.policyStates.save(state);
    return this.serialize(site, state);
  }

  async listLegalModels(actor: Actor) {
    this.requireAdministrator(actor);
    return this.legalModels.find({
      relations: { approvedBy: true },
      order: { createdAt: 'DESC' },
    });
  }

  async createLegalModel(actor: Actor, dto: CreatePrivacyLegalModelDto) {
    this.requireAdministrator(actor);
    const version = dto.version.trim();
    if (await this.legalModels.existsBy({ version }))
      throw new ConflictException(
        'Такая версия юридической модели уже существует',
      );
    const { sections, rules } = this.normalizeLegalModel(dto);
    return this.legalModels.save(
      this.legalModels.create({
        version,
        status: 'draft',
        sections,
        rules,
        approvedAt: null,
        approvedByUserId: null,
        changeSummary: null,
      }),
    );
  }

  async updateLegalModel(
    modelId: string,
    actor: Actor,
    dto: UpdatePrivacyLegalModelDto,
  ) {
    this.requireAdministrator(actor);
    const model = await this.legalModels.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Юридическая модель не найдена');
    if (model.status === 'approved')
      throw new ConflictException('Утверждённая модель неизменяема');
    const { sections, rules } = this.normalizeLegalModel(dto);
    model.sections = sections;
    model.rules = rules;
    return this.legalModels.save(model);
  }

  async approveLegalModel(
    modelId: string,
    actor: Actor,
    dto: ApprovePrivacyLegalModelDto,
  ) {
    this.requireAdministrator(actor);
    const model = await this.legalModels.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('Юридическая модель не найдена');
    if (model.status === 'approved')
      throw new ConflictException('Юридическая модель уже утверждена');
    if (model.sections.some((section) => isPlaceholderLegalBody(section.body)))
      throw new BadRequestException(
        'Нельзя утвердить модель с пустым или placeholder-текстом',
      );
    model.status = 'approved';
    model.approvedAt = new Date();
    model.approvedByUserId = actor.userId;
    model.changeSummary = dto.changeSummary.trim();
    return this.legalModels.save(model);
  }
}
