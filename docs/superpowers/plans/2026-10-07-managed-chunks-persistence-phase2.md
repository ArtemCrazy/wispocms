# Managed Chunks Persistence Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить пустую tenant-safe модель хранения универсальных чанков, CMS-ревизий и атомарных раскладок без переключения Skinova, API, UI или production runtime.

**Architecture:** Стабильные identities, контракты и placements хранятся в нормализованных таблицах, а пользовательский payload — только в `cms_revisions.snapshot`. Внутренний typed repository создаёт revision и обязательные typed links в одной транзакции; compatibility inventory читает draft и published независимо и передаёт их в pure-функцию Phase 1.

**Tech Stack:** NestJS 11, TypeScript 5.7, TypeORM, PostgreSQL 18, Jest 30, pnpm, Docker.

---

## Обязательные границы

- Работать только в `codex/managed-chunks-sdk-v1`; перед каждым task сверять `git status`, `docs/change-log.md` и незавершённый diff.
- Строго RED → verify RED → GREEN → verify GREEN → refactor. Production-код до ожидаемо падающего теста не писать.
- Не менять применённые миграции. Новая миграция: `1791876000000-ManagedChunkPersistence.ts`; перед созданием снова проверить `origin/main` и уникальность номера.
- DB-тесты запускать только в контейнере `wispo-managed-chunks-phase2-test`, БД `wispo_managed_chunks_phase2_test`, `127.0.0.1:55440`, с явным opt-in. Рабочую БД `compose.local.yaml` не использовать.
- Не добавлять controller/route, UI, реальный Skinova manifest v2, backfill, dual-write, sanitizer или media validation.
- Не выполнять push, merge, deployment, VDS/Registry операции или миграцию общей БД.

## Карта файлов

**Создать:**

- `apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.ts` — DDL, ограничения, immutable triggers, guarded down.
- `apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.spec.ts` — регистрация, metadata и SQL-contract.
- `apps/api/src/template-packages/managed-chunk-persistence.repository.ts` — typed transactional repository.
- `apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts` — unit TDD repository.
- `apps/api/src/template-packages/managed-chunk-persistence.database.spec.ts` — opt-in disposable PostgreSQL acceptance.

**Изменить:**

- `apps/api/src/database/entities.ts` — шесть новых entities.
- `apps/api/src/database/data-source.ts` и `data-source.spec.ts` — регистрация одной новой миграции.
- `apps/api/src/content/cms-revisions.service.ts` и `.spec.ts` — внутренние resource types и manager-aware lifecycle hooks.
- `apps/api/src/template-packages/template-package.module.ts` — provider/export repository без route.
- `docs/change-log.md` — одна запись Phase 2 до итогового статуса.

## Точный schema contract

- `managed_chunk_contracts`: identity `(template_package_id, definition_key, schema_version)`, composite FK первой package version к тому же package, digest `^sha256:[0-9a-f]{64}$`, JSON objects `field_contract`/`data_schema`, immutable update/delete.
- `managed_chunk_instances`: `site_id`, unique `revision_resource_id`, `display_name`, `is_archived`, nullable actor; composite FK resource совпадает по site, type `chunk_instance` и `entity_id = instance.id`.
- `managed_chunk_instance_revisions`: PK `revision_id`; exact resource/site/instance/contract links; payload не дублируется; row immutable.
- `managed_chunk_layouts`: page или site_surface XOR; composite page/site FK; unique page target и unique `(site_id, surface_key)` target; resource type `chunk_layout` совпадает с identity.
- `managed_chunk_placements`: exact layout revision/resource/site и instance; `position >= 0`; unique `(layout_revision_id, slot_key, position)`; update/delete immutable.
- `managed_chunk_migration_provenance`: source type только `banner` или `page_banner_assignment`; ровно один target instance/layout/placement; unique migration/source identity; в Phase 2 остаётся пустой.
## Task 1: Migration contract и TypeORM metadata

**Files:**

- Create: `apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.spec.ts`
- Create: `apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.ts`
- Modify: `apps/api/src/database/entities.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/database/data-source.spec.ts`

- [ ] **Step 1: RED регистрации и структуры**

Добавить тесты, которые импортируют ещё отсутствующие migration/entities:

```ts
expect(options.migrations).toContain(ManagedChunkPersistence1791876000000);
expect(databaseEntities).toEqual(expect.arrayContaining([
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkPlacementEntity,
  ManagedChunkMigrationProvenanceEntity,
]));
expect(migrationNames.at(-1)).toBe('ManagedChunkPersistence1791876000000');
expect(new Set(migrationNames).size).toBe(migrationNames.length);
```

