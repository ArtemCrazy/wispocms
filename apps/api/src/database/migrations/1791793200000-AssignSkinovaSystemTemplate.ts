import type { MigrationInterface, QueryRunner } from 'typeorm';

const PAGE_ID = '51a40000-0000-4000-8000-000000000002';
const SITE_ID = '51a00000-0000-4000-8000-000000000002';
const PAGE_SLUG = 'privacy-policy';
const SITE_SLUG = 'skinova';
const TEMPLATE_KEY = 'skinova';
const TEMPLATE_VERSION = '1';

const params = [
  PAGE_ID,
  SITE_ID,
  PAGE_SLUG,
  SITE_SLUG,
  TEMPLATE_KEY,
  TEMPLATE_VERSION,
] as const;

export class AssignSkinovaSystemTemplate1791793200000 implements MigrationInterface {
  name = 'AssignSkinovaSystemTemplate1791793200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "pages" page
       SET "system_template_key" = $5,
           "system_template_version" = $6,
           "published_system_template_key" = $5,
           "published_system_template_version" = $6
       WHERE page."id" = $1
         AND page."site_id" = $2
         AND page."slug" = $3
         AND page."system_template_key" IS NULL
         AND page."system_template_version" IS NULL
         AND page."published_system_template_key" IS NULL
         AND page."published_system_template_version" IS NULL
         AND EXISTS (
           SELECT 1
           FROM "sites" site
           WHERE site."id" = page."site_id"
             AND site."id" = $2
             AND site."slug" = $4
         )`,
      [...params],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "pages" page
       SET "system_template_key" = NULL,
           "system_template_version" = NULL,
           "published_system_template_key" = NULL,
           "published_system_template_version" = NULL
       WHERE page."id" = $1
         AND page."site_id" = $2
         AND page."slug" = $3
         AND page."system_template_key" = $5
         AND page."system_template_version" = $6
         AND page."published_system_template_key" = $5
         AND page."published_system_template_version" = $6
         AND EXISTS (
           SELECT 1
           FROM "sites" site
           WHERE site."id" = page."site_id"
             AND site."id" = $2
             AND site."slug" = $4
         )`,
      [...params],
    );
  }
}
