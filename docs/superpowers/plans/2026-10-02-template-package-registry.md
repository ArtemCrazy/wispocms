# TemplatePackage Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with specification and code-quality reviews after each implementation task.

**Goal:** Добавить в Wispo CMS реестр неизменяемых frontend-пакетов, автоматически зарегистрировать локальную сборку Skinova и показать фактически развёрнутую версию без ложной активации или rollback кода.

**Architecture:** Manifest Skinova остаётся сериализуемым контрактом, а React-компоненты связываются с ним единым runtime registry. API хранит пакеты и версии, принимает только доверенную служебную регистрацию и отдельный отчёт о фактической выкладке. Сайт хранит nullable-ссылку на реально развёрнутую версию; регистрация кандидата её не меняет.

**Tech Stack:** Next.js 16.3/React 19/TypeScript, NestJS 11/TypeORM/PostgreSQL, Ajv JSON Schema draft-07 validation, Node test runner, Jest, Playwright, Docker Compose.

---

## Общие ограничения

- Работать только в `codex/access-control-v2` и локальном окружении.
- Не коммитить и не отправлять изменения до итоговой проверки и отдельного подтверждения владельца.
- Не менять `main`, VDS, внешний GitHub, общую или внешнюю БД.
- Не включать `AGENTS.md`, `.codex/`, `.tmp/` и test-results в изменение.
- Любое изменение production-кода начинается с падающего теста.
- Новую схему БД добавлять только новой миграцией; существующие миграции не редактировать.
- Manifest не содержит JSX, функций, CSS/JS-кода, токенов и секретов.
- На этом этапе отсутствуют пользовательские endpoints и кнопки активации/rollback.

## Task 1: Зафиксировать frontend manifest и package-aware runtime registry

**Files:**

- Create: `apps/web/template-packages/skinova/manifest.template.json`
- Create: `apps/web/src/app/template-package-contract.ts`
- Create: `apps/web/src/app/template-runtime-registry.tsx`
- Create: `apps/web/test/template-package-runtime.test.mjs`
- Modify: `apps/web/src/app/skinova-template.ts`
- Modify: `apps/web/src/app/homepage-templates.ts`

**Step 1: Write the failing contract test**

Проверить, что manifest содержит уникальные identity для `homepage`,
`articles_list`, `article`, `category`, `header`, `footer`, `system_page`; что
каждому шаблону соответствует правдивая component/integrated runtime-
возможность, а каждому renderer слота — package-aware registration; что
неизвестная или чужая package-комбинация возвращает `null`; что JSON manifest
содержит фактические draft-07 схемы и не содержит функций или
React-компонентов.

Run:

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/template-package-runtime.test.mjs
```

Expected: FAIL, потому что manifest и registry ещё отсутствуют.

**Step 2: Implement the minimal contract and registry**

Manifest template содержит стабильные данные пакета Skinova, явно повышаемый
`packageVersion`, ключи шаблонов, версии контрактов, JSON Schema
сохраняемых CMS entity data/настроек, отдельные типизированные `runtimeContext`
requirements и слоты. Route context не включается в entity schema; adapters
Task 2 обязаны потреблять/сопоставлять объявленные ключи с фактическими props
renderer. Поля Git revision,
release/artifact digest и timestamp в файл не записываются — их добавляет
служебная команда. Если исходники
изменились без повышения `packageVersion`, серверный `409` является защитой, а
не поводом перезаписать зарегистрированную версию.

Runtime identity включает `packageId + packageVersion + kind + key +
templateVersion`, slot identity — `packageId + packageVersion + rendererKey`.
Исполняемый сериализуемый каталог/resolver находится в обычном `.ts`, а `.tsx`
содержит только исчерпывающие bindings реальных React-компонентов. Встроенные
`articles_list`, `header` и `footer` не маскируются под самостоятельные
компоненты. `skinova-template.ts` остаётся совместимым тонким re-export, но
перестаёт быть источником истины.

**Step 3: Run the test until it passes**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Спецификационный reviewer подтверждает соответствие manifest утверждённому
набору и фактическим payload Skinova; code-quality reviewer проверяет
типизацию, исполняемые resolver-тесты и отсутствие исполняемых данных в JSON.
Коммит не создавать.

## Task 2: Перевести preview/public Skinova на единый resolver

**Files:**

- Modify: `apps/web/test/skinova-site.contract.test.mjs`
- Modify: `apps/web/test/banner-editor-state.test.mjs`
- Modify: `apps/web/src/app/preview/[siteSlug]/page.tsx`
- Modify: `apps/web/src/app/preview/[siteSlug]/articles/[articleSlug]/page.tsx`
- Modify: `apps/web/src/app/preview/[siteSlug]/categories/[categorySlug]/page.tsx`
- Modify: `apps/web/src/app/preview/[siteSlug]/pages/[pageSlug]/page.tsx`
- Modify: `apps/web/src/app/preview/[siteSlug]/pages/[pageSlug]/not-found.tsx`
- Modify: `apps/web/src/app/banner-preview/page.tsx`
- Modify: `apps/web/src/app/skinova-banner-preview-context.ts`
- Modify: `apps/web/src/app/skinova-banner-preview-frame.tsx`

**Step 1: Extend failing route contracts**

Добавить ожидания, что перечисленные routes не выбирают Skinova через
разрозненные сравнения `SKINOVA_*`, header template или renderer string, а
используют общий resolver. System pages обязаны использовать собственные
`systemTemplateKey/systemTemplateVersion`.

Run:

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/template-package-runtime.test.mjs test/skinova-site.contract.test.mjs test/banner-editor-state.test.mjs
```