SQL-contract test требует `IN (1, 2)`, оба resource type, все шесть tables, отсутствие `INSERT`, immutable triggers и guard до первого `DROP` в `down()`.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- database/migrations/1791876000000-ManagedChunkPersistence.spec.ts database/data-source.spec.ts
```

Expected: FAIL из-за отсутствующих migration/entities, а не из-за опечатки теста.

- [ ] **Step 3: Minimal GREEN migration/entities**

В migration зафиксировать полный предыдущий список:

```ts
const previousResourceTypes = [
  'article', 'category', 'author', 'page', 'banner', 'site_variable',
  'template', 'chunk', 'site_globals', 'site_header', 'site_footer',
  'site_variables', 'site_seo', 'site_search', 'site_not_found',
  'site_privacy', 'site_layout_bindings', 'site_article_list', 'media_alt',
] as const;
const managedChunkResourceTypes = ['chunk_instance', 'chunk_layout'] as const;
```

`up()` выполняет: manifest check `IN (1, 2)`; resource check previous+new; нужные composite unique keys; шесть tables из spec; indexes; `reject_managed_chunk_history_mutation()` и triggers на contracts, instance revisions, placements, provenance. `INSERT`/backfill отсутствуют.

Минимальный entity contract:

```ts
@Entity('managed_chunk_contracts')
@Unique(['templatePackageId', 'definitionKey', 'schemaVersion'])
export class ManagedChunkContractEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'template_package_id', type: 'uuid' }) templatePackageId!: string;
  @Column({ name: 'first_seen_template_package_version_id', type: 'uuid' }) firstSeenTemplatePackageVersionId!: string;
  @Column({ name: 'definition_key', type: 'varchar', length: 80 }) definitionKey!: string;
  @Column({ name: 'schema_version', type: 'varchar', length: 40 }) schemaVersion!: string;
  @Column({ name: 'contract_digest', type: 'varchar', length: 80 }) contractDigest!: string;
  @Column({ name: 'field_contract', type: 'jsonb' }) fieldContract!: Record<string, unknown>;
  @Column({ name: 'data_schema', type: 'jsonb' }) dataSchema!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

Остальные entities дословно отражают spec. Никакого cascade там, где требуется `RESTRICT`; actor uses `SET NULL`.

`down()` первым statement проверяет: все новые tables empty, новых resource types нет, manifest v2 нет. Только затем удаляет новые objects и возвращает оба checks. Guard failure обязан произойти до удаления.

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- database/migrations/1791876000000-ManagedChunkPersistence.spec.ts database/data-source.spec.ts database/migrations/1791789600000-TemplatePackageRegistry.spec.ts
```

Expected: 3 suites PASS; новая migration последняя/уникальная; старый registry test не менялся.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/database/entities.ts apps/api/src/database/data-source.ts apps/api/src/database/data-source.spec.ts apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.ts apps/api/src/database/migrations/1791876000000-ManagedChunkPersistence.spec.ts docs/change-log.md
git commit -m "feat: add managed chunk persistence schema"
```

## Task 2: Idempotent immutable contract registry

**Files:**

- Create: `apps/api/src/template-packages/managed-chunk-persistence.repository.ts`
- Create: `apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts`
- Modify: `apps/api/src/template-packages/template-package.module.ts`

- [ ] **Step 1: RED idempotency/conflict**

```ts
await repository.registerContracts({
  templatePackageId: packageId,
  templatePackageVersionId: versionId,
  definitions: [{ key: 'hero', schemaVersion: '1', fields }],
});
await repository.registerContracts({
  templatePackageId: packageId,
  templatePackageVersionId: versionId,
  definitions: [{ key: 'hero', schemaVersion: '1', fields }],
});
expect(await manager.count(ManagedChunkContractEntity)).toBe(1);
```

Отдельные cases: version другого package → одинаковый safe not-found; та же identity с другим semantic contract → `ConflictException`; изменения только label/help → та же строка.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: FAIL на отсутствующем repository/method.

- [ ] **Step 3: GREEN contract registration**

Repository принимает `DataSource`; внутри transaction проверяет composite package/version и вычисляет данные сервером:

