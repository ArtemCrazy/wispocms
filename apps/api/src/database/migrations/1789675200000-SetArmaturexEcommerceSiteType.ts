import { MigrationInterface, QueryRunner } from 'typeorm';

const PAK_WORKSPACE = {
  id: 'a8100000-0000-4000-8000-000000000008',
  name: 'ПАК',
  slug: 'pak',
} as const;

const ARMATUREX = {
  id: 'a8100000-0000-4000-8000-000000000001',
  slug: 'armaturex',
  provisioningOwner: '1789502400000-armaturex-home-v1',
} as const;

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
};

type SiteRow = {
  id: string;
  slug: string;
  workspace_id: string;
  workspace_slug: string;
  site_type: string;
  provisioning_owner: string | null;
};

export class SetArmaturexEcommerceSiteType1789675200000 implements MigrationInterface {
  name = 'SetArmaturexEcommerceSiteType1789675200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const workspaceRows = (await queryRunner.query(
      `SELECT "id", "name", "slug"
       FROM "workspaces"
       WHERE "id" = $1 OR "slug" = $2
       FOR UPDATE`,
      [PAK_WORKSPACE.id, PAK_WORKSPACE.slug],
    )) as WorkspaceRow[];
    const workspace = workspaceRows[0];

    if (
      workspaceRows.length !== 1 ||
      !workspace ||
      workspace.id !== PAK_WORKSPACE.id ||
      workspace.name !== PAK_WORKSPACE.name ||
      workspace.slug !== PAK_WORKSPACE.slug
    ) {
      throw new Error(
        'Cannot classify Armaturex: workspace pak has an unexpected identity or name',
      );
    }

    const siteRows = (await queryRunner.query(
      `SELECT site."id", site."slug", site."workspace_id", site."site_type",
        workspace."slug" AS "workspace_slug",
        site."global_data" #>> '{__provisioning,owner}' AS "provisioning_owner"
       FROM "sites" site
       INNER JOIN "workspaces" workspace ON workspace."id" = site."workspace_id"
       WHERE site."id" = $1
       FOR UPDATE OF site, workspace`,
      [ARMATUREX.id],
    )) as SiteRow[];
    const site = siteRows[0];

    if (
      siteRows.length !== 1 ||
      !site ||
      site.id !== ARMATUREX.id ||
      site.slug !== ARMATUREX.slug ||
      site.workspace_id !== PAK_WORKSPACE.id ||
      site.workspace_slug !== PAK_WORKSPACE.slug ||
      site.provisioning_owner !== ARMATUREX.provisioningOwner
    ) {
      throw new Error(
        'Cannot classify Armaturex: the provisioned site ownership does not match',
      );
    }

    if (site.site_type !== 'corporate' && site.site_type !== 'ecommerce') {
      throw new Error(
        `Cannot classify Armaturex: unexpected current site type ${site.site_type}`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "sites" DROP CONSTRAINT "CHK_sites_site_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD CONSTRAINT "CHK_sites_site_type" CHECK ("site_type" IN ('media', 'corporate', 'ecommerce', 'landing'))`,
    );

    if (site.site_type === 'ecommerce') {
      return;
    }

    const updatedResult = (await queryRunner.query(
      `UPDATE "sites"
       SET "site_type" = 'ecommerce'
       WHERE "id" = $1
         AND "slug" = $2
         AND "workspace_id" = $3
         AND "site_type" = 'corporate'
         AND "global_data" #>> '{__provisioning,owner}' = $4
       RETURNING "id", "site_type"`,
      [
        ARMATUREX.id,
        ARMATUREX.slug,
        PAK_WORKSPACE.id,
        ARMATUREX.provisioningOwner,
      ],
    )) as [Array<{ id: string; site_type: string }>, number];
    const [updatedRows, affectedRows] = updatedResult;

    if (
      affectedRows !== 1 ||
      updatedRows.length !== 1 ||
      updatedRows[0].id !== ARMATUREX.id ||
      updatedRows[0].site_type !== 'ecommerce'
    ) {
      throw new Error(
        'Cannot classify Armaturex: site ownership changed during migration',
      );
    }
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // Keep the expanded canonical type and user-owned classification. Shrinking
    // the constraint or reverting the value could invalidate later sites.
    return Promise.resolve();
  }
}
