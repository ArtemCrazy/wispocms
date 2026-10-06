// Release-only migration rehearsal. Never run against the live database.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fromApi = createRequire('/app/apps/api/package.json');
const { DataSource } = fromApi('typeorm');
const { createDataSourceOptions } = require('/app/apps/api/dist/database/data-source.js');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/wispo_release_check_20261006');
assert.equal(process.env.WISPO_ISOLATED_REHEARSAL, '20261006');
const tables = ['sites', 'users', 'site_accesses', 'articles', 'pages', 'cms_revisions'];
async function main() {
  const db = new DataSource({ ...createDataSourceOptions(), migrationsRun: false });
  await db.initialize();
  try {
    const counts = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.query(`SELECT count(*)::int AS n FROM "${table}"`))[0].n])));
    const before = await counts();
    const permissions = await db.query('SELECT id, can_edit_code FROM site_accesses');
    const migrated = await db.runMigrations({ transaction: 'all' });
    assert.deepEqual(migrated.map(m => m.name), ['RemoveCmsCodeEditing1791703200000', 'TemplatePackageRegistry1791789600000', 'AssignSkinovaSystemTemplate1791793200000']);
    assert.deepEqual(await counts(), before);
    assert.equal((await db.runMigrations()).length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM template_packages'))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sites WHERE template_package_id IS NOT NULL OR current_template_package_version_id IS NOT NULL'))[0].n, 0);
    console.log(JSON.stringify({ migrated: migrated.map(m => m.name), countsPreserved: before, repeatMigrations: 0 }));
    // Rehearse additive compatibility repair for an old-code rollback, without
    // dropping the registry or reverting any content. Only on this disposable DB.
    await db.query('ALTER TABLE site_accesses ADD can_edit_code boolean NOT NULL DEFAULT false');
    for (const row of permissions) await db.query('UPDATE site_accesses SET can_edit_code=$2 WHERE id=$1', [row.id, row.can_edit_code]);
    assert.deepEqual(await counts(), before);
    console.log('Additive old-code compatibility repair verified on isolated copy.');
  } finally { await db.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
