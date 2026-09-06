import type { QueryRunner } from 'typeorm';
import { ExpandMediaArticleLifecycle1789156800000 } from './1789156800000-ExpandMediaArticleLifecycle';

describe('ExpandMediaArticleLifecycle1789156800000', () => {
  it('adds display, ordering, and scoped redirect storage without rewriting content', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ExpandMediaArticleLifecycle1789156800000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');

    expect(sql).toContain('ADD COLUMN "preview_media_id"');
    expect(sql).toContain('ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN "revision" integer NOT NULL DEFAULT 0');
    expect(sql).toContain('CREATE TABLE "article_redirects"');
    expect(sql).toContain('UNIQUE ("site_id", "from_slug")');
    expect(sql).not.toContain('UPDATE "articles"');
    expect(sql).not.toContain('DELETE FROM');
  });
});
