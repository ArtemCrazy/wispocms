import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalizeArticleDocument } from '../content/article-document';
import type { ArticleDocument } from '../database/entities';
import type { ClusterQueryDto, PlatformRulesDto } from './creation.dto';

export type CreationSnapshot = {
  title: string;
  excerpt: string;
  document: ArticleDocument;
};
export type ClusterRow = {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  direction: string;
  queries: ClusterQueryDto[];
  archived: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type CreatedArticle = {
  id: string;
  workspace_id: string;
  cluster_id: string;
  site_id: string;
  status: 'created' | 'published' | 'unpublished';
  recommendation: 'keep' | 'update' | 'unpublish';
  rationale: string;
  purpose: string;
  task: string;
  need: string;
  content_rationale: string;
  current_number: number;
  published_number: number | null;
  revision: number;
  cms_article_id: string | null;
  cms_revision: number | null;
  publication_url: string | null;
  category_id: string | null;
  created_at: string;
  updated_at: string;
};
export type CreatedVersion = {
  id: string;
  article_id: string;
  number: number;
  snapshot: CreationSnapshot;
  changes: Proposal[];
  reason: string;
  actor_name: string;
  created_at: string;
};
export type Proposal = {
  id: string;
  target: string;
  before: unknown;
  after: unknown;
  reason: string;
  decision: 'pending' | 'accepted' | 'rejected';
};
export type CorrectionRow = {
  id: string;
  article_id: string;
  base_number: number;
  proposals: Proposal[];
  completed: boolean;
};
export type CreationSettings = {
  revision: number;
  rules: string;
  platforms: PlatformRulesDto[];
};
export type CreationOperation = {
  clusterId: string;
  clusterTitle: string;
  siteId: string;
  siteName: string;
  articleId: string | null;
  revision: number | null;
  clusterRevision: number;
  status: 'queued' | 'processing' | 'succeeded' | 'skipped' | 'failed';
  message: string;
};
export type CreationContext = {
  preparedInformation: { id: string; content: string } | null;
  researchResults: Array<{ id: string; content: string }>;
  projectRules: string;
  platforms: Array<{ siteId: string; name: string; rules: string }>;
  clusters: ClusterRow[];
  existingContent: Array<{
    id: string;
    siteId: string;
    title: string;
    document: ArticleDocument | null;
    body: string;
  }>;
  instruction: string;
  file?: { name: string; mediaType: string; dataBase64: string };
  target?: string;
  fragment?: string;
};
export type CreationRunRow = {
  id: string;
  workspace_id: string;
  number: number;
  kind: 'production' | 'correction';
  status: 'queued' | 'processing' | 'succeeded' | 'partial' | 'failed';
  actor_id: string;
  actor_name: string;
  cluster_count: number;
  instruction: string;
  file_name: string | null;
  input: CreationContext | null;
  operations: CreationOperation[];
  lease_token: string | null;
  created_at: string;
};

function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Некорректный ответ AI');
  return value as Record<string, unknown>;
}
export function boundedText(
  value: unknown,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new BadRequestException('Некорректный текст ответа AI');
  return value.trim();
}
export function creationSnapshot(value: unknown): CreationSnapshot {
  const input = plain(value);
  const result = {
    title: boundedText(input.title, 240),
    excerpt: boundedText(input.excerpt ?? '', 500, true),
    document: normalizeArticleDocument(input.document),
  };
  if (!result.document.blocks.length || JSON.stringify(result).length > 200000)
    throw new BadRequestException('Пустой или слишком большой документ статьи');
  return result;
}
export function targetValue(
  snapshot: CreationSnapshot,
  target: string,
): unknown {
  if (target === 'title' || target === 'excerpt' || target === 'document')
    return snapshot[target];
  if (target.startsWith('block:')) {
    const block = snapshot.document.blocks.find(
      (b) => b.id === target.slice(6),
    );
    if (block) return block;
  }
  throw new BadRequestException('Элемент статьи не найден');
}
export function applyProposals(
  snapshot: CreationSnapshot,
  proposals: Proposal[],
): CreationSnapshot {
  const next = structuredClone(snapshot);
  for (const p of proposals.filter((p) => p.decision === 'accepted')) {
    if (
      JSON.stringify(targetValue(snapshot, p.target)) !==
      JSON.stringify(p.before)
    )
      throw new BadRequestException('Предложение относится к другой версии');
    if (p.target === 'title' || p.target === 'excerpt')
      next[p.target] = boundedText(
        p.after,
        p.target === 'title' ? 240 : 500,
        p.target === 'excerpt',
      );
    else if (p.target === 'document')
      next.document = normalizeArticleDocument(p.after);
    else {
      const doc = normalizeArticleDocument({ version: 1, blocks: [p.after] });
      const index = next.document.blocks.findIndex(
        (b) => b.id === p.target.slice(6),
      );
      if (doc.blocks[0].id !== p.target.slice(6))
        throw new BadRequestException('AI изменил идентификатор элемента');
      next.document.blocks[index] = doc.blocks[0];
    }
  }
  return creationSnapshot(next);
}
export function normalizeProposals(
  value: unknown,
  snapshot: CreationSnapshot,
): Proposal[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new BadRequestException('AI не вернул предложения изменений');
  const targets = new Set<string>();
  const proposals = value.map((v) => {
    const p = plain(v),
      target = boundedText(p.target, 100);
    if (
      targets.has(target) ||
      JSON.stringify(targetValue(snapshot, target)) !== JSON.stringify(p.before)
    )
      throw new BadRequestException(
        'Некорректное исходное значение предложения',
      );
    targets.add(target);
    const result: Proposal = {
      id: randomUUID(),
      target,
      before: p.before,
      after: p.after,
      reason: boundedText(p.reason, 2000),
      decision: 'pending',
    };
    applyProposals(snapshot, [{ ...result, decision: 'accepted' }]);
    return result;
  });
  if (
    targets.has('document') &&
    [...targets].some((t) => t.startsWith('block:'))
  )
    throw new BadRequestException('Предложения пересекаются');
  applyProposals(
    snapshot,
    proposals.map((p) => ({ ...p, decision: 'accepted' })),
  );
  return proposals;
}
export function versionChanges(
  before: CreationSnapshot | null,
  after: CreationSnapshot,
): Proposal[] {
  if (!before) return [];
  return (['title', 'excerpt', 'document'] as const)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((target) => ({
      id: randomUUID(),
      target,
      before: before[target],
      after: after[target],
      reason: 'Сохранение версии',
      decision: 'accepted',
    }));
}
export function eligibleArticle(article: CreatedArticle | null): boolean {
  return (
    !article ||
    (article.status !== 'unpublished' && article.recommendation !== 'update')
  );
}
