import { MigrationInterface, QueryRunner } from 'typeorm';

export class SiteScopedRoles1790017200000 implements MigrationInterface {
  name = 'SiteScopedRoles1790017200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" ADD COLUMN "site_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "account_kind" varchar(20) NOT NULL DEFAULT 'legacy'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "home_site_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "account_kind" = 'wispo' WHERE "platform_role" = 'wispo_admin'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_account_kind" CHECK ("account_kind" IN ('legacy', 'wispo', 'site'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_site_home" CHECK (("account_kind" = 'site' AND "home_site_id" IS NOT NULL) OR ("account_kind" <> 'site' AND "home_site_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_home_site" FOREIGN KEY ("home_site_id") REFERENCES "sites"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_home_site"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_site_home"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_users_account_kind"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "home_site_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "account_kind"`);
    await queryRunner.query(
      `ALTER TABLE "workspace_memberships" DROP COLUMN "site_ids"`,
    );
  }
}
