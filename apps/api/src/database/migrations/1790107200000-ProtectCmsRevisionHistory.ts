import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectCmsRevisionHistory1790107200000 implements MigrationInterface {
  name = 'ProtectCmsRevisionHistory1790107200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION "reject_cms_revision_mutation"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'CMS revision history is immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_cms_revisions_immutable"
      BEFORE UPDATE OR DELETE ON "cms_revisions"
      FOR EACH ROW EXECUTE FUNCTION "reject_cms_revision_mutation"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_cms_revision_events_immutable"
      BEFORE UPDATE OR DELETE ON "cms_revision_events"
      FOR EACH ROW EXECUTE FUNCTION "reject_cms_revision_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER "TRG_cms_revision_events_immutable" ON "cms_revision_events"',
    );
    await queryRunner.query(
      'DROP TRIGGER "TRG_cms_revisions_immutable" ON "cms_revisions"',
    );
    await queryRunner.query('DROP FUNCTION "reject_cms_revision_mutation"()');
  }
}
