import { MigrationInterface, QueryRunner } from 'typeorm';

export class CanonicalBannerSlots1789934400000 implements MigrationInterface {
  name = 'CanonicalBannerSlots1789934400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1
           FROM "page_banner_assignments" assignment
           LEFT JOIN "pages" page
             ON page."id" = assignment."page_id"
            AND page."site_id" = assignment."site_id"
           LEFT JOIN "banners" banner
             ON banner."id" = assignment."banner_id"
            AND banner."site_id" = assignment."site_id"
           WHERE page."id" IS NULL OR banner."id" IS NULL
         ) THEN
           RAISE EXCEPTION 'Cannot enforce banner assignment ownership: cross-site rows exist';
         END IF;
       END $$`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD CONSTRAINT "UQ_pages_id_site" UNIQUE ("id", "site_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD CONSTRAINT "UQ_banners_id_site" UNIQUE ("id", "site_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_banner_assignments" ADD CONSTRAINT "FK_page_banner_assignments_page_site" FOREIGN KEY ("page_id", "site_id") REFERENCES "pages"("id", "site_id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_banner_assignments" ADD CONSTRAINT "FK_page_banner_assignments_banner_site" FOREIGN KEY ("banner_id", "site_id") REFERENCES "banners"("id", "site_id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `INSERT INTO "page_banner_assignments" ("site_id", "page_id", "banner_id", "zone")
       SELECT DISTINCT ON (page."id", banner."placement")
         banner."site_id", page."id", banner."id", banner."placement"
       FROM "banners" banner
       INNER JOIN "pages" page
         ON page."site_id" = banner."site_id"
        AND page."kind" = 'homepage'
        AND page."system_template_key" = 'skinova-home'
        AND page."system_template_version" = '1'
       WHERE banner."placement" IN ('homepage_top', 'homepage_middle')
       ORDER BY page."id", banner."placement", banner."is_active" DESC,
         banner."sort_order" ASC, banner."created_at" ASC
       ON CONFLICT ("page_id", "zone") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_banner_assignments" DROP CONSTRAINT "FK_page_banner_assignments_banner_site"`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_banner_assignments" DROP CONSTRAINT "FK_page_banner_assignments_page_site"`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" DROP CONSTRAINT "UQ_banners_id_site"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" DROP CONSTRAINT "UQ_pages_id_site"`,
    );
  }
}
