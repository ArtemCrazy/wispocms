import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ContentCenterService } from './content-center.service';
import {
  ResearchDraftDto,
  ResearchRevisionDto,
  ResearchSourceDto,
} from './research.dto';
import { ResearchSearchService } from './research-search.service';
import { publicMaterialUrl } from './public-material';

type Actor = NonNullable<AuthenticatedRequest['auth']>;
type Prepared = {
  id: string;
  number: number;
  content: string;
  created_at: string;
};
type DraftRow = {
  context_kind: ResearchDraftDto['contextKind'];
  direction: string;
  categories: ResearchDraftDto['categories'];
  sources: ResearchSourceDto[];
  revision: number;
};
type Confirmation = {
  id: string;
  draft_revision: number;
  preparation_version_id: string | null;
  context_kind: string;
  context_text: string | null;
  direction: string;
  categories: ResearchDraftDto['categories'];
  sources: ResearchSourceDto[];
  actor_name: string;
  created_at: string;
};
const defaults = () =>
  [
    'Прямые конкуренты',
    'Косвенные конкуренты',
    'Информационные ресурсы',
    'Отраслевые и специализированные ресурсы',
    'Другие источники',
  ].map((name, index) => ({
    id: ['direct', 'indirect', 'information', 'industry', 'other'][index],
    name,
    enabled: index < 4,
  }));
const conflict = () =>
  new ConflictException(
    'Данные исследования изменились. Сохраните свой текст отдельно и обновите раздел перед повторной попыткой.',
  );

