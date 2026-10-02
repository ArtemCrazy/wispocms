import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveCmsCodeEditing1791703200000 implements MigrationInterface {
  name = 'RemoveCmsCodeEditing1791703200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "site_accesses" DROP COLUMN "can_edit_code"',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "site_accesses" ADD "can_edit_code" boolean NOT NULL DEFAULT false',
    );
  }
}
