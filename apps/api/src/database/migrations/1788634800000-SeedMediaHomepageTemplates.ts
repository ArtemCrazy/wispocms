import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedMediaHomepageTemplates1788634800000 implements MigrationInterface {
  name = 'SeedMediaHomepageTemplates1788634800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "pages" (
        "site_id", "title", "slug", "kind", "status", "blocks",
        "seo_title", "seo_description", "canonical_url", "no_index"
      )
      SELECT
        site."id",
        'Главная',
        '',
        'homepage',
        'draft',
        jsonb_build_array(
          jsonb_build_object(
            'id', 'media-homepage-v1-hero',
            'type', 'hero',
            'title', site."name",
            'text', '',
            'buttonLabel', '',
            'buttonUrl', ''
          ),
          jsonb_build_object(
            'id', 'media-homepage-v1-intro',
            'type', 'text',
            'title', 'О сайте',
            'text', ''
          )
        ),
        NULL,
        NULL,
        NULL,
        false
      FROM "sites" site
      WHERE site."site_type" = 'media'
        AND NOT EXISTS (
          SELECT 1
          FROM "pages" page
          WHERE page."site_id" = site."id"
            AND page."kind" = 'homepage'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "pages"
      WHERE "kind" = 'homepage'
        AND "blocks" @> '[{"id":"media-homepage-v1-hero"}]'::jsonb
    `);
  }
}
