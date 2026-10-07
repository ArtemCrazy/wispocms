# Wispo CMS: Managed Chunks SDK для Skinova

Дата: 07.10.2026. Статус: согласованная архитектура, ожидает проверки
письменной спецификации. Ветка: `codex/managed-chunks-sdk-v1`.

Этот документ описывает первый самостоятельный этап после реестра
`TemplatePackage`: универсальные управляемые чанки на примере Skinova. Код,
схема БД, данные, Docker-окружение, Registry, VDS и `main` на этапе подготовки
спецификации не изменяются.

## Контекст и цель

Каждый сайт имеет собственную React-вёрстку и независимый frontend-релиз.
Разработчик или AI-агент размечает в репозитории сайта только те блоки и поля,
которые заказчик разрешил менять из CMS. Готовая сборка регистрирует их
декларативный контракт в `TemplatePackage` manifest. CMS не хранит и не
редактирует JSX, JavaScript, CSS или исходный HTML компонентов.

Managed Chunks SDK должен:

- добавить в manifest универсальные определения чанков, их категории, поля и
  допустимые места размещения;
- позволить хранить переиспользуемые экземпляры чанков и назначать их в
  заранее объявленные slots без изменения React-кода;
- версионировать данные чанка и его размещение через существующий workflow
  черновика, согласования, публикации и восстановления;
- сохранить существующие Skinova-баннеры, назначения, черновики и историю;
- не блокировать новый frontend-релиз, если его визуальный код изменился, но
  контракт данных остался совместимым;
- блокировать релиз, который перестал понимать опубликованные данные,
  черновики или их размещение.

В интерфейсе выбранного сайта появляется общий раздел «Чанки». Его
подкатегории формируются из manifest конкретного frontend-пакета. Для Skinova
существующее понятное клиенту название «Баннеры» сохраняется как категория, а
не как отдельная жёстко заданная CMS-сущность. В дальнейшем тот же механизм
может показать категории «Карточки», «Промоблоки» и другие.

## Не входит в этот этап

- хранение и редактирование исходного кода сайта в CMS;
- визуальный конструктор React-компонентов или произвольный block-builder;
- генерация React-компонентов и manifest самим AI-агентом;
- физическая сборка и атомарное переключение immutable `SiteRelease`;
- загрузка OCI-образа, управление Registry и production-деплой;
- общий релиз нескольких сайтов или общий репозиторий их уникальной вёрстки;
- переиспользование одного экземпляра чанка между разными сайтами;
- автоматическое преобразование данных между несовместимыми версиями схем;
- удаление legacy-таблиц `banners` и `page_banner_assignments`;
- редактирование manifest, JSON Schema, категорий или slots через админку.

Следующие этапы отдельно реализуют immutable `SiteRelease`, доставку OCI-
артефактов и эксплуатационное усиление. Managed Chunks SDK только создаёт
контракт данных, который эти этапы смогут включить в точный снимок публикации.

## Рассмотренные варианты

### 1. Manifest-driven универсальные чанки — выбран

Frontend-пакет объявляет категории, определения, схемы полей, renderer keys и
slots. CMS проверяет manifest, строит формы, хранит данные экземпляров и
управляет их публикацией. React-код остаётся в репозитории сайта.

Плюсы: одна безопасная модель для разных сайтов, независимая доставка кода и
контента, строгая совместимость перед релизом, отсутствие исполняемого кода в
БД. Минус: manifest и runtime registry должны развиваться синхронно и проходить
строгий preflight.

### 2. Отдельная таблица и интерфейс для каждого типа блока — отклонён

Продолжение модели `BannerEntity` быстро создаст отдельные сущности, DTO,
эндпоинты и UI для карточек, промоблоков и будущих типов. CMS начнёт знать
визуальную семантику каждого сайта, а перенос новой вёрстки потребует её
доработки.

### 3. Произвольный JSON или MODX-подобный код в БД — отклонён

