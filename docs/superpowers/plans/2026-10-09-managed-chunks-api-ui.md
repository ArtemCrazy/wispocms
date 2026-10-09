# Managed Chunks API and UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить для Skinova site-scoped generic API и интерфейс CMS «Чанки → Баннеры», использующие существующие managed revisions, права и согласование без переключения public runtime.

**Architecture:** Новый `ManagedChunkContentService` в `TemplatePackageModule` строит pre-activation catalog только из contracts, уже используемых managed instances сайта, и отдаёт безопасные read models. Записи проходят через расширенные typed lifecycle-методы `CmsRevisionsService` и `ManagedChunkPersistenceRepository`; React-view строит форму по ordered contract fields и доверяет серверу в проверке данных и допустимых действий.

**Tech Stack:** NestJS 11, TypeORM/PostgreSQL, class-validator, Ajv, Next.js 16, React 19, TypeScript, Jest, Node/tsx contract tests, Playwright/Codex Browser для одного локального smoke.

---

## Граница выполнения

- Публичный и preview runtime, legacy `banners`, layouts/placements и package pointers не меняются.
- Новая миграция, entity или persisted format не добавляются. Если они понадобятся, остановить реализацию и вернуть задачу на согласование.
- Поддерживаются только widgets текущего Skinova v2: `text`, `textarea`, `image`, `number`, `boolean`.
- Полный visual/mobile/security/performance regression записывается в `docs/managed-chunks-post-mvp-review.md`.
- По решению владельца после утверждения плана isolated PostgreSQL/browser smoke и полная матрица не блокируют MVP: выполняются только focused unit/contract checks и production builds, остальное переносится в post-MVP документ.
- Внутри Tasks 1–6 коммиты не создавать. После общей проверки остановиться и отдельно предложить один итоговый коммит.

## Файловая структура

- Create: `apps/api/src/template-packages/managed-chunk-content.service.ts` — catalog/read/mutation orchestration и безопасные API read models.
- Create: `apps/api/src/template-packages/managed-chunk-content.service.spec.ts` — service TDD, tenant isolation, validation, workflow.
- Create: `apps/api/src/template-packages/managed-chunk-content.dto.ts` — create/save/request-changes/restore DTO.
- Create: `apps/api/src/template-packages/managed-chunk-content.controller.ts` — `/api/sites/:siteId/content/chunks` routes.
- Create: `apps/api/src/template-packages/managed-chunk-content.controller.spec.ts` — route/guard/DTO contract.
- Modify: `apps/api/src/content/cms-revisions.service.ts` and `.spec.ts` — typed managed submit/request-changes operations.
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.repository.ts` and `.spec.ts` — save/submit/request-changes instance wrappers.
- Modify: `apps/api/src/template-packages/template-package.module.ts` — register controller/service.
- Create: `apps/web/src/app/managed-chunks-model.ts` and `.spec.ts` — API types, default form values, payload normalization, action derivation.
- Create: `apps/web/src/app/managed-chunks-view.tsx` — list/category/editor/workflow UI.
- Modify: `apps/web/src/app/page.tsx` — `chunks` view, menu and render branch.
- Modify: `apps/web/src/app/globals.css` — scoped `.managed-chunks-*` styles using existing tokens.
- Modify: `apps/web/test/site-shell-navigation.spec.ts` — route/menu ownership contract.
- Modify: `docs/change-log.md` and `docs/managed-chunks-post-mvp-review.md` — actual result and deferred checks.

### Task 1: Safe catalog and read models

- [ ] **Step 1: Write failing service tests**

Create `managed-chunk-content.service.spec.ts` with exact cases:

```ts
it('builds the Skinova catalog only from contracts referenced by this site');
it('does not expose an unrelated registered v3 contract');
it('lists and reads only instances from the requested site');
it('returns published and draft snapshot data without changing it');
it('fails closed on ambiguous manifest identity or contract digest');
it('returns not found for a foreign-site instance without leaking its existence');
```

The expected public shape is fixed before implementation:

```ts
type ChunkCatalog = {
  categories: Array<{
    key: string;
    title: string;
    order: number;
    iconKey: string;
    definitions: Array<{
      contractId: string;
      key: string;
      schemaVersion: string;
      title: string;
      fields: ManagedChunkField[];
    }>;
  }>;
};

