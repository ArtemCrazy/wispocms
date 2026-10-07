# Managed Chunks SDK Phase 2: аддитивная модель хранения

Дата: 07.10.2026. Статус: подтверждённая в диалоге архитектура; письменная
спецификация ожидает проверки владельца. Ветка:
`codex/managed-chunks-sdk-v1`.

## Цель и границы

Phase 2 добавляет пустую, tenant-safe модель хранения универсальных чанков поверх
уже реализованных manifest v2 contract primitives и существующего
`cms_revision_*` workflow. Этот этап не переключает Skinova, баннеры, public или
preview на новую модель и не создаёт пользовательский интерфейс.

В Phase 2 входят:

- immutable-контракты definition, привязанные к `TemplatePackage`;
- site-scoped экземпляры чанков;
- атомарно версионируемые раскладки страниц и глобальных поверхностей сайта;
- нормализованные placements конкретной версии раскладки;
- типизированная связь CMS-ревизии экземпляра с точным контрактом;
- пустая provenance-модель для будущего идемпотентного backfill Skinova;
- repository primitives и compatibility inventory без API/UI wiring;
- новая аддитивная TypeORM-миграция и проверки на одноразовой PostgreSQL.

Не входят:

- реальный Skinova manifest v2 и перенос `banners`/`page_banner_assignments`;
- dual-write, shadow-read и переключение public/preview;
- Generic API, формы, TinyMCE, sanitizer и media validation;
- изменение прав, меню или существующих endpoint;
- регистрация v2 через production DTO/controller/release CLI;
- изменение или удаление legacy-таблиц;
- общая БД, VDS, Registry, `main`, deployment или фактическая выкладка.

## Выбранный подход

Используется гибридная модель:

1. Существующие `cms_revision_resources`, `cms_revisions` и
   `cms_revision_events` остаются единственным workflow черновика,
   согласования, публикации, истории и восстановления.
2. Стабильные identities, tenant-связи, contract references и placements
   хранятся в нормализованных таблицах с внешними ключами.
3. Пользовательские данные экземпляра хранятся один раз — в
   `cms_revisions.snapshot`. Отдельная типизированная таблица связывает эту
   revision с immutable contract, но не дублирует payload.
4. Раскладка версионируется целиком. Одна layout revision содержит metadata и
   полный набор placement-строк. Публикация указателя делает активным весь набор
   атомарно; отдельный placement не согласуется и не публикуется сам по себе.

Полностью JSON-вариант отклонён из-за слабых FK и tenant-гарантий. Отдельный
revision engine для чанков отклонён как дублирование действующего workflow.

## Изменение существующих ограничений

Одна новая миграция ориентировочно получает имя
`1791876000000-ManagedChunkPersistence`. Номер перед созданием ещё раз
сверяется с актуальным `origin/main`.

Миграция аддитивно:

- меняет `CHK_template_package_versions_manifest_version` с `= 1` на
  `IN (1, 2)`; это только разрешение хранения, production registration v2
  остаётся невключённой;
- добавляет к `CHK_cms_revision_resources_type` типы `chunk_instance` и
  `chunk_layout`, сохраняя все прежние значения;
- добавляет составные unique keys, необходимые только для tenant-safe FK;
- создаёт новые пустые таблицы и индексы; `INSERT`, backfill и ручных изменений
  существующих строк нет.

## Таблицы

### `managed_chunk_contracts`

Immutable-контракт одной identity definition.

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | Внутренний идентификатор |
| `template_package_id` | uuid not null | Владелец identity |
| `first_seen_template_package_version_id` | uuid not null | Первая зарегистрированная версия-источник |
| `definition_key` | varchar(80) | Machine key definition |
| `schema_version` | varchar(40) | Версия схемы definition |
| `contract_digest` | varchar(80) | Серверный `sha256:<64 hex>` |
| `field_contract` | jsonb | Canonical storage contract без presentation |
| `data_schema` | jsonb | Детерминированно производная draft-07 schema |
| `created_at` | timestamptz | Время регистрации |

Ограничения:

- unique `(template_package_id, definition_key, schema_version)`;
- composite FK первой package version гарантирует тот же
  `template_package_id`;
- `field_contract` и `data_schema` — JSON objects;
- digest соответствует `^sha256:[0-9a-f]{64}$`;
- update запрещён trigger. Повторная регистрация той же identity допустима
  только при совпадающих digest и canonical contract bytes.

