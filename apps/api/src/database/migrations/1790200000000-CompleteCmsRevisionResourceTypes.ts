import type { MigrationInterface, QueryRunner } from 'typeorm';

const previousTypes = [
  'article',
  'category',
  'author',
  'page',
  'banner',
  'site_variable',
  'template',
  'chunk',
  'site_globals',
  'site_header',
  'site_footer',
] as const;

const newTypes = [
  'site_variables',
  'site_seo',
  'site_search',
  'site_not_found',
  'site_privacy',
] as const;

const quoted = (types: readonly string[]) =>
  types.map((type) => `'${type}'`).join(', ');

export class CompleteCmsRevisionResourceTypes1790200000000 implements MigrationInterface {
  name = 'CompleteCmsRevisionResourceTypes1790200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted([...previousTypes, ...newTypes])}))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "cms_revision_resources"
          WHERE "resource_type" IN (${quoted(newTypes)})
        ) THEN
          RAISE EXCEPTION 'Cannot remove active CMS resource histories';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted(previousTypes)}))
    `);
  }
}