```ts
const fieldContract = JSON.parse(
  canonicalManagedChunkContract(definition.fields),
) as Record<string, unknown>;
const dataSchema = deriveManagedChunkDataSchema(definition.fields);
const contractDigest = computeManagedChunkContractDigest(definition.fields);
```

При unique race перечитать identity и повторить semantic equality. Неизвестная и чужая version возвращают `NotFoundException('Версия пакета не найдена')`.

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts template-packages/managed-chunk-schema.spec.ts
```

Expected: PASS, включая presentation-only idempotency.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/template-packages/managed-chunk-persistence.repository.ts apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts apps/api/src/template-packages/template-package.module.ts docs/change-log.md
git commit -m "feat: register immutable chunk contracts"
```

## Task 3: Site-scoped instances и typed revision links

**Files:**

- Modify: `apps/api/src/content/cms-revisions.service.ts`
- Modify: `apps/api/src/content/cms-revisions.service.spec.ts`
- Modify: repository и его spec.

- [ ] **Step 1: RED атомарного initial draft**

```ts
const result = await repository.createInstanceDraft({
  siteId,
  displayName: 'Главный баннер',
  contractId,
  data: { title: 'Skinova' },
  sanitizerPolicyVersion: null,
  actor,
});
expect(result.versionNumber).toBe(1);
```

Проверить в одной transaction: instance, `chunk_instance` resource, snapshot, typed link. Ошибка link оставляет 0 строк во всех местах. Unknown/cross-site path не раскрывает чужой UUID.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts content/cms-revisions.service.spec.ts
```

Expected: FAIL на отсутствующем type/method.

- [ ] **Step 3: GREEN manager-aware hook**

Расширить закрытый union типами `chunk_instance`/`chunk_layout`. Добавить internal hook:

```ts
type RevisionCreatedHook = (
  db: EntityManager,
  revision: CmsRevisionEntity,
  resource: CmsRevisionResourceEntity,
) => Promise<void>;
```

`saveDraftUsingManager` вызывает hook после save revision, но до pointer/event commit. Repository hook сохраняет `ManagedChunkInstanceRevisionEntity`.

Snapshot строго:

```ts
{
  formatVersion: 1,
  data: structuredClone(input.data),
  sanitizerPolicyVersion: input.sanitizerPolicyVersion,
}
```

Phase 2 не sanitizes payload и не exposes controller.

- [ ] **Step 4: Verify GREEN/rollback**

```powershell
pnpm --dir apps/api test --runInBand -- content/cms-revisions.service.spec.ts template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: PASS; thrown hook error не оставляет committed resource/revision/pointer.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/content/cms-revisions.service.ts apps/api/src/content/cms-revisions.service.spec.ts apps/api/src/template-packages/managed-chunk-persistence.repository.ts apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts docs/change-log.md
git commit -m "feat: persist typed chunk instance revisions"
```

## Task 4: Atomic layout revisions и placements set

**Files:** repository и его spec.

- [ ] **Step 1: RED полного layout set**

```ts
const revision = await repository.saveLayoutDraft({
  siteId,
  target: { kind: 'page', pageId },
  templateKey: 'skinova-home',
  templateVersion: '1',
  expectedDraftRevisionId: null,
  placements: [
    { slotKey: 'hero', position: 0, instanceId: heroId },
    { slotKey: 'promo', position: 0, instanceId: promoId },
  ],
  actor,
});
```

Cases: target identity reuse; metadata-only snapshot; exact revision placements; duplicate position, чужой page/instance, unknown instance, stale pointer → 0 partial rows.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: FAIL на отсутствующем `saveLayoutDraft`.

- [ ] **Step 3: GREEN одной transaction**

До transaction проверить local duplicates. Внутри: lock/find-or-create target, validate same-site page/instances, создать `chunk_layout` revision через hook, вставить весь placements array.

```ts
const snapshot = {
  formatVersion: 1,
  templateKey: input.templateKey,
  templateVersion: input.templateVersion,
};
```

Не создавать `savePlacement`; write boundary принимает полный array. Empty array = полная пустая раскладка.

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: PASS; partial layout write API отсутствует.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/template-packages/managed-chunk-persistence.repository.ts apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts docs/change-log.md
git commit -m "feat: persist atomic managed chunk layouts"
```

## Task 5: Typed restore/approve/publish boundary

**Files:** revision service/spec и repository/spec.

- [ ] **Step 1: RED lifecycle preconditions**