`field_contract` является JSON-представлением уже реализованного
`canonicalManagedChunkContract`: ключи, widgets, required/nullable и storage
constraints без `label`, `help` и option labels. Presentation metadata
(`title`, category, order, icon, подписи полей) и `rendererKey` не записываются
как свойства контракта: они читаются из конкретного immutable manifest package
version и могут меняться без новой schema identity.

### `managed_chunk_instances`

Стабильная CMS-сущность переиспользуемого чанка внутри одного сайта.

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | Identity экземпляра |
| `site_id` | uuid not null | Tenant-владелец |
| `revision_resource_id` | uuid unique not null | Ресурс типа `chunk_instance` |
| `display_name` | varchar(160) | Служебное имя в CMS |
| `is_archived` | boolean default false | Мягкое архивирование |
| `created_by_user_id` | uuid null | Автор, `SET NULL` при удалении пользователя |
| `created_at`, `updated_at` | timestamptz | Метаданные |

`display_name` и архивный статус являются организационными метаданными, а не
public content. Public payload определяется только опубликованной revision.
Создание instance и его revision resource выполняется одной транзакцией.
Composite FK фиксирует совпадение `site_id`, `resource_type = chunk_instance` и
`entity_id = instance.id`.

### `managed_chunk_instance_revisions`

Одна строка на одну `cms_revisions` запись instance.

| Поле | Тип | Назначение |
|---|---|---|
| `revision_id` | uuid PK | CMS revision |
| `revision_resource_id` | uuid not null | Проверка принадлежности revision ресурсу |
| `site_id` | uuid not null | Tenant |
| `instance_id` | uuid not null | Стабильный instance |
| `contract_id` | uuid not null | Точный immutable contract этой версии |

Composite FK гарантируют, что revision принадлежит ресурсу экземпляра и что
instance находится в том же site. Строка immutable. Contract, package version,
revision resource и исторические rows используют `ON DELETE RESTRICT`; удаление
пользователя-автора использует `SET NULL`. Данные не дублируются.

`cms_revisions.snapshot` имеет закрытый формат:

```json
{
  "formatVersion": 1,
  "data": {},
  "sanitizerPolicyVersion": null
}
```

В Phase 2 production write этого payload не включается. Репозиторные тесты
используют только синтетические безопасные значения. HTML canonicalization и
media ownership добавляются до появления API записи.

### `managed_chunk_layouts`

Стабильная identity одной атомарной раскладки.

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | Identity layout |
| `site_id` | uuid not null | Tenant |
| `revision_resource_id` | uuid unique not null | Ресурс типа `chunk_layout` |
| `scope_kind` | varchar(24) | `page` или `site_surface` |
| `page_id` | uuid null | Страница для page layout |
| `surface_key` | varchar(80) null | Например, `header`/`footer` для глобальной поверхности |
| `created_at` | timestamptz | Создание identity |

Check constraint требует ровно один target:

- `page`: `page_id` not null, `surface_key` null;
- `site_surface`: `page_id` null, `surface_key` not null.

Добавляется безопасный unique `(pages.id, pages.site_id)`, после чего page FK
проверяет принадлежность страницы тому же сайту. Partial unique indexes не
разрешают две layout identities для одной страницы или одного
`site + surface_key`.

### `managed_chunk_placements`

Immutable-назначения, принадлежащие конкретной layout revision.

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | Placement row |
| `site_id` | uuid not null | Tenant |
| `layout_id` | uuid not null | Layout identity |
| `layout_revision_resource_id` | uuid not null | Revision resource layout |
| `layout_revision_id` | uuid not null | Конкретная CMS revision |
| `instance_id` | uuid not null | Стабильный chunk instance |
| `slot_key` | varchar(80) | Slot из manifest |
| `position` | integer | Нулевая позиция в slot |

Ограничения:

- composite FK подтверждают один site у layout и instance;
- `(layout_revision_resource_id, layout_revision_id)` ссылается на одну
  `cms_revisions(resource_id, id)`;
- unique `(layout_revision_id, slot_key, position)`;
- `position >= 0`;
- update/delete исторических placement rows запрещены trigger.

Layout revision snapshot хранит только metadata, которые не дублируют rows:

```json
{
  "formatVersion": 1,
  "templateKey": "skinova-home",
  "templateVersion": "1"
}
```

Полный draft/published layout собирается из snapshot и всех placement rows этой
revision. Instance ссылается стабильно, а renderer выбирает его соответствующую
published либо preview revision. Поэтому публикация новых данных одного instance
обновляет все использующие его placements и не создаёт revisions страниц.

### `managed_chunk_migration_provenance`

Пустая техническая таблица для Phase 3 backfill.

