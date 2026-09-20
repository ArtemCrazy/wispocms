import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PlatformRole } from '../database/entities';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import type {
  MaterialDto,
  PreparationDraftDto,
  PreparationDto,
  PromptDto,
  UpdateMaterialDto,
} from './content-center.dto';
import { PreparationAiService } from './preparation-ai.service';
import { AiProviderError } from '../ai/ai-provider.error';
import type {
  PreparationInput,
  PreparationProgress,
  SourceSnapshot,
} from './preparation-ai.service';
import {
  PreparationCollectionService,
  PREPARATION_CONTEXT_LIMIT,
} from './preparation-collection.service';
import {
  materialText,
  publicMaterialUrl,
  readPublicMaterial,
} from './public-material';
import { validateMaterialFile } from './material-file';
import type { MaterialUpload } from './material-file';
import { isVkUrl, vkCommunityAddress } from './vk-source';

type Actor = NonNullable<AuthenticatedRequest['auth']>;
type Material = {
  id: string;
  title: string;
  kind: string;
  content: string;
  source_url: string | null;
  file_name: string | null;
  revision: number;
  url_category: string;
  file_size: number | null;
  media_type: string | null;
  has_original: boolean;
  source_error: string | null;
  site_pages?: SourceSnapshot | null;
  site_checked_at?: Date | null;
};
type Version = {
  id: string;
  workspace_id: string;
  number: number;
  content: string;
  actor_name: string;
  reason: string;
  restored_from: number | null;
  created_at: Date;
  sources?: SourceSnapshot[] | null;
  prompt_title: string | null;
  instruction: string | null;
};
type RunSummary = {
  id: string;
  status: string;
  actor_name: string;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};
type Draft = {
  instruction: string;
  prompt_title: string | null;
  without_materials: boolean;
  revision: number;
};
type Run = {
  id: string;
  workspace_id: string;
  instruction: string;
  prompt_title: string | null;
  actor_name: string;
  input_context: PreparationInput;
  status: string;
  operation: 'prepare' | 'collect';
  source_material_id: string | null;
};
const RUN_FIELDS =
  'id, status, actor_name, error, progress, created_at, started_at, finished_at';