Тесты: instance revision без typed link нельзя approve/publish; layout revision без complete placements set нельзя approve/publish; restore instance копирует contract link; restore layout копирует полный source placement set в новую revision. Ошибка copy/precondition не двигает pointers.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- content/cms-revisions.service.spec.ts template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: FAIL до manager-aware lifecycle hooks/wrappers.

- [ ] **Step 3: GREEN без generic endpoint**

Добавить internal manager variants/callbacks к `restore`, `approve`, `publish`, сохранив прежние public signatures delegates. Repository всегда проверяет exact `(site, resource, revision, typed row)`:

```ts
await repository.publishInstanceRevision({ siteId, instanceId, revisionId, actor });
await repository.publishLayoutRevision({ siteId, layoutId, revisionId, actor });
```

Restore создаёт новую immutable CMS revision и новые typed rows; source revision не становится draft напрямую. Existing types идут прежним путём.

- [ ] **Step 4: Verify GREEN/regression**

```powershell
pnpm --dir apps/api test --runInBand -- content/revision-workflow.spec.ts content/cms-revisions.service.spec.ts template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: PASS; article/category behavior unchanged.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/content/cms-revisions.service.ts apps/api/src/content/cms-revisions.service.spec.ts apps/api/src/template-packages/managed-chunk-persistence.repository.ts apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts docs/change-log.md
git commit -m "feat: guard managed chunk revision lifecycle"
```

## Task 6: Draft/published compatibility inventory

**Files:** repository/spec; compatibility spec.

- [ ] **Step 1: RED независимых sources**

```ts
const inventory = await repository.readCompatibilityInventory({
  siteId,
  templatePackageId,
});
expect(inventory.contracts).toContainEqual(
  expect.objectContaining({ sources: ['draft', 'published'] }),
);
expect(inventory.placements).toEqual(expect.arrayContaining([
  expect.objectContaining({ source: 'draft', layoutKey: `page:${pageId}` }),
  expect.objectContaining({ source: 'published', layoutKey: `page:${pageId}` }),
]));
```

Cases: разные contract versions у draft/published instance; отсутствующий draft без fallback; stable ordering; exclusion другого site/package.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts template-packages/managed-chunk-compatibility.spec.ts
```

Expected: FAIL на отсутствующем reader.

- [ ] **Step 3: GREEN mapper**

Читать pointers/typed links отдельно. Для placement source брать одноимённый instance pointer; отсутствующий pointer не подменять. Вернуть exact Phase 1 types, sorted by source/layout/slot/position/identity.

- [ ] **Step 4: Verify GREEN через pure compatibility**

```ts
const result = checkManagedChunkContractCompatibility(
  candidate,
  trustedRendererKeys,
  inventory.contracts,
  inventory.placements,
);
expect(result.reasons).toContainEqual(
  expect.objectContaining({ code: 'contract_digest_mismatch' }),
);
```

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts template-packages/managed-chunk-compatibility.spec.ts
```

Expected: PASS; pending draft блокирует incompatible candidate независимо от published.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/template-packages/managed-chunk-persistence.repository.ts apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts apps/api/src/template-packages/managed-chunk-compatibility.spec.ts docs/change-log.md
git commit -m "feat: expose managed chunk compatibility inventory"
```

## Task 7: Disposable PostgreSQL acceptance

**Files:**

- Create: `apps/api/src/template-packages/managed-chunk-persistence.database.spec.ts`
- Modify: `docs/change-log.md`

- [ ] **Step 1: RED guard без соединения**

```ts
expect(() => assertDisposableManagedChunkDatabase(
  'postgresql://test:test@127.0.0.1:55440/wispo_cms',
  'wispo_managed_chunks_phase2_test',
)).toThrow('disposable local');
```

Guard принимает только postgres/postgresql, `127.0.0.1`, port `55440`, exact DB+opt-in `wispo_managed_chunks_phase2_test`, без query/hash.

- [ ] **Step 2: Verify RED, затем minimal GREEN guard**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.database.spec.ts
```

Expected first run: FAIL; after guard implementation unit PASS, integration SKIP без env.

- [ ] **Step 3: Одноразовый PostgreSQL 18**

```powershell
docker run --name wispo-managed-chunks-phase2-test --rm -d -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=wispo_managed_chunks_phase2_test -p 127.0.0.1:55440:5432 postgres:18-alpine
docker exec wispo-managed-chunks-phase2-test pg_isready -U test -d wispo_managed_chunks_phase2_test
```

Expected: `accepting connections`; volumes и сеть `wispo-cms-local` не используются.