Неструктурированный JSON не позволяет надёжно строить форму и проверять
совместимость. Редактируемый HTML/JSX/PHP смешивает контент и программный код,
не соответствует React-архитектуре, расширяет поверхность XSS/RCE и ломает
независимый жизненный цикл frontend-релиза.

## Термины и идентичность

- `ChunkCategory` — навигационная категория из manifest. Это не permission-
  boundary и не отдельный тип таблицы.
- `ChunkDefinition` — неизменяемый контракт данных и редактора для одного вида
  чанка.
- `ChunkInstance` — переиспользуемый внутри одного сайта экземпляр definition
  со своими данными, именем и историей.
- `Slot` — объявленная шаблоном точка размещения допустимых чанков.
- `ChunkLayout` — упорядоченный опубликованный или черновой набор назначений
  экземпляров в slots одной страницы или шаблонной поверхности сайта.
- `rendererKey` — декларативная ссылка на React-binding в конкретном frontend-
  пакете; исполняемый компонент в manifest не передаётся.

Идентичность definition состоит из
`packageId + definition.key + definition.schemaVersion`. Для неё вычисляется
canonical `contractDigest`. Повторное объявление той же идентичности с другим
digest запрещено. Любое изменение сохраняемого контракта, включая добавление
нового необязательного поля, создаёт новую `schemaVersion`. Изменение только
JSX/CSS или внутренней реализации renderer создаёт новый frontend-релиз, но не
новую версию схемы.

Категория, заголовок и порядок отображения не определяют совместимость.
Постоянные машинные ключи не описывают визуальное назначение всей CMS:
`skinova-banner` — ключ конкретного контракта Skinova, а не встроенный системный
тип «баннер».

## Manifest v2

`manifestVersion: 2` расширяет существующий TemplatePackage manifest, не
изменяя смысл полей пакета, сборки и шаблонов. Manifest v1 остаётся читаемым для
legacy-пакетов. Валидаторы v1 и v2 разделены по строгому discriminator: v2 не
переосмысливает допустимые поля или JSON Schema старого v1. Регистрация новой
версии v2 выполняется тем же доверенным release pipeline; ручного
редактирования manifest в CMS нет.

Сокращённый контракт:

```ts
type TemplatePackageManifestV2 = {
  manifestVersion: 2;
  packageId: string;
  packageVersion: string;
  // cmsApi, source, build и остальные поля TemplatePackage v1
  chunkCategories: Array<{
    key: string;
    title: string;
    order: number;
    iconKey?: CmsChunkIconKey;
  }>;
  chunkDefinitions: Array<{
    key: string;
    schemaVersion: string;
    title: string;
    categoryKey: string;
    rendererKey: string;
    fields: ChunkField[];
  }>;
  templates: Array<TemplateV2>;
};

type TemplateV2 = TemplateV1WithoutSlots & {
  slots?: Array<{
    key: string;
    title: string;
    placement: string;
    maxItems: number;
    allowedChunks: Array<{
      definitionKey: string;
      schemaVersion: string;
    }>;
  }>;
};
```

Для Skinova manifest v2 как минимум объявляет категорию `banners` с названием
«Баннеры», определения существующих вариантов баннера и все фактически
используемые slots. Slot больше не содержит единственный `renderer`: renderer
принадлежит definition, а slot перечисляет допустимые версии definitions.

`fields` — единственный declarative contract данных definition. Manifest v2 не
принимает параллельный `dataSchema`: сервер детерминированно выводит из закрытых
field descriptors JSON Schema draft-07 и runtime validator с
`additionalProperties: false`. Производная schema является проверяемым cache,
а не вторым источником истины.

Manifest проходит fail-closed валидацию до регистрации:

- только точный набор известных полей и plain JSON без функций, исходников и
  удалённых `$ref`; v2 применяет path-aware правила для каждого descriptor, а
  не контекстно-слепой поиск запрещённых слов во всех строках;
