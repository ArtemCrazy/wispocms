import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TemplatePackageRegistry1791789600000 implements MigrationInterface {
  name = 'TemplatePackageRegistry1791789600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "template_packages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "package_id" character varying(100) NOT NULL,
        "title" character varying(160) NOT NULL,
        "site_type" character varying(32) NOT NULL,
        "repository_url" character varying(500) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_template_packages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_template_packages_package_id" UNIQUE ("package_id"),
        CONSTRAINT "CHK_template_packages_site_type"
          CHECK ("site_type" IN ('media', 'corporate', 'ecommerce', 'landing'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "template_package_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "template_package_id" uuid NOT NULL,
        "package_version" character varying(100) NOT NULL,
        "source_revision" character varying(160) NOT NULL,
        "release_digest" character varying(128) NOT NULL,
        "artifact_digest" character varying(128),
        "manifest_digest" character varying(128) NOT NULL,
        "manifest_version" integer NOT NULL,
        "manifest" jsonb NOT NULL,
        "cms_api_min_schema_version" character varying(40) NOT NULL,
        "cms_api_max_schema_version" character varying(40),
        "built_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "runtime_mode" character varying(32) NOT NULL,
        "runtime_url" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_template_package_versions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_template_package_versions_identity"
          UNIQUE ("template_package_id", "package_version"),
        CONSTRAINT "UQ_template_package_versions_site_pointer"
          UNIQUE ("id", "template_package_id"),
        CONSTRAINT "FK_template_package_versions_package"
          FOREIGN KEY ("template_package_id") REFERENCES "template_packages"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_template_package_versions_manifest_version"
          CHECK ("manifest_version" = 1),
        CONSTRAINT "CHK_template_package_versions_manifest_object"
          CHECK (jsonb_typeof("manifest") = 'object'),
        CONSTRAINT "CHK_template_package_versions_runtime_mode"
          CHECK ("runtime_mode" IN ('embedded-next', 'external'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_template_package_versions_package_created_at"
       ON "template_package_versions" ("template_package_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "prevent_template_package_version_update"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Template package versions are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_template_package_versions_immutable"
      BEFORE UPDATE ON "template_package_versions"
      FOR EACH ROW EXECUTE FUNCTION "prevent_template_package_version_update"()
    `);

    await queryRunner.query(
      `ALTER TABLE "sites" ADD "template_package_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD "current_template_package_version_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "sites"
      ADD CONSTRAINT "CHK_sites_template_package_version_requires_package"
      CHECK ("current_template_package_version_id" IS NULL OR "template_package_id" IS NOT NULL)
    `);
    await queryRunner.query(`
      ALTER TABLE "sites"
      ADD CONSTRAINT "FK_sites_template_package"
      FOREIGN KEY ("template_package_id") REFERENCES "template_packages"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "sites"
      ADD CONSTRAINT "FK_sites_current_template_package_version"
      FOREIGN KEY ("current_template_package_version_id", "template_package_id")
      REFERENCES "template_package_versions"("id", "template_package_id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sites_template_package_id" ON "sites" ("template_package_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sites_current_template_package_version_id" ON "sites" ("current_template_package_version_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "site_content_templates" DROP CONSTRAINT "CHK_site_content_templates_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "site_content_templates"
      ADD CONSTRAINT "CHK_site_content_templates_kind"
      CHECK ("kind" IN (
        'homepage', 'articles_list', 'article', 'category',
        'header', 'footer', 'system_page'
      ))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "sites"
          WHERE "template_package_id" IS NOT NULL
             OR "current_template_package_version_id" IS NOT NULL
        ) OR EXISTS (SELECT 1 FROM "template_package_versions")
          OR EXISTS (SELECT 1 FROM "template_packages")
          OR EXISTS (
            SELECT 1 FROM "site_content_templates"
            WHERE "kind" IN ('homepage', 'system_page')
          ) THEN
          RAISE EXCEPTION
            'Cannot safely revert TemplatePackage registry while registry data or new template kinds exist';
        END IF;
      END;
      $$
    `);

    await queryRunner.query(
      `ALTER TABLE "site_content_templates" DROP CONSTRAINT "CHK_site_content_templates_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "site_content_templates"
      ADD CONSTRAINT "CHK_site_content_templates_kind"
      CHECK ("kind" IN ('articles_list', 'article', 'category', 'header', 'footer'))
    `);
    await queryRunner.query(
      `DROP INDEX "IDX_sites_current_template_package_version_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_sites_template_package_id"`);
    await queryRunner.query(`
      ALTER TABLE "sites"
      DROP CONSTRAINT "FK_sites_current_template_package_version"
    `);
    await queryRunner.query(
      `ALTER TABLE "sites" DROP CONSTRAINT "FK_sites_template_package"`,
    );
    await queryRunner.query(`
      ALTER TABLE "sites"
      DROP CONSTRAINT "CHK_sites_template_package_version_requires_package"
    `);
    await queryRunner.query(
      `ALTER TABLE "sites" DROP COLUMN "current_template_package_version_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" DROP COLUMN "template_package_id"`,
    );
    await queryRunner.query(
      `DROP TRIGGER "TRG_template_package_versions_immutable" ON "template_package_versions"`,
    );
    await queryRunner.query(
      `DROP FUNCTION "prevent_template_package_version_update"()`,
    );
    await queryRunner.query(`DROP TABLE "template_package_versions"`);
    await queryRunner.query(`DROP TABLE "template_packages"`);
  }
}
