import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterSourceFiles1790107200000 implements MigrationInterface {
  name = 'ContentCenterSourceFiles1790107200000';

  async up(runner: QueryRunner): Promise<void> {
    // Originals are private workspace data, never part of the public site media pool.
    await runner.query(`
      ALTER TABLE cc_materials
        ADD COLUMN url_category varchar(24) NOT NULL DEFAULT 'other'
          CHECK (url_category IN ('site','social','maps','marketplace','advertising','other')),
        ADD COLUMN file_data bytea,
        ADD COLUMN file_size integer CHECK (file_size BETWEEN 0 AND 10485760),
        ADD COLUMN media_type varchar(160),
        ADD COLUMN source_error varchar(300);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE cc_materials DROP COLUMN source_error,
      DROP COLUMN media_type, DROP COLUMN file_size, DROP COLUMN file_data,
      DROP COLUMN url_category`);
  }
}
