import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { PlatformRole } from '../database/entities';
import { CreationService } from './creation.service';
import type { CreationActor } from './creation.service';
import { CreationAiService } from './creation-ai.service';
import type { CreationProvider } from './creation-ai.service';
import type { CorrectionDto, CreationRunDto } from './creation.dto';
import {
  boundedText,
  containsCorrectionFragment,
  creationSnapshot,
  eligibleArticle,
  normalizeProposals,
  targetValue,
} from './creation-model';
import type {
  ClusterRow,
  CreatedArticle,
  CreationContext,
  CreationOperation,
  CreationRunRow,
} from './creation-model';
import { validateMaterialFile } from './material-file';
import type { MaterialUpload } from './material-file';

@Injectable()
export class CreationRunsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  private logger = new Logger(CreationRunsService.name);
  constructor(
    private readonly service: CreationService,
    readonly ai: CreationAiService,
  ) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () =>
        void this.processNext().catch(() =>
          this.logger.error('Не удалось обработать запуск создания контента'),
        ),
      2000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private async context(
    m: EntityManager,
    w: string,
    instruction: string,
    file?: MaterialUpload,
  ): Promise<CreationContext> {
    const settings = await this.service.settings(w, m);
    const [prepared] = await m.query<Array<{ id: string; content: string }>>(
      'SELECT id,content FROM cc_preparation_versions WHERE workspace_id=$1 ORDER BY number DESC LIMIT 1',
      [w],
    );
    const sites = await m.query<Array<{ id: string; name: string }>>(
      'SELECT id,name FROM sites WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
      [w, settings.platforms.map((p) => p.siteId)],
    );
    const platforms = settings.platforms.flatMap((p) => {
      const site = sites.find((s) => s.id === p.siteId);
      return site ? [{ ...p, name: site.name }] : [];
    });
    const existing = await m.query<CreationContext['existingContent']>(
      `SELECT a.id,a.site_id AS "siteId",a.title,a.body_document AS document,a.body FROM articles a JOIN sites s ON s.id=a.site_id WHERE s.workspace_id=$1 AND a.deleted_at IS NULL ORDER BY a.updated_at DESC LIMIT 500`,
      [w],
    );
    const drafts = await m.query<CreationContext['existingContent']>(
      `SELECT a.id,a.site_id AS "siteId",v.snapshot->>'title' AS title,v.snapshot->'document' AS document,'' AS body FROM cc_created_articles a JOIN cc_created_versions v ON v.article_id=a.id AND v.number=a.current_number WHERE a.workspace_id=$1 ORDER BY a.updated_at DESC LIMIT 500`,
      [w],
    );
    // Confirmed research sources are not research conclusions. The research-result producer is not designed yet.
    const context: CreationContext = {
      preparedInformation: prepared ?? null,
      researchResults: [],
      projectRules: settings.rules,
      platforms,
      clusters: [],
      existingContent: [...drafts, ...existing],
      instruction,
    };
    if (file) {
      const validated = validateMaterialFile(file);
      context.file = {
        name: validated.fileName,
        mediaType: validated.mediaType,
        dataBase64: validated.data.toString('base64'),
      };
    }
    if (JSON.stringify(context.existingContent).length > 2000000)
      throw new BadRequestException(
        'Существующий контент превышает лимит контекста адаптера; требуется настройка выборки',
      );
    return context;
  }
  private ready(file?: MaterialUpload) {
    if (!this.ai.connected)
      throw new ServiceUnavailableException(
        'AI ещё не подключён. Генерация не запускалась.',
      );
    if (file && !this.ai.supportsFiles)
      throw new BadRequestException('Подключённый AI не поддерживает файлы');
  }
  private async insertRun(
    m: EntityManager,
    w: string,
    a: CreationActor,
    name: string,
    kind: 'production' | 'correction',
    input: CreationContext,
    operations: CreationOperation[],
  ) {
    const [pending] = await m.query<Array<{ id: string }>>(
      "SELECT id FROM cc_creation_runs WHERE workspace_id=$1 AND status IN ('queued','processing')",
      [w],
    );
    if (pending)
      throw new ConflictException(
        'В workspace уже выполняется запуск. Дождитесь завершения.',
      );
    const [row] = await m.query<{ id: string }[]>(
      `INSERT INTO cc_creation_runs(workspace_id,number,kind,actor_id,actor_name,cluster_count,instruction,file_name,input,operations) VALUES($1,(SELECT COALESCE(MAX(number),0)+1 FROM cc_creation_runs WHERE workspace_id=$1),$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING id`,
      [
        w,
        kind,
        a.userId,
        name,
        new Set(operations.map((o) => o.clusterId)).size,
        input.instruction,
        input.file?.name ?? null,
        JSON.stringify(input),
        JSON.stringify(operations),
      ],
    );
    return row;
  }
  async start(
    w: string,
    a: CreationActor,
    dto: CreationRunDto,
    file?: MaterialUpload,
  ) {
    await this.service.access(w, a);
    this.ready(file);
    return this.service.transaction(w, a, async (m, name) => {
      const input = await this.context(m, w, dto.instruction.trim(), file);
      if (!input.platforms.length)
        throw new BadRequestException(
          'Подключите хотя бы одну площадку в настройках раздела',
        );
      const clusters = await m.query<ClusterRow[]>(
        'SELECT * FROM cc_clusters WHERE workspace_id=$1 AND NOT archived AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY number',
        [w, dto.clusterIds.length ? dto.clusterIds : null],
      );
      if (dto.clusterIds.length && clusters.length !== dto.clusterIds.length)
        throw new BadRequestException(
          'Выбранный кластер недоступен или находится в архиве',
        );
      if (!clusters.length)
        throw new BadRequestException('Нет актуальных кластеров для запуска');
      if (
        clusters.length > 200 ||
        clusters.length * input.platforms.length > 400
      )
        throw new BadRequestException(
          'Выберите не больше 200 кластеров и 400 операций за запуск',
        );
      input.clusters = clusters;
      const articles = await m.query<CreatedArticle[]>(
        'SELECT * FROM cc_created_articles WHERE workspace_id=$1',
        [w],
      );
      let operations: CreationOperation[] = clusters.flatMap((c) =>
        input.platforms.map((p) => {
          const article = articles.find(
            (a) => a.cluster_id === c.id && a.site_id === p.siteId,
          );
          const allowed = eligibleArticle(article ?? null);
          return {
            clusterId: c.id,
            clusterTitle: c.title,
            clusterRevision: c.revision,
            siteId: p.siteId,
            siteName: p.name,
            articleId: article?.id ?? null,
            revision: article?.revision ?? null,
            status: allowed ? 'queued' : 'skipped',
            message: allowed
              ? ''
              : article!.status === 'unpublished'
                ? 'Статья снята с публикации'
                : 'Есть незавершённые предложения AI',
          };
        }),
      );
      if (dto.retryRunId) {
        const [old] = await m.query<CreationRunRow[]>(
          "SELECT * FROM cc_creation_runs WHERE workspace_id=$1 AND id=$2 AND kind='production' AND status IN ('failed','partial')",
          [w, dto.retryRunId],
        );
        if (!old) throw new BadRequestException('Запуск с ошибками не найден');
        const failed = new Set(
          old.operations
            .filter((o) => o.status === 'failed')
            .map((o) => `${o.clusterId}:${o.siteId}`),
        );
        operations = operations.filter((o) =>
          failed.has(`${o.clusterId}:${o.siteId}`),
        );
        if (!operations.length)
          throw new BadRequestException('Нет доступных операций для повтора');
      }
      return this.insertRun(m, w, a, name, 'production', input, operations);
    });
  }
  async correct(
    w: string,
    a: CreationActor,
    id: string,
    dto: CorrectionDto,
    file?: MaterialUpload,
  ) {
    await this.service.access(w, a);
    this.ready(file);
    return this.service.transaction(w, a, async (m, name) => {
      const article = await this.service.article(w, id, m);
      this.service.revision(article, dto.revision);
      await this.service.noPendingCorrection(m, id);
      const version = await this.service.version(
        article,
        article.current_number,
        m,
      );
      const target = dto.target || undefined;
      if (target) targetValue(version.snapshot, target);
      if (
        dto.fragment &&
        !containsCorrectionFragment(version.snapshot, dto.fragment, target)
      )
        throw new BadRequestException(
          'Выбранный фрагмент не найден в актуальной статье',
        );
      const input = await this.context(m, w, dto.instruction.trim(), file);
      const cluster = await this.service.cluster(w, article.cluster_id, m);
      const [site] = await m.query<{ name: string }[]>(
        'SELECT name FROM sites WHERE id=$1 AND workspace_id=$2',
        [article.site_id, w],
      );
      if (!site) throw new BadRequestException('Площадка недоступна');
      if (!input.platforms.some((p) => p.siteId === article.site_id))
        throw new BadRequestException(
          'Площадка отключена в настройках раздела',
        );
      input.clusters = [cluster];
      input.target = target;
      input.fragment = dto.fragment;
      return this.insertRun(m, w, a, name, 'correction', input, [
        {
          clusterId: cluster.id,
          clusterTitle: cluster.title,
          clusterRevision: cluster.revision,
          siteId: article.site_id,
          siteName: site.name,
          articleId: id,
          revision: article.revision,
          status: 'queued',
          message: '',
        },
      ]);
    });
  }
  async processNext() {
    if (this.working) return;
    this.working = true;
    try {
      // A crashed/expired operation is NOT automatically replayed at the paid provider.
      await this.service.db.query(
        `UPDATE cc_creation_runs SET status='failed',input=NULL,finished_at=now(),operations=(SELECT jsonb_agg(CASE WHEN e->>'status' IN ('queued','processing') THEN e||'{"status":"failed","message":"Обработка прервана. Повторите операцию вручную."}'::jsonb ELSE e END) FROM jsonb_array_elements(operations) e) WHERE status='processing' AND updated_at<now()-interval '3 minutes'`,
      );
      const token = randomUUID();
      const rows = await this.service.db.query<CreationRunRow[]>(
        `WITH claimed AS (UPDATE cc_creation_runs SET status='processing',lease_token=$1,updated_at=now() WHERE id=(SELECT id FROM cc_creation_runs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *) SELECT * FROM claimed`,
        [token],
      );
      const run = rows[0];
      if (!run?.input) return;
      for (const operation of run.operations) {
        if (operation.status !== 'queued') continue;
        operation.status = 'processing';
        await this.updateRun(run, token);
        try {
          const [user] = await this.service.db.query<
            Array<{ platform_role: PlatformRole }>
          >('SELECT platform_role FROM users WHERE id=$1 AND is_active', [
            run.actor_id,
          ]);
          if (!user)
            throw new BadRequestException(
              'Автор запуска больше не имеет доступа',
            );
          const actor = {
            userId: run.actor_id,
            platformRole: user.platform_role,
          };
          await this.service.access(run.workspace_id, actor);
          const article = operation.articleId
            ? await this.service.article(run.workspace_id, operation.articleId)
            : null;
          if (article && article.revision !== operation.revision)
            throw new ConflictException('Статья изменена после запуска');
          const snapshot = article
            ? (await this.service.version(article)).snapshot
            : null;
          const output = await this.ai.produce({
            kind: run.kind,
            context: run.input,
            cluster: run.input.clusters.find(
              (c) => c.id === operation.clusterId,
            )!,
            platform: run.input.platforms.find(
              (p) => p.siteId === operation.siteId,
            )!,
            article:
              article && snapshot ? { metadata: article, snapshot } : null,
          });
          await this.service.transaction(
            run.workspace_id,
            actor,
            async (m, name) => {
              const [lease] = await m.query<Array<{ id: string }>>(
                "SELECT id FROM cc_creation_runs WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE",
                [run.id, token],
              );
              if (!lease) throw new ConflictException('Запуск уже завершён');
              const current = operation.articleId
                ? await this.service.article(
                    run.workspace_id,
                    operation.articleId,
                    m,
                  )
                : null;
              if (current && current.revision !== operation.revision)
                throw new ConflictException(
                  'Статья изменена во время обработки; ответ AI не применён',
                );
              const cluster = await this.service.cluster(
                run.workspace_id,
                operation.clusterId,
                m,
              );
              if (
                cluster.revision !== operation.clusterRevision ||
                cluster.archived
              )
                throw new ConflictException(
                  'Кластер изменён во время обработки; ответ AI не применён',
                );
              const settings = await this.service.settings(run.workspace_id, m);
              if (
                !settings.platforms.some((p) => p.siteId === operation.siteId)
              )
                throw new ConflictException(
                  'Площадка отключена во время обработки',
                );
              await this.applyOutput(m, run, operation, current, output, name);
              await m.query(
                'UPDATE cc_creation_runs SET operations=$3::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2',
                [run.id, token, JSON.stringify(run.operations)],
              );
            },
          );
        } catch (e) {
          operation.status = 'failed';
          operation.message =
            e instanceof BadRequestException ||
            e instanceof ConflictException ||
            e instanceof ServiceUnavailableException
              ? e.message
              : 'Не удалось сохранить результат операции. Статья не изменена.';
          await this.updateRun(run, token);
        }
      }
      const failed = run.operations.filter((o) => o.status === 'failed').length;
      const status = failed
        ? run.operations.some((o) => o.status === 'succeeded')
          ? 'partial'
          : 'failed'
        : 'succeeded';
      await this.service.db.query(
        "UPDATE cc_creation_runs SET status=$3,input=NULL,finished_at=now(),updated_at=now(),operations=$4::jsonb WHERE id=$1 AND lease_token=$2 AND status='processing'",
        [run.id, token, status, JSON.stringify(run.operations)],
      );
    } finally {
      this.working = false;
    }
  }
  private async updateRun(run: CreationRunRow, token: string) {
    await this.service.db.query(
      "UPDATE cc_creation_runs SET operations=$3::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='processing'",
      [run.id, token, JSON.stringify(run.operations)],
    );
  }
  private async applyOutput(
    m: EntityManager,
    run: CreationRunRow,
    op: CreationOperation,
    article: CreatedArticle | null,
    output: Awaited<ReturnType<CreationProvider['produce']>>,
    name: string,
  ) {
    if (!output || typeof output.relevant !== 'boolean')
      throw new BadRequestException('Некорректный ответ AI');
    const rationale = boundedText(output.rationale, 4000);
    if (!output.relevant && !article) {
      op.status = 'skipped';
      op.message = rationale;
      return;
    }
    if (!article) {
      if (output.recommendation !== 'create')
        throw new BadRequestException(
          'Для новой статьи требуется рекомендация «Создать»',
        );
      const snapshot = creationSnapshot(output.article);
      await this.service.validateMedia(m, run.workspace_id, snapshot);
      const [created] = await m.query<CreatedArticle[]>(
        `INSERT INTO cc_created_articles(workspace_id,cluster_id,site_id,rationale,purpose,task,need,content_rationale) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          run.workspace_id,
          op.clusterId,
          op.siteId,
          rationale,
          boundedText(output.purpose, 4000),
          boundedText(output.task, 4000),
          boundedText(output.need, 4000),
          boundedText(output.contentRationale, 4000),
        ],
      );
      await m.query(
        'INSERT INTO cc_created_versions(article_id,number,snapshot,reason,actor_name) VALUES($1,1,$2::jsonb,$3,$4)',
        [created.id, JSON.stringify(snapshot), 'Статья создана AI', name],
      );
      await this.service.event(
        m,
        run.workspace_id,
        name,
        'article',
        'created',
        op.clusterId,
        created.id,
        snapshot.title,
        null,
        { number: 1, siteId: op.siteId },
      );
      op.articleId = created.id;
      op.message = 'Статья создана';
    } else {
      if (!['keep', 'update', 'unpublish'].includes(output.recommendation))
        throw new BadRequestException(
          'Некорректная рекомендация для существующей статьи',
        );
      if (
        output.recommendation === 'unpublish' &&
        article.status !== 'published'
      )
        throw new BadRequestException(
          'Снять с публикации можно только опубликованную статью',
        );
      if (run.kind === 'correction' && output.recommendation !== 'update')
        throw new BadRequestException(
          'Корректировка не вернула предложений изменений',
        );
      if (output.recommendation === 'update') {
        await this.service.noPendingCorrection(m, article.id);
        const version = await this.service.version(
          article,
          article.current_number,
          m,
        );
        const proposals = normalizeProposals(
          output.proposals,
          version.snapshot,
        );
        if (
          run.input?.target &&
          proposals.some((p) => p.target !== run.input?.target)
        )
          throw new BadRequestException(
            'AI предложил изменения вне выбранного элемента',
          );
        await this.service.validateMedia(
          m,
          run.workspace_id,
          applyAccepted(version.snapshot, proposals),
        );
        await m.query(
          'INSERT INTO cc_corrections(article_id,base_number,proposals,actor_name) VALUES($1,$2,$3::jsonb,$4)',
          [article.id, article.current_number, JSON.stringify(proposals), name],
        );
      }
      await m.query(
        'UPDATE cc_created_articles SET recommendation=$2,rationale=$3,revision=revision+1 WHERE id=$1',
        [article.id, output.recommendation, rationale],
      );
      op.message =
        output.recommendation === 'update'
          ? 'Подготовлены предложения изменений'
          : output.recommendation === 'unpublish'
            ? 'Рекомендовано снятие; публикация не изменена'
            : 'Проверено, изменения не требуются';
    }
    op.status = 'succeeded';
  }
}

import { applyProposals } from './creation-model';
function applyAccepted(
  snapshot: Parameters<typeof applyProposals>[0],
  proposals: Parameters<typeof applyProposals>[1],
) {
  return applyProposals(
    snapshot,
    proposals.map((p) => ({ ...p, decision: 'accepted' })),
  );
}
