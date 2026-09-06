import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrackSiteCreator1788462000000 implements MigrationInterface {
  name = 'TrackSiteCreator1788462000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" ADD "created_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD CONSTRAINT "FK_sites_created_by_user" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" DROP CONSTRAINT "FK_sites_created_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" DROP COLUMN "created_by_user_id"`,
    );
  }
}
