import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ManagedChunkPersistence1791876000000 implements MigrationInterface {
  name = 'ManagedChunkPersistence1791876000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "template_package_versions"
        DROP CONSTRAINT "CHK_template_package_versions_manifest_version",
        ADD CONSTRAINT "CHK_template_package_versions_manifest_version"
          CHECK ("manifest_version" IN (1, 2))
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (
            'article', 'category', 'author', 'page', 'banner', 'site_variable',
            'template', 'chunk', 'site_globals', 'site_header', 'site_footer',
            'site_variables', 'site_seo', 'site_search', 'site_not_found',
            'site_privacy', 'site_layout_bindings', 'site_article_list',
            'media_alt', 'chunk_instance', 'chunk_layout'
          ))
    `);
    await queryRunner.query(`
      ALTER TABLE "pages"
        ADD CONSTRAINT "UQ_pages_id_site_id" UNIQUE ("id", "site_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "managed_chunk_contracts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "template_package_id" uuid NOT NULL,
        "first_seen_template_package_version_id" uuid NOT NULL,
        "definition_key" varchar(80) NOT NULL,
        "schema_version" varchar(40) NOT NULL,
        "contract_digest" varchar(80) NOT NULL,
        "field_contract" jsonb NOT NULL,
        "data_schema" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_managed_chunk_contracts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_chunk_contracts_identity"
          UNIQUE ("template_package_id", "definition_key", "schema_version"),
        CONSTRAINT "CHK_managed_chunk_contracts_field_contract_object"
          CHECK (jsonb_typeof("field_contract") = 'object'),
        CONSTRAINT "CHK_managed_chunk_contracts_data_schema_object"
          CHECK (jsonb_typeof("data_schema") = 'object'),
        CONSTRAINT "CHK_managed_chunk_contracts_digest"
          CHECK ("contract_digest" ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT "FK_managed_chunk_contracts_package"
          FOREIGN KEY ("template_package_id")
          REFERENCES "template_packages"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_contracts_first_seen_version"
          FOREIGN KEY (
            "first_seen_template_package_version_id", "template_package_id"
          )
          REFERENCES "template_package_versions"("id", "template_package_id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "managed_chunk_instances" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "revision_resource_id" uuid NOT NULL,
        "display_name" varchar(160) NOT NULL,
        "is_archived" boolean NOT NULL DEFAULT false,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_managed_chunk_instances" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_chunk_instances_revision_resource"
          UNIQUE ("revision_resource_id"),
        CONSTRAINT "UQ_managed_chunk_instances_site_id"
          UNIQUE ("site_id", "id"),
        CONSTRAINT "UQ_managed_chunk_instances_exact_identity"
          UNIQUE ("site_id", "id", "revision_resource_id"),
        CONSTRAINT "FK_managed_chunk_instances_site"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_instances_revision_resource"
          FOREIGN KEY ("revision_resource_id")
          REFERENCES "cms_revision_resources"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_instances_actor"
          FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_instances_site_archived"
        ON "managed_chunk_instances" ("site_id", "is_archived")
    `);

    await queryRunner.query(`
      CREATE TABLE "managed_chunk_instance_revisions" (
        "revision_id" uuid NOT NULL,
        "revision_resource_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "instance_id" uuid NOT NULL,
        "contract_id" uuid NOT NULL,
        CONSTRAINT "PK_managed_chunk_instance_revisions"
          PRIMARY KEY ("revision_id"),
        CONSTRAINT "FK_managed_chunk_instance_revisions_revision"
          FOREIGN KEY ("revision_resource_id", "revision_id")
          REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_instance_revisions_instance"
          FOREIGN KEY ("site_id", "instance_id", "revision_resource_id")
          REFERENCES "managed_chunk_instances"(
            "site_id", "id", "revision_resource_id"
          ) ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_instance_revisions_contract"
          FOREIGN KEY ("contract_id")
          REFERENCES "managed_chunk_contracts"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_instance_revisions_instance"
        ON "managed_chunk_instance_revisions" ("site_id", "instance_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_instance_revisions_contract"
        ON "managed_chunk_instance_revisions" ("contract_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "managed_chunk_layouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "revision_resource_id" uuid NOT NULL,
        "scope_kind" varchar(24) NOT NULL,
        "page_id" uuid,
        "surface_key" varchar(80),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_managed_chunk_layouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_chunk_layouts_revision_resource"
          UNIQUE ("revision_resource_id"),
        CONSTRAINT "UQ_managed_chunk_layouts_site_id"
          UNIQUE ("site_id", "id"),
        CONSTRAINT "UQ_managed_chunk_layouts_exact_identity"
          UNIQUE ("site_id", "id", "revision_resource_id"),
        CONSTRAINT "CHK_managed_chunk_layouts_scope"
          CHECK (
            ("scope_kind" = 'page' AND "page_id" IS NOT NULL AND "surface_key" IS NULL)
            OR
            ("scope_kind" = 'site_surface' AND "page_id" IS NULL AND "surface_key" IS NOT NULL)
          ),
        CONSTRAINT "FK_managed_chunk_layouts_site"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_layouts_revision_resource"
          FOREIGN KEY ("revision_resource_id")
          REFERENCES "cms_revision_resources"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_layouts_page"
          FOREIGN KEY ("page_id", "site_id")
          REFERENCES "pages"("id", "site_id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_page_target"
        ON "managed_chunk_layouts" ("site_id", "page_id")
        WHERE "scope_kind" = 'page'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_surface_target"
        ON "managed_chunk_layouts" ("site_id", "surface_key")
        WHERE "scope_kind" = 'site_surface'
    `);

    await queryRunner.query(`
      CREATE TABLE "managed_chunk_placements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "layout_id" uuid NOT NULL,
        "layout_revision_resource_id" uuid NOT NULL,
        "layout_revision_id" uuid NOT NULL,
        "instance_id" uuid NOT NULL,
        "slot_key" varchar(80) NOT NULL,
        "position" integer NOT NULL,
        CONSTRAINT "PK_managed_chunk_placements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_chunk_placements_site_id"
          UNIQUE ("site_id", "id"),
        CONSTRAINT "UQ_managed_chunk_placements_position"
          UNIQUE ("layout_revision_id", "slot_key", "position"),
        CONSTRAINT "CHK_managed_chunk_placements_position"
          CHECK ("position" >= 0),
        CONSTRAINT "FK_managed_chunk_placements_layout"
          FOREIGN KEY (
            "site_id", "layout_id", "layout_revision_resource_id"
          )
          REFERENCES "managed_chunk_layouts"(
            "site_id", "id", "revision_resource_id"
          ) ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_placements_revision"
          FOREIGN KEY ("layout_revision_resource_id", "layout_revision_id")
          REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_placements_instance"
          FOREIGN KEY ("site_id", "instance_id")
          REFERENCES "managed_chunk_instances"("site_id", "id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_placements_instance"
        ON "managed_chunk_placements" ("site_id", "instance_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "managed_chunk_migration_provenance" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "migration_version" varchar(80) NOT NULL,
        "source_type" varchar(40) NOT NULL,
        "source_id" uuid NOT NULL,
        "source_checksum" varchar(128) NOT NULL,
        "instance_id" uuid,
        "layout_id" uuid,
        "placement_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_managed_chunk_migration_provenance" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_managed_chunk_migration_provenance_source"
          UNIQUE ("migration_version", "source_type", "source_id"),
        CONSTRAINT "CHK_managed_chunk_migration_provenance_source_type"
          CHECK ("source_type" IN ('banner', 'page_banner_assignment')),
        CONSTRAINT "CHK_managed_chunk_migration_provenance_target"
          CHECK (
            (CASE WHEN "instance_id" IS NULL THEN 0 ELSE 1 END) +
            (CASE WHEN "layout_id" IS NULL THEN 0 ELSE 1 END) +
            (CASE WHEN "placement_id" IS NULL THEN 0 ELSE 1 END) = 1
          ),
        CONSTRAINT "FK_managed_chunk_migration_provenance_site"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_migration_provenance_instance"
          FOREIGN KEY ("site_id", "instance_id")
          REFERENCES "managed_chunk_instances"("site_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_migration_provenance_layout"
          FOREIGN KEY ("site_id", "layout_id")
          REFERENCES "managed_chunk_layouts"("site_id", "id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_managed_chunk_migration_provenance_placement"
          FOREIGN KEY ("site_id", "placement_id")
          REFERENCES "managed_chunk_placements"("site_id", "id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_migration_provenance_instance"
        ON "managed_chunk_migration_provenance" ("site_id", "instance_id")
        WHERE "instance_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_migration_provenance_layout"
        ON "managed_chunk_migration_provenance" ("site_id", "layout_id")
        WHERE "layout_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_managed_chunk_migration_provenance_placement"
        ON "managed_chunk_migration_provenance" ("site_id", "placement_id")
        WHERE "placement_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE FUNCTION "verify_managed_chunk_revision_resource"()
      RETURNS trigger AS $$
      DECLARE
        expected_resource_type varchar(32);
      BEGIN
        expected_resource_type := CASE TG_TABLE_NAME
          WHEN 'managed_chunk_instances' THEN 'chunk_instance'
          WHEN 'managed_chunk_layouts' THEN 'chunk_layout'
          ELSE NULL
        END;
        IF expected_resource_type IS NULL OR NOT EXISTS (
          SELECT 1
          FROM "cms_revision_resources" resource
          WHERE resource."id" = NEW."revision_resource_id"
            AND resource."site_id" = NEW."site_id"
            AND resource."resource_type" = expected_resource_type
            AND resource."entity_id" = NEW."id"
        ) THEN
          RAISE EXCEPTION 'Managed chunk revision resource identity mismatch'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_managed_chunk_instances_resource_identity"
      AFTER INSERT OR UPDATE ON "managed_chunk_instances"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "verify_managed_chunk_revision_resource"()
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_managed_chunk_layouts_resource_identity"
      AFTER INSERT OR UPDATE ON "managed_chunk_layouts"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "verify_managed_chunk_revision_resource"()
    `);
    await queryRunner.query(`
      CREATE FUNCTION "protect_managed_chunk_revision_resource_identity"()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "managed_chunk_instances" instance
          WHERE instance."revision_resource_id" = NEW."id"
            AND (
              NEW."site_id" <> instance."site_id"
              OR NEW."resource_type" <> 'chunk_instance'
              OR NEW."entity_id" <> instance."id"
            )
        ) OR EXISTS (
          SELECT 1
          FROM "managed_chunk_layouts" layout
          WHERE layout."revision_resource_id" = NEW."id"
            AND (
              NEW."site_id" <> layout."site_id"
              OR NEW."resource_type" <> 'chunk_layout'
              OR NEW."entity_id" <> layout."id"
            )
        ) THEN
          RAISE EXCEPTION 'Managed chunk revision resource identity is protected'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TRG_cms_revision_resources_managed_chunk_identity"
      AFTER UPDATE OF "site_id", "resource_type", "entity_id"
      ON "cms_revision_resources"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION "protect_managed_chunk_revision_resource_identity"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "protect_managed_chunk_instance_identity"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Managed chunk instance identities cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
          OR NEW."revision_resource_id" IS DISTINCT FROM OLD."revision_resource_id"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
          OR (
            NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
            AND NEW."created_by_user_id" IS NOT NULL
          )
        THEN
          RAISE EXCEPTION 'Managed chunk instance identity is immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_managed_chunk_instances_protect_identity"
      BEFORE UPDATE OR DELETE ON "managed_chunk_instances"
      FOR EACH ROW EXECUTE FUNCTION "protect_managed_chunk_instance_identity"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "protect_managed_chunk_layout_identity"()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Managed chunk layout identities cannot be deleted'
            USING ERRCODE = '55000';
        END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id"
          OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
          OR NEW."revision_resource_id" IS DISTINCT FROM OLD."revision_resource_id"
          OR NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"
          OR NEW."page_id" IS DISTINCT FROM OLD."page_id"
          OR NEW."surface_key" IS DISTINCT FROM OLD."surface_key"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
        THEN
          RAISE EXCEPTION 'Managed chunk layout identities are immutable'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_managed_chunk_layouts_protect_identity"
      BEFORE UPDATE OR DELETE ON "managed_chunk_layouts"
      FOR EACH ROW EXECUTE FUNCTION "protect_managed_chunk_layout_identity"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "reject_managed_chunk_history_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Managed chunk history is immutable'
          USING ERRCODE = '55000';
      END;
      $$ LANGUAGE plpgsql
    `);
    for (const tableName of [
      'managed_chunk_contracts',
      'managed_chunk_instance_revisions',
      'managed_chunk_placements',
      'managed_chunk_migration_provenance',
    ]) {
      await queryRunner.query(
        'CREATE TRIGGER "TRG_' +
          tableName +
          '_immutable" BEFORE UPDATE OR DELETE ON "' +
          tableName +
          '" FOR EACH ROW EXECUTE FUNCTION "reject_managed_chunk_history_mutation"()',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      LOCK TABLE
        "template_package_versions",
        "cms_revision_resources",
        "managed_chunk_contracts",
        "managed_chunk_instances",
        "managed_chunk_instance_revisions",
        "managed_chunk_layouts",
        "managed_chunk_placements",
        "managed_chunk_migration_provenance"
      IN SHARE ROW EXCLUSIVE MODE;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "managed_chunk_contracts")
          OR EXISTS (SELECT 1 FROM "managed_chunk_instances")
          OR EXISTS (SELECT 1 FROM "managed_chunk_instance_revisions")
          OR EXISTS (SELECT 1 FROM "managed_chunk_layouts")
          OR EXISTS (SELECT 1 FROM "managed_chunk_placements")
          OR EXISTS (SELECT 1 FROM "managed_chunk_migration_provenance")
          OR EXISTS (
            SELECT 1 FROM "cms_revision_resources"
            WHERE "resource_type" IN ('chunk_instance', 'chunk_layout')
          )
          OR EXISTS (
            SELECT 1 FROM "template_package_versions"
            WHERE "manifest_version" = 2
          )
        THEN
          RAISE EXCEPTION
            'Cannot safely revert managed chunk persistence while managed data exists';
        END IF;
      END;
      $$
    `);

    await queryRunner.query(
      'DROP TRIGGER "TRG_cms_revision_resources_managed_chunk_identity" ON "cms_revision_resources"',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_managed_chunk_layouts_resource_identity" ON "managed_chunk_layouts"',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_managed_chunk_instances_resource_identity" ON "managed_chunk_instances"',
    );
    await queryRunner.query(
      'DROP FUNCTION "protect_managed_chunk_revision_resource_identity"()',
    );
    await queryRunner.query(
      'DROP FUNCTION "verify_managed_chunk_revision_resource"()',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_managed_chunk_layouts_protect_identity" ON "managed_chunk_layouts"',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_managed_chunk_instances_protect_identity" ON "managed_chunk_instances"',
    );
    await queryRunner.query(
      'DROP FUNCTION "protect_managed_chunk_layout_identity"()',
    );
    await queryRunner.query(
      'DROP FUNCTION "protect_managed_chunk_instance_identity"()',
    );
    for (const tableName of [
      'managed_chunk_migration_provenance',
      'managed_chunk_placements',
      'managed_chunk_instance_revisions',
      'managed_chunk_contracts',
    ]) {
      await queryRunner.query(
        'DROP TRIGGER "TRG_' + tableName + '_immutable" ON "' + tableName + '"',
      );
    }
    await queryRunner.query(
      'DROP FUNCTION "reject_managed_chunk_history_mutation"()',
    );

    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_migration_provenance_placement"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_migration_provenance_layout"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_migration_provenance_instance"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_placements_instance"',
    );
    await queryRunner.query(
      'DROP INDEX "UQ_managed_chunk_layouts_surface_target"',
    );
    await queryRunner.query(
      'DROP INDEX "UQ_managed_chunk_layouts_page_target"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_instance_revisions_contract"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_instance_revisions_instance"',
    );
    await queryRunner.query(
      'DROP INDEX "IDX_managed_chunk_instances_site_archived"',
    );
    await queryRunner.query('DROP TABLE "managed_chunk_migration_provenance"');
    await queryRunner.query('DROP TABLE "managed_chunk_placements"');
    await queryRunner.query('DROP TABLE "managed_chunk_layouts"');
    await queryRunner.query('DROP TABLE "managed_chunk_instance_revisions"');
    await queryRunner.query('DROP TABLE "managed_chunk_instances"');
    await queryRunner.query('DROP TABLE "managed_chunk_contracts"');

    await queryRunner.query(`
      ALTER TABLE "pages"
        DROP CONSTRAINT "UQ_pages_id_site_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (
            'article', 'category', 'author', 'page', 'banner', 'site_variable',
            'template', 'chunk', 'site_globals', 'site_header', 'site_footer',
            'site_variables', 'site_seo', 'site_search', 'site_not_found',
            'site_privacy', 'site_layout_bindings', 'site_article_list',
            'media_alt'
          ))
    `);
    await queryRunner.query(`
      ALTER TABLE "template_package_versions"
        DROP CONSTRAINT "CHK_template_package_versions_manifest_version",
        ADD CONSTRAINT "CHK_template_package_versions_manifest_version"
          CHECK ("manifest_version" = 1)
    `);
  }
}
