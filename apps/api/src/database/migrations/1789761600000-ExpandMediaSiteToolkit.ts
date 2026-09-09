import { MigrationInterface, QueryRunner } from 'typeorm';

type CountRow = { count: string };

export class ExpandMediaSiteToolkit1789761600000 implements MigrationInterface {
  name = 'ExpandMediaSiteToolkit1789761600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "site_content_templates" DROP CONSTRAINT "CHK_site_content_templates_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "site_content_templates" ADD CONSTRAINT "CHK_site_content_templates_kind" CHECK ("kind" IN ('articles_list', 'article', 'category', 'header', 'footer'))`,
    );
    await queryRunner.query(
      `INSERT INTO "site_content_templates" ("site_id", "kind", "key", "version", "name", "config")
       SELECT site."id", template."kind", template."key", '1', template."name", '{}'::jsonb
       FROM "sites" site
       CROSS JOIN (VALUES
         ('articles_list', 'editorial-feed', 'Редакционная лента'),
         ('article', 'standard-article', 'Стандартная статья'),
         ('category', 'standard-category', 'Стандартная категория'),
         ('header', 'standard-header', 'Стандартная шапка'),
         ('footer', 'standard-footer', 'Стандартный подвал')
       ) AS template("kind", "key", "name")
       WHERE site."site_type" = 'media'
       ON CONFLICT DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO "article_section_settings" ("site_id", "list_template_key", "list_template_version", "list_template_config")
       SELECT "id", 'editorial-feed', '1', '{}'::jsonb
       FROM "sites"
       WHERE "site_type" = 'media'
       ON CONFLICT ("site_id") DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE "sites"
       SET "layout_settings" = jsonb_build_object(
         'headerTemplateKey', 'standard-header',
         'headerTemplateVersion', '1',
         'headerTemplateConfig', '{}'::jsonb,
         'footerTemplateKey', 'standard-footer',
         'footerTemplateVersion', '1',
         'footerTemplateConfig', '{}'::jsonb
       ) || COALESCE("layout_settings", '{}'::jsonb)
       WHERE "site_type" = 'media'`,
    );

    await queryRunner.query(
      `ALTER TABLE "banners" ALTER COLUMN "placement" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD COLUMN "mobile_media_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD COLUMN "subtitle" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD COLUMN "button_text" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD CONSTRAINT "FK_banners_mobile_media" FOREIGN KEY ("mobile_media_id") REFERENCES "media"("id") ON DELETE SET NULL`,
    );

    for (const table of ['articles', 'categories', 'pages']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "og_title" character varying(240)`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "og_description" character varying(500)`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "og_image_media_id" uuid`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "structured_data" jsonb`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_og_image_media" FOREIGN KEY ("og_image_media_id") REFERENCES "media"("id") ON DELETE SET NULL`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN "redirects" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );

    await queryRunner.query(
      `CREATE TABLE "page_banner_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "page_id" uuid NOT NULL,
        "banner_id" uuid NOT NULL,
        "zone" character varying(80) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_page_banner_assignment_zone" UNIQUE ("page_id", "zone"),
        CONSTRAINT "PK_page_banner_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_page_banner_assignments_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_page_banner_assignments_page" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_page_banner_assignments_banner" FOREIGN KEY ("banner_id") REFERENCES "banners"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_page_banner_assignments_site" ON "page_banner_assignments" ("site_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_page_banner_assignments_banner" ON "page_banner_assignments" ("banner_id")`,
    );
    await queryRunner.query(
      `INSERT INTO "page_banner_assignments" ("site_id", "page_id", "banner_id", "zone")
       SELECT DISTINCT ON (page."id", banner."placement")
         banner."site_id", page."id", banner."id", banner."placement"
       FROM "banners" banner
       INNER JOIN "sites" site
         ON site."id" = banner."site_id" AND site."site_type" = 'media'
       INNER JOIN "pages" page
         ON page."site_id" = banner."site_id" AND page."kind" = 'homepage'
       WHERE banner."placement" IN ('homepage_top', 'homepage_middle')
       ORDER BY page."id", banner."placement", banner."is_active" DESC,
         banner."sort_order" ASC, banner."created_at" ASC
       ON CONFLICT ("page_id", "zone") DO NOTHING`,
    );

    await queryRunner.query(
      `CREATE TABLE "site_variables" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "identifier" character varying(100) NOT NULL,
        "value" text NOT NULL DEFAULT '',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_site_variables_identifier" UNIQUE ("site_id", "identifier"),
        CONSTRAINT "CHK_site_variables_identifier" CHECK ("identifier" ~ '^[a-z][a-z0-9_]*$'),
        CONSTRAINT "PK_site_variables" PRIMARY KEY ("id"),
        CONSTRAINT "FK_site_variables_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "site_search_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "searchable_sections" jsonb NOT NULL DEFAULT '["articles"]'::jsonb,
        "popular_queries" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "recommended_queries" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_site_search_settings_site" UNIQUE ("site_id"),
        CONSTRAINT "PK_site_search_settings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_site_search_settings_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "page_activities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "page_id" uuid NOT NULL,
        "user_id" uuid,
        "action" character varying(60) NOT NULL,
        "description" character varying(500) NOT NULL,
        "changes" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_page_activities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_page_activities_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_page_activities_page" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_page_activities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_page_activities_page_created" ON "page_activities" ("page_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT (
        (SELECT COUNT(*) FROM "banners" WHERE "placement" IS NULL OR "mobile_media_id" IS NOT NULL OR "subtitle" IS NOT NULL OR "button_text" IS NOT NULL) +
        (SELECT COUNT(*) FROM "site_variables") +
        (SELECT COUNT(*) FROM "site_search_settings" WHERE "searchable_sections" <> '["articles"]'::jsonb OR "popular_queries" <> '[]'::jsonb OR "recommended_queries" <> '[]'::jsonb) +
        (SELECT COUNT(*) FROM "page_activities") +
        (SELECT COUNT(*) FROM "pages" WHERE "og_title" IS NOT NULL OR "og_description" IS NOT NULL OR "og_image_media_id" IS NOT NULL OR "structured_data" IS NOT NULL OR "redirects" <> '[]'::jsonb) +
        (SELECT COUNT(*) FROM "articles" WHERE "og_title" IS NOT NULL OR "og_description" IS NOT NULL OR "og_image_media_id" IS NOT NULL OR "structured_data" IS NOT NULL) +
        (SELECT COUNT(*) FROM "categories" WHERE "og_title" IS NOT NULL OR "og_description" IS NOT NULL OR "og_image_media_id" IS NOT NULL OR "structured_data" IS NOT NULL) +
        (SELECT COUNT(*) FROM "site_content_templates"
          WHERE "kind" IN ('header', 'footer')
            AND NOT (
              ("kind" = 'header' AND "key" = 'standard-header' AND "version" = '1' AND "config" = '{}'::jsonb AND "is_active") OR
              ("kind" = 'footer' AND "key" = 'standard-footer' AND "version" = '1' AND "config" = '{}'::jsonb AND "is_active")
            )) +
        (SELECT COUNT(*) FROM "sites"
          WHERE "site_type" = 'media' AND (
            COALESCE("layout_settings"->>'headerTemplateKey', '') <> 'standard-header' OR
            COALESCE("layout_settings"->>'headerTemplateVersion', '') <> '1' OR
            COALESCE("layout_settings"->'headerTemplateConfig', '{}'::jsonb) <> '{}'::jsonb OR
            COALESCE("layout_settings"->>'footerTemplateKey', '') <> 'standard-footer' OR
            COALESCE("layout_settings"->>'footerTemplateVersion', '') <> '1' OR
            COALESCE("layout_settings"->'footerTemplateConfig', '{}'::jsonb) <> '{}'::jsonb
          )) +
        (SELECT COUNT(*) FROM "page_banner_assignments" assignment
          WHERE NOT EXISTS (
            SELECT 1 FROM "banners" banner
            WHERE banner."id" = assignment."banner_id"
              AND banner."site_id" = assignment."site_id"
              AND banner."placement" = assignment."zone"
          ))
      )::text AS "count"`,
    )) as CountRow[];
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Cannot safely revert Media toolkit: user-authored toolkit data exists',
      );
    }

    await queryRunner.query(`DROP TABLE "page_activities"`);
    await queryRunner.query(`DROP TABLE "site_search_settings"`);
    await queryRunner.query(`DROP TABLE "site_variables"`);
    await queryRunner.query(`DROP TABLE "page_banner_assignments"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN "redirects"`);
    for (const table of ['pages', 'categories', 'articles']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT "FK_${table}_og_image_media"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "structured_data"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "og_image_media_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "og_description"`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "og_title"`);
    }
    await queryRunner.query(
      `ALTER TABLE "banners" DROP CONSTRAINT "FK_banners_mobile_media"`,
    );
    await queryRunner.query(`ALTER TABLE "banners" DROP COLUMN "button_text"`);
    await queryRunner.query(`ALTER TABLE "banners" DROP COLUMN "subtitle"`);
    await queryRunner.query(
      `ALTER TABLE "banners" DROP COLUMN "mobile_media_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ALTER COLUMN "placement" SET NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "sites"
       SET "layout_settings" = "layout_settings"
         - 'headerTemplateKey'
         - 'headerTemplateVersion'
         - 'headerTemplateConfig'
         - 'footerTemplateKey'
         - 'footerTemplateVersion'
         - 'footerTemplateConfig'
       WHERE "site_type" = 'media'`,
    );
    await queryRunner.query(
      `DELETE FROM "site_content_templates" WHERE "kind" IN ('header', 'footer')`,
    );
    await queryRunner.query(
      `ALTER TABLE "site_content_templates" DROP CONSTRAINT "CHK_site_content_templates_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "site_content_templates" ADD CONSTRAINT "CHK_site_content_templates_kind" CHECK ("kind" IN ('articles_list', 'article', 'category'))`,
    );
  }
}
