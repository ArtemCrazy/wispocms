const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { prompts, seed } = require('./seed-content-center-prompts.cjs');

test('six realistic starter prompts fit the existing API limits', () => {
  assert.deepEqual(prompts.map((p) => p.title), ['Анализ компании', 'Анализ интернет-магазина', 'Анализ лендинга', 'Без материалов', 'Структура статьи', 'Анализ конкурентов']);
  for (const prompt of prompts) {
    assert.ok(prompt.title.length <= 160);
    assert.ok(prompt.content.length > 1000 && prompt.content.length <= 12000);
    assert.match(prompt.content, /Не придумывай факты/);
    assert.match(prompt.content, /Нет данных/);
    assert.match(prompt.content, /только сведения из текущей задачи/);
  }
});

test('requires explicitly scoped workspace identifiers', async () => {
  const client = { query() { throw new Error('must not access database'); } };
  await assert.rejects(seed(client, [], true), /Explicit valid/);
  await assert.rejects(seed(client, ['all'], true), /Explicit valid/);
});

test('PostgreSQL: dry-run, insert, isolation, no overwrite, ordering, idempotency and rollback', { skip: !process.env.CONTENT_CENTER_TEST_DATABASE_URL }, async () => {
  const { Client } = require('../apps/api/node_modules/pg');
  const url = new URL(process.env.CONTENT_CENTER_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_tests'));
  const schema = `prompt_seed_test_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: url.href, options: `-c search_path=${schema}` });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query('CREATE TABLE workspaces (id uuid PRIMARY KEY,name text NOT NULL)');
    await client.query(`CREATE TABLE cc_prompts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),title varchar(160) NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
    const first = randomUUID(), second = randomUUID(), untouched = randomUUID();
    for (const id of [first, second, untouched]) await client.query('INSERT INTO workspaces VALUES ($1,$2)', [id, id]);
    assert.equal((await seed(client, [first], false))[0].planned.length, 6);
    assert.equal((await client.query('SELECT * FROM cc_prompts')).rowCount, 0);
    assert.equal((await seed(client, [first], true))[0].added.length, 6);
    const rows = (await client.query('SELECT id,title,content FROM cc_prompts WHERE workspace_id=$1 ORDER BY created_at DESC', [first])).rows;
    assert.deepEqual(rows.map((row) => ({ title: row.title, content: row.content })), prompts);
    assert.equal((await client.query('SELECT * FROM cc_prompts WHERE workspace_id=$1', [untouched])).rowCount, 0);
    await client.query('INSERT INTO cc_prompts (workspace_id,title,content) VALUES ($1,$2,$3)', [second, 'Анализ компании', 'Авторский текст заказчика']);
    assert.equal((await seed(client, [second], true))[0].added.length, 5);
    assert.equal((await client.query('SELECT content FROM cc_prompts WHERE workspace_id=$1 AND title=$2', [second, 'Анализ компании'])).rows[0].content, 'Авторский текст заказчика');
    assert.ok((await seed(client, [first, first, second], true)).every((row) => row.added.length === 0));
    assert.equal((await client.query('SELECT * FROM cc_prompts')).rowCount, 12);
    await assert.rejects(seed(client, [untouched, randomUUID()], true), /Workspace not found/);
    assert.equal((await client.query('SELECT * FROM cc_prompts WHERE workspace_id=$1', [untouched])).rowCount, 0);
    await client.query("INSERT INTO cc_prompts (workspace_id,title,content) SELECT $1,'User '||n,'Existing' FROM generate_series(1,99) n", [untouched]);
    await assert.rejects(seed(client, [untouched], true), /limit would be exceeded/);
    assert.equal((await client.query('SELECT * FROM cc_prompts WHERE workspace_id=$1', [untouched])).rowCount, 99);
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    await client.end();
  }
});
