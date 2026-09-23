import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeepseekIntegration1790400000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE platform_ai_settings (
      id text PRIMARY KEY CHECK (id = 'deepseek'),
      encrypted_key text,
      model text NOT NULL DEFAULT 'deepseek-flash',
      revision integer NOT NULL DEFAULT 0,
      updated_at timestamptz,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      verified_at timestamptz
    )`);
    await runner.query(
      `INSERT INTO platform_ai_settings (id) VALUES ('deepseek')`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE platform_ai_settings');
  }
}
