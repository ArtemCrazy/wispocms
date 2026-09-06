import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandMediaArticleLifecycle1789156800000 implements MigrationInterface {
  name = 'ExpandMediaArticleLifecycle1789156800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "articles"
        ADD COLUMN "preview_media_id" uuid,
        ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN "revision" integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT "FK_articles_preview_media"
          FOREIGN KEY ("preview_media_id") REFERENCES "media"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "article_redirects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "article_id" uuid NOT NULL,
        "from_slug" character varying(160) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_article_redirects" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_article_redirects_site_slug" UNIQUE ("site_id", "from_slug"),
        CONSTRAINT "FK_article_redirects_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_article_redirects_article" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_article_redirects_article" ON "article_redirects" ("article_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_article_redirects_article"`);
    await queryRunner.query(`DROP TABLE "article_redirects"`);
    await queryRunner.query(`
      ALTER TABLE "articles"
        DROP CONSTRAINT "FK_articles_preview_media",
        DROP COLUMN "revision",
        DROP COLUMN "sort_order",
        DROP COLUMN "preview_media_id"
    `);
  }
}
