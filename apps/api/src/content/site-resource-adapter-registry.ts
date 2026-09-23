import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  PageEntity,
  PageStatus,
  MediaEntity,
  PrivacyLegalModelEntity,
  PrivacyPolicyStateEntity,
  SiteEntity,
  SiteSearchSettingsEntity,
  SiteVariableEntity,
} from '../database/entities';
import { privacyMissingFields } from '../privacy/privacy-generator';
import { getNotFoundTemplate } from './not-found-templates';
import type {
  SiteResourceAdapterRegistry,
  SiteRevisionResourceType,
} from './site-resource-revisions.service';

type VariableSnapshot = {
  id: string;
  name: string;
  identifier: string;
  value: string;
};

const text = (value: unknown, max: number) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new BadRequestException('Ожидался текст');
  const normalized = value.trim();
  if (normalized.length > max)
    throw new BadRequestException(`Текст длиннее ${max} символов`);
  return normalized || null;
};

const stringArray = (value: unknown) => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new BadRequestException('Ожидался список строк');
  return [...new Set(value)];
};

const uuid = (value: unknown) => {
  const normalized = text(value, 40);
  if (
    !normalized ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  )
    throw new BadRequestException('Ожидался UUID');
  return normalized;
};

export function normalizeSiteResourceSnapshot(
  resourceType: SiteRevisionResourceType,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (resourceType === 'site_seo') {
    const canonicalUrl = text(input.canonicalUrl, 500);
    if (canonicalUrl) {
      try {
        const parsed = new URL(canonicalUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
          throw new Error('protocol');
      } catch {
        throw new BadRequestException('Некорректный canonical URL');
      }
    }
    if (typeof input.noIndex !== 'boolean')
      throw new BadRequestException('Некорректное значение noIndex');
    return {
      seoTitle: text(input.seoTitle, 200),
      seoDescription: text(input.seoDescription, 500),
      canonicalUrl: canonicalUrl?.replace(/\/$/, '') ?? null,
      seoImageMediaId:
        input.seoImageMediaId === null || input.seoImageMediaId === undefined
          ? null
          : uuid(input.seoImageMediaId),
      noIndex: input.noIndex,
    };
  }

  if (resourceType === 'site_variables') {
    if (!Array.isArray(input.items))
      throw new BadRequestException('Ожидался список переменных');
    const ids = new Set<string>();
    const identifiers = new Set<string>();
    const items = input.items.map((raw) => {
      if (!raw || typeof raw !== 'object')
        throw new BadRequestException('Некорректная переменная');
      const item = raw as Record<string, unknown>;
      const id = uuid(item.id);
      const name = text(item.name, 160);
      const identifier = text(item.identifier, 100)?.toLowerCase();
      if (
        !name ||
        name.length < 2 ||
        !identifier ||
        !/^[a-z][a-z0-9_]*$/.test(identifier)
      )
        throw new BadRequestException('Некорректная переменная');
      if (ids.has(id))
        throw new BadRequestException('Идентификаторы записей не повторяются');
      ids.add(id);
      if (identifiers.has(identifier))
        throw new BadRequestException(
          'Идентификаторы переменных не повторяются',
        );
      identifiers.add(identifier);
      if (typeof item.value !== 'string' || item.value.length > 10000)
        throw new BadRequestException('Некорректное значение переменной');
      return { id, name, identifier, value: item.value };
    });
    return { items };
  }

  if (resourceType === 'site_search') {
    const searchableSections = stringArray(input.searchableSections);
    if (
      searchableSections.some(
        (section) => !['articles', 'pages', 'categories'].includes(section),
      )
    )
      throw new BadRequestException('Неизвестный раздел поиска');
    const queries = (value: unknown, recommended = false) => {
      if (!Array.isArray(value))
        throw new BadRequestException('Ожидался список запросов');
      if (value.length > 30)
        throw new BadRequestException('Допустимо не более 30 запросов');
      const ids = new Set<string>();
      const names = new Set<string>();
      return value.map((raw) => {
        if (!raw || typeof raw !== 'object')
          throw new BadRequestException('Некорректный поисковый запрос');
        const item = raw as Record<string, unknown>;
        const id = uuid(item.id);
        const query = text(item.query, 100);
        if (!query || query.length < 2)
          throw new BadRequestException('Некорректный поисковый запрос');
        const key = query.toLocaleLowerCase('ru-RU');
        if (ids.has(id) || names.has(key))
          throw new BadRequestException('Поисковые запросы не повторяются');
        ids.add(id);
        names.add(key);
        if (!recommended) return { id, query };
        if (
          typeof item.hits !== 'number' ||
          !Number.isInteger(item.hits) ||
          item.hits < 0
        )
          throw new BadRequestException('Некорректная статистика запроса');
        return { id, query, hits: item.hits };
      });
    };
    return {
      searchableSections,
      popularQueries: queries(input.popularQueries),
      recommendedQueries: queries(input.recommendedQueries ?? [], true),
    };
  }

  if (resourceType === 'site_not_found') {
    const status = input.status;
    if (status !== PageStatus.DRAFT && status !== PageStatus.PUBLISHED)
      throw new BadRequestException('Некорректный статус страницы 404');
    const templateKey = text(input.templateKey, 80);
    const templateVersion = text(input.templateVersion, 40);
    if (!templateKey || !templateVersion)
      throw new BadRequestException('Шаблон страницы 404 не выбран');
    const template = getNotFoundTemplate(templateKey, templateVersion);
    if (template.key !== templateKey || template.version !== templateVersion)
      throw new BadRequestException('Неизвестный шаблон 404');
    return {
      status,
      seoTitle: text(input.seoTitle, 240),
      seoDescription: text(input.seoDescription, 500),
      templateKey,
      templateVersion,
    };
  }

  if (resourceType === 'site_privacy') {
    const snapshot = structuredClone(input);
    if (
      snapshot.pageStatus === PageStatus.PUBLISHED &&
      !text(snapshot.document, 100000)
    )
      throw new BadRequestException('Документ политики не сформирован');
    return snapshot;
  }

  throw new BadRequestException('Неизвестный тип ресурса');
}

@Injectable()
export class SiteResourceAdapterRegistryService implements SiteResourceAdapterRegistry {
  constructor(private readonly dataSource: DataSource) {}

  private get manager() {
    return this.dataSource.manager;
  }

  private async validateSeoImage(
    manager: EntityManager,
    siteId: string,
    mediaId: string | null,
  ) {
    if (!mediaId) return;
    const site = await manager.findOne(SiteEntity, {
      where: { id: siteId },
      select: { id: true, workspaceId: true },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const media = await manager.findOne(MediaEntity, {
      where: { id: mediaId, workspaceId: site.workspaceId },
    });
    if (!media) throw new NotFoundException('SEO-изображение не найдено');
  }

  private async variableUsageCount(
    manager: EntityManager,
    siteId: string,
    identifier: string,
  ) {
    const escapedIdentifier = identifier.replace(/[\\%_]/g, '\\$&');
    const token = `%{{${escapedIdentifier}}}%`;
    const rows: Array<{ count: string }> = await manager.query(
      `SELECT (
        (SELECT COUNT(*) FROM "sites" entry WHERE entry."id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "pages" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "articles" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "categories" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "banners" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "privacy_policy_states" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "site_content_templates" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\') +
        (SELECT COUNT(*) FROM "article_section_settings" entry WHERE entry."site_id" = $1 AND to_jsonb(entry)::text LIKE $2 ESCAPE '\\')
      )::text AS "count"`,
      [siteId, token],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async normalizeSnapshot(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ) {
    const normalized = normalizeSiteResourceSnapshot(resourceType, snapshot);
    if (resourceType === 'site_seo')
      await this.validateSeoImage(
        this.manager,
        siteId,
        normalized.seoImageMediaId as string | null,
      );
    return normalized;
  }

  async presentSnapshot(
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ) {
    if (resourceType !== 'site_variables') return snapshot;
    const items = Array.isArray(snapshot.items)
      ? (snapshot.items as VariableSnapshot[])
      : [];
    return {
      ...snapshot,
      items: await Promise.all(
        items.map(async (item) => ({
          ...item,
          usageCount: await this.variableUsageCount(
            this.manager,
            siteId,
            item.identifier,
          ),
        })),
      ),
    };
  }

  async publishedSnapshot(
    siteId: string,
    resourceType: SiteRevisionResourceType,
  ): Promise<Record<string, unknown>> {
    if (resourceType === 'site_seo') {
      const site = await this.manager.findOne(SiteEntity, {
        where: { id: siteId },
      });
      if (!site) throw new NotFoundException('Сайт не найден');
      return {
        seoTitle: site.seoTitle,
        seoDescription: site.seoDescription,
        canonicalUrl: site.canonicalUrl,
        seoImageMediaId: site.seoImageMediaId,
        noIndex: site.noIndex,
      };
    }
    if (resourceType === 'site_variables') {
      const items = await this.manager.find(SiteVariableEntity, {
        where: { siteId },
        order: { updatedAt: 'DESC' },
      });
      return {
        items: items.map(({ id, name, identifier, value }) => ({
          id,
          name,
          identifier,
          value,
        })),
      };
    }
    if (resourceType === 'site_search') {
      const settings = await this.manager.findOne(SiteSearchSettingsEntity, {
        where: { siteId },
      });
      return {
        searchableSections: settings?.searchableSections ?? ['articles'],
        popularQueries: settings?.popularQueries ?? [],
        recommendedQueries: settings?.recommendedQueries ?? [],
      };
    }
    if (resourceType === 'site_not_found') {
      const page = await this.manager.findOne(PageEntity, {
        where: { siteId, slug: '404' },
      });
      if (!page) throw new NotFoundException('Страница 404 не найдена');
      const template = getNotFoundTemplate(
        page.publishedSystemTemplateKey ?? page.systemTemplateKey,
        page.publishedSystemTemplateVersion ?? page.systemTemplateVersion,
      );
      return {
        status: page.status,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        templateKey: template.key,
        templateVersion: template.version,
      };
    }
    const state = await this.manager.findOne(PrivacyPolicyStateEntity, {
      where: { siteId },
      relations: { page: true, legalModel: true },
    });
    if (!state) throw new NotFoundException('Политика не найдена');
    const site = await this.manager.findOne(SiteEntity, {
      where: { id: siteId },
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const company = {
      organizationType: site.globalData?.organizationType ?? '',
      legalName:
        site.globalData?.legalName ?? site.globalData?.companyName ?? '',
      inn: site.globalData?.inn ?? '',
      ogrn: site.globalData?.ogrn ?? '',
      legalAddress:
        site.globalData?.legalAddress ?? site.globalData?.address ?? '',
    };
    const settings = state.settings ?? {};
    const document = state.publishedSnapshot;
    const missingFields = privacyMissingFields(site.globalData ?? {}, settings);
    return {
      siteId,
      pageId: state.pageId,
      pageStatus: state.page.status,
      company,
      settings,
      legalModel: {
        id: state.legalModel.id,
        version: state.publishedLegalModelVersion ?? state.legalModel.version,
        status: state.legalModel.status,
        sections: state.legalModel.sections ?? [],
      },
      latestApprovedModel: null,
      availableUpdate: null,
      manualModelReview: null,
      displayTemplate: {
        key: state.publishedDisplayTemplateKey ?? state.displayTemplateKey,
        version:
          state.publishedDisplayTemplateVersion ?? state.displayTemplateVersion,
        config:
          state.publishedDisplayTemplateConfig ??
          state.displayTemplateConfig ??
          {},
        title: 'Опубликованный шаблон',
        status: 'active',
      },
      displayTemplates: [
        {
          key: 'system-policy',
          version: '1',
          title: 'Стандартный',
          description:
            'Полная ширина страницы и выраженные заголовки разделов.',
        },
        {
          key: 'compact-policy',
          version: '1',
          title: 'Компактный',
          description:
            'Узкая текстовая колонка для длинного юридического документа.',
        },
      ],
      mode: state.mode,
      status: document ? 'current' : 'not_configured',
      missingFields,
      document,
      automaticSnapshot: state.mode === 'automatic' ? document : null,
      publishedSnapshot: document,
      generatedAt: state.publishedAt,
      publicationAvailable:
        Boolean(document) &&
        state.legalModel.status === 'approved' &&
        missingFields.length === 0,
      publicationBlockedReason: document
        ? null
        : 'Сначала сформируйте и сохраните документ политики',
      published: {
        status: state.page.status,
        at: state.publishedAt,
        legalModelVersion: state.publishedLegalModelVersion,
        templateKey: state.publishedDisplayTemplateKey,
        templateVersion: state.publishedDisplayTemplateVersion,
      },
      draftNotice: null,
    };
  }

  async activate(
    manager: EntityManager,
    siteId: string,
    resourceType: SiteRevisionResourceType,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    const normalized = normalizeSiteResourceSnapshot(resourceType, snapshot);
    if (resourceType === 'site_seo') {
      await this.validateSeoImage(
        manager,
        siteId,
        normalized.seoImageMediaId as string | null,
      );
      const site = await manager.findOne(SiteEntity, { where: { id: siteId } });
      if (!site) throw new NotFoundException('Сайт не найден');
      await manager.save(SiteEntity, Object.assign(site, normalized));
      return;
    }
    if (resourceType === 'site_variables') {
      const items = normalized.items as VariableSnapshot[];
      const nextIdentifiers = new Set(items.map((item) => item.identifier));
      const current = await manager.find(SiteVariableEntity, {
        where: { siteId },
      });
      for (const variable of current) {
        if (nextIdentifiers.has(variable.identifier)) continue;
        const usageCount = await this.variableUsageCount(
          manager,
          siteId,
          variable.identifier,
        );
        if (usageCount > 0)
          throw new ConflictException(
            `Переменная используется в ${usageCount} элементах. Сначала удалите ссылки {{${variable.identifier}}}`,
          );
      }
      await manager.delete(SiteVariableEntity, { siteId });
      if (items.length)
        await manager.save(
          SiteVariableEntity,
          items.map((item) => ({ ...item, siteId })),
        );
      return;
    }
    if (resourceType === 'site_search') {
      const current = await manager.findOne(SiteSearchSettingsEntity, {
        where: { siteId },
      });
      const promoted = new Set(
        (normalized.popularQueries as Array<{ query: string }>).map((item) =>
          item.query.trim().toLocaleLowerCase('ru-RU'),
        ),
      );
      await manager.upsert(
        SiteSearchSettingsEntity,
        {
          siteId,
          ...normalized,
          recommendedQueries: (current?.recommendedQueries ?? []).filter(
            (item) =>
              !promoted.has(item.query.trim().toLocaleLowerCase('ru-RU')),
          ),
        },
        ['siteId'],
      );
      return;
    }
    if (resourceType === 'site_not_found') {
      const page = await manager.findOne(PageEntity, {
        where: { siteId, slug: '404' },
      });
      if (!page) throw new NotFoundException('Страница 404 не найдена');
      page.status = normalized.status as PageStatus;
      page.seoTitle = normalized.seoTitle as string | null;
      page.seoDescription = normalized.seoDescription as string | null;
      page.noIndex = true;
      page.systemTemplateKey = normalized.templateKey as string;
      page.systemTemplateVersion = normalized.templateVersion as string;
      page.publishedSystemTemplateKey = normalized.templateKey as string;
      page.publishedSystemTemplateVersion =
        normalized.templateVersion as string;
      await manager.save(PageEntity, page);
      return;
    }
    const state = await manager.findOne(PrivacyPolicyStateEntity, {
      where: { siteId },
      relations: { page: true, legalModel: true },
    });
    if (!state) throw new NotFoundException('Политика не найдена');
    const template = normalized.displayTemplate as Record<string, unknown>;
    const legalModel = normalized.legalModel as Record<string, unknown>;
    const document = text(normalized.document, 100000);
    if (!document)
      throw new BadRequestException('Документ политики не сформирован');
    const approvedLegalModel = await manager.findOne(PrivacyLegalModelEntity, {
      where: {
        id: typeof legalModel.id === 'string' ? legalModel.id : '',
        version:
          typeof legalModel.version === 'string' ? legalModel.version : '',
        status: 'approved',
      },
    });
    if (!approvedLegalModel)
      throw new BadRequestException(
        'Юридическая модель политики не утверждена',
      );
    if (
      ![
        ['system-policy', '1'],
        ['compact-policy', '1'],
      ].some(
        ([key, version]) =>
          template.key === key && template.version === version,
      )
    )
      throw new BadRequestException('Шаблон политики недоступен');
    const company =
      normalized.company &&
      typeof normalized.company === 'object' &&
      !Array.isArray(normalized.company)
        ? (normalized.company as Record<string, unknown>)
        : {};
    const settings =
      normalized.settings &&
      typeof normalized.settings === 'object' &&
      !Array.isArray(normalized.settings)
        ? (structuredClone(normalized.settings) as Record<string, unknown>)
        : {};
    if (privacyMissingFields(company, settings).length)
      throw new BadRequestException(
        'В политике не заполнены обязательные данные',
      );
    const site = await manager.findOne(SiteEntity, { where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    const organizationType = company.organizationType;
    if (
      organizationType !== 'ip' &&
      organizationType !== 'ooo' &&
      organizationType !== 'self_employed' &&
      organizationType !== 'other'
    )
      throw new BadRequestException('Некорректный тип организации');
    site.globalData = {
      ...(site.globalData ?? {}),
      organizationType,
      legalName: text(company.legalName, 300) ?? undefined,
      inn: text(company.inn, 20) ?? undefined,
      ogrn: text(company.ogrn, 30) ?? undefined,
      legalAddress: text(company.legalAddress, 500) ?? undefined,
    };
    state.settings = settings;
    state.legalModelId = approvedLegalModel.id;
    state.legalModel = approvedLegalModel;
    state.displayTemplateKey = String(template.key);
    state.displayTemplateVersion = String(template.version);
    state.displayTemplateConfig =
      (template.config as Record<string, unknown>) ?? {};
    state.mode = normalized.mode === 'manual' ? 'manual' : 'automatic';
    state.automaticSnapshot =
      text(normalized.automaticSnapshot, 100000) ??
      (state.mode === 'automatic' ? document : state.automaticSnapshot);
    state.manualSnapshot = state.mode === 'manual' ? document : null;

    state.publishedSnapshot = document;
    state.publishedAt = new Date();
    state.publishedLegalModelVersion = approvedLegalModel.version;
    state.publishedDisplayTemplateKey = String(template.key);
    state.publishedDisplayTemplateVersion = String(template.version);
    state.publishedDisplayTemplateConfig =
      (template.config as Record<string, unknown>) ?? {};
    state.page.status = PageStatus.PUBLISHED;
    state.page.blocks = [
      { id: 'privacy-policy-document', type: 'text', text: document },
    ];
    await manager.save(SiteEntity, site);
    await manager.save(PrivacyPolicyStateEntity, state);
    await manager.save(PageEntity, state.page);
  }
}
