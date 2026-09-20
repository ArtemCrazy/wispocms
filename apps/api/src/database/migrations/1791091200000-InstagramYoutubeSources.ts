import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InstagramYoutubeSources1791091200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE platform_social_settings (
      network text PRIMARY KEY CHECK (network IN ('youtube','instagram')),
      encrypted_secret text, app_id text, redirect_uri text,
      revision integer NOT NULL DEFAULT 0, updated_at timestamptz,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT INTO platform_social_settings(network) VALUES ('youtube'),('instagram');
    CREATE TABLE cc_instagram_connections (
      material_id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
      source_url text NOT NULL, account_id text NOT NULL, username text NOT NULL,
      encrypted_token text NOT NULL, expires_at timestamptz NOT NULL,
      app_revision integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (workspace_id,material_id) REFERENCES cc_materials(workspace_id,id) ON DELETE CASCADE
    );
    CREATE TABLE cc_instagram_oauth_states (
      state_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id uuid NOT NULL, material_id uuid NOT NULL, material_revision integer NOT NULL,
      app_revision integer NOT NULL, source_url text NOT NULL, expires_at timestamptz NOT NULL,
      FOREIGN KEY (workspace_id,material_id) REFERENCES cc_materials(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX cc_instagram_oauth_expiry ON cc_instagram_oauth_states(expires_at);`);
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Social connections contain credentials. Keep additive tables on application rollback; destructive recovery requires an explicit export/restore plan.',
      ),
    );
  }
}
