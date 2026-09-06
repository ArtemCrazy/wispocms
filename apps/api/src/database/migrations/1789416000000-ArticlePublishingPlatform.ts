import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ArticlePublishingPlatform1789416000000 implements MigrationInterface {
  name = 'ArticlePublishingPlatform1789416000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN "publication_state" character varying(24) NOT NULL DEFAULT 'draft',
        ADD COLUMN "display_template_key" character varying(80) NOT NULL DEFAULT 'standard-category',
        ADD COLUMN "display_template_version" character varying(40) NOT NULL DEFAULT '1',
        ADD COLUMN "display_template_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "deleted_by_user_id" uuid,
        ADD CONSTRAINT "FK_categories_deleted_by" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "CHK_categories_publication_state" CHECK ("publication_state" IN ('draft', 'published', 'hidden', 'disabled', 'archive'))
    `);
    await queryRunner.query(`
      UPDATE "categories"
      SET "publication_state" = CASE "status"
        WHEN 'active' THEN 'published'
        WHEN 'hidden' THEN 'hidden'
        ELSE 'draft'
      END
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_categories_site_publication_deleted"
      ON "categories" ("site_id", "publication_state", "deleted_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "articles"
        ADD COLUMN "publication_state" character varying(24) NOT NULL DEFAULT 'draft',
        ADD COLUMN "editorial_state" character varying(24) NOT NULL DEFAULT 'draft',
        ADD COLUMN "display_template_key" character varying(80) NOT NULL DEFAULT 'standard-article',
        ADD COLUMN "display_template_version" character varying(40) NOT NULL DEFAULT '1',
        ADD COLUMN "display_template_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "deleted_by_user_id" uuid,
        ADD CONSTRAINT "FK_articles_deleted_by" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "CHK_articles_publication_state" CHECK ("publication_state" IN ('draft', 'published', 'hidden', 'disabled', 'archive')),
        ADD CONSTRAINT "CHK_articles_editorial_state" CHECK ("editorial_state" IN ('draft', 'review', 'changes', 'approved'))
    `);
    await queryRunner.query(`
      UPDATE "articles"
      SET
        "publication_state" = CASE "status"
          WHEN 'published' THEN 'published'
          WHEN 'hidden' THEN 'hidden'
          ELSE 'draft'
        END,
        "editorial_state" = CASE "status"
          WHEN 'review' THEN 'review'
          WHEN 'changes_requested' THEN 'changes'
          WHEN 'published' THEN 'approved'
          ELSE 'draft'
        END
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_articles_site_publication_deleted"
      ON "articles" ("site_id", "publication_state", "deleted_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "site_content_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "kind" character varying(32) NOT NULL,
        "key" character varying(80) NOT NULL,
        "version" character varying(40) NOT NULL,
        "name" character varying(160) NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_content_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_content_templates_identity" UNIQUE ("site_id", "kind", "key", "version"),
        CONSTRAINT "FK_site_content_templates_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_site_content_templates_kind" CHECK ("kind" IN ('articles_list', 'article', 'category'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO "site_content_templates" ("site_id", "kind", "key", "version", "name", "config")
      SELECT "id", template."kind", template."key", '1', template."name", '{}'::jsonb
      FROM "sites"
      CROSS JOIN (VALUES
        ('articles_list', 'editorial-feed', 'Редакционная лента'),
        ('article', 'standard-article', 'Стандартная статья'),
        ('category', 'standard-category', 'Стандартная категория')
      ) AS template("kind", "key", "name")
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE "article_section_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "list_template_key" character varying(80) NOT NULL DEFAULT 'editorial-feed',
        "list_template_version" character varying(40) NOT NULL DEFAULT '1',
        "list_template_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_article_section_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_article_section_settings_site" UNIQUE ("site_id"),
        CONSTRAINT "FK_article_section_settings_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO "article_section_settings" ("site_id")
      SELECT "id" FROM "sites"
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE "article_related_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "article_id" uuid NOT NULL,
        "related_article_id" uuid NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_article_related_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_article_related_items_pair" UNIQUE ("article_id", "related_article_id"),
        CONSTRAINT "CHK_article_related_items_distinct" CHECK ("article_id" <> "related_article_id"),
        CONSTRAINT "FK_article_related_items_article" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_article_related_items_related" FOREIGN KEY ("related_article_id") REFERENCES "articles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_article_related_items_order"
      ON "article_related_items" ("article_id", "sort_order")
    `);

    await queryRunner.query(`
      CREATE TABLE "article_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "article_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "snapshot" jsonb NOT NULL,
        "actor_user_id" uuid,
        "reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_article_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_article_versions_number" UNIQUE ("article_id", "version_number"),
        CONSTRAINT "FK_article_versions_article" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_article_versions_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "article_versions" ("article_id", "version_number", "snapshot", "actor_user_id", "reason", "created_at")
      SELECT
        "id",
        1,
        jsonb_build_object(
          'title', "title",
          'slug', "slug",
          'excerpt', "excerpt",
          'body', "body",
          'bodyDocument', "body_document",
          'documentVersion', "document_version",
          'categoryId', "category_id",
          'authorId', "author_id",
          'coverMediaId', "cover_media_id",
          'previewMediaId', "preview_media_id",
          'sortOrder', "sort_order",
          'publicationState', "publication_state",
          'editorialState', "editorial_state",
          'displayTemplateKey', "display_template_key",
          'displayTemplateVersion', "display_template_version",
          'displayTemplateConfig', "display_template_config",
          'seoTitle', "seo_title",
          'seoDescription', "seo_description",
          'canonicalUrl', "canonical_url",
          'noIndex', "no_index"
        ),
        "updated_by_user_id",
        'backfill',
        "updated_at"
      FROM "articles"
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE "content_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "entity_type" character varying(24) NOT NULL,
        "entity_id" uuid NOT NULL,
        "event_type" character varying(40) NOT NULL,
        "actor_kind" character varying(16) NOT NULL,
        "actor_user_id" uuid,
        "reason" text,
        "before" jsonb,
        "after" jsonb,
        "changes" jsonb,
        "version_id" uuid,
        "group_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_content_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_content_events_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_content_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_content_events_entity_type" CHECK ("entity_type" IN ('article', 'category')),
        CONSTRAINT "CHK_content_events_actor_kind" CHECK ("actor_kind" IN ('user', 'system'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_content_events_entity_created"
      ON "content_events" ("site_id", "entity_type", "entity_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_content_events_group"
      ON "content_events" ("group_id") WHERE "group_id" IS NOT NULL
    `);
    await queryRunner.query(`
      INSERT INTO "content_events" ("site_id", "entity_type", "entity_id", "event_type", "actor_kind", "actor_user_id", "reason", "after", "created_at")
      SELECT "site_id", 'article', "id", 'created',
        CASE WHEN "created_by_user_id" IS NULL THEN 'system' ELSE 'user' END,
        "created_by_user_id", 'backfill',
        jsonb_build_object('title', "title", 'slug', "slug"), "created_at"
      FROM "articles"
    `);
    await queryRunner.query(`
      INSERT INTO "content_events" ("site_id", "entity_type", "entity_id", "event_type", "actor_kind", "actor_user_id", "reason", "after", "created_at")
      SELECT "site_id", 'category', "id", 'created',
        CASE WHEN "created_by_user_id" IS NULL THEN 'system' ELSE 'user' END,
        "created_by_user_id", 'backfill',
        jsonb_build_object('name', "name", 'slug', "slug"), "created_at"
      FROM "categories"
    `);
    await queryRunner.query(`
      CREATE FUNCTION reject_content_event_mutation() RETURNS trigger AS $$
      BEGIN
        IF pg_trigger_depth() > 1 THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'content_events is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_content_events_immutable"
      BEFORE UPDATE OR DELETE ON "content_events"
      FOR EACH ROW EXECUTE FUNCTION reject_content_event_mutation()
    `);

    await queryRunner.query(`
      CREATE TABLE "content_status_schedules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "entity_type" character varying(24) NOT NULL,
        "entity_id" uuid NOT NULL,
        "target_publication_state" character varying(24) NOT NULL,
        "execute_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "requested_by_user_id" uuid,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "executed_at" TIMESTAMP WITH TIME ZONE,
        "last_error" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_content_status_schedules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_content_status_schedules_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_content_status_schedules_actor" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_content_status_schedules_entity" CHECK ("entity_type" IN ('article', 'category')),
        CONSTRAINT "CHK_content_status_schedules_state" CHECK ("target_publication_state" IN ('draft', 'published', 'hidden', 'disabled', 'archive')),
        CONSTRAINT "CHK_content_status_schedules_status" CHECK ("status" IN ('pending', 'completed', 'cancelled', 'failed'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_content_status_schedules_pending"
      ON "content_status_schedules" ("entity_type", "entity_id")
      WHERE "status" = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_content_status_schedules_due"
      ON "content_status_schedules" ("status", "execute_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_content_status_schedules_due"`);
    await queryRunner.query(`DROP INDEX "UQ_content_status_schedules_pending"`);
    await queryRunner.query(`DROP TABLE "content_status_schedules"`);
    await queryRunner.query(
      `DROP TRIGGER "TR_content_events_immutable" ON "content_events"`,
    );
    await queryRunner.query(`DROP FUNCTION reject_content_event_mutation`);
    await queryRunner.query(`DROP INDEX "IDX_content_events_group"`);
    await queryRunner.query(`DROP INDEX "IDX_content_events_entity_created"`);
    await queryRunner.query(`DROP TABLE "content_events"`);
    await queryRunner.query(`DROP TABLE "article_versions"`);
    await queryRunner.query(`DROP INDEX "IDX_article_related_items_order"`);
    await queryRunner.query(`DROP TABLE "article_related_items"`);
    await queryRunner.query(`DROP TABLE "article_section_settings"`);
    await queryRunner.query(`DROP TABLE "site_content_templates"`);
    await queryRunner.query(
      `DROP INDEX "IDX_articles_site_publication_deleted"`,
    );
    await queryRunner.query(`
      ALTER TABLE "articles"
        DROP CONSTRAINT "CHK_articles_editorial_state",
        DROP CONSTRAINT "CHK_articles_publication_state",
        DROP CONSTRAINT "FK_articles_deleted_by",
        DROP COLUMN "deleted_by_user_id",
        DROP COLUMN "deleted_at",
        DROP COLUMN "display_template_config",
        DROP COLUMN "display_template_version",
        DROP COLUMN "display_template_key",
        DROP COLUMN "editorial_state",
        DROP COLUMN "publication_state"
    `);
    await queryRunner.query(
      `DROP INDEX "IDX_categories_site_publication_deleted"`,
    );
    await queryRunner.query(`
      ALTER TABLE "categories"
        DROP CONSTRAINT "CHK_categories_publication_state",
        DROP CONSTRAINT "FK_categories_deleted_by",
        DROP COLUMN "deleted_by_user_id",
        DROP COLUMN "deleted_at",
        DROP COLUMN "display_template_config",
        DROP COLUMN "display_template_version",
        DROP COLUMN "display_template_key",
        DROP COLUMN "publication_state"
    `);
  }
}
