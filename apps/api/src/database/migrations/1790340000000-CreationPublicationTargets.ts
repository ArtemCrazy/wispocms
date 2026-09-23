import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreationPublicationTargets1790340000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE cc_article_publications (
      article_id uuid NOT NULL REFERENCES cc_created_articles(id) ON DELETE CASCADE,
      site_id uuid NOT NULL REFERENCES sites(id),
      cms_article_id uuid NOT NULL UNIQUE REFERENCES articles(id),
      cms_revision integer NOT NULL,
      PRIMARY KEY(article_id,site_id)
    )`);
    await q.query(`INSERT INTO cc_article_publications(article_id,site_id,cms_article_id,cms_revision)
      SELECT id,site_id,cms_article_id,cms_revision FROM cc_created_articles
      WHERE cms_article_id IS NOT NULL AND cms_revision IS NOT NULL`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE cc_article_publications');
  }
}
