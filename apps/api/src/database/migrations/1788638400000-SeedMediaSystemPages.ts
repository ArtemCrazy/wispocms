import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedMediaSystemPages1788638400000 implements MigrationInterface {
  name = 'SeedMediaSystemPages1788638400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "pages" (
        "site_id", "title", "slug", "kind", "status", "blocks",
        "seo_title", "seo_description", "canonical_url", "no_index"
      )
      SELECT
        site."id",
        template."title",
        template."slug",
        'page',
        'draft',
        template."blocks",
        NULL,
        NULL,
        NULL,
        template."no_index"
      FROM "sites" site
      CROSS JOIN (
        VALUES
          (
            'Политика конфиденциальности',
            'privacy-policy',
            jsonb_build_array(
              jsonb_build_object(
                'id', 'media-system-v1-privacy',
                'type', 'text',
                'title', 'Политика конфиденциальности',
                'text', ''
              )
            ),
            false
          ),
          (
            'Страница 404',
            '404',
            jsonb_build_array(
              jsonb_build_object(
                'id', 'media-system-v1-404',
                'type', 'hero',
                'title', 'Страница не найдена',
                'text', 'Проверьте адрес или вернитесь на главную страницу.',
                'buttonLabel', 'На главную',
                'buttonUrl', '/'
              )
            ),
            true
          )
      ) AS template("title", "slug", "blocks", "no_index")
      WHERE site."site_type" = 'media'
        AND NOT EXISTS (
          SELECT 1
          FROM "pages" page
          WHERE page."site_id" = site."id"
            AND page."slug" = template."slug"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "pages"
      WHERE "blocks" @> '[{"id":"media-system-v1-privacy"}]'::jsonb
         OR "blocks" @> '[{"id":"media-system-v1-404"}]'::jsonb
    `);
  }
}