- `rendererKey`, `placement`, category/definition/slot keys являются только
  machine identifiers и никогда не интерпретируются как путь, selector, URL,
  module name или fragment исходного кода;
- optional `iconKey` категории выбирается только из закрытого каталога иконок
  CMS; SVG, URL, className или произвольная строка из manifest запрещены;
- уникальные ключи категорий, definitions и slots в своей области;
- каждая `categoryKey`, definition и slot-ссылка обязана существовать;
- каждая definition имеет runtime binding для своего `rendererKey`;
- `fields` используют точный закрытый union widgets; серверная производная
  JSON Schema обязана собраться и скомпилироваться без ошибок;
- циклическая вложенность group/repeater, неизвестные widgets и повторяющиеся
  select values запрещены; descriptor unions закрыты, а ключи `__proto__`,
  `prototype` и `constructor` зарезервированы;
- defaults любого типа в первом выпуске запрещены; descriptors также не
  содержат source/expressions, render paths или значений, меняющих runtime;
- complexity budgets считаются по всему пакету: не более 100 definitions,
  100 slots и 2 000 field descriptors; одна definition содержит не более 256
  descriptors, один group/repeater — не более 64 соседних descriptors, общая
  глубина — не более 6, а вложенность repeater — не более 2;
- один `select` содержит не более 100 options, один repeater — не более 100
  items, а суммарно один instance — не более 500 repeater items на всех уровнях;
- категорий не более 50; `maxItems` slot обязателен, является целым числом от 1
  до 100 и не может быть ниже числа уже опубликованных или черновых назначений
  при активации кандидата.

Canonical digest сервер вычисляет только из детерминированной canonical
JSON-формы `fields` и их семантически значимых ограничений. Производная JSON
Schema должна детерминированно воспроизводиться из тех же bytes, но в digest как
независимый input не входит. Порядок свойств JSON не должен менять digest.
Presentation-поля категории, `iconKey` и заголовка в digest совместимости не
входят. Присланный клиентом digest не считается доверенным: mismatch возвращает
conflict (`409`) и никогда не подменяется «последней» схемой.

## Поля и формат данных

Первая версия SDK поддерживает только следующие widgets:

| Widget | Сохраняемое значение | Основные ограничения |
|---|---|---|
| `text` | строка | длина, required, без HTML |
| `textarea` | строка | длина, многострочный ввод, без HTML |
| `html` | каноническая HTML-строка | серверная CMS HTML policy |
| `number` | конечное число | min/max/step |
| `boolean` | boolean | required/optional без default |
| `select` | строковое значение | только manifest allowlist, до 100 options |
| `link` | объект URL/label/target | разрешённые протоколы и длина |
| `image` | ссылка на media + alt/decorative | image MIME, preview, размеры |
| `mediaFile` | ссылка на media | имя, MIME и размер из медиатеки |
| `group` | объект вложенных полей | до 64 siblings, общая глубина до 6 |
| `repeater` | массив group/item | до 100 items, nesting до 2 |

CMS не вводит семантические поля «заголовок баннера» или «кнопка карточки».
Manifest конкретной definition сам даёт универсальным полям ключи и подписи.
`image` и `mediaFile` намеренно разделены: первое показывает изображение,
размеры и alt/decorative, второе — файл с именем, MIME и размером. Клиент не
может подменять серверные метаданные; в данных хранится ссылка на media, а
метаданные читаются из медиатеки с проверкой того же сайта.

Каждый payload является JSON-объектом, проходит серверную валидацию по
детерминированно выведенной schema и ограничен 256 KiB в canonical JSON.
Неизвестные свойства, `NaN`, бесконечные числа, внешние media другого сайта и
значения вне manifest constraints отклоняются. Различие между отсутствующим
необязательным полем и явным `null` сохраняется только там, где производная
schema явно допускает `null`. Defaults не подставляются.