Expected: FAIL на старых ветках выбора.

**Step 2: Replace direct selection with resolver calls**

Все состояния общего public/CMS-preview route используют один runtime registry.
Поскольку DB pointer этого этапа диагностический, route передаёт resolver
identity встроенного manifest текущей сборки; после Task 6 также сверяется
package identity, возвращаемая основным public/preview payload. Неизвестный
пакет или template identity показывает существующее безопасное состояние
«шаблон недоступен», но не попадает молча в Skinova.

**Step 3: Run targeted tests**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Reviewers проверяют все поверхности и отсутствие изменения визуального
результата текущей Skinova. Коммит не создавать.

## Task 3: Добавить аддитивную схему реестра TemplatePackage

**Files:**

- Create: `apps/api/src/database/migrations/1791789600000-TemplatePackageRegistry.ts`
- Create: `apps/api/src/database/migrations/1791789600000-TemplatePackageRegistry.spec.ts`
- Create: `apps/api/src/database/migrations/1791793200000-AssignSkinovaSystemTemplate.ts`
- Create: `apps/api/src/database/migrations/1791793200000-AssignSkinovaSystemTemplate.spec.ts`
- Modify: `apps/api/src/database/entities.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/database/data-source.spec.ts`

**Step 1: Write failing migration/entity tests**

Проверить создание `template_packages`, `template_package_versions`,
уникальность `(package_id, package_version)`, nullable
`sites.template_package_id`, nullable
`sites.current_template_package_version_id`, новые enum-kind `homepage` и
`system_page`, а также DB-trigger неизменяемости записанной версии. Реестровая
миграция не должна создавать фиктивную версию Skinova и не должна менять
существующие пользовательские данные. Отдельная идемпотентная data-миграция
должна назначить `skinova@1` текущим и опубликованным системным шаблоном только
странице `privacy-policy` точного сайта Skinova из миграции импорта и только
если все четыре поля template identity остаются `NULL`.

Run:

```powershell
pnpm --dir apps/api test --runInBand -- 1791789600000 data-source
```

Expected: FAIL.

**Step 2: Implement entities and migration**

Добавить таблицы, индексы, ограничения, immutable trigger и nullable FK.
Отдельной следующей миграцией выполнить узкое условное исправление identity
Skinova без изменения уже применённой миграции импорта. Down реестровой
миграции удаляет только новые зависимости/таблицы в обратном порядке и не
предназначен для автоматического отката внешней рабочей БД; down data-миграции
снимает только собственное присваивание при полном совпадении установленных
ею значений и целевой строки.

**Step 3: Run targeted tests**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Reviewers отдельно подтверждают отсутствие общего data-backfill,
совместимость legacy-сайтов с `NULL` и точную область единственного
Skinova-исправления. Коммит не создавать.

## Task 4: Реализовать строгую валидацию manifest и release-token guard

**Files:**