- [ ] **Step 4: Migration/FK/transaction acceptance**

```powershell
$env:MANAGED_CHUNK_TEST_DATABASE_URL='postgresql://test:test@127.0.0.1:55440/wispo_managed_chunks_phase2_test'
$env:WISPO_MANAGED_CHUNK_ISOLATED_DB='wispo_managed_chunks_phase2_test'
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.database.spec.ts
```

Suite применяет весь ledger; повторный run no-op; проверяет v1/v2 checks;
idempotent contract; cross-package/version FK; cross-site page/instance FK;
duplicate position; rollback layout; draft/published inventory; empty safe down
на fresh second database; blocked down после managed data до любого drop.

Concurrency acceptance использует два независимых соединения к disposable DB:

1. transaction A выполняет первый `down()` batch (`LOCK TABLE ... IN SHARE ROW
   EXCLUSIVE MODE` + guard) и удерживает transaction-wide locks;
2. transaction B пытается вставить/изменить guard dependency и подтверждённо
   блокируется до rollback/commit A;
3. после появления новых данных повторный `down()` падает на guard и не удаляет
   ни таблицы, ни checks, ни triggers.

Owner-identity negative cases: layout с revision нельзя удалить, rebind к
другому revision resource или перенести в другой site; instance нельзя удалить,
поменять `id/site_id/revision_resource_id/created_at` или переназначить actor.
При этом `display_name`/`is_archived`/`updated_at` обновляются, а удаление actor
успешно выполняет FK `ON DELETE SET NULL`.

- [ ] **Step 5: Удалить только тестовый контейнер**

```powershell
docker rm -f wispo-managed-chunks-phase2-test
Remove-Item Env:MANAGED_CHUNK_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:WISPO_MANAGED_CHUNK_ISOLATED_DB -ErrorAction SilentlyContinue
```

Expected: test container removed; рабочая PostgreSQL/volume не затронуты.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/template-packages/managed-chunk-persistence.database.spec.ts docs/change-log.md
git commit -m "test: verify managed chunk persistence in postgres"
```

## Task 8: Regression, scope audit, журнал

**Files:** Modify `docs/change-log.md`.

- [ ] **Step 1: Phase 1 + Phase 2 tests**

```powershell
pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk.types.spec.ts template-packages/managed-chunk-schema.spec.ts template-packages/managed-chunk-validation.spec.ts template-packages/managed-chunk-compatibility.spec.ts template-packages/managed-chunk-persistence.repository.spec.ts database/migrations/1791876000000-ManagedChunkPersistence.spec.ts content/cms-revisions.service.spec.ts
```

Expected: all selected suites PASS, zero warnings/errors.

- [ ] **Step 2: Full API regression/build/static checks**

```powershell
pnpm --dir apps/api test --runInBand
pnpm --dir apps/api build
pnpm --dir apps/api exec eslint "src/**/*.ts"
pnpm --dir apps/api exec prettier --check "src/**/*.ts"
git diff --check
```

Expected: all PASS; финальный lint без `--fix`.

- [ ] **Step 3: Scope audit**

```powershell
git diff --name-status origin/main...HEAD
git status --short --branch
```

Проверить: нет web/UI, real Skinova v2, controller/routes, legacy delete, seed/backfill, credentials, `.codex/`, VDS/Registry/deploy changes. Новая migration одна и последняя.

- [ ] **Step 4: Закрыть журнал доказательствами**

Записать schema changes; `данные: не изменялись`; snapshot format; migration/down guard; exact test results; commit hashes; `push/merge/выкладка/общая БД: не выполнялись`.

- [ ] **Step 5: Финальный локальный docs commit**

```powershell
git add docs/change-log.md
git commit -m "docs: record managed chunk persistence phase"
```

После этого остановиться, показать статус и отдельно запросить разрешение на push. Самостоятельно push/merge/deployment не выполнять.

## Self-review

- Spec coverage: шесть tables, checks, tenant FK, immutable history, guarded down, contracts, instances, full layouts, typed lifecycle, dual inventory и isolated PostgreSQL покрыты.
- Out of scope: Skinova backfill, API/UI, sanitizer/media validation, runtime switch нигде не реализуются.
- TDD: каждый production step начинается с ожидаемо падающего теста и проверки причины RED.
- Type consistency: `contractId`, `instanceId`, `layoutId`, exact `siteId`; snapshots совпадают со spec.
- Safety: integration URL fail-closed; общая БД/VDS не используются; down guard pre-drop.
