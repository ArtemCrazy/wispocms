import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PreparationCheckpoints1791436800000 implements MigrationInterface {
  name = 'PreparationCheckpoints1791436800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE cc_preparation_runs
      ADD COLUMN resume_count integer NOT NULL DEFAULT 0`);
    await runner.query(`CREATE TABLE cc_preparation_checkpoints (
      run_id uuid NOT NULL REFERENCES cc_preparation_runs(id) ON DELETE CASCADE,
      request_hash char(64) NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, request_hash)
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE cc_preparation_checkpoints');
    await runner.query(
      'ALTER TABLE cc_preparation_runs DROP COLUMN resume_count',
    );
  }
}
