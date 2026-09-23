import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentCenterCreation1790280000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE cc_creation_settings (
        workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        revision integer NOT NULL DEFAULT 1, rules text NOT NULL DEFAULT '',
        platforms jsonb NOT NULL DEFAULT '[]'
      );
      CREATE TABLE cc_clusters (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        number integer NOT NULL, title varchar(240) NOT NULL, direction varchar(160) NOT NULL DEFAULT '',
        queries jsonb NOT NULL, archived boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(workspace_id, number), UNIQUE(workspace_id,id)
      );
      CREATE TABLE cc_created_articles (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        cluster_id uuid NOT NULL, site_id uuid NOT NULL REFERENCES sites(id),
        status varchar(24) NOT NULL DEFAULT 'created' CHECK(status IN ('created','published','unpublished')),
        recommendation varchar(24) NOT NULL DEFAULT 'keep' CHECK(recommendation IN ('keep','update','unpublish')),
        rationale text NOT NULL DEFAULT '', purpose text NOT NULL DEFAULT '', task text NOT NULL DEFAULT '', need text NOT NULL DEFAULT '',
        content_rationale text NOT NULL DEFAULT '', current_number integer NOT NULL DEFAULT 1, published_number integer,
        revision integer NOT NULL DEFAULT 1, cms_article_id uuid REFERENCES articles(id), cms_revision integer,
        publication_url text, category_id uuid REFERENCES categories(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(workspace_id,cluster_id) REFERENCES cc_clusters(workspace_id,id),
        UNIQUE(cluster_id,site_id), UNIQUE(workspace_id,id)
      );
      CREATE TABLE cc_created_versions (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), article_id uuid NOT NULL REFERENCES cc_created_articles(id) ON DELETE CASCADE,
        number integer NOT NULL, snapshot jsonb NOT NULL, changes jsonb NOT NULL DEFAULT '[]',
        reason text NOT NULL, actor_name varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(article_id,number)
      );
      CREATE TABLE cc_corrections (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), article_id uuid NOT NULL REFERENCES cc_created_articles(id) ON DELETE CASCADE,
        base_number integer NOT NULL, proposals jsonb NOT NULL, completed boolean NOT NULL DEFAULT false,
        actor_name varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX cc_one_pending_correction ON cc_corrections(article_id) WHERE NOT completed;
      CREATE TABLE cc_creation_runs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        number integer NOT NULL, kind varchar(24) NOT NULL CHECK(kind IN ('production','correction')),
        status varchar(24) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','partial','failed')),
        actor_id uuid NOT NULL REFERENCES users(id), actor_name varchar(160) NOT NULL,
        cluster_count integer NOT NULL, instruction text NOT NULL DEFAULT '', file_name text,
        input jsonb, operations jsonb NOT NULL, lease_token uuid,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
        UNIQUE(workspace_id,number)
      );
      CREATE UNIQUE INDEX cc_one_creation_run ON cc_creation_runs(workspace_id) WHERE status IN ('queued','processing');
      CREATE TABLE cc_creation_events (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        kind varchar(16) NOT NULL CHECK(kind IN ('cluster','article')), type varchar(32) NOT NULL,
        cluster_id uuid NOT NULL REFERENCES cc_clusters(id), article_id uuid REFERENCES cc_created_articles(id),
        title text NOT NULL, before jsonb, after jsonb, related_ids jsonb NOT NULL DEFAULT '[]',
        actor_name varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX cc_creation_events_workspace ON cc_creation_events(workspace_id,created_at DESC);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP TABLE cc_creation_events, cc_creation_runs, cc_corrections, cc_created_versions, cc_created_articles, cc_clusters, cc_creation_settings',
    );
  }
}