@Injectable()
export class ContentCenterService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private readonly logger = new Logger(ContentCenterService.name);

  constructor(
    private readonly db: DataSource,
    private readonly ai: PreparationAiService,
    private readonly collection: PreparationCollectionService = new PreparationCollectionService(
      db,
    ),
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.processNext().catch(() =>
        this.logger.error('Не удалось выполнить задачу подготовки информации'),
      );
    }, 2000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async access(workspaceId: string, actor: Actor): Promise<string> {
    const rows = await this.db.query<Array<{ full_name: string }>>(
      `
      SELECT u.full_name FROM workspaces w JOIN users u ON u.id = $2 AND u.is_active = true
      WHERE w.id = $1 AND ($3::boolean OR EXISTS (
        SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = w.id AND m.user_id = u.id
      ))`,
      [
        workspaceId,
        actor.userId,
        actor.platformRole === PlatformRole.WISPO_ADMIN,
      ],
    );
    if (!rows[0])
      throw new NotFoundException('Рабочее пространство недоступно');
    return rows[0].full_name;
  }

  private async lock(manager: EntityManager, workspaceId: string) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `cc:${workspaceId}`,
    ]);
  }

  async overview(workspaceId: string, actor: Actor) {
    await this.access(workspaceId, actor);
    const [materials, prompts, versions, runs, drafts] = await Promise.all([
      this.db.query<
        Array<
          Omit<Material, 'content'> & { characters: number; updated_at: Date }
        >
      >(
        `SELECT id, title, kind, source_url, file_name, revision, url_category, file_size, media_type, source_error, site_checked_at, (file_data IS NOT NULL) AS has_original, length(content) AS characters, created_at, updated_at FROM cc_materials WHERE workspace_id=$1 ORDER BY created_at DESC`,
        [workspaceId],
      ),
      this.db.query<Array<{ id: string; title: string; content: string }>>(
        `SELECT id, title, content FROM platform_prompts ORDER BY created_at DESC,id`,
      ),
      this.db.query<
        Array<Omit<Version, 'workspace_id' | 'content' | 'instruction'>>
      >(
        `SELECT id, number, actor_name, reason, restored_from, created_at, prompt_title FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC`,
        [workspaceId],
      ),
      this.db.query<RunSummary[]>(
        `SELECT ${RUN_FIELDS} FROM cc_preparation_runs WHERE workspace_id=$1 AND operation='prepare' ORDER BY created_at DESC LIMIT 1`,
        [workspaceId],
      ),
      this.db.query<Draft[]>(
        `SELECT instruction, prompt_title, without_materials, revision FROM cc_preparation_drafts WHERE workspace_id=$1`,
        [workspaceId],
      ),
    ]);
    return {
      materials,
      prompts,
      versions,
      run: runs[0] ?? null,
      draft: drafts[0] ?? {
        instruction: '',
        prompt_title: null,
        without_materials: false,
        revision: 0,
      },
      ai: { connected: this.ai.configured },
    };
  }

  async getMaterial(workspaceId: string, id: string, actor: Actor) {
    await this.access(workspaceId, actor);
    const [row] = await this.db.query<Material[]>(
      `SELECT id, title, kind, source_url, file_name, content, revision, url_category, file_size, media_type, source_error, site_pages, site_checked_at, (file_data IS NOT NULL) AS has_original FROM cc_materials WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, id],
    );
    if (!row) throw new NotFoundException('Материал не найден');
    const [collectionRun] = await this.db.query<RunSummary[]>(
      `SELECT ${RUN_FIELDS} FROM cc_preparation_runs WHERE workspace_id=$1 AND source_material_id=$2 AND operation='collect' ORDER BY created_at DESC LIMIT 1`,
      [workspaceId, id],
    );
    return { ...row, collection_run: collectionRun ?? null };
  }

  async refreshSource(
    workspaceId: string,
    id: string,
    actor: Actor,
    revision: number,
  ) {
    const actorName = await this.access(workspaceId, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      await this.requireIdle(manager, workspaceId);
      const [material] = await manager.query<Material[]>(
        `SELECT id,title,kind,source_url,revision,url_category FROM cc_materials WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      if (!material) throw new NotFoundException('Материал не найден');
      if (
        material.kind !== 'url' ||
        !(
          material.url_category === 'site' ||
          (material.url_category === 'social' && isVkUrl(material.source_url))
        ) ||
        !material.source_url
      )
        throw new BadRequestException(
          'Обновить сбор можно для сайта или сообщества VK',
        );
      if (material.revision !== revision)
        throw new ConflictException(
          'Ссылка изменилась. Откройте источник заново.',
        );
      publicMaterialUrl(material.source_url);
      const input: PreparationInput = {
        previousResult: null,
        materials: [
          {
            id: material.id,
            revision: material.revision,
            title: material.title,
            sourceUrl: material.source_url,
            urlCategory: material.url_category,
            content: '',
          },
        ],
      };
      const [run] = await manager.query<RunSummary[]>(
        `INSERT INTO cc_preparation_runs(workspace_id,status,actor_name,instruction,input_context,provider,operation,source_material_id)
         VALUES ($1,'queued',$2,'',$3::jsonb,'source-collection','collect',$4) RETURNING ${RUN_FIELDS}`,
        [workspaceId, actorName, JSON.stringify(input), material.id],
      );
      return run;
    });
  }

  private async requireRefreshSource(
    run: Run,
    manager: Pick<EntityManager, 'query'> = this.db,
  ) {
    const source = run.input_context.materials[0];
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM cc_materials WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND source_url=$4 AND kind='url' AND url_category=$5`,
      [
        run.workspace_id,
        run.source_material_id,
        source.revision,
        source.sourceUrl,
        source.urlCategory,
      ],
    );
    if (!rows.length)
      throw new AiProviderError(
        'Источник изменён или удалён. Сбор не применён; запустите его заново для актуальной ссылки.',
      );
  }

  async uploadFile(workspaceId: string, actor: Actor, upload?: MaterialUpload) {
    await this.access(workspaceId, actor);
    const file = validateMaterialFile(upload);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const [usage] = await manager.query<Array<{ total: string }>>(
        `SELECT count(*) AS total FROM cc_materials WHERE workspace_id=$1`,
        [workspaceId],
      );
      if (Number(usage.total) >= 50)
        throw new BadRequestException('Можно добавить до 50 материалов');
      const [row] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cc_materials (workspace_id,title,kind,file_name,content,file_data,file_size,media_type) VALUES ($1,$2,'file',$3,$4,$5,$6,$7) RETURNING id`,
        [
          workspaceId,
          file.fileName.slice(0, 160),
          file.fileName,
          file.content,
          file.data,
          file.size,
          file.mediaType,
        ],
      );
      return row;
    });
  }

  async getFile(workspaceId: string, id: string, actor: Actor) {
    await this.access(workspaceId, actor);
    const [row] = await this.db.query<
      Array<{
        file_data: Buffer | null;
        file_name: string;
        content: string;
        media_type: string | null;
      }>
    >(
      `SELECT file_data,file_name,content,media_type FROM cc_materials WHERE workspace_id=$1 AND id=$2 AND kind='file'`,
      [workspaceId, id],
    );
    if (!row) throw new NotFoundException('Файл не найден');
    return {
      data: row.file_data ?? Buffer.from(row.content, 'utf8'),
      fileName: row.file_name,
      mediaType: row.media_type ?? 'text/plain',
    };
  }

  async saveMaterial(
    workspaceId: string,
    actor: Actor,
    dto: MaterialDto | UpdateMaterialDto,
    id?: string,
  ) {
    await this.access(workspaceId, actor);
    if (id && (await this.getMaterial(workspaceId, id, actor)).has_original)
      throw new BadRequestException(
        'Чтобы заменить оригинал, загрузите новый файл и удалите старый',
      );
    let content: string;
    let sourceError: string | null = null;
    if (dto.kind === 'url') {
      publicMaterialUrl(dto.sourceUrl ?? '');
      const vkSource = dto.urlCategory === 'social' && isVkUrl(dto.sourceUrl);
      if (vkSource) vkCommunityAddress(dto.sourceUrl!);
      if (dto.urlCategory === 'site' || vkSource) {
        // Collection belongs to the explicit run, not to saving a link.
        content = '';
      } else
        try {
          content = await readPublicMaterial(dto.sourceUrl ?? '');
        } catch {
          content = '';
          sourceError =
            'Ссылка сохранена, но текст страницы недоступен. При необходимости добавьте его вручную.';
        }
    } else {
      if (dto.kind === 'file' && !/\.(txt|md)$/i.test(dto.fileName ?? ''))
        throw new BadRequestException(
          'В этой версии поддерживаются файлы TXT и Markdown в UTF-8',
        );
      content = materialText(dto.content ?? '', false);
    }
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      if (!id) {
        const [count] = await manager.query<Array<{ total: string }>>(
          `SELECT count(*) AS total FROM cc_materials WHERE workspace_id=$1`,
          [workspaceId],
        );
        if (Number(count.total) >= 50)
          throw new BadRequestException('Можно добавить до 50 материалов');
      }
      const params = [
        workspaceId,
        dto.title,
        dto.kind,
        dto.kind === 'url' ? dto.sourceUrl : null,
        dto.kind === 'file' ? dto.fileName : null,
        content,
        dto.kind === 'url' ? (dto.urlCategory ?? 'other') : 'other',
        sourceError,
      ];
      const rows = id
        ? await manager.query<Array<{ id: string }>>(
            `WITH changed AS (UPDATE cc_materials SET title=$2, kind=$3, source_url=$4, file_name=$5, content=$6, url_category=$7, source_error=$8, site_pages=NULL,site_checked_at=NULL, revision=revision+1, updated_at=now() WHERE workspace_id=$1 AND id=$9 AND revision=$10 AND file_data IS NULL RETURNING id) SELECT * FROM changed`,
            [...params, id, (dto as UpdateMaterialDto).revision],
          )
        : await manager.query<Array<{ id: string }>>(
            `INSERT INTO cc_materials (workspace_id,title,kind,source_url,file_name,content,url_category,source_error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            params,
          );
      if (!rows.length)
        throw new ConflictException(
          'Материал изменён другим сотрудником. Откройте его заново.',
        );
      if (id)
        await manager.query(
          `DELETE FROM cc_vk_connections WHERE workspace_id=$1 AND material_id=$2 AND (source_url IS DISTINCT FROM $3 OR $4::boolean)`,
          [
            workspaceId,
            id,
            dto.sourceUrl ?? null,
            dto.kind !== 'url' || dto.urlCategory !== 'social',
          ],
        );
      return rows[0];
    });
  }

  async deleteMaterial(
    workspaceId: string,
    id: string,
    revision: number,
    actor: Actor,
  ) {
    await this.access(workspaceId, actor);
    const rows = await this.db.query<Array<{ id: string }>>(
      `WITH removed AS (DELETE FROM cc_materials WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id) SELECT * FROM removed`,
      [workspaceId, id, revision],
    );
    if (!rows.length)
      throw new ConflictException(
        'Материал уже изменён или удалён. Обновите список.',
      );
    return { deleted: true };
  }

  async createPrompt(workspaceId: string, actor: Actor, dto: PromptDto) {
    await this.access(workspaceId, actor);
    void dto; // Retired route retained for a clear response to cached clients.
    throw new GoneException(
      'Библиотека промптов теперь общая. Обновите страницу; редактирование доступно администратору в настройках платформы.',
    );
  }

  async saveDraft(workspaceId: string, actor: Actor, dto: PreparationDraftDto) {
    await this.access(workspaceId, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const rows = await manager.query<Array<{ revision: number }>>(
        `
        INSERT INTO cc_preparation_drafts (workspace_id,instruction,without_materials,prompt_title)
        SELECT $1,$2,$3,$5 WHERE $4::integer=0
        ON CONFLICT (workspace_id) DO NOTHING RETURNING revision`,
        [
          workspaceId,
          dto.instruction,
          dto.withoutMaterials,
          dto.revision,
          dto.promptTitle?.trim() || null,
        ],
      );
      if (rows.length) return rows[0];
      const updated = await manager.query<Array<{ revision: number }>>(
        `WITH changed AS (UPDATE cc_preparation_drafts SET instruction=$2, without_materials=$3, prompt_title=$5, revision=revision+1 WHERE workspace_id=$1 AND revision=$4 RETURNING revision) SELECT * FROM changed`,
        [
          workspaceId,
          dto.instruction,
          dto.withoutMaterials,
          dto.revision,
          dto.promptTitle?.trim() || null,
        ],
      );
      if (!updated.length)
        throw new ConflictException(
          'Задача изменена другим сотрудником. Скопируйте свой текст и обновите страницу.',
        );
      return updated[0];
    });
  }

  async start(workspaceId: string, actor: Actor, dto: PreparationDto) {
    const actorName = await this.access(workspaceId, actor);
    if (!this.ai.configured)
      throw new ServiceUnavailableException(
        'AI ещё не подключён. Материалы и промпты можно подготовить заранее.',
      );
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      await this.requireIdle(manager, workspaceId);
      const materials = await manager.query<
        Array<Material & { file_data: Buffer | null }>
      >(
        `SELECT id,revision,url_category,title,content,source_url,source_error,file_name,media_type,file_data FROM cc_materials WHERE workspace_id=$1 ORDER BY created_at`,
        [workspaceId],
      );
      if (!materials.length && !dto.withoutMaterials)
        throw new BadRequestException(
          'Добавьте материалы или выберите «У меня нет материалов»',
        );
      if (materials.length && dto.withoutMaterials)
        throw new BadRequestException(
          'В пространстве уже есть материалы — они должны участвовать в обработке',
        );
      const [previous] = await manager.query<Version[]>(
        `SELECT content FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC LIMIT 1`,
        [workspaceId],
      );
      const input: PreparationInput = {
        materials: materials.map((m) => ({
          id: m.id,
          revision: m.revision,
          urlCategory: m.url_category,
          sourceError: m.source_error,
          title: m.title,
          content: m.content,
          sourceUrl: m.source_url,
        })),
        // With no materials the specification permits only the user's message.
        // A saved result must not silently reintroduce deleted source facts.
        previousResult: dto.withoutMaterials
          ? null
          : (previous?.content ?? null),
      };
      if (JSON.stringify(input).length > PREPARATION_CONTEXT_LIMIT)
        throw new BadRequestException(
          'Материалы превышают безопасный объём запуска (2,2 млн символов). Сократите материалы перед запуском.',
        );
      const files = materials
        .filter((m) => m.file_data && !m.content)
        .map((m) => ({
          fileName: m.file_name!,
          mediaType: m.media_type!,
          dataBase64: m.file_data!.toString('base64'),
        }));
      if (files.length) {
        if (!this.ai.supportsFiles)
          throw new BadRequestException(
            'Подключённый AI пока не умеет обрабатывать документы и изображения. Файлы сохранены, запуск не выполнен.',
          );
        input.files = files;
      }
      const [row] = await manager.query<RunSummary[]>(
        `INSERT INTO cc_preparation_runs (workspace_id,status,actor_name,instruction,input_context,provider,prompt_title) VALUES ($1,'queued',$2,$3,$4::jsonb,$5,$6) RETURNING ${RUN_FIELDS}`,
        [
          workspaceId,
          actorName,
          dto.instruction,
          JSON.stringify(input),
          this.ai.name,
          dto.promptTitle?.trim() || 'Свой запрос',
        ],
      );
      return row;
    });
  }

  private async requireIdle(manager: EntityManager, workspaceId: string) {
    const rows = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM cc_preparation_runs WHERE workspace_id=$1 AND status IN ('queued','processing')`,
      [workspaceId],
    );
    if (rows.length)
      throw new ConflictException(
        'Обработка уже выполняется. Дождитесь результата.',
      );
  }

  async getVersion(workspaceId: string, id: string, actor: Actor) {
    await this.access(workspaceId, actor);
    const [row] = await this.db.query<Version[]>(
      `SELECT * FROM cc_preparation_versions WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, id],
    );
    if (!row) throw new NotFoundException('Версия не найдена');
    return row;
  }

  private async appendVersion(
    manager: EntityManager,
    workspaceId: string,
    content: string,
    actorName: string,
    reason: string,
    restoredFrom: number | null = null,
    sources: SourceSnapshot[] | null = null,
    promptTitle: string | null = null,
    instruction: string | null = null,
  ) {
    // Caller holds the workspace transaction lock. MAX+1 therefore cannot race.
    const [row] = await manager.query<Array<{ id: string; number: number }>>(
      `INSERT INTO cc_preparation_versions (workspace_id,number,content,actor_name,reason,restored_from,sources,prompt_title,instruction)
      SELECT $1,COALESCE(MAX(number),0)+1,$2,$3,$4,$5,$6::jsonb,$7,$8 FROM cc_preparation_versions WHERE workspace_id=$1 RETURNING id,number`,
      [
        workspaceId,
        content,
        actorName,
        reason,
        restoredFrom,
        JSON.stringify(sources),
        promptTitle,
        instruction,
      ],
    );
    return row;
  }

  async restore(
    workspaceId: string,
    id: string,
    actor: Actor,
    expectedCurrentNumber: number,
  ) {
    const actorName = await this.access(workspaceId, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      await this.requireIdle(manager, workspaceId);
      const [version] = await manager.query<Version[]>(
        `SELECT * FROM cc_preparation_versions WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      if (!version) throw new NotFoundException('Версия не найдена');
      const [latest] = await manager.query<Version[]>(
        `SELECT number FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC LIMIT 1`,
        [workspaceId],
      );
      if (latest.number !== expectedCurrentNumber)
        throw new ConflictException(
          'Появилась новая версия. Обновите историю перед восстановлением.',
        );
      if (latest.number === version.number)
        throw new BadRequestException('Эта версия уже текущая');
      return this.appendVersion(
        manager,
        workspaceId,
        version.content,
        actorName,
        `Восстановление V${version.number}`,
        version.number,
        version.sources ?? null,
        version.prompt_title,
        version.instruction,
      );
    });
  }

  async processNext(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      // A terminated worker must not leave the workspace locked forever. Never retry a paid call automatically.
      await this.db.query(
        `UPDATE cc_preparation_runs SET status='failed', error='Обработка прервалась. Повторите запуск.', input_context=NULL, finished_at=now() WHERE status='processing' AND COALESCE(heartbeat_at,started_at) < now()-interval '5 minutes'`,
      );
      await this.db.query(
        `UPDATE cc_preparation_runs SET status='failed', error='Истекло время ожидания обработки. Повторите запуск.', input_context=NULL, finished_at=now() WHERE status='queued' AND created_at < now()-interval '30 minutes'`,
      );
      const [run] = await this.db.query<Run[]>(
        `WITH claimed AS (UPDATE cc_preparation_runs SET status='processing',started_at=now(),heartbeat_at=now() WHERE id=(SELECT id FROM cc_preparation_runs WHERE status='queued' AND (operation='collect' OR ($2::boolean AND provider=$1)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *) SELECT * FROM claimed`,
        [this.ai.name, this.ai.configured],
      );
      if (!run) return;
      const heartbeat = setInterval(() => {
        void this.db
          .query(
            `UPDATE cc_preparation_runs SET heartbeat_at=now() WHERE id=$1 AND status='processing'`,
            [run.id],
          )
          .catch(() => undefined);
      }, 15000);
      heartbeat.unref();
      try {
        const progress = async (value: PreparationProgress) => {
          const rows = await this.db.query<Array<{ id: string }>>(
            `UPDATE cc_preparation_runs SET progress=$2::jsonb,heartbeat_at=now() WHERE id=$1 AND status='processing' RETURNING id`,
            [run.id, JSON.stringify(value)],
          );
          if (!rows.length)
            throw new AiProviderError('Запуск больше не активен');
        };
        if (run.operation === 'collect') await this.requireRefreshSource(run);
        const resolved = await this.collection.collect(
          run.workspace_id,
          run.input_context,
          progress,
          AbortSignal.timeout(6 * 60_000),
          run.operation === 'collect'
            ? { persistSnapshots: false, allowUnread: true }
            : {
                selectPages: (pages, signal) =>
                  this.ai.selectSitePages(
                    run.instruction,
                    pages,
                    signal,
                    progress,
                  ),
              },
        );
        if (run.operation === 'collect') {
          await this.db.transaction(async (manager) => {
            await this.lock(manager, run.workspace_id);
            const active = await manager.query<Array<{ id: string }>>(
              `SELECT id FROM cc_preparation_runs WHERE id=$1 AND status='processing' FOR UPDATE`,
              [run.id],
            );
            if (!active.length) return;
            await this.requireRefreshSource(run, manager);
            const snapshot = resolved.sources?.[0];
            if (!snapshot)
              throw new AiProviderError('Не удалось получить результат сбора');
            await manager.query(
              `UPDATE cc_materials SET site_pages=$3::jsonb,site_checked_at=now() WHERE workspace_id=$1 AND id=$2`,
              [
                run.workspace_id,
                run.source_material_id,
                JSON.stringify(snapshot),
              ],
            );
            await manager.query(
              `UPDATE cc_preparation_runs SET status='succeeded', input_context=NULL, progress=$2::jsonb, finished_at=now() WHERE id=$1 AND status='processing'`,
              [
                run.id,
                JSON.stringify({
                  stage: 'collecting',
                  message: 'Сбор обновлён. AI не запускался.',
                }),
              ],
            );
          });
          return;
        }
        await this.db.query(
          `UPDATE cc_preparation_runs SET input_context=$2::jsonb WHERE id=$1 AND status='processing'`,
          [run.id, JSON.stringify(resolved)],
        );
        const content = await this.ai.generate(
          run.instruction,
          resolved,
          progress,
        );
        await this.db.transaction(async (manager) => {
          await this.lock(manager, run.workspace_id);
          const rows = await manager.query<Array<{ id: string }>>(
            `SELECT id FROM cc_preparation_runs WHERE id=$1 AND status='processing' FOR UPDATE`,
            [run.id],
          );
          if (!rows.length) return;
          await this.appendVersion(
            manager,
            run.workspace_id,
            content,
            run.actor_name,
            'Обработка материалов',
            null,
            resolved.sources ?? null,
            run.prompt_title,
            run.instruction,
          );
          await manager.query(
            `UPDATE cc_preparation_runs SET status='succeeded',input_context=NULL,finished_at=now() WHERE id=$1`,
            [run.id],
          );
        });
      } catch (error) {
        await this.db.query(
          `UPDATE cc_preparation_runs SET status='failed',error=$2,input_context=NULL,finished_at=now() WHERE id=$1 AND status='processing'`,
          [
            run.id,
            error instanceof AiProviderError
              ? error.message
              : run.operation === 'collect'
                ? 'Не удалось завершить сбор. AI не запускался. Повторите попытку.'
                : this.ai.configured
                  ? 'Не удалось завершить обработку. Текущая версия сохранена. Повторите запуск.'
                  : 'AI ещё не подключён. Повторите запуск после подключения.',
          ],
        );
      } finally {
        clearInterval(heartbeat);
      }
    } finally {
      this.working = false;
    }
  }
}
