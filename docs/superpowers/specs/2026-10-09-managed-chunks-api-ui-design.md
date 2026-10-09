# Managed Chunks API и UI для Skinova: дизайн Phase 4.1

## Цель

Дать пользователям CMS первый видимый generic-интерфейс управления чанками на
примере уже описанных в Skinova v2 баннеров. Этап читает и изменяет только
managed-модель, использует существующую версионность и согласование и не меняет
текущий публичный вывод Skinova.

## Границы MVP

В этап входят:

- site-scoped API каталога категорий и определений из зарегистрированного и
  доступного сайту manifest v2;
- список, карточка и создание managed chunk instances;
- сохранение draft, отправка на согласование, одобрение/отклонение и публикация
  через существующий revision workflow;
- раздел CMS «Чанки» с категорией «Баннеры» и формой, построенной по контракту;
- widgets, реально используемые Skinova v2: `text`, `textarea`, `image`,
  `number`, `boolean`;
- серверная contract-валидация, site-scoped media lookup и существующие правила
  ролей/`requiresApproval`;
- отображение статуса, опубликованной версии и незавершённого draft.

В этап не входят:

- переключение public/preview runtime на managed-модель;
- запись обратно в legacy `banners` и dual-write;
- редактирование layouts/placements и назначение чанка в slot;
- перенос legacy draft/history;
- `richText`, TinyMCE, HTML sanitizer, `mediaFile`, nested group/repeater;
- удаление или архивирование instance, пока не реализована безопасная проверка
  placements;
- применение backfill к рабочей, общей или VDS-базе.

## API

Все маршруты находятся под `/api/sites/:siteId/content/chunks` и используют
существующую проверку доступа к сайту.

1. `GET /catalog` возвращает только разрешённый пользовательский каталог:
   категории, определения, labels, widgets и constraints. Внутренние digest,
   repository, candidates и release metadata обычным пользователям не
   возвращаются.
2. `GET /instances` возвращает instances сайта с фильтром по категории и
   безопасным summary текущего workflow.
3. `GET /instances/:instanceId` возвращает display name, definition identity,
   published/draft data и допустимые действия текущего пользователя.
4. `POST /instances` создаёт site-scoped instance и его первый draft. Создание
   не означает размещение или публикацию.
5. `PUT /instances/:instanceId/draft` сохраняет новую immutable revision с
   optimistic expected revision и не меняет published pointer.
6. Существующие операции revision workflow используются для submit, approve,
   reject, publish и restore; новый controller не создаёт вторую реализацию
   согласования.

Ответы не раскрывают существование instance/media другого сайта. Любая
definition должна принадлежать доступной site package version и проходить
точную contract-проверку. `image` принимает `null` либо объект
`{ mediaId, alt, decorative }`; media обязана принадлежать тому же сайту и быть
изображением.

Проверка media повторяется внутри транзакции записи с блокировкой строки.
Удаление media блокируется, пока она используется активным managed draft или
published snapshot. Историческая неактивная revision без нормализованного
индекса ссылок не удерживает файл, но её восстановление повторно валидирует
media и безопасно отклоняется, если файл уже недоступен.

## Выбор каталога до переключения runtime

Site package identity уже известна через `sites.template_package_id`, но
`current_template_package_version_id` до следующей фазы остаётся на v1. Поэтому
Phase 4.1 не выбирает «последнюю» зарегистрированную версию и не показывает
произвольный release candidate.

Доступный сайту pre-activation catalog строится только из contracts, на которые
уже ссылаются managed revisions его собственных instances после контролируемого
backfill. Категории, labels и порядок берутся из manifest v2, впервые
зарегистрировавшего эти точные contract identities/digests. Все contracts должны
принадлежать package identity сайта; неоднозначные версии или digest mismatch
дают безопасную ошибку. Создавать новые instances можно только по definitions,
которые уже присутствуют в таком site catalog.

Это переходное правило позволяет показать и переиспользовать три backfilled
типа Skinova без нового pointer в БД и без автоматической активации любого
будущего v3. Отдельный managed package activation pointer, если он понадобится
другим сайтам до backfill, проектируется новой фазой и новой миграцией.

## Права и согласование

- Администратор Wispo видит и изменяет chunks всех доступных сайтов.
- Владелец сайта и контент-менеджер работают только в назначенном сайте.
- Публикация следует существующему site-scoped permission и
  `requiresApproval`; новый особый флаг для чанков не добавляется.
- Технические manifest/release данные и изменение definition/schema через CMS
  недоступны всем ролям.

## Интерфейс

В меню сайта появляется раздел «Чанки». Его содержимое строится из catalog API:
для Skinova показывается категория «Баннеры». Список содержит название,
тип, статус и дату изменения. Создание и редактирование открывают одну форму,
построенную из ordered fields контракта.

Форма поддерживает текстовые поля, textarea, выбор изображения с preview,
число с min/max/step и boolean-переключатель. Она отдельно показывает
опубликованное состояние и текущий draft, не выдаёт сохранение draft за
публикацию и выводит только допустимые текущему пользователю действия.
Несохранённые значения блокируют workflow и защищены общим предупреждением при
закрытии или навигации. Модальный редактор управляет фокусом, удерживает его
внутри диалога и возвращает на исходный элемент после закрытия.

Полный редизайн CMS не выполняется: используются существующие размеры,
типографика, формы, таблицы и модальные паттерны. Полная responsive/visual
матрица остаётся в post-MVP проверках; критично проверить рабочий desktop flow,
empty/error/loading и отсутствие смешивания сайтов.

## Данные и совместимость

Новая миграция не ожидается: используются существующие managed tables и
snapshot format v1. Если реализация выявит необходимость менять схему или
persisted format, этап останавливается и возвращается на отдельное согласование.

Публичный сайт и legacy banner endpoints продолжают работать как раньше.
Поэтому опубликованное через новый интерфейс managed-состояние в этой фазе ещё
не обязано появляться на публичной Skinova. Следующая отдельная фаза добавит
совместимую запись/переключение чтения и зафиксирует rollback boundary.

## Ошибки и критичные проверки

- неизвестные category/definition/field и недоступный package отклоняются;
- UUID другого сайта для instance/media не раскрывает данные и не записывается;
- stale draft даёт conflict и не затирает новую revision;
- invalid widget payload не создаёт revision/event/pointer;
- `requiresApproval=true` не допускает самостоятельную публикацию;
- backfilled Skinova instances читаются без преобразования значений;
- UI строит поля по контракту, сохраняет draft и корректно показывает workflow;
- существующие legacy endpoints и public output не меняются.

Критичный MVP покрывается focused unit/API tests, production build и одним
локальным browser smoke. Полный E2E, large catalog, mobile/pixel-perfect,
performance и расширенная security matrix записываются для отдельной проверки.