type ChunkInstanceDetail = {
  id: string;
  displayName: string;
  categoryKey: string;
  definitionKey: string;
  schemaVersion: string;
  fields: ManagedChunkField[];
  reviewState: 'draft' | 'in_review' | 'approved' | 'changes_requested';
  published: { id: string; versionNumber: number; data: Record<string, unknown> } | null;
  draft: { id: string; versionNumber: number; data: Record<string, unknown> } | null;
  allowedActions: string[];
  updatedAt: string;
};
```

- [ ] **Step 2: Run RED**

Run:

```powershell
pnpm --dir apps/api test -- --runInBand src/template-packages/managed-chunk-content.service.spec.ts
```

Expected: FAIL because `ManagedChunkContentService` does not exist.

- [ ] **Step 3: Implement minimal catalog/list/detail service**

`ManagedChunkContentService` must:

```ts
@Injectable()
export class ManagedChunkContentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly persistence: ManagedChunkPersistenceRepository,
  ) {}

  catalog(siteId: string, actor: RevisionActor): Promise<ChunkCatalog>;
  list(siteId: string, actor: RevisionActor, categoryKey?: string): Promise<ChunkInstanceSummary[]>;
  get(siteId: string, instanceId: string, actor: RevisionActor): Promise<ChunkInstanceDetail>;
}
```

Selection rules:

1. authorize `SitePermission.READ` before managed reads;
2. collect only contract IDs referenced by draft/published revisions of non-archived instances of this site;
3. require every contract to match `sites.template_package_id`;
4. parse its `firstSeenTemplatePackageVersion.manifest` with existing v2 validator;
5. match exact `definitionKey`, `schemaVersion` and digest; do not select highest/latest package version;
6. clone all JSON returned to callers and never return `dataSchema`, digest, repository or release metadata.

- [ ] **Step 4: Run GREEN**

Run the Task 1 command. Expected: one suite PASS and no snapshots.

### Task 2: Typed instance draft and workflow lifecycle

- [ ] **Step 1: Add failing lifecycle tests**

Extend `cms-revisions.service.spec.ts` and `managed-chunk-persistence.repository.spec.ts` with:

```ts
it('submits a verified managed instance revision');
it('requests changes only after verifying the typed instance link');
it('saves a new instance draft with the existing contract link');
it('rejects a stale expectedDraftRevisionId without partial rows');
it('keeps publishedRevisionId unchanged while saving a draft');
it('blocks direct publish when the site grant requires approval');
```

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir apps/api test -- --runInBand src/content/cms-revisions.service.spec.ts src/template-packages/managed-chunk-persistence.repository.spec.ts
```

Expected: new managed submit/request/save methods are missing.

- [ ] **Step 3: Add typed lifecycle methods**

Add manager-aware methods which use the same `prepareInstanceRevision` proof as approve/publish:

```ts
submitManagedRevisionUsingManager(db, input, prepare): Promise<void>;
requestManagedRevisionChangesUsingManager(db, input, reason, prepare): Promise<void>;
```

Expose repository wrappers:

```ts
saveInstanceDraft(input: {
  siteId: string;
  instanceId: string;
  data: Record<string, unknown>;
  expectedDraftRevisionId: string | null;
  actor: RevisionActor;
}): Promise<{ revisionId: string; versionNumber: number }>;
submitInstanceRevision(input): Promise<void>;
requestInstanceRevisionChanges(input & { reason: string }): Promise<void>;
```

`saveInstanceDraft` must reuse the instance's current typed contract and persist snapshot exactly as:

```ts
{ formatVersion: 1, data: structuredClone(data), sanitizerPolicyVersion: null }
```

No generic lifecycle method may accept an unverified `chunk_instance` identifier.

- [ ] **Step 4: Run GREEN**

Run the Task 2 command. Expected: both suites PASS.

### Task 3: Validated mutation service and protected routes

- [ ] **Step 1: Write failing mutation and route tests**

Add service cases:

```ts
it('creates an instance only from a contract in the site catalog');
it('validates data with the stored derived JSON schema');
it('accepts same-site image media and rejects foreign or non-image media');
it('does not create a revision when validation fails');
it('delegates submit approve request-changes publish and restore to typed workflow');
```