- Create: `apps/api/src/template-packages/template-package.types.ts`
- Create: `apps/api/src/template-packages/template-package.dto.ts`
- Create: `apps/api/src/template-packages/template-package.validation.ts`
- Create: `apps/api/src/template-packages/template-package.validation.spec.ts`
- Create: `apps/api/src/template-packages/release-token.guard.ts`
- Create: `apps/api/src/template-packages/release-token.guard.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Write failing validation and authorization tests**

Покрыть валидный Skinova manifest, дубли identity/renderer, неверные версии,
несовместимый CMS schema range, исполняемые/исходные поля, невалидный URL,
credentials/private runtime URL и некомпилируемую JSON Schema. Guard обязан
fail closed, сравнивать токен безопасно и не возвращать его в ошибке.

Run:

```powershell
pnpm --dir apps/api test --runInBand -- template-package.validation release-token.guard
```

Expected: FAIL.

**Step 2: Add Ajv through the package manager**

```powershell
pnpm --dir apps/api add ajv
```

**Step 3: Implement minimal validation and guard**

Release token читается только из окружения. Missing env и missing/incorrect
header отклоняются; токен, полный manifest и environment не логируются.

**Step 4: Run targeted tests**

Run the command from Step 1.

Expected: PASS.

**Step 5: Review checkpoint**

Security/spec reviewer проверяет границы доверия. Коммит не создавать.

## Task 5: Реализовать идемпотентную регистрацию и отчёт о выкладке

**Files:**

- Create: `apps/api/src/template-packages/template-package.service.ts`
- Create: `apps/api/src/template-packages/template-package.service.spec.ts`
- Create: `apps/api/src/template-packages/template-package.controller.ts`
- Create: `apps/api/src/template-packages/template-package.controller.spec.ts`
- Create: `apps/api/src/template-packages/template-package.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/audit/audit.service.ts`
- Modify: `apps/api/src/audit/audit.service.spec.ts`

**Step 1: Write failing service/controller tests**

Проверить:

- `POST /api/internal/template-packages/register` создаёт кандидата;
- идентичный повтор возвращает ту же версию без дубликата;
- тот же package/version с другим digest или canonical manifest даёт `409`;
- регистрация не меняет сайт и его каталог;
- read-only `POST /api/internal/sites/:siteSlug/template-package/preflight`
  принимает уже зарегистрированную версию, проверяет совместимость и ничего
  не изменяет;
- `PUT /api/internal/sites/:siteSlug/template-package/deployed` фиксирует
  фактически развёрнутую версию и привязку сайта к пакету, не меняя каталог;
- несовместимое фактическое состояние сохраняет правдивый pointer, а read API
  возвращает mismatch status и причины;
- повторный deploy-report идемпотентен;
- успешные системные события попадают в audit без token/full manifest.

Run:

```powershell
pnpm --dir apps/api test --runInBand -- template-package.service template-package.controller audit.service
```

Expected: FAIL.

**Step 2: Implement service, controller and module**

Canonical manifest digest вычисляется сервером. Все служебные endpoints
защищаются guard из Task 4 и недоступны пользовательским ролям. API активации и
rollback не добавлять.

**Step 3: Run targeted tests**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Reviewers проверяют идемпотентность, транзакцию, audit и отсутствие скрытой
активации при регистрации. Коммит не создавать.

## Task 6: Расширить read API и публичный integration manifest

**Files:**

- Modify: `apps/api/src/content/public-integration-manifest.ts`
- Modify: `apps/api/src/content/public-integration-manifest.spec.ts`
- Modify: `apps/api/src/content/content.service.ts`
- Modify: `apps/api/src/content/content.service.spec.ts`
- Modify: `apps/api/src/template-packages/template-package.controller.ts`
- Modify: `apps/api/src/template-packages/template-package.controller.spec.ts`

**Step 1: Write failing API contract tests**

Проверить schema version `1.2`, nullable `templatePackage` для legacy-сайта,
текущую версию и template identities для зарегистрированного сайта, а также
`displayTemplate*` и `systemTemplate*` в content model. Владелец видит только
current summary своего сайта; Wispo admin дополнительно видит кандидатов;
контент-менеджер не получает управление релизами.

Run:

```powershell
pnpm --dir apps/api test --runInBand -- public-integration-manifest content.controller platform.controller
```

Expected: FAIL.

**Step 2: Implement read contracts**

Добавить owner/admin current endpoint и отдельный platform-admin candidates
endpoint в модуле `template-packages`, не раздувая content/platform
controllers. Кандидаты ограничены стабильной привязкой сайта к пакету; при
`NULL` список пуст. Основной public/preview payload получает current package
identity, чтобы frontend мог диагностировать расхождение с embedded build.
Сервер возвращает готовый nullable preview URL; UI его не собирает.

**Step 3: Run targeted tests**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Reviewers проверяют tenant isolation и отсутствие лишних данных у владельца.
Коммит не создавать.

## Task 7: Добавить локальную CI-like команду Skinova

**Files:**

- Create: `scripts/template-package-release.mjs`
- Create: `scripts/register-template-package.test.mjs`
- Modify: `package.json`
- Modify: `.env.local.example`
- Modify: `compose.local.yaml`

**Step 1: Write the failing script test**

Проверить сборку полного manifest из template, детерминированный release digest
всего runtime Skinova в стабильном порядке `relative-path + bytes`, обязательный
token из env, отсутствие секрета в stdout/stderr и полную независимость команд
`register`, `preflight`, `report-deployed`. `register` не вызывает остальные
команды. Повторно использованный packageVersion с другой ревизией должен дать
конфликт и потребовать явного повышения версии.

Run:

```powershell
node --test scripts/register-template-package.test.mjs
```

Expected: FAIL.

**Step 2: Implement the command**

Добавить отдельные scripts `template-package:register:skinova`,
`template-package:preflight:skinova` и
`template-package:report-deployed:skinova` через
`node --env-file-if-exists=.env.local`. Локально revision берётся из Git;
release digest охватывает manifest, registry/components и `public/skinova/**`,
включая CSS, изображения, SVG и шрифты. Artifact digest остаётся `null`. Token
передаётся только заголовком `x-wispo-release-token`, не принимается аргументом
CLI и не печатается. Default API URL — `http://127.0.0.1:4300/api`; в
examples/compose хранится только placeholder.

**Step 3: Run the script test**

Run the command from Step 1.

Expected: PASS.

**Step 4: Review checkpoint**

Reviewers проверяют отсутствие секретов и то, что регистрация не объявляется
деплоем до отдельного успешного report. Коммит не создавать.

## Task 8: Показать read-only состояние frontend-пакета в CMS

**Files:**

- Create: `apps/web/test/template-package-release-ui.contract.test.mjs`
- Create: `apps/web/test/template-package-release-workflow.spec.ts`
- Modify: `apps/web/src/app/media-templates-view.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css` only if existing primitives are insufficient

**Step 1: Write failing role/UI tests**

Проверить: владелец видит только текущую версию; Wispo admin видит текущую
версию и кандидатов того же пакета; manager не видит раздел; preview link появляется только
если его подтвердил API; нет file input, release token, «Активировать» и
«Rollback».

Run:

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/template-package-release-ui.contract.test.mjs
```

Expected: FAIL.

**Step 2: Implement the read-only panel**

Переиспользовать существующую дизайн-систему страницы «Шаблоны». Передать
отдельный `isWispoAdmin`, не подменяя его `canManageStructure`.

**Step 3: Run the contract test**

```powershell
pnpm --dir apps/web exec node --experimental-strip-types --test test/template-package-release-ui.contract.test.mjs
```

Expected: PASS. Browser workflow выполняется только в Task 9 после подготовки
изолированной БД и fixtures.

**Step 4: Review checkpoint**

Reviewers проверяют роль, читаемость и отсутствие ложных действий. Коммит не
создавать.

## Task 9: Проверить изолированную локальную миграцию и полный сценарий Skinova

**Files:**

- Create or Modify: `apps/api/src/template-packages/template-package.integration.spec.ts`
- Modify: `docs/react-site-architecture.md`
- Modify: `docs/change-log.md`

**Step 1: Prepare an isolated local database**

Использовать отдельную тестовую БД/схему, не локальную рабочую и не внешнюю.
Проверить список миграций до запуска, затем применить новую миграцию.

**Step 2: Run integration lifecycle**

Проверить регистрацию Skinova, идемпотентный повтор, конфликт digest,
read-only preflight, неизменность public manifest и каталога до report,
отдельный deploy-report и появление текущей версии после него. Отдельно
проверить legacy-сайт с `NULL` и mismatch status без ложного старого pointer.

Run with the isolated test database configured in the environment:

```powershell
pnpm --dir apps/api test --runInBand -- template-package.integration
pnpm template-package:register:skinova
pnpm template-package:preflight:skinova
pnpm template-package:report-deployed:skinova
```

Expected: PASS; команда печатает только безопасные идентификаторы результата.

**Step 3: Run full verification**

```powershell
pnpm --dir apps/api test --runInBand
pnpm --dir apps/api exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm --dir apps/api build
pnpm --dir apps/web exec node --experimental-strip-types --test test/*.test.mjs
pnpm --dir apps/web exec tsc --noEmit
pnpm --dir apps/web exec eslint src/app
pnpm --dir apps/web build
pnpm build
```

Playwright запускается только против поднятого isolated E2E-стека с явными
`WISPO_E2E_ISOLATED_DB=wispo_cms_e2e` и тестовым `baseURL`: сначала целевой
`template-package-release-workflow.spec.ts`, затем существующий набор.

Expected: новые проверки проходят; существующие известные несвязанные legacy
ошибки, если сохранятся, фиксируются отдельно и не маскируются.

**Step 4: Update documentation and journal**

Зафиксировать фактические файлы, схему, отсутствие внешнего data-migration,
результаты тестов и точный статус «локально, не выложено». Не писать, что
физическая активация/rollback реализованы.

**Step 5: Final review and user checkpoint**

Провести итоговый review по ТЗ и качеству. Показать владельцу, что проверять в
CMS. Не создавать commit и не выполнять push до отдельного подтверждения.
