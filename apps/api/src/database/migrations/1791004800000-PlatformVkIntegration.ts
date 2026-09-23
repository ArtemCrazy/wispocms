import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformVkIntegration1791004800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE platform_vk_settings (
      id text PRIMARY KEY CHECK (id = 'vk'),
      encrypted_key text,
      revision integer NOT NULL DEFAULT 0,
      updated_at timestamptz,
      verified_at timestamptz,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL
    )`);
    await runner.query("INSERT INTO platform_vk_settings(id) VALUES ('vk')");
    // NULL denotes the platform credential; existing per-source secrets remain valid.
    await runner.query(
      'ALTER TABLE cc_vk_connections ALTER COLUMN encrypted_token DROP NOT NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    // Refuse rollback while global connections exist instead of silently deleting them.
    await runner.query(
      'ALTER TABLE cc_vk_connections ALTER COLUMN encrypted_token SET NOT NULL',
    );
    await runner.query('DROP TABLE platform_vk_settings');
  }
}
