import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterResearch1790193600000 implements MigrationInterface {
  name = 'ContentCenterResearch1790193600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE cc_research_drafts (
        workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        context_kind varchar(20) NOT NULL CHECK (context_kind IN ('conclusions','full')),
        direction text NOT NULL DEFAULT '',
        categories jsonb NOT NULL,
        sources jsonb NOT NULL DEFAULT '[]',
        revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE cc_research_confirmations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        draft_revision integer NOT NULL,
        preparation_version_id uuid REFERENCES cc_preparation_versions(id),
        context_kind varchar(20) NOT NULL,
        context_text text,
        direction text NOT NULL,
        categories jsonb NOT NULL,
        sources jsonb NOT NULL,
        actor_name varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE NULLS NOT DISTINCT (workspace_id,draft_revision,preparation_version_id)
      );
      CREATE INDEX cc_research_confirmations_workspace ON cc_research_confirmations(workspace_id,created_at DESC);
      CREATE TABLE cc_research_search_locks (
        workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        token uuid NOT NULL,
        expires_at timestamptz NOT NULL
      );
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TABLE cc_research_search_locks, cc_research_confirmations, cc_research_drafts',
    );
  }
}
