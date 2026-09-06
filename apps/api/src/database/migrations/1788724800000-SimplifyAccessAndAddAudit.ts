import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SimplifyAccessAndAddAudit1788724800000 implements MigrationInterface {
  name = 'SimplifyAccessAndAddAudit1788724800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users" SET "platform_role" = 'employee' WHERE "platform_role" IN ('member', 'agency_member')`,
    );
    await queryRunner.query(
      `UPDATE "workspace_memberships" SET "role" = 'employee' WHERE "role" <> 'employee'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "platform_role" SET DEFAULT 'employee'`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_user_id" uuid,
        "actor_name" character varying(160) NOT NULL,
        "workspace_id" uuid,
        "site_id" uuid,
        "entity_type" character varying(80) NOT NULL,
        "entity_id" character varying(160),
        "action" character varying(40) NOT NULL,
        "description" character varying(500) NOT NULL,
        "changes" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_workspace_created" ON "audit_logs" ("workspace_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_site_created" ON "audit_logs" ("site_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_workspace" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_audit_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_site"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_workspace"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_actor"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_site_created"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_workspace_created"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_created_at"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "platform_role" SET DEFAULT 'member'`,
    );
    await queryRunner.query(
      `UPDATE "workspace_memberships" SET "role" = 'content_manager' WHERE "role" = 'employee'`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "platform_role" = 'member' WHERE "platform_role" = 'employee'`,
    );
  }
}
