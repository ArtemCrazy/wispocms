import {
  BadRequestException,
  ConflictException,
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
import type { PreparationInput } from './preparation-ai.service';
import { materialText, readPublicMaterial } from './public-material';

type Actor = NonNullable<AuthenticatedRequest['auth']>;
type Material = {
  id: string;
  title: string;
  kind: string;
  content: string;
  source_url: string | null;
  file_name: string | null;
  revision: number;
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
  without_materials: boolean;
  revision: number;
};
type Run = {
  id: string;
  workspace_id: string;
  instruction: string;
  actor_name: string;
  input_context: PreparationInput;
  status: string;
};
const RUN_FIELDS =
  'id, status, actor_name, error, created_at, started_at, finished_at';

@Injectable()
export class ContentCenterService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private readonly logger = new Logger(ContentCenterService.name);

  constructor(
    private readonly db: DataSource,
    private readonly ai: PreparationAiService,
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

  private async access(workspaceId: string, actor: Actor): Promise<string> {
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
        `SELECT id, title, kind, source_url, file_name, revision, length(content) AS characters, updated_at FROM cc_materials WHERE workspace_id=$1 ORDER BY created_at DESC`,
        [workspaceId],
      ),
      this.db.query<Array<{ id: string; title: string; content: string }>>(
        `SELECT id, title, content FROM cc_prompts WHERE workspace_id=$1 ORDER BY created_at DESC`,
        [workspaceId],
      ),
      this.db.query<Array<Omit<Version, 'workspace_id' | 'content'>>>(
        `SELECT id, number, actor_name, reason, restored_from, created_at FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC`,
        [workspaceId],
      ),
      this.db.query<RunSummary[]>(
        `SELECT ${RUN_FIELDS} FROM cc_preparation_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [workspaceId],
      ),
      this.db.query<Draft[]>(
        `SELECT instruction, without_materials, revision FROM cc_preparation_drafts WHERE workspace_id=$1`,
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
        without_materials: false,
        revision: 0,
      },
      ai: { connected: this.ai.configured },
    };
  }

  async getMaterial(workspaceId: string, id: string, actor: Actor) {
    await this.access(workspaceId, actor);
    const [row] = await this.db.query<Material[]>(
      `SELECT * FROM cc_materials WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, id],
    );
    if (!row) throw new NotFoundException('Материал не найден');
    return row;
  }

  async saveMaterial(
    workspaceId: string,
    actor: Actor,
    dto: MaterialDto | UpdateMaterialDto,
    id?: string,
  ) {
    await this.access(workspaceId, actor);
    if (id) await this.getMaterial(workspaceId, id, actor);
    let content: string;
    if (dto.kind === 'url') {
      try {
        content = await readPublicMaterial(dto.sourceUrl ?? '');
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(
          'Не удалось прочитать страницу. Проверьте ссылку или добавьте текст вручную.',
        );
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
      ];
      const rows = id
        ? await manager.query<Array<{ id: string }>>(
            `WITH changed AS (UPDATE cc_materials SET title=$2, kind=$3, source_url=$4, file_name=$5, content=$6, revision=revision+1, updated_at=now() WHERE workspace_id=$1 AND id=$7 AND revision=$8 RETURNING id) SELECT * FROM changed`,
            [...params, id, (dto as UpdateMaterialDto).revision],
          )
        : await manager.query<Array<{ id: string }>>(
            `INSERT INTO cc_materials (workspace_id,title,kind,source_url,file_name,content) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            params,
          );
      if (!rows.length)
        throw new ConflictException(
          'Материал изменён другим сотрудником. Откройте его заново.',
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
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const [count] = await manager.query<Array<{ total: string }>>(
        `SELECT count(*) AS total FROM cc_prompts WHERE workspace_id=$1`,
        [workspaceId],
      );
      if (Number(count.total) >= 100)
        throw new BadRequestException('В списке уже 100 промптов');
      const [row] = await manager.query<Array<{ id: string }>>(
        `INSERT INTO cc_prompts (workspace_id,title,content) VALUES ($1,$2,$3) RETURNING id`,
        [workspaceId, dto.title, dto.content],
      );
      return row;
    });
  }

  async saveDraft(workspaceId: string, actor: Actor, dto: PreparationDraftDto) {
    await this.access(workspaceId, actor);
    return this.db.transaction(async (manager) => {
      await this.lock(manager, workspaceId);
      const rows = await manager.query<Array<{ revision: number }>>(
        `
        INSERT INTO cc_preparation_drafts (workspace_id,instruction,without_materials)
        SELECT $1,$2,$3 WHERE $4::integer=0
        ON CONFLICT (workspace_id) DO NOTHING RETURNING revision`,
        [workspaceId, dto.instruction, dto.withoutMaterials, dto.revision],
      );
      if (rows.length) return rows[0];
      const updated = await manager.query<Array<{ revision: number }>>(
        `WITH changed AS (UPDATE cc_preparation_drafts SET instruction=$2, without_materials=$3, revision=revision+1 WHERE workspace_id=$1 AND revision=$4 RETURNING revision) SELECT * FROM changed`,
        [workspaceId, dto.instruction, dto.withoutMaterials, dto.revision],
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
      const materials = await manager.query<Material[]>(
        `SELECT title, content, source_url FROM cc_materials WHERE workspace_id=$1 ORDER BY created_at`,
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
          title: m.title,
          content: m.content,
          sourceUrl: m.source_url,
        })),
        previousResult: previous?.content ?? null,
      };
      if (JSON.stringify(input).length > 180000)
        throw new BadRequestException(
          'Материалы и предыдущий результат превышают 180 000 символов. Сократите материалы перед запуском.',
        );
      const [row] = await manager.query<RunSummary[]>(
        `INSERT INTO cc_preparation_runs (workspace_id,status,actor_name,instruction,input_context,provider) VALUES ($1,'queued',$2,$3,$4::jsonb,$5) RETURNING ${RUN_FIELDS}`,
        [
          workspaceId,
          actorName,
          dto.instruction,
          JSON.stringify(input),
          this.ai.name,
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
  ) {
    // Caller holds the workspace transaction lock. MAX+1 therefore cannot race.
    const [row] = await manager.query<Array<{ id: string; number: number }>>(
      `INSERT INTO cc_preparation_versions (workspace_id,number,content,actor_name,reason,restored_from)
      SELECT $1,COALESCE(MAX(number),0)+1,$2,$3,$4,$5 FROM cc_preparation_versions WHERE workspace_id=$1 RETURNING id,number`,
      [workspaceId, content, actorName, reason, restoredFrom],
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
      );
    });
  }

  async processNext(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      // A terminated worker must not leave the workspace locked forever. Never retry a paid call automatically.
      await this.db.query(
        `UPDATE cc_preparation_runs SET status='failed', error='Обработка прервалась. Повторите запуск.', input_context=NULL, finished_at=now() WHERE status='processing' AND started_at < now()-interval '5 minutes'`,
      );
      await this.db.query(
        `UPDATE cc_preparation_runs SET status='failed', error='Истекло время ожидания обработки. Повторите запуск.', input_context=NULL, finished_at=now() WHERE status='queued' AND created_at < now()-interval '30 minutes'`,
      );
      if (!this.ai.configured) return;
      const [run] = await this.db.query<Run[]>(
        `WITH claimed AS (UPDATE cc_preparation_runs SET status='processing',started_at=now() WHERE id=(SELECT id FROM cc_preparation_runs WHERE status='queued' AND provider=$1 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *) SELECT * FROM claimed`,
        [this.ai.name],
      );
      if (!run) return;
      try {
        const content = await this.ai.generate(
          run.instruction,
          run.input_context,
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
          );
          await manager.query(
            `UPDATE cc_preparation_runs SET status='succeeded',input_context=NULL,finished_at=now() WHERE id=$1`,
            [run.id],
          );
        });
      } catch {
        await this.db.query(
          `UPDATE cc_preparation_runs SET status='failed',error=$2,input_context=NULL,finished_at=now() WHERE id=$1 AND status='processing'`,
          [
            run.id,
            this.ai.configured
              ? 'Не удалось завершить обработку. Текущая версия сохранена. Повторите запуск.'
              : 'AI ещё не подключён. Повторите запуск после подключения.',
          ],
        );
      }
    } finally {
      this.working = false;
    }
  }
}
