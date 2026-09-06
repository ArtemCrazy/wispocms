import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillMediaSystemPages1788897600000 implements MigrationInterface {
  name = 'BackfillMediaSystemPages1788897600000';

  async up(queryRunner: QueryRunner): Promise<void> {
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
            '[{"id":"media-system-v1-privacy","type":"text","title":"Политика конфиденциальности","text":""}]'::jsonb,
            false
          ),
          (
            'Страница 404',
            '404',
            '[{"id":"media-system-v1-404","type":"hero","title":"Страница не найдена","text":"Проверьте адрес или вернитесь на главную страницу.","buttonLabel":"На главную","buttonUrl":"/"}]'::jsonb,
            true
          ),
          ('Спасибо', 'thank-you', '[]'::jsonb, true),
          ('Форма захвата', 'capture-form', '[]'::jsonb, true)
      ) AS template("title", "slug", "blocks", "no_index")
      WHERE site."site_type" = 'media'
        AND NOT EXISTS (
          SELECT 1
          FROM "pages" page
          WHERE page."site_id" = site."id"
            AND page."slug" = template."slug"
        )
      ON CONFLICT ("site_id", "slug") DO NOTHING
    `);
  }

  async down(): Promise<void> {
    // Additive backfill is intentionally irreversible: existing and inserted
    // system pages cannot be distinguished safely without deleting user data.
  }
}
