import type { QueryRunner } from 'typeorm';
import { CompleteArticleCategoryLifecycle1789243200000 } from './1789243200000-CompleteArticleCategoryLifecycle';

describe('CompleteArticleCategoryLifecycle1789243200000', () => {
  it('adds lifecycle data and backfills a recoverable document without rewriting legacy body', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CompleteArticleCategoryLifecycle1789243200000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('ADD COLUMN "status"');
    expect(sql).toContain('CREATE TABLE "category_redirects"');
    expect(sql).toContain('CREATE TABLE "category_activities"');
    expect(sql).toContain('ADD COLUMN "body_document" jsonb');
    expect(sql).toContain('\'text\', "body"');
    expect(sql).toContain('WHERE "body_document" IS NULL');
    expect(sql).not.toContain('SET "body" =');
    expect(sql).not.toContain('DELETE FROM');
  });

  it('has an explicit rollback for every added object', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CompleteArticleCategoryLifecycle1789243200000().down({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('DROP TABLE "category_activities"');
    expect(sql).toContain('DROP TABLE "category_redirects"');
    expect(sql).toContain('DROP COLUMN "body_document"');
    expect(sql).toContain('DROP COLUMN "description"');
  });
});
