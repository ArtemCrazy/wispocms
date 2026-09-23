import type { MigrationInterface, QueryRunner } from 'typeorm';

const legacyTypes = [
  'article',
  'category',
  'author',
  'page',
  'banner',
  'site_variable',
  'template',
  'chunk',
] as const;

const settingsTypes = ['site_globals', 'site_header', 'site_footer'] as const;

function quoted(types: readonly string[]) {
  return types.map((type) => `'${type}'`).join(', ');
}

export class ExpandCmsRevisionResourceTypes1790190000000 implements MigrationInterface {
  name = 'ExpandCmsRevisionResourceTypes1790190000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted([...legacyTypes, ...settingsTypes])}))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "cms_revision_resources"
          WHERE "resource_type" IN (${quoted(settingsTypes)})
        ) THEN
          RAISE EXCEPTION 'Cannot remove site settings revision types while their immutable history exists';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted(legacyTypes)}))
    `);
  }
}
