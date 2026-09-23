import { MigrationInterface, QueryRunner } from 'typeorm';

export class GlobalPromptLibrary1790486400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE platform_prompts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title varchar(160) NOT NULL,
      content text NOT NULL,
      revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Only our exact generic starter drafts may become public across workspaces.
    // Never promote arbitrary workspace content, even if its title matches.
    await runner.query(`INSERT INTO platform_prompts (title,content,created_at)
      SELECT DISTINCT ON (title) title,content,created_at FROM cc_prompts
      WHERE (title,md5(convert_to(content,'UTF8'))) IN (
        ('Анализ компании','b305a9e7943b097cb646f5aa8cf13851'),
        ('Анализ интернет-магазина','2e1b64544c4599245360c2ee3785121d'),
        ('Анализ лендинга','a2a8e051ed1cc51b7cecd60267193e3c'),
        ('Без материалов','4768991cc1ebb62cf187f281edd222ef'),
        ('Структура статьи','a229f58226f9a66b80fe5afc7005284b'),
        ('Анализ конкурентов','fd7ac6ff83cb9830e9d692f9979a3445')
      ) ORDER BY title,created_at,id`);
    await runner.query(`COMMENT ON TABLE cc_prompts IS
      'Retired workspace prompt library; retained for recovery only. Active library: platform_prompts.'`);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Global prompts contain shared admin edits. Roll back application images only; export data before manual schema recovery.',
      ),
    );
  }
}
