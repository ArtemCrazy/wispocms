import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterSiteImports1790572800000 implements MigrationInterface {
  name = 'ContentCenterSiteImports1790572800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE cc_materials ADD COLUMN site_pages jsonb,
        ADD COLUMN site_checked_at timestamptz;
      ALTER TABLE cc_preparation_versions ADD COLUMN sources jsonb;
      ALTER TABLE cc_preparation_runs ADD COLUMN progress jsonb,
        ADD COLUMN heartbeat_at timestamptz;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE cc_preparation_runs DROP COLUMN progress, DROP COLUMN heartbeat_at;
      ALTER TABLE cc_preparation_versions DROP COLUMN sources;
      ALTER TABLE cc_materials DROP COLUMN site_pages, DROP COLUMN site_checked_at;`);
  }
}