### TinyMCE и HTML policy

`html` редактируется self-hosted TinyMCE поверх textarea. Пользователь может
форматировать текст визуально и открыть встроенное представление HTML-source.
Это редактор значения поля, а не редактор шаблона или компонента. HTML хранится
только канонической строкой в `ChunkInstance` data: manifest не содержит HTML,
defaults, шаблонов или исполняемой конфигурации.

Сервер является единственным доверенным валидатором. Sanitizer подключается
как прямая зафиксированная API-зависимость, а не случайная transitive dependency.
Клиент может убирать безопасный мусор Word при вставке, но не определяет
итоговую безопасность.
Сервер разбирает HTML как DOM, применяет versioned allowlist policy,
нормализует разрешённую разметку и сохраняет только canonical результат вместе
с `sanitizerPolicyVersion`. Операция идемпотентна и выполняется на create,
update, import, restore и миграции, а не только в форме TinyMCE. Если вход
содержит запрещённый тег, атрибут, URL или неоднозначную конструкцию, запрос
отклоняется с указанием поля; опасные фрагменты не удаляются молча и сырой HTML
не включается в ошибку или технический лог.

Всегда запрещены `script`, `style`, исполняемые/встраиваемые объекты вне
политики, inline event attributes, `srcdoc`, `javascript:`/`vbscript:` URLs,
неразрешённые `data:` URLs, CSS и SVG с активным содержимым. Разрешённые теги,
атрибуты, URL-протоколы и встроенный каталог iframe providers принадлежат
только CMS/server policy. Критические запреты нельзя отключить через UI,
manifest, candidate package или настройки сайта. Descriptor `html` может лишь
сузить CMS allowlist до перечисленных built-in provider IDs.

TinyMCE source может принять iframe поддержанного провайдера как часть общей
HTML-строки. Сервер распознаёт provider по точному HTTPS hostname/path,
валидирует media/video ID, отклоняет redirect и host aliases, затем переписывает
`src`, query и атрибуты в канонический безопасный iframe. В `ChunkInstance`
остаётся каноническая HTML-строка, а не отдельный provider ID. Сервер выставляет
`sandbox`, `allow`, `referrerpolicy` и `loading`; пользовательские домены,
произвольные query/attrs и расширение allowlist через manifest запрещены.
Public CSP `frame-src` формируется из того же закрытого CMS allowlist.

Public и preview renderer являются единственной trusted boundary для вывода
HTML. Они принимают только server-normalized строку с известной
`sanitizerPolicyVersion` и перед `dangerouslySetInnerHTML` отклоняют любое иное
значение; непроверенный draft не попадает в public output.

## Модель хранения

### Контракты definitions

Зарегистрированный immutable `TemplatePackageVersion.manifest` остаётся
источником истины. При регистрации v2 сервер материализует поисковый индекс
контрактов `chunk_definition_contracts`:

- `package_id`, `definition_key`, `schema_version` — уникальная идентичность;
- `contract_digest` и canonical `field_descriptors` — неизменяемый контракт;
- `derived_schema_cache` — воспроизводимый сервером cache, а не авторитетный
  input; его digest сверяется с `field_descriptors` при чтении/регистрации;
- ссылка на первую зарегистрировавшую его package version;
- timestamps без пользовательского редактирования.

Повторная регистрация идентичного контракта идемпотентна. Та же идентичность с
другим digest завершает регистрацию конфликтом. Связь package version с
definitions хранит presentation metadata, category и renderer binding этой
сборки. Это позволяет менять визуал и подписи без копирования пользовательских
данных и без ложной новой версии контента.

### ChunkInstance

Новая site-scoped сущность `chunk_instances` содержит:

- стабильный UUID, `site_id` и пользовательское имя экземпляра;
- `package_id`, `definition_key`, `schema_version`, `contract_digest`;
- `source_package_version_id` как provenance версии, где instance был создан;
  это не привязывает контент к одной сборке, совместимость всё равно
  доказывается exact identity/digest текущего deployed package;
