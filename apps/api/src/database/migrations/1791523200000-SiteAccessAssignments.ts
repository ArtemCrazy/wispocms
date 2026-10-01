import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SiteAccessAssignments1791523200000 implements MigrationInterface {
  name = 'SiteAccessAssignments1791523200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "site_accesses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "site_id" uuid NOT NULL,
        "role" character varying(40) NOT NULL,
        "can_edit_code" boolean NOT NULL DEFAULT false,
        "requires_approval" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_site_accesses_role"
          CHECK ("role" IN ('site_owner', 'content_manager')),
        CONSTRAINT "UQ_site_accesses_user_site" UNIQUE ("user_id", "site_id"),
        CONSTRAINT "PK_site_accesses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_site_accesses_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_site_accesses_site"
          FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_site_accesses_site_id" ON "site_accesses" ("site_id")',
    );
    await queryRunner.query(`
      INSERT INTO "site_accesses"
        ("user_id", "site_id", "role", "can_edit_code", "requires_approval")
      SELECT
        membership."user_id",
        assigned."site_id",
        CASE
          WHEN membership."role" = 'site_owner' THEN 'site_owner'
          ELSE 'content_manager'
        END,
        membership."role" IN ('wispo_developer', 'site_developer'),
        false
      FROM "workspace_memberships" membership
      CROSS JOIN LATERAL unnest(
        COALESCE(membership."site_ids", '{}'::uuid[])
      ) AS assigned("site_id")
      INNER JOIN "sites" site
        ON site."id" = assigned."site_id"
       AND site."workspace_id" = membership."workspace_id"
      WHERE membership."role" IN (
        'site_owner',
        'wispo_manager',
        'site_content_manager',
        'wispo_developer',
        'site_developer'
      )
      ON CONFLICT ("user_id", "site_id") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "site_accesses"');
  }
}
