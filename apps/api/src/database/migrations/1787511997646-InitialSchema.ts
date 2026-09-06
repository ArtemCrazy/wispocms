import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1787511997646 implements MigrationInterface {
  name = 'InitialSchema1787511997646';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const expectedTables = [
      'users',
      'workspaces',
      'sites',
      'workspace_memberships',
      'categories',
      'authors',
      'media',
      'articles',
      'article_activities',
      'pages',
      'banners',
    ];
    let existingTables = 0;

    for (const tableName of expectedTables) {
      if (await queryRunner.hasTable(tableName)) {
        existingTables += 1;
      }
    }

    if (existingTables === expectedTables.length) {
      return;
    }

    if (existingTables > 0) {
      throw new Error(
        `Cannot apply the initial Wispo schema to a partial database: found ${existingTables} of ${expectedTables.length} expected tables`,
      );
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "full_name" character varying(160) NOT NULL, "platform_role" character varying(40) NOT NULL DEFAULT 'member', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "workspaces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(160) NOT NULL, "slug" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b8e9fe62e93d60089dfc4f175f" ON "workspaces"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "workspace_id" uuid NOT NULL, "name" character varying(160) NOT NULL, "slug" character varying(100) NOT NULL, "domain" character varying(255), "site_type" character varying(32) NOT NULL DEFAULT 'media', "seo_title" character varying(200), "seo_description" character varying(500), "canonical_url" character varying(500), "seo_image_media_id" uuid, "no_index" boolean NOT NULL DEFAULT false, "notification_email" character varying(255), "global_data" jsonb NOT NULL DEFAULT '{}'::jsonb, "layout_settings" jsonb NOT NULL DEFAULT '{}'::jsonb, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e509f1c008dcac6cd0c07907009" UNIQUE ("workspace_id", "slug"), CONSTRAINT "PK_4f5eccb1dfde10c9170502595a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "workspace_memberships" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "role" character varying(40) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4689405e98986489166f648d1f7" UNIQUE ("user_id", "workspace_id"), CONSTRAINT "PK_38b7d40a750229143fda4a1b011" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "slug" character varying(100) NOT NULL, "color" character varying(20) NOT NULL DEFAULT '#9f91ef', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_69d4cd477ab55637aed872c0e3d" UNIQUE ("site_id", "slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "authors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "full_name" character varying(160) NOT NULL, "email" character varying(255), "bio" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d2ed02fabd9b52847ccb85e6b88" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "media" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "stored_name" character varying(255) NOT NULL, "original_name" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size" integer NOT NULL, "alt_text" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f4e0fcac36e050de337b670d8bd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "category_id" uuid, "author_id" uuid, "cover_media_id" uuid, "title" character varying(240) NOT NULL, "slug" character varying(160) NOT NULL, "excerpt" character varying(500), "body" text NOT NULL DEFAULT '', "seo_title" character varying(240), "seo_description" character varying(500), "canonical_url" character varying(500), "no_index" boolean NOT NULL DEFAULT false, "status" character varying(32) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_08c1e9989fdb995f02c672fe196" UNIQUE ("site_id", "slug"), CONSTRAINT "PK_0a6e2c450d83e0b6052c2793334" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "article_activities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "article_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" character varying(32) NOT NULL, "message" text, "from_status" character varying(32), "to_status" character varying(32), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_949018a58ca936b7d337699fbbd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "slug" character varying(160) NOT NULL, "kind" character varying(24) NOT NULL DEFAULT 'page', "status" character varying(24) NOT NULL DEFAULT 'draft', "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb, "seo_title" character varying(240), "seo_description" character varying(500), "canonical_url" character varying(500), "no_index" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fbcb2bb88f9e4c547ea2119314f" UNIQUE ("site_id", "slug"), CONSTRAINT "PK_8f21ed625aa34c8391d636b7d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "banners" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "site_id" uuid NOT NULL, "media_id" uuid, "name" character varying(160) NOT NULL, "placement" character varying(40) NOT NULL, "title" character varying(200), "link_url" character varying(500), "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e9b186b959296fcb940790d31c3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD CONSTRAINT "FK_51cdb6d8b98b66a26ee7837f002" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" ADD CONSTRAINT "FK_14cd888d48ea02703648cff0be6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" ADD CONSTRAINT "FK_c478a264ff4081763bb45418ca9" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_411cbb14d7ab96d475a721c1cfe" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "authors" ADD CONSTRAINT "FK_34254686e735ef6414ab13ebe21" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD CONSTRAINT "FK_0f2e46da6bc9d2d7428f84250a4" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_d13ecb9431bc17bcfe3d2af8934" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_6515da4dff8db423ce4eb841490" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "FK_a74d78d839af9974f9041747204" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "article_activities" ADD CONSTRAINT "FK_9a6f9487ecf2565c179a5540b66" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "article_activities" ADD CONSTRAINT "FK_3215ee28bf542ae04d97d29b50a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD CONSTRAINT "FK_277b911e3ca624484c82dcb0d5c" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD CONSTRAINT "FK_f56a8b15310103c3c90743ea27a" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" ADD CONSTRAINT "FK_ca000fa118448246716e05946d2" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "banners" DROP CONSTRAINT "FK_ca000fa118448246716e05946d2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "banners" DROP CONSTRAINT "FK_f56a8b15310103c3c90743ea27a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" DROP CONSTRAINT "FK_277b911e3ca624484c82dcb0d5c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "article_activities" DROP CONSTRAINT "FK_3215ee28bf542ae04d97d29b50a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "article_activities" DROP CONSTRAINT "FK_9a6f9487ecf2565c179a5540b66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_a74d78d839af9974f9041747204"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_6515da4dff8db423ce4eb841490"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "FK_d13ecb9431bc17bcfe3d2af8934"`,
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP CONSTRAINT "FK_0f2e46da6bc9d2d7428f84250a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "authors" DROP CONSTRAINT "FK_34254686e735ef6414ab13ebe21"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_411cbb14d7ab96d475a721c1cfe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" DROP CONSTRAINT "FK_c478a264ff4081763bb45418ca9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" DROP CONSTRAINT "FK_14cd888d48ea02703648cff0be6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" DROP CONSTRAINT "FK_51cdb6d8b98b66a26ee7837f002"`,
    );
    await queryRunner.query(`DROP TABLE "banners"`);
    await queryRunner.query(`DROP TABLE "pages"`);
    await queryRunner.query(`DROP TABLE "article_activities"`);
    await queryRunner.query(`DROP TABLE "articles"`);
    await queryRunner.query(`DROP TABLE "media"`);
    await queryRunner.query(`DROP TABLE "authors"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TABLE "workspace_memberships"`);
    await queryRunner.query(`DROP TABLE "sites"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b8e9fe62e93d60089dfc4f175f"`,
    );
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