- nullable опубликованный `published_data` как материализованную проекцию;
- ссылку на источник legacy-миграции, если экземпляр создан из баннера;
- timestamps и признак архивирования без физического удаления истории.

Composite constraints не позволяют связать instance, media или placement с
другим сайтом. Экземпляр нельзя перевести на другую definition обновлением
строки. Переход на новую schema version создаёт новую draft revision через
явную операцию миграции данных; исходная опубликованная версия остаётся
рабочей до публикации результата.

### Ревизии и согласование

Новые экземпляры используют существующие `cms_revision_resources`,
`cms_revisions` и `cms_revision_events` с `resourceType = chunk`. Snapshot
содержит точную identity definition, `contractDigest`, policy versions и
payload. Публикация повторно валидирует всё сервером и в одной транзакции
переключает revision pointers и `chunk_instances.published_data`.

Размещения версионируются не отдельными строками, а целостным layout одной
поверхности:

- `page_chunk_layout` для конкретной страницы;
- `template_chunk_layout` для общей шаблонной поверхности сайта.

Snapshot layout — упорядоченный список `{slotKey, chunkInstanceId, position}`.
Публикация под блокировкой проверяет существование instance, тот же `site_id`,
allowedChunks, `maxItems`, уникальность позиции и совместимость с фактически
развёрнутым пакетом, затем атомарно заменяет materialized placements.

Версии самого чанка независимы от использующих его layouts. Публикация новых
данных экземпляра сразу делает их текущими для всех опубликованных placements,
не создавая новые версии страниц или шаблонов. Изменение размещения создаёт
версию только соответствующего layout.

### Materialized placements

`chunk_placements` содержит published-проекцию для быстрого public read:
`site_id`, `chunk_instance_id`, `slot_key`, `position` и ровно одну цель —
nullable `page_id` либо nullable `site_content_template_id`. DB `CHECK`
требует одну и только одну цель; composite foreign keys подтверждают один
сайт. Уникальные индексы защищают позицию внутри target/slot. Ограничения
manifest, включая `maxItems`, дополнительно проверяются сервисом в
транзакции, потому что они не являются статической DB-константой.

## Потоки данных

### Регистрация frontend-пакета

1. Release pipeline собирает код сайта и manifest v2 из одного Git tree.
2. CMS валидирует manifest, canonical digests и runtime bindings.
3. Контракты definitions материализуются только идемпотентно.
4. Preflight сравнивает кандидата со всеми опубликованными данными, drafts и
   layouts сайта.
5. Несовместимый кандидат регистрируется как диагностируемый результат по
   правилам реестра, но не может стать deployed/current.
6. Фактическую активацию кода выполняет отдельный deployment flow; content
   approval для неё не используется.

### Работа с контентом

1. Пользователь открывает категорию внутри раздела «Чанки» выбранного сайта.
2. CMS показывает только definitions текущего deployed package и строит форму
   из `fields`.
3. Создание/редактирование сохраняет новую draft revision, не меняя public.
4. Placement выбирается только из slots, где manifest разрешает эту точную
   identity definition.
5. Пользователь без требования согласования может опубликовать draft. Если на
   его site access установлен `requiresApproval`, он отправляет draft, а
   владелец сайта или Wispo admin согласует и публикует его.
6. Public read возвращает только published projections; preview может явно
   показать выбранный draft и новый renderer, не подменяя public.

Изменение frontend-визуала при той же schema identity не трогает drafts:
публичный сайт после deployment использует новый renderer с прежними
опубликованными данными, а preview draft — тот же renderer с draft snapshot.

## Совместимость package versions

Кандидат считается совместимым с сайтом, только если одновременно выполнено:

- присутствует каждая identity definition, используемая опубликованным
  instance или любым существующим draft;
