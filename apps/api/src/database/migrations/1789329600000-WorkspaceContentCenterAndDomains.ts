import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceContentCenterAndDomains1789329600000 implements MigrationInterface {
  name = 'WorkspaceContentCenterAndDomains1789329600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sites"
        ADD COLUMN "domain_status" character varying(24) NOT NULL DEFAULT 'not_configured',
        ADD COLUMN "domain_checked_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "domain_status_message" character varying(500),
        ADD COLUMN "linked_commercial_site_id" uuid,
        ADD CONSTRAINT "CHK_sites_domain_status" CHECK ("domain_status" IN ('not_configured', 'pending', 'verified', 'error')),
        ADD CONSTRAINT "FK_sites_linked_commercial" FOREIGN KEY ("linked_commercial_site_id") REFERENCES "sites"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "sites"
      SET "domain" = NULLIF(
        regexp_replace(
          regexp_replace(lower(trim("domain")), '^https?://', ''),
          '[/\\?#].*$',
          ''
        ),
        ''
      ),
      "domain_status" = CASE
        WHEN NULLIF(trim("domain"), '') IS NULL THEN 'not_configured'
        ELSE 'pending'
      END
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sites_domain_ci"
      ON "sites" (lower("domain"))
      WHERE "domain" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "media"
        ADD COLUMN "workspace_id" uuid,
        ADD COLUMN "storage_namespace" character varying(100)
    `);
    await queryRunner.query(`
      UPDATE "media" AS media
      SET "workspace_id" = site."workspace_id",
          "storage_namespace" = media."site_id"::text
      FROM "sites" AS site
      WHERE site."id" = media."site_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "media"
        ALTER COLUMN "workspace_id" SET NOT NULL,
        ALTER COLUMN "storage_namespace" SET NOT NULL,
        ALTER COLUMN "site_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_0f2e46da6bc9d2d7428f84250a4",
        ADD CONSTRAINT "FK_media_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_media_origin_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_media_workspace_created" ON "media" ("workspace_id", "created_at" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_workspace_created"`);
    await queryRunner.query(`
      ALTER TABLE "media"
        DROP CONSTRAINT "FK_media_origin_site",
        DROP CONSTRAINT "FK_media_workspace",
        ALTER COLUMN "site_id" SET NOT NULL,
        ADD CONSTRAINT "FK_0f2e46da6bc9d2d7428f84250a4" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "media"
        DROP COLUMN "storage_namespace",
        DROP COLUMN "workspace_id"
    `);
    await queryRunner.query(`DROP INDEX "UQ_sites_domain_ci"`);
    await queryRunner.query(`
      ALTER TABLE "sites"
        DROP CONSTRAINT "FK_sites_linked_commercial",
        DROP CONSTRAINT "CHK_sites_domain_status",
        DROP COLUMN "linked_commercial_site_id",
        DROP COLUMN "domain_status_message",
        DROP COLUMN "domain_checked_at",
        DROP COLUMN "domain_status"
    `);
  }
}