@Injectable()
export class ResearchService {
  constructor(
    private readonly db: DataSource,
    private readonly access: ContentCenterService,
    private readonly searchProvider: ResearchSearchService,
  ) {}
  private async lock(manager: EntityManager, workspaceId: string) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `cc:${workspaceId}`,
    ]);
  }
  private async draft(
    workspaceId: string,
    manager = this.db.manager,
  ): Promise<ResearchDraftDto> {
    const [row] = await manager.query<DraftRow[]>(
      'SELECT context_kind,direction,categories,sources,revision FROM cc_research_drafts WHERE workspace_id=$1',
      [workspaceId],
    );
    return row
      ? {
          contextKind: row.context_kind,
          direction: row.direction,
          categories: row.categories,
          sources: row.sources,
          revision: row.revision,
        }
      : {
          contextKind: 'conclusions',
          direction: '',
          categories: defaults(),
          sources: [],
          revision: 0,
        };
  }
  private async prepared(workspaceId: string, manager = this.db.manager) {
    const [row] = await manager.query<Prepared[]>(
      'SELECT id,number,content,created_at FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC LIMIT 1',
      [workspaceId],
    );
    return row ?? null;
  }
  async overview(workspaceId: string, actor: Actor) {
    await this.access.access(workspaceId, actor);
    const [draft, prepared, confirmations] = await Promise.all([
      this.draft(workspaceId),
      this.prepared(workspaceId),
      this.db.query<
        Array<Omit<Confirmation, 'context_text' | 'sources' | 'categories'>>
      >(
        'SELECT id,draft_revision,preparation_version_id,context_kind,direction,actor_name,created_at FROM cc_research_confirmations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30',
        [workspaceId],
      ),
    ]);
    return {
      draft,
      prepared,
      conclusions: null,
      confirmations,
      searchConnected: this.searchProvider.connected,
    };
  }
  private async normalize(dto: ResearchDraftDto) {
    const candidate = plainToInstance(ResearchDraftDto, dto);
    if (
      (
        await validate(candidate, {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length
    )
      throw new BadRequestException(
        'Проверьте данные: до 20 категорий, 100 источников; заполните названия и ссылки.',
      );
    const categories = new Set(candidate.categories.map((c) => c.id));
    if (
      new Set(candidate.categories.map((c) => c.name.toLowerCase())).size !==
      candidate.categories.length
    )
      throw new BadRequestException('Названия категорий не должны повторяться');
    const seen = new Set<string>();
    for (const source of candidate.sources) {
      if (!categories.has(source.categoryId))
        throw new BadRequestException(
          'Для каждого источника выберите существующую категорию',
        );
      const url = publicMaterialUrl(source.url);
      url.hash = '';
      source.url = url.href;
      if (seen.has(source.url))
        throw new BadRequestException(
          'Этот адрес уже есть в списке источников',
        );
      seen.add(source.url);
    }
    return candidate;
  }
  private async store(
    workspaceId: string,
    dto: ResearchDraftDto,
    manager: EntityManager,
  ) {
    const previous = await this.draft(workspaceId, manager);
    if (previous.revision !== dto.revision) throw conflict();
    const [row] = await manager.query<Array<{ revision: number }>>(
      `INSERT INTO cc_research_drafts (workspace_id,context_kind,direction,categories,sources) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) ON CONFLICT (workspace_id) DO UPDATE SET context_kind=excluded.context_kind,direction=excluded.direction,categories=excluded.categories,sources=excluded.sources,revision=cc_research_drafts.revision+1,updated_at=now() RETURNING revision`,
      [
        workspaceId,
        dto.contextKind,
        dto.direction,
        JSON.stringify(dto.categories),
        JSON.stringify(dto.sources),
      ],
    );
    return { ...dto, revision: row.revision };
  }
  async save(workspaceId: string, actor: Actor, dto: ResearchDraftDto) {
    await this.access.access(workspaceId, actor);
    const clean = await this.normalize(dto);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      return this.store(workspaceId, clean, manager);
    });
  }
  private context(
    prepared: Prepared | null,
    dto: ResearchDraftDto,
    expected: string | null,
  ) {
    if ((prepared?.id ?? null) !== expected)
      throw new ConflictException(
        'Появилась новая версия подготовленной информации. Обновите раздел и проверьте данные исследования.',
      );
    if (!prepared) {
      if (!dto.direction.trim())
        throw new BadRequestException(
          'Без обработанных материалов укажите направление исследования',
        );
      return null;
    }
    if (dto.contextKind === 'conclusions')
      throw new BadRequestException(
        'Структурированные выводы пока не сформированы. Выберите полный результат обработки.',
      );
    return {
      versionId: prepared.id,
      kind: dto.contextKind,
      content: prepared.content,
    };
  }
  async confirmation(workspaceId: string, actor: Actor, id: string) {
    await this.access.access(workspaceId, actor);
    const [row] = await this.db.query<Confirmation[]>(
      'SELECT id,draft_revision,preparation_version_id,context_kind,context_text,direction,categories,sources,actor_name,created_at FROM cc_research_confirmations WHERE workspace_id=$1 AND id=$2',
      [workspaceId, id],
    );
    if (!row) throw new NotFoundException('Подтверждённый список не найден');
    return row;
  }
  async confirm(workspaceId: string, actor: Actor, dto: ResearchRevisionDto) {
    const actorName = await this.access.access(workspaceId, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const draft = await this.draft(workspaceId, manager);
      if (draft.revision !== dto.revision) throw conflict();
      const context = this.context(
        await this.prepared(workspaceId, manager),
        draft,
        dto.preparationVersionId,
      );
      const sources = draft.sources.filter((s) => s.included);
      if (!sources.length)
        throw new BadRequestException(
          'Выберите хотя бы один источник для исследования',
        );
      const [row] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cc_research_confirmations (workspace_id,draft_revision,preparation_version_id,context_kind,context_text,direction,categories,sources,actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(workspace_id,draft_revision,preparation_version_id) DO UPDATE SET draft_revision=excluded.draft_revision RETURNING id`,
        [
          workspaceId,
          draft.revision,
          context?.versionId ?? null,
          context?.kind ?? 'none',
          context?.content ?? null,
          draft.direction,
          JSON.stringify(draft.categories),
          JSON.stringify(sources),
          actorName,
        ],
      );
      return row;
    });
  }
  async search(workspaceId: string, actor: Actor, dto: ResearchRevisionDto) {
    await this.access.access(workspaceId, actor);
    if (!this.searchProvider.connected)
      throw new ServiceUnavailableException(
        'Автоматический поиск ещё не подключён. Добавляйте источники вручную.',
      );
    const token = randomUUID();
    const input = await this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const draft = await this.draft(workspaceId, manager);
      if (draft.revision !== dto.revision) throw conflict();
      const context = this.context(
        await this.prepared(workspaceId, manager),
        draft,
        dto.preparationVersionId,
      );
      const categories = draft.categories.filter((c) => c.enabled);
      if (!categories.length)
        throw new BadRequestException('Выберите категории поиска');
      const locks = await manager.query<Array<{ token: string }>>(
        `INSERT INTO cc_research_search_locks (workspace_id,token,expires_at) VALUES ($1,$2,now()+interval '60 seconds') ON CONFLICT(workspace_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE cc_research_search_locks.expires_at < now() RETURNING token`,
        [workspaceId, token],
      );
      if (!locks.length)
        throw new ConflictException('Поиск уже выполняется. Повторите позже.');
      return { draft, context, categories };
    });
    try {
      const found = await this.searchProvider.search({
        context: input.context,
        direction: input.draft.direction,
        categories: input.categories,
      });
      if (!Array.isArray(found) || found.length > 100)
        throw new ServiceUnavailableException(
          'Поиск вернул некорректный список. Сохранённые данные не изменены.',
        );
      const additions = found.map((source) => ({
        ...source,
        id: randomUUID(),
        included: true,
      }));
      const normalized = await this.normalize({
        ...input.draft,
        sources: additions,
      });
      if (
        normalized.sources.some(
          (s) => !input.categories.some((c) => c.id === s.categoryId),
        )
      )
        throw new ServiceUnavailableException(
          'Поиск вернул источник из невыбранной категории',
        );
      const existing = new Set(input.draft.sources.map((s) => s.url));
      const merged = await this.normalize({
        ...input.draft,
        sources: [
          ...input.draft.sources,
          ...normalized.sources.filter((s) => !existing.has(s.url)),
        ],
      });
      await this.access.access(workspaceId, actor);
      return await this.db.transaction(async (manager) => {
        await this.lock(manager, workspaceId);
        this.context(
          await this.prepared(workspaceId, manager),
          merged,
          dto.preparationVersionId,
        );
        return this.store(workspaceId, merged, manager);
      });
    } finally {
      await this.db.query(
        'DELETE FROM cc_research_search_locks WHERE workspace_id=$1 AND token=$2',
        [workspaceId, token],
      );
    }
  }
}