- `contractDigest` каждой такой identity совпадает;
- существует runtime binding каждого `rendererKey` кандидата;
- каждый опубликованный и draft layout находит тот же target slot;
- slot разрешает назначенную identity, а новые `maxItems` и ограничения не
  нарушаются;
- текущая CMS/server HTML policy способна безопасно прочитать
  `sanitizerPolicyVersion` всех сохранённых `html` values; candidate package не
  владеет policy и может только сузить список built-in iframe providers;
- все media references остаются допустимыми для этого сайта.

Проверяются не только опубликованные значения: висящий неопубликованный draft
также блокирует удаление своей schema version. Это исключает потерю работы при
обновлении frontend-кода.

Breaking change создаёт новую identity, например `skinova-banner@2`.
`skinova-banner@1` и его renderer остаются в candidate package, пока на них
ссылаются published data, drafts или layouts. Чтобы добавить кнопку в ранее
существовавший баннер, агент/разработчик добавляет schema v2 и renderer,
контент-менеджер явно создаёт или мигрирует нужный instance в draft v2,
заполняет кнопку и публикует. Остальные instances продолжают работать на v1.
Автоматическое массовое преобразование не выполняется.

## Права и интерфейс

### Навигация

- Внутри сайта общий раздел «Чанки» содержит «Все чанки» и динамические
  категории из текущего manifest, отсортированные по `order` и названию.
- Skinova показывает «Баннеры» и сохраняет понятный клиенту сценарий работы.
- Категория фильтрует definitions/instances, но не выдаёт дополнительных прав.
- Пустая или неизвестная категория не открывает произвольные данные; UI
  возвращается к «Все чанки» и показывает безопасное состояние ошибки.
- Корневой технический раздел «Шаблоны и чанки» остаётся отдельным от
  контентной работы внутри сайта.

### Роли

- **Администратор Wispo** видит все сайты, пакеты, candidates/current версии,
  категории, definitions, schema identity/digest, instances, drafts,
  историю, согласование и placements. Он может выполнять все разрешённые CMS-
  операции, но не редактирует исходный код или manifest в CMS.
- **Владелец сайта** видит только свой сайт, его категории, instances,
  layouts и историю. Он редактирует/публикует собственный контент и
  согласовывает пользователей, для которых это требуется. Технический каталог
  contracts и кандидаты frontend-пакетов ему не выдаются.
- **Контент-менеджер** видит только назначенные сайты и редактируемые поля
  instances. Он может создавать экземпляры, назначать их только в объявленные
  slots и менять порядок, но не меняет page template, definition, renderer,
  schema или manifest. Способ публикации определяется `requiresApproval`.

Технические endpoints definitions/candidates отдельно проверяют роль на
сервере; скрытое меню не является защитой. Все site endpoints повторно
проверяют site membership и permission. Tenant ownership проверяется до
existence-sensitive ответа для instance, layout, package/version и каждой media
lookup, чтобы UUID другого сайта нельзя было использовать для перечисления.
Право менять `requiresApproval` остаётся только у администратора Wispo.

## Безопасный переход со Skinova-баннеров

Переход выполняется только новыми аддитивными TypeORM-миграциями,
зарегистрированными в `data-source.ts`. Применённые миграции не меняются.
Точные номера миграций выбираются после сверки актуальной ветки перед
реализацией.

### Этап A: контракт и пустая схема

- Валидатор начинает принимать v1 и v2; v1 продолжает работать без чанков.
- Добавляются новые таблицы contracts, instances, placements и provenance.
- Legacy-таблицы и API остаются источником текущего поведения.
- Новые таблицы не активируют произвольные поля и не меняют public output.

### Этап B: идемпотентный backfill и shadow-read

- Зарегистрированный Skinova manifest v2 объявляет banner definitions/slots.
- Каждому `banners.id` соответствует один site-scoped ChunkInstance; при
  возможности сохраняется тот же UUID, а provenance явно связывает обе строки.
