import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyCompetitorStarter1791350400000 implements MigrationInterface {
  name = 'RemoveLegacyCompetitorStarter1791350400000';

  async up(runner: QueryRunner): Promise<void> {
    // Only the untouched generic starter is removed. An administrator's edited
    // competitor prompt has a different hash and remains available to them.
    await runner.query(
      `
      DELETE FROM platform_prompts
      WHERE title='Анализ конкурентов'
        AND md5(convert_to(content,'UTF8'))='accbbb4420ff0504278cbf04b381c792'
    `,
    );
  }

  async down(): Promise<void> {
    // Do not recreate an editable global prompt after administrators continue
    // working with the library.
  }
}
