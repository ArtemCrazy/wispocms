import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ContentCenterService } from './content-center.service';
import type {
  ClusterDto,
  CreationSettingsDto,
  ProposalDecisionDto,
  RestructureClustersDto,
} from './creation.dto';
import {
  applyProposals,
  creationSnapshot,
  versionChanges,
} from './creation-model';
import type {
  ClusterRow,
  CreatedArticle,
  CreatedVersion,
  CreationSettings,
  CreationSnapshot,
  CorrectionRow,
} from './creation-model';
import { articleDocumentMediaIds } from '../content/article-document';

export type CreationActor = NonNullable<AuthenticatedRequest['auth']>;

@Injectable()
export class CreationService {
  constructor(
    readonly db: DataSource,
    private readonly accessService: ContentCenterService,
  ) {}
  access(w: string, a: CreationActor) {
    return this.accessService.access(w, a);
  }
  async lock(m: EntityManager, w: string) {
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cc:${w}`]);
  }
  async transaction<T>(
    w: string,
    a: CreationActor,
    fn: (m: EntityManager, name: string) => Promise<T>,
  ): Promise<T> {
    await this.access(w, a);
    return this.db.transaction(async (m) => {
      await this.lock(m, w);
      const name = await this.access(w, a);
      return fn(m, name);
    });
  }
  async settings(
    w: string,
    m: EntityManager = this.db.manager,
  ): Promise<CreationSettings> {
    const [row] = await m.query<CreationSettings[]>(
      'SELECT revision,rules,platforms FROM cc_creation_settings WHERE workspace_id=$1',
      [w],
    );
    return row ?? { revision: 0, rules: '', platforms: [] };
  }
  async saveSettings(w: string, a: CreationActor, dto: CreationSettingsDto) {
    return this.transaction(w, a, async (m) => {
      const previous = await this.settings(w, m);
      this.revision(previous, dto.revision);
      for (const p of dto.platforms) {
        const [site] = await m.query<Array<{ id: string }>>(
          "SELECT s.id FROM sites s WHERE s.id=$1 AND s.workspace_id=$2 AND EXISTS(SELECT 1 FROM site_content_templates t WHERE t.site_id=s.id AND t.kind='article' AND t.is_active)",
          [p.siteId, w],
        );
        if (!site)
          throw new BadRequestException(
            'Площадка со статьями недоступна в этом workspace',
          );
      }
      const [row] = await m.query<CreationSettings[]>(
        `INSERT INTO cc_creation_settings(workspace_id,revision,rules,platforms) VALUES($1,1,$2,$3::jsonb) ON CONFLICT(workspace_id) DO UPDATE SET revision=cc_creation_settings.revision+1,rules=excluded.rules,platforms=excluded.platforms RETURNING revision,rules,platforms`,
        [w, dto.rules.trim(), JSON.stringify(dto.platforms)],
      );
      return row;
    });
  }
  revision(row: { revision: number }, expected: number) {
    if (row.revision !== expected)
      throw new ConflictException(
        'Данные уже изменились. Обновите страницу и повторите действие.',
      );
  }
  async cluster(
    w: string,
    id: string,
    m: EntityManager = this.db.manager,
  ): Promise<ClusterRow> {
    const [row] = await m.query<ClusterRow[]>(
      'SELECT * FROM cc_clusters WHERE workspace_id=$1 AND id=$2',
      [w, id],
    );
    if (!row) throw new NotFoundException('Кластер не найден');
    return row;
  }
  async article(
    w: string,
    id: string,
    m: EntityManager = this.db.manager,
  ): Promise<CreatedArticle> {
    const [row] = await m.query<CreatedArticle[]>(
      'SELECT * FROM cc_created_articles WHERE workspace_id=$1 AND id=$2',
      [w, id],
    );
    if (!row) throw new NotFoundException('Статья не найдена');
    return row;
  }
  async version(
    article: CreatedArticle,
    number = article.current_number,
    m: EntityManager = this.db.manager,
  ): Promise<CreatedVersion> {
    const [row] = await m.query<CreatedVersion[]>(
      'SELECT * FROM cc_created_versions WHERE article_id=$1 AND number=$2',
      [article.id, number],
    );
    if (!row) throw new NotFoundException('Версия не найдена');
    return row;
  }
  async event(
    m: EntityManager,
    w: string,
    name: string,
    kind: 'cluster' | 'article',
    type: string,
    clusterId: string,
    articleId: string | null,
    title: string,
    before: unknown,
    after: unknown,
    relatedIds: string[] = [],
  ) {
    await m.query(
      `INSERT INTO cc_creation_events(workspace_id,kind,type,cluster_id,article_id,title,before,after,related_ids,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
      [
        w,
        kind,
        type,
        clusterId,
        articleId,
        title,
        JSON.stringify(before),
        JSON.stringify(after),
        JSON.stringify(relatedIds),
        name,
      ],
    );
  }
  private normalizedCluster(dto: ClusterDto) {
    const queries = dto.queries.map((q) => ({ ...q, text: q.text.trim() }));
    if (
      queries.some((q) => !q.text) ||
      queries.filter((q) => q.primary).length !== 1 ||
      new Set(queries.map((q) => q.text.toLocaleLowerCase())).size !==
        queries.length
    )
      throw new BadRequestException(
        'Укажите один основной запрос; запросы не должны повторяться',
      );
    return {
      title: queries.find((q) => q.primary)!.text,
      direction: dto.direction.trim(),
      queries,
      archived: dto.archived,
    };
  }
  async saveCluster(w: string, a: CreationActor, dto: ClusterDto, id?: string) {
    return this.transaction(w, a, (m, name) =>
      this.writeCluster(m, w, name, dto, id),
    );
  }
  private async writeCluster(
    m: EntityManager,
    w: string,
    name: string,
    dto: ClusterDto,
    id?: string,
  ) {
    const values = this.normalizedCluster(dto);
    const before = id ? await this.cluster(w, id, m) : null;
    if (before) this.revision(before, dto.revision);
    else if (dto.revision !== 0)
      throw new ConflictException('Неверная версия нового кластера');
    const [row] = before
      ? await m.query<ClusterRow[]>(
          'WITH updated AS (UPDATE cc_clusters SET title=$3,direction=$4,queries=$5::jsonb,archived=$6,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *) SELECT * FROM updated',
          [
            w,
            id,
            values.title,
            values.direction,
            JSON.stringify(values.queries),
            values.archived,
          ],
        )
      : await m.query<ClusterRow[]>(
          `INSERT INTO cc_clusters(workspace_id,number,title,direction,queries,archived) VALUES($1,(SELECT COALESCE(MAX(number),0)+1 FROM cc_clusters WHERE workspace_id=$1),$2,$3,$4::jsonb,$5) RETURNING *`,
          [
            w,
            values.title,
            values.direction,
            JSON.stringify(values.queries),
            values.archived,
          ],
        );
    await this.event(
      m,
      w,
      name,
      'cluster',
      before ? 'changed' : 'formed',
      row.id,
      null,
      row.title,
      before,
      row,
    );
    return row;
  }
  async restructure(w: string, a: CreationActor, dto: RestructureClustersDto) {
    return this.transaction(w, a, async (m, name) => {
      if (
        dto.ids.length !== dto.revisions.length ||
        (dto.kind === 'split'
          ? dto.ids.length !== 1 || dto.clusters.length < 2
          : dto.ids.length < 2 || dto.clusters.length !== 1)
      )
        throw new BadRequestException(
          'Неверный состав разделения или объединения',
        );
      const before: ClusterRow[] = [];
      for (let i = 0; i < dto.ids.length; i++) {
        const c = await this.cluster(w, dto.ids[i], m);
        this.revision(c, dto.revisions[i]);
        if (c.archived)
          throw new BadRequestException(
            'Архивный кластер нельзя разделить или объединить',
          );
        before.push(c);
      }
      const oldQueries = before
        .flatMap((c) => c.queries)
        .map((q) =>
          JSON.stringify({ text: q.text, general: q.general, exact: q.exact }),
        )
        .sort();
      const newQueries = dto.clusters
        .flatMap((c) => c.queries)
        .map((q) =>
          JSON.stringify({
            text: q.text.trim(),
            general: q.general,
            exact: q.exact,
          }),
        )
        .sort();
      if (JSON.stringify(oldQueries) !== JSON.stringify(newQueries))
        throw new BadRequestException(
          'Разделение и объединение должны сохранять исходные запросы и частотности',
        );
      const result: ClusterRow[] = [];
      for (const c of dto.clusters)
        result.push(
          await this.writeCluster(m, w, name, {
            ...c,
            archived: false,
            revision: 0,
          }),
        );
      await m.query(
        'UPDATE cc_clusters SET archived=true,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
        [w, dto.ids],
      );
      for (const c of before)
        await this.event(
          m,
          w,
          name,
          'cluster',
          dto.kind,
          c.id,
          null,
          c.title,
          before,
          result,
          [...dto.ids, ...result.map((c) => c.id)],
        );
      return result;
    });
  }
  async overview(w: string, a: CreationActor) {
    await this.access(w, a);
    const [settings, clusters, articles, sites, run] = await Promise.all([
      this.settings(w),
      this.db.query<ClusterRow[]>(
        'SELECT * FROM cc_clusters WHERE workspace_id=$1 ORDER BY number',
        [w],
      ),
      this.db.query<Array<CreatedArticle & { title: string }>>(
        `SELECT a.*,v.snapshot->>'title' AS title,(SELECT b->>'mediaId' FROM jsonb_array_elements(v.snapshot->'document'->'blocks') b WHERE b->>'type'='image' LIMIT 1) AS cover_media_id FROM cc_created_articles a JOIN cc_created_versions v ON v.article_id=a.id AND v.number=a.current_number WHERE a.workspace_id=$1`,
        [w],
      ),
      this.db.query<Array<{ id: string; name: string }>>(
        `SELECT s.id,s.name FROM sites s WHERE s.workspace_id=$1 AND EXISTS(SELECT 1 FROM site_content_templates t WHERE t.site_id=s.id AND t.kind='article' AND t.is_active) ORDER BY s.name`,
        [w],
      ),
      this.db.query<Array<{ id: string; number: number; status: string }>>(
        `SELECT id,number,kind,status,cluster_count,actor_name,created_at,finished_at,operations FROM cc_creation_runs WHERE workspace_id=$1 ORDER BY number DESC LIMIT 1`,
        [w],
      ),
    ]);
    return { settings, clusters, articles, sites, run: run[0] ?? null };
  }
  async details(w: string, a: CreationActor, id: string) {
    await this.access(w, a);
    const article = await this.article(w, id);
    const settings = await this.settings(w);
    const siteIds = [
      ...new Set([article.site_id, ...settings.platforms.map((p) => p.siteId)]),
    ];
    const [version, versions, correction, sites, categories, templates, media] =
      await Promise.all([
        this.version(article),
        this.db.query<
          Array<
            Pick<
              CreatedVersion,
              'id' | 'number' | 'reason' | 'actor_name' | 'created_at'
            >
          >
        >(
          'SELECT id,number,reason,actor_name,created_at FROM cc_created_versions WHERE article_id=$1 ORDER BY number DESC',
          [id],
        ),
        this.db.query<CorrectionRow[]>(
          'SELECT * FROM cc_corrections WHERE article_id=$1 AND NOT completed',
          [id],
        ),
        this.db.query<Array<{ id: string; name: string; slug: string }>>(
          'SELECT id,name,slug FROM sites WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND is_active ORDER BY name',
          [w, siteIds],
        ),
        this.db.query<Array<{ id: string; name: string; site_id: string }>>(
          `SELECT c.id,c.name,c.site_id FROM categories c JOIN sites s ON s.id=c.site_id WHERE s.workspace_id=$1 AND c.site_id=ANY($2::uuid[]) AND c.deleted_at IS NULL AND c.publication_state='published' AND (c.published_at IS NULL OR c.published_at<=now()) ORDER BY c.sort_order,c.name`,
          [w, siteIds],
        ),
        this.db.query<
          Array<{ key: string; version: string; name: string; site_id: string }>
        >(
          `SELECT t.key,t.version,t.name,t.site_id FROM site_content_templates t JOIN sites s ON s.id=t.site_id WHERE s.workspace_id=$1 AND t.site_id=ANY($2::uuid[]) AND t.kind='article' AND t.is_active ORDER BY t.name`,
          [w, siteIds],
        ),
        this.db.query<Array<{ id: string; alt_text: string }>>(
          'SELECT id,alt_text FROM media WHERE workspace_id=$1',
          [w],
        ),
      ]);
    return {
      article,
      version,
      versions,
      correction: correction[0] ?? null,
      sites,
      categories,
      templates,
      media,
    };
  }
  async getVersion(w: string, a: CreationActor, id: string, number: number) {
    await this.access(w, a);
    return this.version(await this.article(w, id), number);
  }
  async validateMedia(m: EntityManager, w: string, snapshot: CreationSnapshot) {
    const ids = articleDocumentMediaIds(snapshot.document);
    if (!ids.length) return;
    const rows = await m.query<Array<{ id: string }>>(
      'SELECT id FROM media WHERE workspace_id=$1 AND id=ANY($2::uuid[])',
      [w, ids],
    );
    if (new Set(ids).size !== rows.length)
      throw new BadRequestException(
        'Изображение статьи недоступно в workspace',
      );
  }
  async addVersion(
    m: EntityManager,
    w: string,
    article: CreatedArticle,
    snapshot: CreationSnapshot,
    name: string,
    reason: string,
  ) {
    await this.validateMedia(m, w, snapshot);
    const previous = await this.version(article, article.current_number, m);
    const number = article.current_number + 1;
    const changes = versionChanges(previous.snapshot, snapshot);
    await m.query(
      'INSERT INTO cc_created_versions(article_id,number,snapshot,changes,reason,actor_name) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)',
      [
        article.id,
        number,
        JSON.stringify(snapshot),
        JSON.stringify(changes),
        reason,
        name,
      ],
    );
    await m.query(
      'UPDATE cc_created_articles SET current_number=$2,revision=revision+1,updated_at=now() WHERE id=$1',
      [article.id, number],
    );
    await this.event(
      m,
      w,
      name,
      'article',
      'version',
      article.cluster_id,
      article.id,
      snapshot.title,
      { number: article.current_number },
      { number, reason },
    );
    return number;
  }
  async decide(
    w: string,
    a: CreationActor,
    id: string,
    dto: ProposalDecisionDto,
  ) {
    return this.transaction(w, a, async (m, name) => {
      const article = await this.article(w, id, m);
      this.revision(article, dto.revision);
      const [correction] = await m.query<CorrectionRow[]>(
        'SELECT * FROM cc_corrections WHERE article_id=$1 AND id=$2 AND NOT completed',
        [id, dto.correctionId],
      );
      if (!correction || correction.base_number !== article.current_number)
        throw new ConflictException(
          'Корректировка уже завершена или относится к другой версии',
        );
      const p = correction.proposals.find((p) => p.id === dto.proposalId);
      if (!p || p.decision !== 'pending')
        throw new ConflictException('Решение по предложению уже принято');
      p.decision = dto.decision;
      const complete = correction.proposals.every(
        (p) => p.decision !== 'pending',
      );
      if (
        complete &&
        correction.proposals.some((p) => p.decision === 'accepted')
      ) {
        const old = await this.version(article, article.current_number, m);
        await this.addVersion(
          m,
          w,
          article,
          applyProposals(old.snapshot, correction.proposals),
          name,
          'Приняты предложения AI',
        );
      } else
        await m.query(
          'UPDATE cc_created_articles SET revision=revision+1 WHERE id=$1',
          [id],
        );
      await m.query(
        'UPDATE cc_corrections SET proposals=$2::jsonb,completed=$3 WHERE id=$1',
        [correction.id, JSON.stringify(correction.proposals), complete],
      );
      if (complete)
        await m.query(
          "UPDATE cc_created_articles SET recommendation='keep',rationale='Работа с предложениями завершена пользователем' WHERE id=$1",
          [id],
        );
      return { completed: complete };
    });
  }
  async restore(
    w: string,
    a: CreationActor,
    id: string,
    revision: number,
    number: number,
  ) {
    return this.transaction(w, a, async (m, name) => {
      const article = await this.article(w, id, m);
      this.revision(article, revision);
      if (number === article.current_number)
        throw new BadRequestException('Эта версия уже актуальна');
      await this.noPendingCorrection(m, id);
      const version = await this.version(article, number, m);
      return {
        number: await this.addVersion(
          m,
          w,
          article,
          creationSnapshot(version.snapshot),
          name,
          `Восстановлена версия ${number}`,
        ),
      };
    });
  }
  async noPendingCorrection(m: EntityManager, id: string) {
    const [pending] = await m.query<Array<{ id: string }>>(
      'SELECT id FROM cc_corrections WHERE article_id=$1 AND NOT completed',
      [id],
    );
    if (pending)
      throw new ConflictException(
        'Сначала примите или отклоните все предложения текущей корректировки',
      );
  }
  async history(w: string, a: CreationActor) {
    await this.access(w, a);
    const [runs, events] = await Promise.all([
      this.db.query<
        Array<{
          id: string;
          number: number;
          status: string;
          actor_name: string;
          cluster_count: number;
          created_at: string;
        }>
      >(
        `SELECT id,number,kind,status,cluster_count,actor_name,created_at,finished_at FROM cc_creation_runs WHERE workspace_id=$1 AND kind='production' ORDER BY number DESC`,
        [w],
      ),
      this.db.query<
        Array<{
          id: string;
          kind: string;
          type: string;
          article_id: string | null;
          cluster_id: string;
          title: string;
          before: unknown;
          after: unknown;
          related_ids: string[];
          actor_name: string;
          created_at: string;
        }>
      >(
        'SELECT * FROM cc_creation_events WHERE workspace_id=$1 ORDER BY created_at DESC,id',
        [w],
      ),
    ]);
    return { runs, events };
  }
}
