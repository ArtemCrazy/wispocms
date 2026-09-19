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

test('rejects legacy workspace-scoped seeding', async () => {
  const client = { query() { throw new Error('must not access database'); } };
  await assert.rejects(seed(client, [], true), /Explicit --global-library/);
  await assert.rejects(seed(client, [randomUUID()], true), /Explicit --global-library/);
});

test('PostgreSQL: one global library, dry-run, no overwrite, order, idempotency and rollback', { skip: !process.env.CONTENT_CENTER_TEST_DATABASE_URL }, async () => {
  const { Client } = require('../apps/api/node_modules/pg');
  const url = new URL(process.env.CONTENT_CENTER_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_tests'));
  const schema = 'prompt_seed_test_' + randomUUID().replaceAll('-', '');
  const client = new Client({ connectionString: url.href, options: '-c search_path=' + schema });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('CREATE TABLE platform_prompts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title varchar(160) NOT NULL,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())');
    assert.equal((await seed(client, true, false)).planned.length, 6);
    assert.equal((await client.query('SELECT * FROM platform_prompts')).rowCount, 0);
    assert.equal((await seed(client, true, true)).added.length, 6);
    const rows = (await client.query('SELECT title,content FROM platform_prompts ORDER BY created_at DESC')).rows;
    assert.deepEqual(rows, prompts);
    await client.query('UPDATE platform_prompts SET content=$1 WHERE title=$2', ['Авторский текст заказчика', 'Анализ компании']);
    assert.equal((await seed(client, true, true)).added.length, 0);
    assert.equal((await client.query('SELECT content FROM platform_prompts WHERE title=$1', ['Анализ компании'])).rows[0].content, 'Авторский текст заказчика');
    await client.query('TRUNCATE platform_prompts');
    await client.query("INSERT INTO platform_prompts (title,content) SELECT 'User '||n,'Existing' FROM generate_series(1,99) n");
    await assert.rejects(seed(client, true, true), /limit would be exceeded/);
    assert.equal((await client.query('SELECT * FROM platform_prompts')).rowCount, 99);
  } finally {
    await client.query('ROLLBACK');
    await client.query('DROP SCHEMA "' + schema + '" CASCADE');
    await client.end();
  }
});
