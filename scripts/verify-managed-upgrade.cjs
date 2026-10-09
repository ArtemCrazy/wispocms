// One-off release rehearsal: only an isolated restored copy, never production.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const api = createRequire('/app/apps/api/package.json');
const { DataSource } = api('typeorm');
const { createDataSourceOptions } = require('/app/apps/api/dist/database/data-source.js');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.protocol, 'postgresql:');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/wispo_managed_rehearsal_20261009');
assert.equal(url.search, '');
assert.equal(url.hash, '');
assert.equal(process.env.WISPO_ISOLATED_REHEARSAL, '20261009');
const legacy = ['sites', 'users', 'site_accesses', 'articles', 'pages', 'cms_revisions', 'cms_revision_resources', 'template_packages', 'template_package_versions'];
const managed = ['managed_chunk_contracts', 'managed_chunk_instances', 'managed_chunk_instance_revisions', 'managed_chunk_layouts', 'managed_chunk_placements', 'managed_chunk_migration_provenance'];
async function main() {
  const db = new DataSource({ ...createDataSourceOptions(), migrationsRun: false });
  await db.initialize();
  try {
    const snapshot = async () => Object.fromEntries(await Promise.all(legacy.map(async table => [table, (await db.query(`SELECT count(*)::int AS count, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) AS digest FROM "${table}" t`))[0]])));
    const before = await snapshot();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 51);
    const migrated = await db.runMigrations({ transaction: 'all' });
    assert.deepEqual(migrated.map(m => m.name), ['ManagedChunkPersistence1791876000000']);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.runMigrations()).length, 0);
    for (const table of managed) assert.equal((await db.query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM migrations'))[0].n, 52);
    console.log(JSON.stringify({ migrated: migrated.map(m => m.name), legacyRowsUnchanged: before, managedTablesEmpty: managed.length, repeatMigrations: 0 }));
  } finally { await db.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
