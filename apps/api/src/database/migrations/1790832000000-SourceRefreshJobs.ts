import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SourceRefreshJobs1790832000000 implements MigrationInterface {
  name = 'SourceRefreshJobs1790832000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE cc_preparation_runs
      ADD COLUMN operation varchar(16) NOT NULL DEFAULT 'prepare' CHECK (operation IN ('prepare','collect')),
      ADD COLUMN source_material_id uuid REFERENCES cc_materials(id) ON DELETE SET NULL;
      CREATE INDEX cc_source_refresh_history ON cc_preparation_runs(workspace_id,source_material_id,created_at DESC)
      WHERE operation='collect';`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX cc_source_refresh_history;
      ALTER TABLE cc_preparation_runs DROP COLUMN source_material_id, DROP COLUMN operation;`);
  }
}
