import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotFoundTemplateBinding1789070400000 implements MigrationInterface {
  name = 'AddNotFoundTemplateBinding1789070400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pages"
        ADD COLUMN "system_template_key" character varying(80),
        ADD COLUMN "system_template_version" character varying(40),
        ADD COLUMN "published_system_template_key" character varying(80),
        ADD COLUMN "published_system_template_version" character varying(40)
    `);
    await queryRunner.query(`
      UPDATE "pages"
      SET
        "system_template_key" = 'signal',
        "system_template_version" = '1',
        "published_system_template_key" = CASE
          WHEN "status" = 'published' THEN 'signal'
          ELSE NULL
        END,
        "published_system_template_version" = CASE
          WHEN "status" = 'published' THEN '1'
          ELSE NULL
        END
      WHERE "slug" = '404'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pages"
        DROP COLUMN "published_system_template_version",
        DROP COLUMN "published_system_template_key",
        DROP COLUMN "system_template_version",
        DROP COLUMN "system_template_key"
    `);
  }
}
