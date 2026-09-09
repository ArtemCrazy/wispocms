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
  provisioning_owner: string | null;
};

export class MoveArmaturexToPakWorkspace1789588800000 implements MigrationInterface {
  name = 'MoveArmaturexToPakWorkspace1789588800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const workspaceRows = (await queryRunner.query(
      `SELECT "id", "name", "slug"
       FROM "workspaces"
       WHERE "id" = $1 OR "slug" = $2`,
      [PAK_WORKSPACE.id, PAK_WORKSPACE.slug],
    )) as WorkspaceRow[];

    let pakWorkspace = workspaceRows[0];
    if (
      workspaceRows.length > 1 ||
      (pakWorkspace && !this.isExpectedPak(pakWorkspace))
    ) {
      throw new Error(
        'Cannot move Armaturex: workspace pak has an unexpected identity or name',
      );
    }

    if (!pakWorkspace) {
      const insertedRows = (await queryRunner.query(
        `INSERT INTO "workspaces" ("id", "name", "slug")
         VALUES ($1, $2, $3)
         RETURNING "id", "name", "slug"`,
        [PAK_WORKSPACE.id, PAK_WORKSPACE.name, PAK_WORKSPACE.slug],
      )) as WorkspaceRow[];
      pakWorkspace = insertedRows[0];
      if (!pakWorkspace || !this.isExpectedPak(pakWorkspace)) {
        throw new Error(
          'Cannot move Armaturex: workspace pak was not created with the expected identity',
        );
      }
    }

    const siteRows = (await queryRunner.query(
      `SELECT site."id", site."slug", site."workspace_id",
        workspace."slug" AS "workspace_slug",
        site."global_data" #>> '{__provisioning,owner}' AS "provisioning_owner"
       FROM "sites" site
       INNER JOIN "workspaces" workspace ON workspace."id" = site."workspace_id"
       WHERE site."id" = $1`,
      [ARMATUREX.id],
    )) as SiteRow[];
    const site = siteRows[0];

    if (
      !site ||
      site.slug !== ARMATUREX.slug ||
      site.provisioning_owner !== ARMATUREX.provisioningOwner
    ) {
      throw new Error(
        'Cannot move Armaturex: the provisioned site identity does not match',
      );
    }

    if (site.workspace_slug === PAK_WORKSPACE.slug) {
      if (site.workspace_id !== PAK_WORKSPACE.id) {
        throw new Error(
          'Cannot move Armaturex: site is attached to an unexpected pak workspace',
        );
      }
      return;
    }

    if (site.workspace_slug !== 'crazy-studio') {
      throw new Error(
        `Cannot move Armaturex: unexpected current workspace ${site.workspace_slug}`,
      );
    }

    const movedRows = (await queryRunner.query(
      `UPDATE "sites"
       SET "workspace_id" = $1
       WHERE "id" = $2
         AND "slug" = $3
         AND "workspace_id" = $4
         AND "global_data" #>> '{__provisioning,owner}' = $5
       RETURNING "id"`,
      [
        PAK_WORKSPACE.id,
        ARMATUREX.id,
        ARMATUREX.slug,
        site.workspace_id,
        ARMATUREX.provisioningOwner,
      ],
    )) as Array<{ id: string }>;

    if (movedRows.length !== 1 || movedRows[0].id !== ARMATUREX.id) {
      throw new Error(
        'Cannot move Armaturex: site ownership changed during migration',
      );
    }
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // The workspace and site become user-owned immediately. Reversing this
    // data move could discard later ownership decisions or user content.
    return Promise.resolve();
  }

  private isExpectedPak(workspace: WorkspaceRow) {
    return (
      workspace.id === PAK_WORKSPACE.id &&
      workspace.name === PAK_WORKSPACE.name &&
      workspace.slug === PAK_WORKSPACE.slug
    );
  }
}
