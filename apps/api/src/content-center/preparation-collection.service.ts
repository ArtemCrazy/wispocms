import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiProviderError } from '../ai/ai-provider.error';
import { readPublicMaterial } from './public-material';
import {
  SiteCrawler,
  SITE_RULE_SELECTION_NOTE,
  siteCoverage,
  type SitePage,
  type SiteDiscovery,
} from './site-crawler';
import { preparationTopic } from './preparation-topics';
import { isVkUrl, VkSourceError } from './vk-source';
import { VkConnectionService } from './vk-connection.service';
import {
  isTelegramUrl,
  TelegramSourceClient,
  TelegramSourceError,
} from './telegram-source';
import type {
  PreparationInput,
  PreparationProgress,
  SourceSnapshot,
} from './preparation-ai.service';

export const PREPARATION_CONTEXT_LIMIT = 2_200_000;

@Injectable()
export class PreparationCollectionService {
  constructor(
    private readonly db: DataSource,
    private readonly vk: VkConnectionService = new VkConnectionService(db),
  ) {}

  async collect(
    workspaceId: string,
    input: PreparationInput,
    progress: (value: PreparationProgress) => Promise<void>,
    signal: AbortSignal,
    options: {
      persistSnapshots?: boolean;
      allowUnread?: boolean;
      selectPages?: (
        pages: SitePage[],
        signal: AbortSignal,
      ) => Promise<SitePage[]>;
    } = {},
  ): Promise<PreparationInput> {
    const materials: PreparationInput['materials'] = [];
    const sources: SourceSnapshot[] = [];
    let characters = 0;
    let readable = 0;
    for (const [index, material] of input.materials.entries()) {
      signal.throwIfAborted();
      const sourceId = `S${index + 1}`;
      const snapshot: SourceSnapshot = {
        sourceId,
        materialId: material.id,
        title: material.title,
        sourceUrl: material.sourceUrl,
        checkedAt: new Date().toISOString(),
        mode: material.sourceUrl
          ? material.urlCategory === 'site'
            ? 'main-pages'
            : 'single-page'
          : 'provided',
        warnings: [],
        pages: [],
      };
      await progress({
        stage: 'collecting',
        message: `Сбор источника: ${material.title}`,
        completed: index,
        total: input.materials.length,
      });
      const vkSource =
        material.urlCategory === 'social' && isVkUrl(material.sourceUrl);
      const telegramSource =
        material.urlCategory === 'social' && isTelegramUrl(material.sourceUrl);
      if (material.sourceUrl && vkSource) {
        snapshot.mode = 'social-feed';
        try {
          const collected = await this.vk.collect(
            workspaceId,
            material.id,
            material.revision,
            material.sourceUrl,
            signal,
          );
          snapshot.pages = collected.pages;
          snapshot.warnings = collected.warnings;
        } catch (error) {
          signal.throwIfAborted();
          snapshot.pages = [
            {
              url: material.sourceUrl,
              title: material.title,
              group: 'VK',
              status: 'failed',
              recommended: true,
              error:
                error instanceof VkSourceError
                  ? error.message
                  : 'Не удалось прочитать VK. Проверьте общее подключение VK в настройках CMS.',
            },
          ];
        }
      } else if (material.sourceUrl && telegramSource) {
        snapshot.mode = 'social-feed';
        try {
          const collected = await new TelegramSourceClient().collect(
            material.sourceUrl,
            signal,
          );
          snapshot.pages = collected.pages;
          snapshot.warnings = collected.warnings;
        } catch (error) {
          signal.throwIfAborted();
          // A failed refresh must leave the previous Telegram snapshot intact.
          if (options.allowUnread)
            throw new AiProviderError(
              error instanceof TelegramSourceError
                ? error.message
                : 'Не удалось прочитать публичный Telegram-канал. Предыдущий сбор сохранён.',
            );
          snapshot.pages = [
            {
              url: material.sourceUrl,
              title: material.title,
              group: 'Telegram',
              status: 'failed',
              recommended: true,
              error:
                error instanceof TelegramSourceError
                  ? error.message
                  : 'Не удалось прочитать публичный Telegram-канал. Проверьте ссылку или добавьте текст вручную.',
            },
          ];
        }
      } else if (material.sourceUrl && material.urlCategory === 'site') {
        let discovered: SitePage[] = [];
        let loaded: SitePage[] = [];
        let discoveryStatus: SiteDiscovery = {
          state: 'partial',
          checkedPages: 0,
          pendingPages: 0,
          pendingSitemaps: 0,
          reasons: ['Не удалось завершить поиск структуры сайта.'],
        };
        try {
          const crawler = new SiteCrawler(
            material.sourceUrl,
            () => {
              signal.throwIfAborted();
              return Promise.resolve();
            },
            signal,
          );
          const discovery = await crawler.discover(async (checked, found) => {
            await progress({
              stage: 'collecting',
              message: `${material.title}: поиск структуры — найдено ${found}, проверено ${checked} страниц`,
              completed: checked,
              total: found,
            });
          });
          discovered = options.selectPages
            ? discovery.pages.map((page) => ({ ...page, recommended: true }))
            : discovery.pages;
          discoveryStatus = discovery.discovery;
          snapshot.warnings = options.selectPages
            ? discovery.warnings.filter(
                (warning) => warning !== SITE_RULE_SELECTION_NOTE,
              )
            : discovery.warnings;
          const selected = discovered.filter((page) => page.recommended);
          loaded = await crawler.collect(selected, async (pages) => {
            loaded = pages;
            await progress({
              stage: 'collecting',
              message: `${material.title}: прочитано ${pages.filter((p) => p.status === 'loaded').length}, проверено ${pages.length} из ${selected.length}`,
              completed: pages.length,
              total: selected.length,
            });
          });
        } catch {
          signal.throwIfAborted();
          snapshot.warnings.push(
            'Обход сайта завершён не полностью: доступ ограничен, истекло время или сайт не отдал читаемый текст.',
          );
        }
        // Preserve failures and exclusions in the registry, but never pretend they were read.
        snapshot.pages = discovered.map((page) => {
          // Redirected pages remain attached to their original selection by position below.
          const selectedIndex = discovered
            .filter((item) => item.recommended)
            .indexOf(page);
          if (selectedIndex >= 0 && loaded[selectedIndex])
            return loaded[selectedIndex];
          return page.recommended
            ? {
                ...page,
                status: 'pending',
                reason: 'Обход прерван до завершения проверки страницы',
              }
            : page;
        });
        if (!snapshot.pages.length)
          snapshot.pages.push({
            url: material.sourceUrl,
            title: material.title,
            group: 'Главная',
            recommended: true,
            status: 'failed',
            error: 'Сайт не удалось прочитать',
          });
        if (options.selectPages) {
          // AI failures must fail the run explicitly, not be mistaken for crawler errors.
          snapshot.pages = await options.selectPages(snapshot.pages, signal);
          snapshot.warnings.push(
            'Основные страницы включены программно. Дополнительные страницы оценены AI по фрагментам и задаче; при сомнении доступный полный текст включён в анализ. Недоступные и не проверенные страницы AI не оценивал. Отбор не гарантирует полноту сайта.',
          );
        }
        snapshot.coverage = siteCoverage(discoveryStatus, snapshot.pages);
      } else {
        let content = material.content;
        let error: string | undefined;
        if (material.sourceUrl) {
          try {
            content = await readPublicMaterial(material.sourceUrl);
          } catch {
            content = '';
            error =
              'Страница недоступна. Старый текст не используется как актуальный.';
          }
        }
        snapshot.pages = [
          {
            url: material.sourceUrl ?? '',
            title: material.title,
            group: 'Материал',
            recommended: true,
            status: content && !material.sourceError ? 'loaded' : 'failed',
            content,
            error:
              error ?? (!content ? 'Текст материала не загружен' : undefined),
            checkedAt: snapshot.checkedAt,
          },
        ];
        // A successfully refreshed URL supersedes the warning saved when it was first added.
        if (material.sourceUrl && content) snapshot.pages[0].status = 'loaded';
      }
      for (const [pageIndex, page] of snapshot.pages.entries()) {
        if (!page.recommended || page.status !== 'loaded' || !page.content)
          continue;
        characters += page.content.length;
        if (characters > PREPARATION_CONTEXT_LIMIT)
          throw new AiProviderError(
            'Собранные материалы превышают безопасный объём одного запуска (2,2 млн символов). Уменьшите число источников. Предыдущая версия сохранена.',
          );
        readable++;
        materials.push({
          title: `[${sourceId}.${pageIndex + 1}] ${page.title}`,
          content: page.content,
          sourceUrl: page.url || null,
          topic:
            snapshot.mode === 'main-pages'
              ? preparationTopic(page, sourceId)
              : { sourceId, key: 'material', label: material.title },
        });
      }
      const failed = snapshot.pages.filter((page) => page.status === 'failed');
      materials.push({
        title: `[${sourceId}] Охват источника «${material.title}»`,
        sourceUrl: material.sourceUrl,
        topic: {
          sourceId,
          key: 'coverage',
          label: 'Охват и ограничения источника',
        },
        content: JSON.stringify({
          mode: snapshot.mode,
          warnings: snapshot.warnings,
          coverage: snapshot.coverage,
          loaded: snapshot.pages
            .filter((p) => p.status === 'loaded')
            .map((p) => p.url),
          unavailable: failed.map((p) => ({ url: p.url, reason: p.error })),
          unchecked: snapshot.pages
            .filter((p) => p.status === 'pending')
            .map((p) => ({ url: p.url, reason: p.reason })),
          excluded: snapshot.pages.filter((p) => !p.recommended).length,
          rule: 'Выводы только по прочитанным материалам. Не найдено в выборке не означает отсутствие у компании. Маркетинговые заявления не являются независимо проверенными фактами.',
        }),
      });
      sources.push(snapshot);
      if (
        options.persistSnapshots !== false &&
        material.id &&
        material.sourceUrl &&
        (material.urlCategory === 'site' || vkSource || telegramSource)
      ) {
        // An edit/deletion during collection cannot be overwritten or resurrected.
        await this.db.query(
          `UPDATE cc_materials SET site_pages=$4::jsonb,site_checked_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND source_url=$5`,
          [
            workspaceId,
            material.id,
            material.revision,
            JSON.stringify(snapshot),
            material.sourceUrl,
          ],
        );
      }
    }
    if (
      !options.allowUnread &&
      input.materials.length &&
      !readable &&
      !input.files?.length
    )
      throw new AiProviderError(
        'Не удалось прочитать ни один источник. Проверьте ссылки или добавьте текст вручную. Новая версия не создана.',
      );
    return { ...input, materials, sources };
  }
}
