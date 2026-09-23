import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterVkSources1790918400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE UNIQUE INDEX cc_materials_workspace_identity ON cc_materials(workspace_id,id)',
    );
    await runner.query(`CREATE TABLE cc_vk_connections (
      material_id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL,
      source_url text NOT NULL,
      group_id bigint NOT NULL CHECK (group_id > 0),
      group_name text NOT NULL,
      encrypted_token text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (workspace_id,material_id) REFERENCES cc_materials(workspace_id,id) ON DELETE CASCADE
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE cc_vk_connections');
    await runner.query('DROP INDEX cc_materials_workspace_identity');
  }
}
