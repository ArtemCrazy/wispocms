# Skinova Managed Chunks Backfill Design

## Цель и граница

Phase 3.2a переносит опубликованное legacy-состояние Skinova из `banners` и
`page_banner_assignments` в уже существующую managed chunk модель. Перенос
запускается отдельной release-командой после регистрации `skinova-media@2`.
Регистрация пакета сама backfill не запускает.

Legacy-таблицы, public runtime, site package pointers и UI не меняются. История,
незавершённые legacy drafts, shadow-read и dual-write остаются следующими
этапами.

## Коррекция Skinova v2 contract

До backfill manifest v2 дополняется без изменения definition identity:

- поле `sort_order` (`number`, integer 0..9999) во всех трёх definitions;
- slot `homepage_top` с `skinova-promo-strip@1` у `system_page` шаблона
  `skinova@1`, потому что legacy Skinova публикует промо на 404 и privacy;
- `name` переносится в `ManagedChunkInstance.displayName`;
- `placement` становится структурой layout/slot, а не data field;
- `mediaId`/`mobileMediaId` становятся image value
  `{ mediaId, alt: "", decorative: true }`, `null` остаётся `null`;
- `title`, `subtitle`, `buttonText`, `linkUrl`, `sortOrder`, `isActive`
  отображаются в `title`, `subtitle`, `button_text`, `link_url`, `sort_order`,
  `is_active` без нормализации содержимого.

V2 package ещё не регистрировался в общей/рабочей БД и не выкладывался, поэтому
коррекция contract до backfill не требует новой schemaVersion.

## Управляемая команда

Release CLI получает отдельную операцию и пакетный script для Skinova. Команда
передаёт `siteSlug=skinova`, `packageId=skinova-media`, `packageVersion=2` во
внутренний endpoint под существующим release token.

Сервис требует зарегистрированные package version 2 и три точных contracts,
блокирует site и legacy source rows, затем выполняет весь backfill одной
транзакцией. Он не меняет `sites.template_package_id` или
`current_template_package_version_id`.

## Правила определения definition и layouts

Для каждого banner собираются все legacy usages:

- `page_banner_assignment.zone=homepage_top` → `skinova-promo-strip@1`;
- `page_banner_assignment.zone=homepage_middle` →
  `skinova-consultation-banner@1`;
- `banner.placement=article_sidebar` →
  `skinova-article-sidebar-banner@1`.

Несколько usages одного definition разрешены. Banner без распознаваемого usage
или с usages разных definitions останавливает всю транзакцию как неоднозначный;
данные не угадываются и не пропускаются.

Instance получает тот же UUID, что и banner. Создаётся managed published
baseline revision со всеми тремя pointers на одну revision, review state
`approved`, `sanitizerPolicyVersion=null` и typed contract link.

Page layouts создаются для каждой страницы с legacy assignments:

- homepage использует `skinova-home@1`;
- `404` и `privacy-policy` используют `skinova@1`;
- неизвестный page/template mapping блокирует backfill.

Одна legacy assignment становится placement с тем же zone, instance UUID и
position `0`. Article sidebar создаётся как site-surface layout
`template:article:skinova-article@1` и placement `article_sidebar:0`.

## Идемпотентность и provenance

`managed_chunk_migration_provenance` связывает:

- banner → instance;
- page banner assignment → placement;
- article-sidebar banner → structural placement отдельным migration key.

Checksum считается из канонического JSON всех полей legacy source, влияющих на
target. Layout имеет естественную identity `(site,page)` либо
`(site,surfaceKey)` и проверяется по полному canonical placement set.

Идентичный повтор не создаёт revisions, events или placements. Отсутствующая
provenance при полностью совпадающем target может быть достроена. Несовпадающий
checksum, partial/corrupt target или уже изменённый managed target вызывает
conflict и rollback, а не перезапись.

## Проверки MVP

Критичный набор:

1. contract покрывает `sort_order` и system-page promo slot;
2. текущий Skinova seed даёт 3 instances, 4 layouts и 5 placements;
3. instance IDs равны banner IDs, значения и `null` перенесены lossless;
4. legacy 4 page assignments и article sidebar сопоставлены точным slots;
5. повторный запуск является no-op;
6. неизвестный usage, checksum conflict или partial target откатывает всё;
7. legacy rows, public response и site package pointers не меняются;
8. один focused test на disposable PostgreSQL подтверждает транзакцию.

Полная concurrency matrix, большая история, shadow comparison, runtime/UI smoke
и производительность остаются в post-MVP списке.