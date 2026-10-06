// Run only in the isolated rehearsal after verify-package-upgrade.cjs.
const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/wispo_release_check_20261006');
assert.equal(process.env.WISPO_ISOLATED_REHEARSAL, '20261006');
const db = require('/app/apps/api/dist/database/data-source.js').default;
db.initialize().then(async () => {
  try {
    await db.getRepository('SiteAccessEntity').find();
    await db.getRepository('SiteEntity').find();
    console.log('Previous API datasource starts and reads sites/access after additive compatibility repair.');
  } finally { await db.destroy(); }
}).catch(error => { console.error(error.message); process.exitCode = 1; });
