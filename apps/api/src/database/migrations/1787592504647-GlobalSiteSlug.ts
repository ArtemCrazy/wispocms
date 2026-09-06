import { MigrationInterface, QueryRunner } from 'typeorm';

export class GlobalSiteSlug1787592504647 implements MigrationInterface {
  name = 'GlobalSiteSlug1787592504647';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates = (await queryRunner.query(
      `SELECT "slug" FROM "sites" GROUP BY "slug" HAVING COUNT(*) > 1 LIMIT 1`,
    )) as Array<{ slug: string }>;
    if (duplicates.length) {
      throw new Error(
        `Cannot make site slugs globally unique: duplicate slug "${duplicates[0].slug}"`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_sites_slug_unique" ON "sites" ("slug")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_sites_slug_unique"`);
  }
}