Она хранит `site_id`, `migration_version`, `source_type`, `source_id`,
`source_checksum`, один из `instance_id/layout_id/placement_id` и `created_at`.
Check требует ровно один target, а composite FK запрещают target другого сайта.
Unique `(migration_version, source_type, source_id)` делает повтор backfill
детерминированным. В Phase 2 строки не создаются; `source_type` ограничен
legacy-источниками `banner` и `page_banner_assignment`.

## Транзакции и repositories

Phase 2 добавляет внутренние repository primitives без controller/API:

- idempotent contract registration из уже проверенного manifest v2;
- создание instance вместе с `cms_revision_resources`;
- запись revision-to-contract link в той же транзакции, где создаётся revision;
- создание layout revision и полного placements set одной короткой транзакцией;
- чтение inventory отдельно по draft и published pointers для Phase 1
  compatibility function;
- tenant mismatch, неизвестный contract/instance/slot target и stale pointer
  завершают транзакцию ошибкой без частичных строк.

Новые resource types не добавляются в пользовательский generic endpoint как
произвольные строки. Save, restore, approve и publish чанков вызываются только
через типизированный adapter/repository, который в той же транзакции сохраняет
`managed_chunk_instance_revisions` либо полный placements set. Это исключает
revision без contract link и частичную layout revision.

Длинная manifest validation, HTML sanitization, media lookup и frontend
preflight не выполняются под DB lock. Перед commit повторно проверяются только
identity/pointers и локальные ограничения, способные измениться конкурентно.

## Источники совместимости

DB inventory возвращает:

- каждую contract identity, используемую draft или published instance;
- источник `draft`/`published`;
- каждую placement requirement из draft/published layout;
- layout key, template key/version, slot, position и contract identity
  разрешённой для выбранного источника instance revision.

Pending draft учитывается независимо от published state и поэтому может
заблокировать несовместимый frontend candidate. Отсутствующая draft revision не
подменяется новым контрактом; для preview допустим явный fallback на published
instance только на уровне будущего rendering adapter.

## Tenant isolation и целостность

- Каждый внешний ключ к instance/layout/placement включает `site_id`.
- Resource link включает `site_id`, точный `resource_type` и `entity_id`.
- Доступ к package contract не означает доступ к данным сайтов.
- Repository всегда получает явный `siteId`; глобальный поиск instance/layout
  по одному UUID не является публичным методом.
- UUID другого сайта должен давать тот же безопасный not-found/forbidden путь,
  что отсутствующий UUID; Phase 2 проверяет это на repository уровне.

## Миграция и откат

`up()` не читает и не переписывает пользовательский контент. Все операции
выполняются одной TypeORM migration transaction (`migrationsTransactionMode:
all`). Индексы создаются обычным способом внутри транзакции; `CONCURRENTLY` не
используется.

`down()` допустим только пока:

- все новые таблицы пусты;
- нет revision resources типов `chunk_instance`/`chunk_layout`;
- нет сохранённых `template_package_versions.manifest_version = 2`.

При наличии любого из этих данных `down()` завершается ошибкой до удаления
объектов. Откат приложения не требует и не должен автоматически откатывать эту
аддитивную схему. После начала Phase 3 восстановление выполняется forward-fix
или по отдельно подтверждённому плану резервной копии.

## Проверки приёмки Phase 2

1. Migration и entities зарегистрированы; существующие migration-файлы не
   изменены.
2. Migration `up` на одноразовой PostgreSQL проходит от актуального ledger;
   повторный `migration:run` является no-op.
3. Existing v1 package и старые resource types остаются допустимыми.
4. Пустой безопасный `down` проходит; при новых данных guard блокирует down до
   любой потери.
5. Повторная регистрация совпадающего contract идемпотентна; тот же identity с
   другим digest/fields отклоняется.
6. FK/negative tests блокируют package-version другого package, page/instance
   другого site, revision другого resource и duplicate slot position.
7. Одна layout revision читается только целиком; частичного published set нет.
8. Draft и published inventories учитываются независимо и передаются в чистую
   Phase 1 compatibility function.
9. Existing API Managed Chunks, revision workflow, TemplatePackage v1, release
   CLI и web runtime tests продолжают проходить.
10. Интеграционные проверки используют только отдельную одноразовую БД и после
    себя удаляют container/database; общая БД и VDS не используются.

## Последующие фазы

Phase 3 отдельно добавит реальный Skinova v2, idempotent backfill, legacy history
adapter и shadow comparison. Только после подтверждённой эквивалентности Phase 4
добавит Generic API/forms, sanitization и media validation. Ни commit, ни push,
ни merge сами по себе не означают deployment или применение миграции к общей
БД.