- Все поля переносятся lossless, включая `null`/absent различия, media/mobile
  media, порядок и active state.
- `page_banner_assignments` копируются в placements с тем же site/page/zone и
  детерминированной позицией.
- Существующие `cms_revision_resources` типа `banner`, revisions и events не
  переписываются и не удаляются. Compatibility adapter показывает их как
  legacy-историю соответствующего instance и сохраняет текущие pointers,
  включая незавершённый draft или согласование.
- Повторный backfill является no-op для совпадающих source checksum и
  provenance. Отсутствующая/частичная связь достраивается; конфликт с уже
  изменённой target-строкой завершает миграцию ошибкой, а не перезаписывает её.
- Shadow-read сравнивает legacy и generic projection и пишет только безопасные
  метрики расхождения без содержимого пользовательских полей.

### Этап C: совместимые записи и переключение чтения

- Сначала разрешены только banner-compatible definitions и поля.
- Generic write в одной транзакции обновляет новый workflow и необходимую
  legacy-проекцию, чтобы старый код ещё мог обслуживать сайт.
- API/UI переключаются на generic read только после нулевого расхождения на
  отдельной копии БД и контролируемого локального smoke.
- Прямые legacy endpoints либо делегируют generic service, либо становятся
  read-only; двух независимых бизнес-логик записи не остаётся.

### Граница отката

До появления первого generic-only instance/field старую версию приложения
можно вернуть только по документированному сценарию, сохранив legacy dual-write
и не откатывая схему разрушительным `down()`. После включения поля, которое
старый `banners` не способен представить, rollback старого приложения становится
lossy и запрещается. Перед пересечением границы нужны:

1. проверенная резервная копия целевой БД и медиатеки;
2. rehearsal миграции и восстановления на отдельной БД;
3. подтверждённый новый read/write path и наблюдение shadow metrics;
4. явная запись в журнале и операционной документации.

После границы восстановление выполняется forward-fix новой версии либо
восстановлением проверенной резервной копии по отдельному плану. Legacy-таблицы
не удаляются в этом этапе; их очистка требует отдельной спецификации и срока
хранения.

## Ошибки, конкуренция и аудит

- Draft save использует optimistic revision pointer; устаревший клиент
  получает conflict и не затирает чужие изменения.
- Publish/layout replace выполняются в транзакции с блокировкой revision
  resource/target и повторной валидацией package identity.
- Удаление instance запрещено при published/draft placements; архивирование
  сохраняет историю.
- Недоступный media, definition или slot даёт доменную ошибку и не создаёт
  частичный draft/layout.
- Регистрация package, backfill и retry публикации идемпотентны по устойчивой
  identity; одинаковый retry не создаёт новую историю.
- Audit фиксирует actor, site, resource, operation, revision, definition
  identity и безопасную причину отказа. HTML, токены и полные payload в
  технический лог не выводятся.
- Public API не возвращает drafts, internal schema, source repository,
  candidates или данные другого сайта.

## Проверки безопасности и приёмки

### Manifest и compatibility

- v1 manifest продолжает регистрироваться и читаться без v2-таблиц в public
  контракте; корректный v2 регистрируется идемпотентно.
- неизвестные поля, duplicate identities, внешний `$ref`, функции, code-like
  значения, defaults и превышение любого complexity budget отклоняются;
- для одинаковых canonical `fields` сервер детерминированно строит одинаковую
  JSON Schema/validator; manifest с `dataSchema` как вторым input отклоняется.
- та же definition identity с другим digest отклоняется.
- отсутствующий renderer, slot, category или запрещённая slot assignment
  блокирует preflight.
- candidate без версии, используемой published или draft instance/layout,
  нельзя report-deployed.
- визуальное изменение с тем же контрактом проходит без новых CMS revisions.

### Tenant isolation и права

- UUID instance, media, page или template другого сайта не принимается даже
  при прямом API-запросе.
