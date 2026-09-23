import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PreparationRequestLabels1790659200000 implements MigrationInterface {
  name = 'PreparationRequestLabels1790659200000';

  async up(runner: QueryRunner): Promise<void> {
    // Nullable snapshots preserve compatibility for history without reliable provenance.
    await runner.query(`
      ALTER TABLE cc_preparation_drafts ADD COLUMN prompt_title varchar(160);
      ALTER TABLE cc_preparation_runs ADD COLUMN prompt_title varchar(160);
      ALTER TABLE cc_preparation_versions ADD COLUMN prompt_title varchar(160), ADD COLUMN instruction text;
    `);
    // appendVersion and the successful run update share a transaction's now().
    // Require exactly one matching run in the same workspace; titles are filled
    // only for a single library prompt with the exact saved instruction text.
    await runner.query(`
      WITH matched AS (
        SELECT v.id, min(r.instruction) AS instruction
        FROM cc_preparation_versions v
        JOIN cc_preparation_runs r ON r.workspace_id=v.workspace_id
          AND r.finished_at=v.created_at AND r.status='succeeded'
        WHERE v.restored_from IS NULL AND v.reason='Обработка материалов'
        GROUP BY v.id HAVING count(*)=1
      )
      UPDATE cc_preparation_versions v
      SET instruction=matched.instruction,
          prompt_title=(SELECT min(p.title) FROM platform_prompts p
            WHERE btrim(p.content)=btrim(matched.instruction) HAVING count(*)=1)
      FROM matched WHERE v.id=matched.id;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE cc_preparation_versions DROP COLUMN instruction, DROP COLUMN prompt_title;
      ALTER TABLE cc_preparation_runs DROP COLUMN prompt_title;
      ALTER TABLE cc_preparation_drafts DROP COLUMN prompt_title;
    `);
  }
}
