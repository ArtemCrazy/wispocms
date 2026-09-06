import type { QueryRunner } from 'typeorm';
import { ArticlePublishingPlatform1789416000000 } from './1789416000000-ArticlePublishingPlatform';

describe('ArticlePublishingPlatform1789416000000', () => {
  it('backfills independent states and creates durable publishing records', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ArticlePublishingPlatform1789416000000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');

    expect(sql).toContain('ADD COLUMN "publication_state"');
    expect(sql).toContain('ADD COLUMN "editorial_state"');
    expect(sql).toContain("WHEN 'published' THEN 'approved'");
    expect(sql).toContain('CREATE TABLE "site_content_templates"');
    expect(sql).toContain('CREATE TABLE "article_related_items"');
    expect(sql).toContain('CREATE TABLE "article_versions"');
    expect(sql).toContain('CREATE TABLE "content_events"');
    expect(sql).toContain('CREATE TABLE "content_status_schedules"');
    expect(sql).toContain('WHERE "status" = \'pending\'');
    expect(sql).toContain('reject_content_event_mutation');
    expect(sql).toContain('IDX_content_events_group');
    expect(sql).toContain('pg_trigger_depth() > 1');
    expect(sql).toContain('FROM "articles"');
    expect(sql).not.toContain('SET "body" =');
  });

  it('has an explicit rollback for every new lifecycle object', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ArticlePublishingPlatform1789416000000().down({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');

    for (const table of [
      'content_status_schedules',
      'content_events',
      'article_versions',
      'article_related_items',
      'article_section_settings',
      'site_content_templates',
    ])
      expect(sql).toContain(`DROP TABLE "${table}"`);
    expect(sql).toContain('DROP COLUMN "editorial_state"');
    expect(sql).toContain('DROP COLUMN "publication_state"');
  });
});