- content manager не получает technical definitions/candidates и не может
  изменить definition/schema/renderer/template.
- `requiresApproval=true` запрещает самостоятельный publish; `false` разрешает
  его при наличии permission.
- владелец видит и согласует только свой сайт; Wispo admin видит все сущности и
  версии.
- скрытие UI подтверждается отрицательными API-тестами, а не считается
  достаточным само по себе.

### HTML и медиа

- TinyMCE source сохраняет допустимую каноническую HTML-строку; sanitizer
  идемпотентен на create/update/import/restore/migration.
- `script`, `style`, `on*`, `srcdoc`, dangerous URL schemes, malformed markup,
  DOM clobbering, prototype pollution keys и обходы кодировкой отклоняются
  сервером; отдельные complexity tests проверяют ограничение CPU/памяти.
- iframe произвольного домена, HTTP, redirect/alias и лишние атрибуты
  отклоняются; iframe built-in provider из HTML source переписывается в
  канонический HTTPS `src` и server-generated safe attributes, оставаясь частью
  HTML-строки; manifest способен только сузить CMS provider allowlist.
- image принимает только image media того же сайта и требует корректную пару
  alt/decorative; сервер сверяет magic bytes с допустимым MIME, а активный SVG
  не пропускается как обычное безопасное изображение; mediaFile не доверяет
  имени/MIME/размеру клиента.
- public renderer не выводит unsanitized draft и проходит XSS regression в
  SSR и hydration.

### Workflow и миграция

- изменение одного переиспользуемого instance после публикации видно во всех
  его placements без revisions использующих страниц.
- изменение layout не создаёт новую revision данных instance.
- pending draft переживает регистрацию и deployment совместимого frontend-
  пакета.
- breaking v2 definition сосуществует с v1, пока v1 используется.
- backfill дважды даёт одинаковое состояние, сохраняет количества, IDs,
  nullability, assignments, revision pointers, actors и timestamps.
- shadow comparison подтверждает эквивалентный public/preview output Skinova;
  искусственный conflict останавливает backfill без перезаписи.
- интеграционные тесты выполняются только на disposable отдельной БД; общая
  рабочая БД, VDS и медиатека не используются.

### UI

- раздел «Чанки» строит категории из deployed manifest; Skinova показывает
  «Баннеры» и существующие экземпляры после backfill.
- формы всех widgets, nested group/repeater, image preview и mediaFile picker
  работают с keyboard navigation, labels и server errors.
- Wispo admin видит технический каталог и всю историю; владелец и content
  manager видят только разрешённый контентный уровень.
- loading/empty/error/stale site response не смешивают данные разных сайтов;
  длинные названия, 100 items одного repeater и суммарные 500 items instance не
  ломают desktop/mobile layout и не обходят complexity budgets.

## Фазы реализации

1. **Manifest v2 contract.** Типы, fail-closed validator, canonical digest,
   runtime-binding и compatibility tests без изменения поведения баннеров.
2. **Аддитивная модель.** Новые миграции contracts/instances/placements,
   generic revision types и repositories на отдельной БД.
3. **Skinova adapter.** Manifest categories/definitions/slots, идемпотентный
   backfill, legacy history adapter и shadow comparison.
4. **Generic API и формы.** Instance/layout workflow, универсальные widgets,
   self-hosted TinyMCE и server HTML policy; сначала banner-compatible mode.
5. **Переключение Skinova.** Generic read/write, dual-write rollback window,
   role/UI regression и локальный public/preview smoke.
6. **Расширение безопасных полей.** Только после фиксации rollback boundary
   разрешить generic-only definitions и новые категории.

Каждая фаза получает отдельный TDD-план, запись журнала, адресные проверки и
review. Ни одна фаза сама по себе не означает push, merge, deployment или
изменение общей БД. Реализация начинается только после отдельного утверждения
этой письменной спецификации и подробного implementation plan.
