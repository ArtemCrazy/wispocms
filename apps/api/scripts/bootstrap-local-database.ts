import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../src/database/data-source';

const firstSeedMigration = 'SeedArmaturexHomepage1789502400000';

async function bootstrapLocalDatabase() {
  const options = createDataSourceOptions();
  const migrations = Array.isArray(options.migrations) ? options.migrations : [];
  const boundary = migrations.findIndex(
    (migration) =>
      typeof migration === 'function' && migration.name === firstSeedMigration,
  );

  if (boundary < 0) {
    throw new Error(`Migration boundary ${firstSeedMigration} was not found`);
  }

  const source = new DataSource({
    ...options,
    migrations: migrations.slice(0, boundary),
    migrationsRun: false,
  });

  await source.initialize();
  try {
    await source.runMigrations({ transaction: 'all' });
    await source.query(
      `INSERT INTO "workspaces" ("name", "slug")
       VALUES ($1, $2)
       ON CONFLICT ("slug") DO NOTHING`,
      ['Crazy Studio', 'crazy-studio'],
    );
    await source.query(
      `UPDATE "privacy_legal_models"
       SET "status" = 'approved',
           "approved_at" = COALESCE("approved_at", now()),
           "change_summary" = COALESCE(
             "change_summary",
             'Local development bootstrap'
           )
       WHERE "id" = (
         SELECT "id"
         FROM "privacy_legal_models"
         WHERE "status" = 'draft'
         ORDER BY "created_at" DESC
         LIMIT 1
       )
       AND NOT EXISTS (
         SELECT 1 FROM "privacy_legal_models" WHERE "status" = 'approved'
       )`,
    );
  } finally {
    await source.destroy();
  }
}

void bootstrapLocalDatabase().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
