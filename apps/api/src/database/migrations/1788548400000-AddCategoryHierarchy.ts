import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryHierarchy1788548400000 implements MigrationInterface {
  name = 'AddCategoryHierarchy1788548400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" ADD "parent_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "icon" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "image_media_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "seo_title" character varying(240)`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "seo_description" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "canonical_url" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD "no_index" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_categories_parent_id" ON "categories" ("parent_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_categories_parent" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_categories_image_media" FOREIGN KEY ("image_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_categories_image_media"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_categories_parent"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_categories_parent_id"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "no_index"`);
    await queryRunner.query(
      `ALTER TABLE "categories" DROP COLUMN "canonical_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP COLUMN "seo_description"`,
    );
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "seo_title"`);
    await queryRunner.query(
      `ALTER TABLE "categories" DROP COLUMN "image_media_id"`,
    );
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "icon"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "parent_id"`);
  }
}
