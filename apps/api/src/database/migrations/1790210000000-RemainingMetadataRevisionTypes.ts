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
  'site_variables',
  'site_seo',
  'site_search',
  'site_not_found',
  'site_privacy',
] as const;
const newTypes = [
  'site_layout_bindings',
  'site_article_list',
  'media_alt',
] as const;
const quoted = (types: readonly string[]) =>
  types.map((type) => `'${type}'`).join(', ');

export class RemainingMetadataRevisionTypes1790210000000 implements MigrationInterface {
  name = 'RemainingMetadataRevisionTypes1790210000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted([...previousTypes, ...newTypes])}))
    `);
    await queryRunner.query(`
      ALTER TABLE "media"
        ADD COLUMN "is_decorative" boolean NOT NULL DEFAULT false
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
          RAISE EXCEPTION 'Cannot remove active metadata revision histories';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "cms_revision_resources"
        DROP CONSTRAINT "CHK_cms_revision_resources_type",
        ADD CONSTRAINT "CHK_cms_revision_resources_type"
          CHECK ("resource_type" IN (${quoted(previousTypes)}))
    `);
    await queryRunner.query('ALTER TABLE "media" DROP COLUMN "is_decorative"');
  }
}
