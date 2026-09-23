/* Run ONLY inside an isolated PostgreSQL container network namespace.
 * Uses the compiled API and its installed dependencies; prints no row data.
 * DATABASE_URL must point at the restored wispo_merge_snapshot database.
 */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const apiRequire = createRequire(`${process.cwd()}/apps/api/package.json`);
const { DataSource } = apiRequire('typeorm');
const { createDataSourceOptions } = apiRequire('./dist/database/data-source');
const address = new URL(process.env.DATABASE_URL);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.pathname, '/wispo_merge_snapshot');
const options = createDataSourceOptions();
const migrations = options.migrations;
const migrationName = (Migration) => new Migration().name || Migration.name;
const names = migrations.map(migrationName);
assert.equal(new Set(names).size, names.length, 'Migration names must be unique');
assert.equal(names.length, 46, 'Both complete migration histories must be present');
const romanNames = new Set([
  'SiteScopedRoles1790017200000', 'CmsRevisionLedger1790103600000',
  'ProtectCmsRevisionHistory1790107200000', 'ExpandCmsRevisionResourceTypes1790190000000',
  'CompleteCmsRevisionResourceTypes1790200000000', 'RemainingMetadataRevisionTypes1790210000000',
]);
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const sourceFor = (url, selected = migrations) => new DataSource({
  ...options, url, migrations: selected, migrationsRun: false,
});
async function fingerprint(source, table, columns) {
  const [row] = await source.query(`SELECT count(*)::int AS count,
    md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest
    FROM (SELECT ${columns.map(quote).join(',')} FROM public.${quote(table)}) t`);
  return row;
}
async function migrate(source, expected) {
  const applied = await source.runMigrations({ transaction: 'all' });
  assert.equal(applied.length, expected);
  assert.equal(await source.showMigrations(), false);
  assert.equal((await source.runMigrations()).length, 0, 'Second run must be a no-op');
  return applied.map((migration) => migration.name);
}
async function main() {
  const snapshot = sourceFor(address.href);
  await snapshot.initialize();
  try {
    if (!process.argv.includes('--fresh-only')) {
    const tables = await snapshot.query(`SELECT table_name, array_agg(column_name::text ORDER BY ordinal_position) AS columns
      FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'migrations'
      GROUP BY table_name ORDER BY table_name`);
    const before = new Map();
    for (const table of tables) before.set(table.table_name, await fingerprint(snapshot, table.table_name, table.columns));
    const applied = await migrate(snapshot, 6);
    assert.deepEqual(new Set(applied), romanNames);
    for (const table of tables) assert.deepEqual(
      await fingerprint(snapshot, table.table_name, table.columns), before.get(table.table_name),
      `Existing values changed in ${table.table_name}`,
    );
    console.log(JSON.stringify({ scenario: 'live-snapshot-plus-Roman', applied, preservedTables: tables.length }));
    }

    for (const [name, romanFirst] of [['wispo_merge_empty', false], ['wispo_merge_roman', true]]) {
      const existing = await snapshot.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
      if (!existing.length) await snapshot.query(`CREATE DATABASE ${quote(name)}`);
      const target = new URL(address.href);
      target.pathname = `/${name}`;
      // Historical seed migrations require the local bootstrap preconditions.
      // Mirror apps/api/scripts/bootstrap-local-database.ts; never fake migration rows.
      const baseline = sourceFor(target.href, migrations.filter((Migration) =>
        Number(migrationName(Migration).slice(-13)) < 1789502400000));
      await baseline.initialize();
      try {
        await migrate(baseline, 16);
        await baseline.query(`INSERT INTO workspaces(name,slug) VALUES ('Integration test','crazy-studio')`);
        await baseline.query(`UPDATE privacy_legal_models SET status='approved', approved_at=now()
          WHERE id=(SELECT id FROM privacy_legal_models WHERE status='draft' ORDER BY created_at DESC LIMIT 1)
          AND NOT EXISTS(SELECT 1 FROM privacy_legal_models WHERE status='approved')`);
      } finally { await baseline.destroy(); }
      if (romanFirst) {
        const roman = sourceFor(target.href, migrations.filter((Migration) => {
          const name = migrationName(Migration);
          return Number(name.slice(-13)) <= 1789934400000 || romanNames.has(name);
        }));
        await roman.initialize();
        try { await migrate(roman, 12); } finally { await roman.destroy(); }
      }
      const merged = sourceFor(target.href);
      await merged.initialize();
      try {
        await migrate(merged, romanFirst ? 18 : 30);
        console.log(JSON.stringify({ scenario: romanFirst ? 'Roman-plus-content-center' : 'empty-to-merged', totalMigrations: 46 }));
      } finally { await merged.destroy(); }
    }
  } finally { await snapshot.destroy(); }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
