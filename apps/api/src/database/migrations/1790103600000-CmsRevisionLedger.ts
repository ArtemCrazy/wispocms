import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CmsRevisionLedger1790103600000 implements MigrationInterface {
  name = 'CmsRevisionLedger1790103600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cms_revision_resources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "resource_type" varchar(32) NOT NULL,
        "entity_id" uuid NOT NULL,
        "latest_version_number" integer NOT NULL DEFAULT 0,
        "draft_revision_id" uuid,
        "approved_revision_id" uuid,
        "published_revision_id" uuid,
        "review_state" varchar(24) NOT NULL DEFAULT 'draft',
        CONSTRAINT "PK_cms_revision_resources" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cms_revision_resources_identity" UNIQUE ("site_id", "resource_type", "entity_id"),
        CONSTRAINT "FK_cms_revision_resources_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_cms_revision_resources_type" CHECK ("resource_type" IN ('article', 'category', 'author', 'page', 'banner', 'site_variable', 'template', 'chunk')),
        CONSTRAINT "CHK_cms_revision_resources_state" CHECK ("review_state" IN ('draft', 'in_review', 'changes_requested', 'approved')),
        CONSTRAINT "CHK_cms_revision_resources_number" CHECK ("latest_version_number" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "cms_revisions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "snapshot" jsonb NOT NULL,
        "actor_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cms_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cms_revisions_number" UNIQUE ("resource_id", "version_number"),
        CONSTRAINT "UQ_cms_revisions_resource_id_id" UNIQUE ("resource_id", "id"),
        CONSTRAINT "FK_cms_revisions_resource" FOREIGN KEY ("resource_id") REFERENCES "cms_revision_resources"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_cms_revisions_number" CHECK ("version_number" > 0)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        ADD CONSTRAINT "FK_cms_resources_draft" FOREIGN KEY ("id", "draft_revision_id") REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_cms_resources_approved" FOREIGN KEY ("id", "approved_revision_id") REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_cms_resources_published" FOREIGN KEY ("id", "published_revision_id") REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE TABLE "cms_revision_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource_id" uuid NOT NULL,
        "revision_id" uuid NOT NULL,
        "event_type" varchar(32) NOT NULL,
        "actor_user_id" uuid,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cms_revision_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cms_revision_events_resource" FOREIGN KEY ("resource_id") REFERENCES "cms_revision_resources"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cms_revision_events_revision" FOREIGN KEY ("resource_id", "revision_id") REFERENCES "cms_revisions"("resource_id", "id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cms_revisions_resource_created"
        ON "cms_revisions" ("resource_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cms_revision_events_resource_created"
        ON "cms_revision_events" ("resource_id", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "cms_revision_events"');
    await queryRunner.query(
      'ALTER TABLE "cms_revision_resources" DROP CONSTRAINT "FK_cms_resources_draft", DROP CONSTRAINT "FK_cms_resources_approved", DROP CONSTRAINT "FK_cms_resources_published"',
    );
    await queryRunner.query('DROP TABLE "cms_revisions"');
    await queryRunner.query('DROP TABLE "cms_revision_resources"');
  }
}