Add controller metadata/integration cases for JWT guard, UUID parsing and exact routes.

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir apps/api test -- --runInBand src/template-packages/managed-chunk-content.service.spec.ts src/template-packages/managed-chunk-content.controller.spec.ts
```

Expected: controller/DTO/mutation methods are missing.

- [ ] **Step 3: Implement DTO, validation and controller**

DTO boundary:

```ts
class CreateManagedChunkInstanceDto {
  @IsString() @Length(1, 160) displayName!: string;
  @IsUUID() contractId!: string;
  @IsObject() data!: Record<string, unknown>;
}

class SaveManagedChunkDraftDto {
  @IsObject() data!: Record<string, unknown>;
  @ValidateIf((_o, value) => value !== null) @IsUUID()
  expectedDraftRevisionId!: string | null;
}
```

Compile the stored closed `dataSchema` with Ajv `{ allErrors: true, strict: true }`. Walk only declared `image` fields and require each non-null `mediaId` to resolve to an image `MediaEntity` in the same site. Return one safe `BadRequestException` without schema internals.

Controller routes:

```text
GET    /sites/:siteId/content/chunks/catalog
GET    /sites/:siteId/content/chunks/instances
GET    /sites/:siteId/content/chunks/instances/:instanceId
POST   /sites/:siteId/content/chunks/instances
PUT    /sites/:siteId/content/chunks/instances/:instanceId/draft
POST   /sites/:siteId/content/chunks/instances/:instanceId/revisions/:revisionId/submit
POST   /sites/:siteId/content/chunks/instances/:instanceId/revisions/:revisionId/approve
POST   /sites/:siteId/content/chunks/instances/:instanceId/revisions/:revisionId/request-changes
POST   /sites/:siteId/content/chunks/instances/:instanceId/revisions/:revisionId/publish
POST   /sites/:siteId/content/chunks/instances/:instanceId/revisions/:revisionId/restore
```

Register service/controller in `TemplatePackageModule`; reuse its existing `ContentModule` import and do not create a circular module dependency.

- [ ] **Step 4: Run GREEN and API build**

```powershell
pnpm --dir apps/api test -- --runInBand src/template-packages/managed-chunk-content.service.spec.ts src/template-packages/managed-chunk-content.controller.spec.ts src/content/cms-revisions.service.spec.ts src/template-packages/managed-chunk-persistence.repository.spec.ts
pnpm --dir apps/api build
```

Expected: focused suites and production build PASS.

### Task 4: Pure client model and workflow actions

- [ ] **Step 1: Write failing pure client test**

Create `managed-chunks-model.spec.ts` covering:

```ts
assert.deepEqual(initialData(fields), expectedSkinovaDefaults);
assert.deepEqual(normalizeDraft(fields, formValues), expectedApiData);
assert.deepEqual(chunkActions(detail), expectedButtons);
assert.throws(() => normalizeDraft(fields, unknownKeyPayload));
```

Rules: nullable text/image defaults to `null`; required number/boolean keep contract-safe values; image is `{ mediaId, alt, decorative }`; unknown widgets or keys fail closed.

- [ ] **Step 2: Run RED**

```powershell
pnpm --dir apps/web exec tsx src/app/managed-chunks-model.spec.ts
```

Expected: module missing.

- [ ] **Step 3: Implement pure types/helpers**

Export API DTO types plus:

```ts
initialManagedChunkData(fields): Record<string, unknown>;
normalizeManagedChunkDraft(fields, values): Record<string, unknown>;
managedChunkActions(detail): {
  save: boolean;
  submit: boolean;
  approve: boolean;
  requestChanges: boolean;
  publish: boolean;
  restore: boolean;
};
```

The UI may hide actions from this helper, but the API remains authoritative.

- [ ] **Step 4: Run GREEN**

Run the Task 4 command. Expected: exit 0.

### Task 5: CMS «Чанки → Баннеры» UI

- [ ] **Step 1: Add failing shell contract**

Update `site-shell-navigation.spec.ts` to require:

```text
View includes "chunks"
media site menu contains { id: "chunks", label: "Чанки" }
render branch mounts ManagedChunksView with siteId and existing capability flags
legacy "banners" route remains present and unchanged
```

Run:

```powershell
pnpm --dir apps/web exec playwright test test/site-shell-navigation.spec.ts
```

Expected: FAIL before page integration.

- [ ] **Step 2: Implement the view**

`ManagedChunksView` owns:

- loading/error/empty states for catalog and instance list;
- category tabs generated from API, with Skinova «Баннеры»;
- compact list with display name, definition title, review state and updated time;
- create/edit modal using ordered fields;
- `text`, `textarea`, same-site image picker with preview/alt/decorative,
  constrained number and boolean switch;
- explicit labels «Сохранить черновик», «Отправить», «Одобрить»,
  «Вернуть на доработку», «Опубликовать», never treating draft save as publish;
- refresh after every successful action and safe server error text.

`page.tsx` adds `chunks` to `View`, imports `ManagedChunksView`, adds the menu item for media sites and renders it. Existing `banners` route is not renamed or removed in this phase.

- [ ] **Step 3: Add scoped styles**

Add only `.managed-chunks-*` selectors to `globals.css`. Reuse existing CSS variables, typography, button/form/modal patterns; no `!important`, inline magic colors or global selector changes. Desktop must support the 300px sidebar and editor content without horizontal overflow.

- [ ] **Step 4: Run client checks**

```powershell
pnpm --dir apps/web exec tsx src/app/managed-chunks-model.spec.ts
pnpm --dir apps/web exec eslint src/app/managed-chunks-model.ts src/app/managed-chunks-view.tsx src/app/page.tsx
pnpm --dir apps/web exec playwright test test/site-shell-navigation.spec.ts
pnpm --dir apps/web build
```

Expected: all focused checks and build PASS.

### Task 6: Critical smoke, documentation and stop point

- [ ] **Step 1: Verify without shared DB mutation**

Use only a disposable PostgreSQL database or an already isolated local copy. Register Skinova v2 and run the existing managed backfill there; never run integration tests against the shared local application DB, VDS or another developer's database.

- [ ] **Step 2: Browser smoke**

Start API/Web against that isolated database and verify one desktop flow:

1. open Skinova → «Чанки»;
2. see category «Баннеры» and three backfilled instances;
3. open an instance and see text/image/number/boolean fields;
4. save a draft and confirm the published value remains unchanged;
5. verify available approval/publish buttons for one direct-publish actor and one approval-required actor;
6. confirm the public Skinova response remains legacy/unchanged.

Do not perform full responsive/pixel-perfect regression in this phase.

- [ ] **Step 3: Update journal and deferred review**

Update the existing Phase 4.1 entry in `docs/change-log.md` with actual files, tests, DB/container cleanup and explicit non-release status. Append deferred mobile, large catalog, full tenant/security matrix and runtime switch checks to `docs/managed-chunks-post-mvp-review.md`.

- [ ] **Step 4: Final critical commands**

```powershell
pnpm --dir apps/api test -- --runInBand src/template-packages/managed-chunk-content.service.spec.ts src/template-packages/managed-chunk-content.controller.spec.ts src/content/cms-revisions.service.spec.ts src/template-packages/managed-chunk-persistence.repository.spec.ts
pnpm --dir apps/api build
pnpm --dir apps/web exec tsx src/app/managed-chunks-model.spec.ts
pnpm --dir apps/web build
git diff --check
git status --short --untracked-files=all
```

Confirm no files changed under `apps/api/src/database/migrations`.

- [ ] **Step 5: Stop before commit**

Report the implemented behavior and exact verification evidence. Do not commit, push, merge, deploy or touch VDS. Ask for confirmation to create one separate implementation commit.

### VDS rollout после отдельного согласования

Локальный dump на VDS не переносить и не использовать для замены целевой БД.
Выкладку выполнять как одну согласованную операцию в следующем порядке:

1. Создать свежий backup целевой БД и проверить его читаемость через
   `pg_restore --list`.
2. Сверить migrations в согласованной ревизии, фактически применённые
   migrations целевой БД и текущую серверную версию.
3. Развернуть web и API из одной и той же согласованной Git-ревизии; не
   смешивать артефакты разных веток или коммитов.
4. Применить только migrations этой ревизии и подтвердить migration ledger до
   любых data-команд.
5. Последовательно выполнить release-команды: register Skinova v1, preflight,
   report-deployed v1, затем register Skinova v2.
6. Запустить идемпотентный managed backfill только для подтверждённого Skinova
   site id; не запускать общий или неограниченный backfill.
7. Проверить package/runtime pointers, managed instances/resources и их draft/
   published pointers, API «Чанки», public legacy output и отсутствие 4xx/5xx.
8. Зафиксировать фактическую ревизию, migration ledger, результат команд и
   проверки в журнале. Откат кода не откатывает схему или данные БД: не
   выполнять destructive `down` и не восстанавливать старый dump без отдельного
   согласованного плана восстановления.
