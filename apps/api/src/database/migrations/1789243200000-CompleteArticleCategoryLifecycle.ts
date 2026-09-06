import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteArticleCategoryLifecycle1789243200000 implements MigrationInterface {
  name = 'CompleteArticleCategoryLifecycle1789243200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN "description" text,
        ADD COLUMN "status" character varying(24) NOT NULL DEFAULT 'active',
        ADD COLUMN "published_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0,
        ADD COLUMN "created_by_user_id" uuid,
        ADD COLUMN "updated_by_user_id" uuid,
        ADD COLUMN "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD CONSTRAINT "FK_categories_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_categories_updated_by" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "CHK_categories_status" CHECK ("status" IN ('active', 'hidden', 'draft'))
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_categories_site_parent_order"
      ON "categories" ("site_id", "parent_id", "sort_order", "created_at")
    `);
    await queryRunner.query(`
      CREATE TABLE "category_redirects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "from_slug" character varying(100) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_redirects" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_category_redirects_site_slug" UNIQUE ("site_id", "from_slug"),
        CONSTRAINT "FK_category_redirects_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_category_redirects_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_category_redirects_category"
      ON "category_redirects" ("category_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "category_activities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "category_id" uuid NOT NULL,
        "user_id" uuid,
        "action" character varying(40) NOT NULL,
        "message" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_activities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_category_activities_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_category_activities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_category_activities_category_created"
      ON "category_activities" ("category_id", "created_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "articles"
        ADD COLUMN "body_document" jsonb,
        ADD COLUMN "document_version" integer NOT NULL DEFAULT 1,
        ADD COLUMN "created_by_user_id" uuid,
        ADD COLUMN "updated_by_user_id" uuid,
        ADD CONSTRAINT "FK_articles_created_by" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_articles_updated_by" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "articles"
      SET "body_document" = jsonb_build_object(
        'version', 1,
        'blocks', CASE
          WHEN btrim("body") = '' THEN '[]'::jsonb
          ELSE jsonb_build_array(jsonb_build_object(
            'id', 'legacy-' || "id"::text,
            'type', 'paragraph',
            'text', "body"
          ))
        END
      )
      WHERE "body_document" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "articles" article
      SET
        "created_by_user_id" = (
          SELECT "user_id" FROM "article_activities"
          WHERE "article_id" = article."id"
          ORDER BY "created_at" ASC LIMIT 1
        ),
        "updated_by_user_id" = (
          SELECT "user_id" FROM "article_activities"
          WHERE "article_id" = article."id"
          ORDER BY "created_at" DESC LIMIT 1
        )
      WHERE article."created_by_user_id" IS NULL
         OR article."updated_by_user_id" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "articles"
        DROP CONSTRAINT "FK_articles_updated_by",
        DROP CONSTRAINT "FK_articles_created_by",
        DROP COLUMN "updated_by_user_id",
        DROP COLUMN "created_by_user_id",
        DROP COLUMN "document_version",
        DROP COLUMN "body_document"
    `);
    await queryRunner.query(
      `DROP INDEX "IDX_category_activities_category_created"`,
    );
    await queryRunner.query(`DROP TABLE "category_activities"`);
    await queryRunner.query(`DROP INDEX "IDX_category_redirects_category"`);
    await queryRunner.query(`DROP TABLE "category_redirects"`);
    await queryRunner.query(`DROP INDEX "IDX_categories_site_parent_order"`);
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP CONSTRAINT "CHK_categories_status",
        DROP CONSTRAINT "FK_categories_updated_by",
        DROP CONSTRAINT "FK_categories_created_by",
        DROP COLUMN "updated_at",
        DROP COLUMN "updated_by_user_id",
        DROP COLUMN "created_by_user_id",
        DROP COLUMN "sort_order",
        DROP COLUMN "published_at",
        DROP COLUMN "status",
        DROP COLUMN "description"
    `);
  }
}
