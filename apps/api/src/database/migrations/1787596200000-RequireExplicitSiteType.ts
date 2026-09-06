import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequireExplicitSiteType1787596200000 implements MigrationInterface {
  name = 'RequireExplicitSiteType1787596200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const invalidRows: unknown = await queryRunner.query(
      `SELECT DISTINCT "site_type" FROM "sites" WHERE "site_type" NOT IN ('media', 'corporate', 'landing')`,
    );
    if (!Array.isArray(invalidRows)) {
      throw new Error('Cannot validate existing site types');
    }
    if (invalidRows.length > 0) {
      throw new Error(
        'Cannot require an explicit site type: unsupported values exist',
      );
    }

    await queryRunner.query(
      `ALTER TABLE "sites" ALTER COLUMN "site_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD CONSTRAINT "CHK_sites_site_type" CHECK ("site_type" IN ('media', 'corporate', 'landing'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" DROP CONSTRAINT "CHK_sites_site_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ALTER COLUMN "site_type" SET DEFAULT 'media'`,
    );
  }
}
