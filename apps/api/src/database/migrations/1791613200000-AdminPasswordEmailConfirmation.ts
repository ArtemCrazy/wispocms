import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminPasswordEmailConfirmation1791613200000 implements MigrationInterface {
  name = 'AdminPasswordEmailConfirmation1791613200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD "session_version" integer NOT NULL DEFAULT 0',
    );
    await queryRunner.query(`
      CREATE TABLE "admin_password_resets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_admin_password_resets_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "PK_admin_password_resets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_admin_password_resets_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_admin_password_resets_user_created" ON "admin_password_resets" ("user_id", "created_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "admin_password_resets"');
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN "session_version"',
    );
  }
}
