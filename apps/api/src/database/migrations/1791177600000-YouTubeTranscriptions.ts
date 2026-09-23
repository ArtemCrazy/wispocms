import type { MigrationInterface, QueryRunner } from 'typeorm';

export class YouTubeTranscriptions1791177600000 implements MigrationInterface {
  name = 'YouTubeTranscriptions1791177600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE platform_transcription_settings (
        id text PRIMARY KEY CHECK (id = 'groq'),
        encrypted_key text,
        model text NOT NULL DEFAULT 'whisper-large-v3-turbo',
        revision integer NOT NULL DEFAULT 0,
        updated_at timestamptz,
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        verified_at timestamptz
      );
      INSERT INTO platform_transcription_settings (id) VALUES ('groq');

      CREATE TABLE cc_youtube_transcriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        material_id uuid NOT NULL REFERENCES cc_materials(id) ON DELETE CASCADE,
        video_id varchar(11) NOT NULL,
        video_url varchar(2048) NOT NULL,
        title varchar(500) NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('queued','processing','succeeded','failed')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        transcript text,
        error varchar(500),
        model varchar(80) NOT NULL DEFAULT 'whisper-large-v3-turbo',
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz,
        heartbeat_at timestamptz,
        UNIQUE(material_id, video_id)
      );
      CREATE INDEX cc_youtube_transcriptions_queue
        ON cc_youtube_transcriptions(status, created_at)
        WHERE status IN ('queued','processing');
      CREATE INDEX cc_youtube_transcriptions_material
        ON cc_youtube_transcriptions(material_id, created_at);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TABLE cc_youtube_transcriptions, platform_transcription_settings',
    );
  }
}
