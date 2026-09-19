import type { MigrationInterface, QueryRunner } from 'typeorm';

const oldRule =
  'При возможности указывай название материала или предоставленную ссылку, откуда взят факт; не выдумывай источники.';
const newRule =
  'В итоговом документе не добавляй ссылки на источники, сноски и служебные идентификаторы [S…]: источники доступны отдельно в CMS. Адреса сайтов сохраняй только как данные проекта, не как ссылки-доказательства.';
const starterTitles = [
  'Анализ компании',
  'Анализ интернет-магазина',
  'Анализ лендинга',
  'Без материалов',
  'Структура статьи',
  'Анализ конкурентов',
];

export class PreparationReadablePrompts1790745600000 implements MigrationInterface {
  name = 'PreparationReadablePrompts1790745600000';

  async up(runner: QueryRunner): Promise<void> {
    // Change only the original starter sentence. Preserve client edits and all
    // historical instructions/results; do not overwrite copied workspace drafts.
    await runner.query(
      `
      UPDATE platform_prompts
      SET content=replace(content, $1, $2), revision=revision+1, updated_at=now()
      WHERE title=ANY($3::text[]) AND strpos(content, $1)>0
    `,
      [oldRule, newRule, starterTitles],
    );
  }

  async down(): Promise<void> {
    // Editable library content cannot be safely reverted after subsequent edits.
  }
}
