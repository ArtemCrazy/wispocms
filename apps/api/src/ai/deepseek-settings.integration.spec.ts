import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DeepseekIntegration1790400000000 } from '../database/migrations/1790400000000-DeepseekIntegration';
import { DeepseekSettingsService } from './deepseek-settings.service';
import { decryptApiKey, encryptApiKey } from './ai-secret';

const databaseUrl = process.env.CONTENT_CENTER_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('encrypted DeepSeek settings (PostgreSQL)', () => {
  const schema = `ai_test_${randomUUID().replaceAll('-', '')}`;
  const actor = randomUUID();
  const key = 'sk-test-only-never-a-real-api-key';
  let db: DataSource, service: DeepseekSettingsService;
  const previousKey = process.env.AI_ENCRYPTION_KEY;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_tests')
    )
      throw new Error('Local test database required');
    process.env.AI_ENCRYPTION_KEY = 'a'.repeat(64);
    db = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      extra: { options: `-c search_path=${schema}` },
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query('CREATE TABLE users (id uuid PRIMARY KEY)');
    await db.query('INSERT INTO users VALUES ($1)', [actor]);
    const runner = db.createQueryRunner();
    try {
      await new DeepseekIntegration1790400000000().up(runner);
    } finally {
      await runner.release();
    }
    service = new DeepseekSettingsService(db);
    await service.onModuleInit();
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      await db.query(`DROP SCHEMA "${schema}" CASCADE`);
      await db.destroy();
    }
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });
  it('stores only authenticated ciphertext and returns only non-secret metadata', async () => {
    expect((await service.status()).configured).toBe(false);
    const status = await service.save(
      { apiKey: key, model: 'deepseek-flash', revision: 0 },
      actor,
    );
    expect(status).toMatchObject({
      configured: true,
      revision: 1,
      verifiedAt: null,
    });
    expect(JSON.stringify(status)).not.toContain(key);
    const rows: { encrypted_key: string; updated_by: string }[] =
      await db.query(
        'SELECT encrypted_key,updated_by FROM platform_ai_settings',
      );
    expect(rows[0].encrypted_key).not.toContain(key);
    expect(rows[0].updated_by).toBe(actor);
    expect(decryptApiKey(rows[0].encrypted_key)).toBe(key);
    expect((await service.credentials()).apiKey).toBe(key);
  });
  it('preserves existing keys when changing model, rejects stale saves and stale verification', async () => {
    await service.markVerified(1);
    expect((await service.status()).verifiedAt).not.toBeNull();
    const changed = await service.save(
      { model: 'deepseek-v4-pro', revision: 1 },
      actor,
    );
    expect(changed).toMatchObject({ revision: 2, verifiedAt: null });
    expect((await service.credentials()).apiKey).toBe(key);
    await expect(
      service.save(
        {
          model: 'deepseek-flash',
          apiKey: 'sk-stale-test-only-key',
          revision: 1,
        },
        actor,
      ),
    ).rejects.toThrow('уже изменены');
    await expect(service.markVerified(1)).rejects.toThrow('во время проверки');
    await expect(service.remove(1, actor)).rejects.toThrow('уже изменены');
  });
  it('requires a valid server encryption key and detects ciphertext tampering', async () => {
    const encrypted = encryptApiKey(key);
    expect(encryptApiKey(key)).not.toBe(encrypted);
    process.env.AI_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decryptApiKey(encrypted)).toThrow('прочитать ключ');
    process.env.AI_ENCRYPTION_KEY = '';
    expect((await service.status()).configured).toBe(false);
    await expect(
      service.save(
        { model: 'deepseek-flash', apiKey: key, revision: 2 },
        actor,
      ),
    ).rejects.toThrow('хранилище');
    process.env.AI_ENCRYPTION_KEY = 'a'.repeat(64);
  });
  it('deletes the key and disables both AI processes without touching results', async () => {
    expect(await service.remove(2, actor)).toMatchObject({
      hasKey: false,
      configured: false,
      revision: 3,
      verifiedAt: null,
    });
    await expect(service.credentials()).rejects.toThrow('Сначала сохраните');
  });
});
