import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterPreparation1790020800000 implements MigrationInterface {
  name = 'ContentCenterPreparation1790020800000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE cc_materials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title varchar(160) NOT NULL,
        kind varchar(12) NOT NULL CHECK (kind IN ('text','file','url')),
        source_url varchar(2048),
        file_name varchar(200),
        content text NOT NULL,
        revision integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX cc_materials_workspace ON cc_materials(workspace_id, created_at);
      CREATE TABLE cc_prompts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title varchar(160) NOT NULL,
        content text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX cc_prompts_workspace ON cc_prompts(workspace_id, created_at);
      CREATE TABLE cc_preparation_drafts (
        workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        instruction text NOT NULL DEFAULT '',
        without_materials boolean NOT NULL DEFAULT false,
        revision integer NOT NULL DEFAULT 1
      );
      CREATE TABLE cc_preparation_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        number integer NOT NULL CHECK (number > 0),
        content text NOT NULL,
        actor_name varchar(160) NOT NULL,
        reason varchar(240) NOT NULL,
        restored_from integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(workspace_id, number)
      );
      CREATE TABLE cc_preparation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        status varchar(20) NOT NULL CHECK (status IN ('queued','processing','succeeded','failed')),
        actor_name varchar(160) NOT NULL,
        instruction text NOT NULL,
        input_context jsonb,
        provider varchar(160) NOT NULL,
        error varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz
      );
      CREATE UNIQUE INDEX cc_one_active_preparation ON cc_preparation_runs(workspace_id)
        WHERE status IN ('queued','processing');
      CREATE INDEX cc_preparation_queue ON cc_preparation_runs(created_at) WHERE status = 'queued';
      CREATE INDEX cc_preparation_workspace ON cc_preparation_runs(workspace_id, created_at DESC);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DROP TABLE cc_preparation_runs, cc_preparation_versions, cc_preparation_drafts, cc_prompts, cc_materials`,
    );
  }
}
