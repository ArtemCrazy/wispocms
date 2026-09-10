import { MigrationInterface, QueryRunner } from 'typeorm';

const OWNER = '1789848000000-skinova-media-v1';
const WORKSPACE = {
  id: '51a00000-0000-4000-8000-000000000001',
  name: 'Luminava',
  slug: 'luminava',
} as const;
const SITE = {
  id: '51a00000-0000-4000-8000-000000000002',
  name: 'Skinova',
  slug: 'skinova',
} as const;
const PRIVACY_STATE_ID = '51a40000-0000-4000-8000-000000000006';

const PRIVACY_DOCUMENT = [
  '# Политика конфиденциальности',
  'Настоящая Политика объясняет, какие сведения могут обрабатываться при использовании сайта Skinova, для чего они нужны и как пользователь может распорядиться своими данными.',
  'Последнее обновление: 7 сентября 2026 года.',
  '> Используя сайт или отправляя данные через его формы, пользователь подтверждает, что ознакомился с настоящей Политикой. Если условия не подходят, следует прекратить использование сайта и не отправлять персональные данные.',
  '## 1. Общие положения',
  'Администрация сайта Skinova уважает право пользователей на конфиденциальность и обрабатывает персональные данные только в объёме, необходимом для работы сайта, ответа на обращения и улучшения качества материалов.',
  'Политика применяется ко всей информации, которую сайт может получить во время его использования. Она не регулирует работу сторонних ресурсов, на которые пользователь может перейти по внешним ссылкам.',
  '## 2. Какие данные мы обрабатываем',
  'В зависимости от способа взаимодействия с сайтом могут обрабатываться:',
  '- имя и номер телефона, которые пользователь самостоятельно указывает в форме;',
  '- содержание обращения и иные сведения, добровольно сообщённые пользователем;',
  '- технические данные: IP-адрес, тип устройства и браузера, язык, дата и время посещения, адреса просмотренных страниц;',
  '- файлы cookie и обезличенные сведения о действиях на сайте.',
  'Сайт не предназначен для сбора специальных категорий персональных данных, сведений о банковских картах или документов, удостоверяющих личность.',
  '## 3. Цели обработки',
  'Данные могут использоваться для следующих целей:',
  '- обработка обращений и обратная связь с пользователем;',
  '- организация консультации и уточнение удобного времени связи;',
  '- обеспечение стабильной и безопасной работы сайта;',
  '- анализ востребованности материалов и улучшение структуры сайта;',
  '- выполнение требований применимого законодательства.',
  '## 4. Правовые основания',
  'Администрация обрабатывает данные с согласия пользователя, выраженного при заполнении и отправке формы, а также в случаях, когда обработка необходима для ответа на обращение, исполнения соглашения с пользователем или соблюдения требований закона.',
  'Пользователь предоставляет достоверные сведения добровольно и подтверждает, что вправе распоряжаться ими.',
  '## 5. Порядок и сроки обработки',
  'Обработка может выполняться с использованием средств автоматизации и без них. Данные хранятся не дольше, чем это необходимо для заявленных целей, если более длительный срок не предусмотрен законом.',
  'После достижения целей обработки, отзыва согласия или получения обоснованного требования пользователя данные удаляются либо обезличиваются, если отсутствуют законные основания продолжить их хранение.',
  '## 6. Передача третьим лицам',
  'Администрация не продаёт персональные данные. Информация может передаваться подрядчикам, которые обеспечивают хостинг, аналитику, связь и техническую поддержку, только в объёме, необходимом для оказания соответствующих услуг.',
  'Передача также возможна по законному запросу государственных органов либо с отдельного согласия пользователя. Получатели обязаны соблюдать конфиденциальность и использовать данные только для согласованных целей.',
  '## 7. Файлы cookie и аналитика',
  'Cookie помогают запоминать настройки, поддерживать корректную работу интерфейса и получать обезличенную статистику посещений. Пользователь может ограничить или отключить cookie в настройках браузера.',
  'Отключение отдельных cookie может повлиять на работу некоторых функций сайта, но не лишает пользователя доступа к основным информационным материалам.',
  '## 8. Права пользователя',
  'Пользователь вправе:',
  '- получить информацию об обработке своих персональных данных;',
  '- потребовать уточнения, ограничения обработки или удаления данных;',
  '- отозвать ранее предоставленное согласие;',
  '- возразить против обработки в случаях, предусмотренных законом;',
  '- обратиться в уполномоченный орган или суд для защиты своих прав.',
  '## 9. Защита информации',
  'Администрация применяет разумные организационные и технические меры для защиты данных от неправомерного доступа, изменения, раскрытия, блокирования, копирования и уничтожения.',
  'При этом передача информации через интернет не может быть абсолютно безопасной. Пользователю следует самостоятельно заботиться о безопасности своего устройства и не передавать конфиденциальные сведения через незащищённые каналы.',
  '## 10. Изменение Политики',
  'Администрация вправе обновлять Политику при изменении сайта, используемых сервисов или требований законодательства. Новая редакция вступает в силу с момента публикации на этой странице, если в ней не указано иное.',
  'Актуальная дата редакции указана в начале документа. Рекомендуем периодически проверять эту страницу.',
  '## 11. Контакты',
  'Вопросы об обработке персональных данных, запросы на уточнение или удаление информации можно направить Администрации сайта через форму обратной связи. Для выполнения запроса может потребоваться подтверждение, позволяющее идентифицировать заявителя.',
  '> Остались вопросы? Оставьте контактные данные — администратор свяжется с вами и подскажет, как направить обращение.',
].join('\n\n');

const roots = [
  ['51a10000-0000-4000-8000-000000000001', 'Кожа', 'kozha', 'droplet'],
  ['51a10000-0000-4000-8000-000000000002', 'Уход', 'ukhod', 'bottle'],
  [
    '51a10000-0000-4000-8000-000000000003',
    'Косметология',
    'kosmetologiya',
    'dropper',
  ],
  [
    '51a10000-0000-4000-8000-000000000004',
    'Эстетическая медицина',
    'esteticheskaya-meditsina',
    'lotus',
  ],
  [
    '51a10000-0000-4000-8000-000000000005',
    'Препараты и ингредиенты',
    'preparaty-i-ingredienty',
    'flask',
  ],
  [
    '51a10000-0000-4000-8000-000000000006',
    'Мифы и разборы',
    'mify-i-razbory',
    'myth-analysis',
  ],
] as const;

const children = [
  [
    '51a20000-0000-4000-8000-000000000001',
    'Проблемы кожи',
    'problemy-kozhi',
    roots[0][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000002',
    'Состояния',
    'sostoyaniya',
    roots[0][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000003',
    'Заболевания',
    'zabolevaniya',
    roots[0][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000004',
    'Возрастные изменения',
    'vozrastnye-izmeneniya',
    roots[0][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000005',
    'Особенности кожи',
    'osobennosti-kozhi',
    roots[0][0],
  ],
  ['51a20000-0000-4000-8000-000000000006', 'Кремы', 'kremy', roots[1][0]],
  [
    '51a20000-0000-4000-8000-000000000007',
    'Сыворотки',
    'syvorotki',
    roots[1][0],
  ],
  ['51a20000-0000-4000-8000-000000000008', 'SPF', 'spf', roots[1][0]],
  [
    '51a20000-0000-4000-8000-000000000009',
    'Домашний уход',
    'domashniy-ukhod',
    roots[1][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000010',
    'Процедуры',
    'protsedury',
    roots[2][0],
  ],
  ['51a20000-0000-4000-8000-000000000011', 'Аппараты', 'apparaty', roots[2][0]],
  ['51a20000-0000-4000-8000-000000000012', 'Инъекции', 'inektsii', roots[2][0]],
  ['51a20000-0000-4000-8000-000000000013', 'Лазеры', 'lazery', roots[2][0]],
  [
    '51a20000-0000-4000-8000-000000000014',
    'Омоложение',
    'omolozhenie',
    roots[3][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000015',
    'Эстетические методики',
    'esteticheskie-metodiki',
    roots[3][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000016',
    'Ретиноиды',
    'retinoidy',
    roots[4][0],
  ],
  ['51a20000-0000-4000-8000-000000000017', 'Кислоты', 'kisloty', roots[4][0]],
  ['51a20000-0000-4000-8000-000000000018', 'Пептиды', 'peptidy', roots[4][0]],
  [
    '51a20000-0000-4000-8000-000000000019',
    'Правда или миф',
    'pravda-ili-mif',
    roots[5][0],
  ],
  [
    '51a20000-0000-4000-8000-000000000020',
    'Сравнение методов',
    'sravnenie-metodov',
    roots[5][0],
  ],
] as const;

const articles = [
  {
    id: '51a30000-0000-4000-8000-000000000001',
    categoryId: children[9][0],
    slug: 'biorevitalizatsiya',
    title: 'Биоревитализация: что это за процедура и кому она подходит',
    excerpt:
      'Разбираемся, как работает биоревитализация, какие бывают препараты, кому показана процедура и каких результатов можно ожидать.',
    date: '2026-05-15T09:00:00.000Z',
    image: 'hero-bioprevitalization.webp',
    read: 7,
    views: '12 842',
    tags: ['процедуры', 'инъекции', 'омоложение'],
  },
  [
    '51a30000-0000-4000-8000-000000000002',
    children[8][0],
    'ukhod-posle-pilinga',
    'Как правильно ухаживать за кожей после пилинга',
    'Пошаговый план восстановления кожи после процедуры.',
    '2026-05-14T09:00:00.000Z',
    'article-skincare.webp',
    5,
    '8 432',
    ['кремы', 'домашний уход', 'проблемы кожи'],
  ],
  [
    '51a30000-0000-4000-8000-000000000003',
    children[0][0],
    'pigmentatsiya',
    'Пигментация: почему появляется и как с ней справиться',
    'Причины пигментации и современные способы коррекции.',
    '2026-05-13T09:00:00.000Z',
    'article-pigmentation.webp',
    6,
    '6 201',
    ['состояния', 'проблемы кожи'],
  ],
  [
    '51a30000-0000-4000-8000-000000000004',
    children[15][0],
    'retinoidy-v-ukhode',
    'Ретиноиды в уходе: как работают и кому подходят',
    'Спокойный гид по ретиноидам и безопасному введению в уход.',
    '2026-05-11T09:00:00.000Z',
    'article-retinoids.webp',
    4,
    '5 764',
    ['ретиноиды', 'уход'],
  ],
  [
    '51a30000-0000-4000-8000-000000000005',
    children[12][0],
    'lazernoe-omolozhenie',
    'Лазерное омоложение лица: виды процедур и эффект',
    'Разбираем виды лазерных процедур и ожидаемый эффект.',
    '2026-05-09T09:00:00.000Z',
    'article-laser.webp',
    6,
    '4 912',
    ['лазеры', 'аппараты', 'омоложение'],
  ],
  [
    '51a30000-0000-4000-8000-000000000006',
    children[1][0],
    'zashchitnyy-barer-kozhi',
    'Как восстановить защитный барьер кожи',
    'Признаки повреждённого барьера и бережный план восстановления.',
    '2026-05-07T09:00:00.000Z',
    'article-pigmentation.webp',
    8,
    '4 380',
    ['состояния', 'проблемы кожи'],
  ],
  [
    '51a30000-0000-4000-8000-000000000007',
    children[6][0],
    'syvorotki-i-aktivy',
    'Сыворотки: как выбрать активы под задачу',
    'Как подобрать активы под потребности кожи и не перегрузить уход.',
    '2026-05-05T09:00:00.000Z',
    'article-skincare.webp',
    7,
    '3 916',
    ['сыворотки', 'домашний уход'],
  ],
  [
    '51a30000-0000-4000-8000-000000000008',
    children[17][0],
    'peptidy-v-kosmetike',
    'Пептиды в косметике: ожидания и факты',
    'Что умеют пептиды и где маркетинговые обещания опережают данные.',
    '2026-05-02T09:00:00.000Z',
    'article-retinoids.webp',
    6,
    '3 402',
    ['пептиды', 'миф'],
  ],
  [
    '51a30000-0000-4000-8000-000000000009',
    children[10][0],
    'apparatnye-protsedury',
    'Аппаратные процедуры: спокойный гид',
    'Основные технологии, показания и вопросы перед консультацией.',
    '2026-04-29T09:00:00.000Z',
    'article-laser.webp',
    9,
    '3 104',
    ['аппараты', 'процедуры'],
  ],
  [
    '51a30000-0000-4000-8000-000000000010',
    children[16][0],
    'kisloty-vesnoy',
    'Кислоты весной: как избежать раздражения',
    'Как скорректировать уход с кислотами в период активного солнца.',
    '2026-04-26T09:00:00.000Z',
    'article-skincare.webp',
    5,
    '2 988',
    ['кислоты', 'проблемы кожи'],
  ],
  [
    '51a30000-0000-4000-8000-000000000011',
    children[3][0],
    'vozrastnye-izmeneniya',
    'Возрастные изменения: что действительно работает',
    'Методы с доказанной эффективностью и реалистичные ожидания.',
    '2026-04-23T09:00:00.000Z',
    'hero-bioprevitalization.webp',
    10,
    '2 715',
    ['возрастные изменения', 'омоложение'],
  ],
  [
    '51a30000-0000-4000-8000-000000000012',
    children[7][0],
    'spf-v-gorode',
    'SPF в городе: пять устойчивых мифов',
    'Отвечаем на частые вопросы о ежедневной защите от солнца.',
    '2026-04-20T09:00:00.000Z',
    'article-pigmentation.webp',
    6,
    '2 509',
    ['SPF', 'миф'],
  ],
  [
    '51a30000-0000-4000-8000-000000000013',
    children[19][0],
    'inektsii-i-apparaty',
    'Инъекции и аппараты: как сравнивать методы',
    'Критерии честного сравнения методик эстетической медицины.',
    '2026-04-17T09:00:00.000Z',
    'article-laser.webp',
    11,
    '2 184',
    ['сравнение', 'инъекции', 'аппараты'],
  ],
] as const;

type ArticleSeed = {
  id: string;
  categoryId: string;
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  image: string;
  read: number;
  views: string;
  tags: readonly string[];
};

function articleSeed(value: (typeof articles)[number]): ArticleSeed {
  if (!Array.isArray(value)) return value as ArticleSeed;
  const tuple = value as unknown as readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    readonly string[],
  ];
  const [id, categoryId, slug, title, excerpt, date, image, read, views, tags] =
    tuple;
  return {
    id,
    categoryId,
    slug,
    title,
    excerpt,
    date,
    image,
    read,
    views,
    tags,
  };
}

export class ImportSkinovaMediaSite1789848000000 implements MigrationInterface {
  name = 'ImportSkinovaMediaSite1789848000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const workspaceConflict = (await queryRunner.query(
      `SELECT "id", "name", "slug" FROM "workspaces" WHERE "id" = $1 OR "slug" = $2 FOR UPDATE`,
      [WORKSPACE.id, WORKSPACE.slug],
    )) as Array<{ id: string; name: string; slug: string }>;
    if (workspaceConflict.length) {
      const workspace = workspaceConflict[0];
      if (
        workspaceConflict.length !== 1 ||
        workspace.id !== WORKSPACE.id ||
        workspace.name !== WORKSPACE.name ||
        workspace.slug !== WORKSPACE.slug
      )
        throw new Error(
          'Cannot import Skinova: workspace identity conflicts with existing data',
        );
    } else {
      await queryRunner.query(
        `INSERT INTO "workspaces" ("id", "name", "slug") VALUES ($1, $2, $3)`,
        [WORKSPACE.id, WORKSPACE.name, WORKSPACE.slug],
      );
    }

    const siteConflict = (await queryRunner.query(
      `SELECT "id", "workspace_id", "name", "slug", "site_type", "global_data" #>> '{__provisioning,owner}' AS "owner" FROM "sites" WHERE "id" = $1 OR "slug" = $2 FOR UPDATE`,
      [SITE.id, SITE.slug],
    )) as Array<{
      id: string;
      workspace_id: string;
      name: string;
      slug: string;
      site_type: string;
      owner: string | null;
    }>;
    if (siteConflict.length) {
      const site = siteConflict[0];
      if (
        siteConflict.length !== 1 ||
        site.id !== SITE.id ||
        site.workspace_id !== WORKSPACE.id ||
        site.name !== SITE.name ||
        site.slug !== SITE.slug ||
        site.site_type !== 'media' ||
        site.owner !== OWNER
      )
        throw new Error(
          'Cannot import Skinova: site slug or identity conflicts with existing data',
        );
      return;
    }

    const legalModels = (await queryRunner.query(
      `SELECT "id", "version" FROM "privacy_legal_models"
       ORDER BY ("status" = 'approved') DESC,
         "approved_at" DESC NULLS LAST, "created_at" DESC
       LIMIT 1`,
    )) as Array<{ id: string; version: string }>;
    if (!legalModels[0])
      throw new Error('Cannot import Skinova: privacy legal model is missing');

    await queryRunner.query(
      `INSERT INTO "workspace_memberships" ("user_id", "workspace_id", "role")
       SELECT "id", $1, 'employee' FROM "users" WHERE "platform_role" = 'wispo_admin'
       ON CONFLICT ("user_id", "workspace_id") DO NOTHING`,
      [WORKSPACE.id],
    );
    await queryRunner.query(
      `INSERT INTO "sites" ("id", "workspace_id", "created_by_user_id", "name", "slug", "domain", "site_type", "seo_title", "seo_description", "no_index", "global_data", "layout_settings", "is_active")
       VALUES ($1, $2, (SELECT "id" FROM "users" WHERE "platform_role" = 'wispo_admin' ORDER BY "created_at" LIMIT 1), $3, $4, NULL, 'media', $5, $6, true, $7::jsonb, $8::jsonb, true)`,
      [
        SITE.id,
        WORKSPACE.id,
        SITE.name,
        SITE.slug,
        'Skinova — о коже и современной косметологии',
        'Доказательные материалы о коже, уходе, косметологии и эстетической медицине.',
        JSON.stringify({
          companyName: 'Skinova',
          __provisioning: { owner: OWNER },
        }),
        JSON.stringify({
          logoText: 'Skinova',
          showPages: true,
          showArticles: true,
          ctaLabel: 'Записаться',
          ctaUrl: '#consultation',
          footerDescription:
            'Разбираем проблемы кожи, косметические средства, процедуры и эстетическую медицину.',
          showContacts: false,
          showSocials: true,
          headerTemplateKey: 'skinova-header',
          headerTemplateVersion: '1',
          headerTemplateConfig: {},
          footerTemplateKey: 'skinova-footer',
          footerTemplateVersion: '1',
          footerTemplateConfig: {},
        }),
      ],
    );

    const pages = [
      [
        '51a40000-0000-4000-8000-000000000001',
        'Главная',
        '',
        'homepage',
        false,
        'skinova-home',
        [
          {
            id: 'skinova-home-hero',
            type: 'hero',
            title: 'Биоревитализация: что это за процедура и кому она подходит',
            text: 'Разбираемся, как работает биоревитализация, какие бывают препараты, кому показана процедура и каких результатов можно ожидать.',
            buttonLabel: 'Читать статью',
            buttonUrl: '/articles/biorevitalizatsiya',
          },
        ],
      ],
      [
        '51a40000-0000-4000-8000-000000000002',
        'Политика конфиденциальности',
        'privacy-policy',
        'page',
        false,
        null,
        [
          {
            id: 'skinova-privacy',
            type: 'text',
            title: 'Политика конфиденциальности',
            text: PRIVACY_DOCUMENT,
          },
        ],
      ],
      [
        '51a40000-0000-4000-8000-000000000003',
        'Страница 404',
        '404',
        'page',
        true,
        'skinova',
        [
          {
            id: 'skinova-404',
            type: 'hero',
            title: 'Страница не найдена',
            text: 'Похоже, такой страницы больше нет или адрес введён неверно.',
            buttonLabel: 'Вернуться на главную',
            buttonUrl: '/',
          },
        ],
      ],
      [
        '51a40000-0000-4000-8000-000000000004',
        'Спасибо',
        'thank-you',
        'page',
        true,
        null,
        [
          {
            id: 'skinova-thank-you',
            type: 'hero',
            title: 'Спасибо за обращение',
            text: 'Мы получили ваши контакты и свяжемся с вами.',
            buttonLabel: 'На главную',
            buttonUrl: '/',
          },
        ],
      ],
      [
        '51a40000-0000-4000-8000-000000000005',
        'Форма захвата',
        'capture-form',
        'page',
        true,
        null,
        [
          {
            id: 'skinova-capture',
            type: 'cta',
            title: 'Записаться к косметологу',
            text: 'Оставьте контакты — администратор свяжется с вами и подберёт удобное время.',
            buttonLabel: 'Открыть форму',
            buttonUrl: '/#consultation',
          },
        ],
      ],
    ] as const;
    for (const [id, title, slug, kind, noIndex, template, blocks] of pages) {
      await queryRunner.query(
        `INSERT INTO "pages" ("id", "site_id", "title", "slug", "kind", "status", "blocks", "seo_title", "seo_description", "no_index", "system_template_key", "system_template_version", "published_system_template_key", "published_system_template_version")
         VALUES ($1, $2, $3, $4, $5, 'published', $6::jsonb, $7, $8, $9, $10::varchar, CASE WHEN $10::varchar IS NULL THEN NULL ELSE '1' END, $10::varchar, CASE WHEN $10::varchar IS NULL THEN NULL ELSE '1' END)`,
        [
          id,
          SITE.id,
          slug === ''
            ? 'Skinova — о коже, косметологии и эстетической медицине'
            : title,
          slug,
          kind,
          JSON.stringify(blocks),
          title,
          slug === 'privacy-policy'
            ? 'Как Skinova получает, использует и защищает данные пользователей консультационной формы.'
            : blocks[0]?.text?.slice(0, 480) || null,
          noIndex,
          template,
        ],
      );
    }
    await queryRunner.query(
      `INSERT INTO "privacy_policy_states" (
        "id", "site_id", "page_id", "legal_model_id", "settings",
        "display_template_key", "display_template_version",
        "display_template_config", "manual_snapshot", "published_snapshot",
        "published_at", "published_legal_model_version",
        "published_display_template_key", "published_display_template_version",
        "published_display_template_config", "mode", "legacy_content_preserved"
      ) VALUES ($1, $2, $3, $4, '{}'::jsonb, 'system-policy', '1',
        '{}'::jsonb, $5, $5, now(), $6, 'system-policy', '1', '{}'::jsonb,
        'manual', true)`,
      [
        PRIVACY_STATE_ID,
        SITE.id,
        pages[1][0],
        legalModels[0].id,
        PRIVACY_DOCUMENT,
        legalModels[0].version,
      ],
    );

    let order = 0;
    for (const [id, name, slug, categoryIcon] of roots) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "site_id", "name", "slug", "description", "status", "publication_state", "display_template_key", "display_template_version", "display_template_config", "published_at", "sort_order", "parent_id", "color", "icon") VALUES ($1, $2, $3, $4, $5, 'active', 'published', 'skinova-category', '1', '{}'::jsonb, now(), $6, NULL, '#b86252', $7)`,
        [
          id,
          SITE.id,
          name,
          slug,
          `Материалы Skinova: ${name.toLocaleLowerCase('ru-RU')}.`,
          order++,
          categoryIcon,
        ],
      );
    }
    for (const [id, name, slug, parentId] of children) {
      await queryRunner.query(
        `INSERT INTO "categories" ("id", "site_id", "name", "slug", "description", "status", "publication_state", "display_template_key", "display_template_version", "display_template_config", "published_at", "sort_order", "parent_id", "color") VALUES ($1, $2, $3, $4, $5, 'active', 'published', 'skinova-category', '1', '{}'::jsonb, now(), $6, $7, '#b86252')`,
        [
          id,
          SITE.id,
          name,
          slug,
          `Статьи и рекомендации по теме «${name}».`,
          order++,
          parentId,
        ],
      );
    }

    const authorId = '51a50000-0000-4000-8000-000000000001';
    await queryRunner.query(
      `INSERT INTO "authors" ("id", "site_id", "full_name", "bio") VALUES ($1, $2, 'Мария Васильевна', 'Врач-косметолог, эксперт Skinova')`,
      [authorId, SITE.id],
    );
    for (const [index, rawArticle] of articles.entries()) {
      const article = articleSeed(rawArticle);
      const body =
        article.slug === 'biorevitalizatsiya'
          ? 'Биоревитализация — инъекционная процедура, направленная на увлажнение кожи и улучшение её качества. Решение о процедуре принимают после очной консультации.\n\nСпециалист оценивает состояние кожи, собирает анамнез и подбирает препарат и схему введения.\n\nПосле процедуры важно соблюдать рекомендации врача и использовать мягкий домашний уход.'
          : `${article.excerpt}\n\nМатериал подготовлен редакцией Skinova вместе с врачом-косметологом. Индивидуальные рекомендации можно получить только после очной консультации.`;
      const document =
        article.slug === 'biorevitalizatsiya'
          ? {
              version: 1,
              blocks: [
                {
                  id: 'what-is',
                  type: 'heading',
                  level: 2,
                  text: 'Что такое биоревитализация',
                },
                {
                  id: 'what-is-text',
                  type: 'paragraph',
                  text: 'Биоревитализация — инъекционная процедура, направленная на увлажнение кожи и улучшение её качества. Для неё используют препараты на основе гиалуроновой кислоты.',
                },
                {
                  id: 'who-needs',
                  type: 'heading',
                  level: 2,
                  text: 'Кому подходит процедура',
                },
                {
                  id: 'who-needs-list',
                  type: 'bullet_list',
                  items: [
                    'При ощущении сухости и стянутости кожи',
                    'При снижении тонуса и появлении мелких морщин',
                    'В период восстановления после интенсивного солнца',
                  ],
                },
                {
                  id: 'procedure',
                  type: 'heading',
                  level: 2,
                  text: 'Как проходит процедура',
                },
                {
                  id: 'procedure-text',
                  type: 'paragraph',
                  text: 'Врач собирает анамнез, осматривает кожу, обсуждает ожидания и только затем подбирает препарат и схему введения.',
                },
                {
                  id: 'expert-opinion',
                  type: 'quote',
                  text: 'Задача консультации — оценить показания и противопоказания, а не назначить процедуру по фотографии.',
                  cite: 'Мария Васильевна, врач-косметолог',
                },
                {
                  id: 'aftercare',
                  type: 'heading',
                  level: 2,
                  text: 'Уход после процедуры',
                },
                {
                  id: 'aftercare-list',
                  type: 'numbered_list',
                  items: [
                    'Не трогать места инъекций без необходимости',
                    'Временно отказаться от интенсивного спорта, сауны и бассейна',
                    'Использовать назначенный врачом мягкий уход и SPF',
                  ],
                },
              ],
            }
          : {
              version: 1,
              blocks: [
                {
                  id: `${article.slug}-intro`,
                  type: 'paragraph',
                  text: article.excerpt,
                },
                {
                  id: `${article.slug}-details`,
                  type: 'heading',
                  level: 2,
                  text: 'Что важно знать',
                },
                {
                  id: `${article.slug}-body`,
                  type: 'paragraph',
                  text: 'Подход к уходу и процедурам зависит от состояния кожи. Оценить его и подобрать безопасную схему может специалист на очной консультации.',
                },
              ],
            };
      await queryRunner.query(
        `INSERT INTO "articles" ("id", "site_id", "category_id", "author_id", "title", "slug", "excerpt", "body", "body_document", "document_version", "seo_title", "seo_description", "no_index", "status", "publication_state", "editorial_state", "display_template_key", "display_template_version", "display_template_config", "published_at", "sort_order") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 1, $5, $7, false, 'published', 'published', 'approved', 'skinova-article', '1', $10::jsonb, $11, $12)`,
        [
          article.id,
          SITE.id,
          article.categoryId,
          authorId,
          article.title,
          article.slug,
          article.excerpt,
          body,
          JSON.stringify(document),
          JSON.stringify({
            imageAsset: article.image,
            readMinutes: article.read,
            views: article.views,
            tags: article.tags,
            dateLabel: article.date,
          }),
          article.date,
          index,
        ],
      );
    }

    const templates = [
      ['articles_list', 'skinova-editorial', 'Лента Skinova'],
      ['article', 'skinova-article', 'Статья Skinova'],
      ['category', 'skinova-category', 'Рубрика Skinova'],
      ['header', 'skinova-header', 'Шапка Skinova'],
      ['footer', 'skinova-footer', 'Подвал Skinova'],
    ] as const;
    for (const [kind, key, name] of templates) {
      await queryRunner.query(
        `INSERT INTO "site_content_templates" ("site_id", "kind", "key", "version", "name", "config") VALUES ($1, $2, $3, '1', $4, '{}'::jsonb)`,
        [SITE.id, kind, key, name],
      );
    }
    await queryRunner.query(
      `INSERT INTO "article_section_settings" ("site_id", "list_template_key", "list_template_version", "list_template_config") VALUES ($1, 'skinova-editorial', '1', '{}'::jsonb)`,
      [SITE.id],
    );

    const banners = [
      [
        '51a60000-0000-4000-8000-000000000001',
        'Промо Skinova',
        'Бесплатная консультация косметолога',
        'Фотодинамическая терапия Heleo4 за 0 ₽',
        'Записаться',
        null,
      ],
      [
        '51a60000-0000-4000-8000-000000000002',
        'Консультация косметолога',
        'Консультация косметолога',
        'Разберитесь, какие процедуры подходят именно вашей коже. Подберём индивидуальный план на консультации.',
        'Записаться на консультацию',
        null,
      ],
      [
        '51a60000-0000-4000-8000-000000000003',
        'Баннер статьи Skinova',
        'Подберём препарат и схему процедуры после консультации специалиста',
        'Есть противопоказания. Необходима консультация специалиста.',
        'Записаться',
        'article_sidebar',
      ],
    ] as const;
    for (const [id, name, title, subtitle, button, placement] of banners) {
      await queryRunner.query(
        `INSERT INTO "banners" ("id", "site_id", "name", "placement", "title", "subtitle", "button_text", "link_url", "sort_order", "is_active") VALUES ($1, $2, $3, $4, $5, $6, $7, '#consultation', 0, true)`,
        [id, SITE.id, name, placement, title, subtitle, button],
      );
    }
    await queryRunner.query(
      `INSERT INTO "page_banner_assignments" ("site_id", "page_id", "banner_id", "zone") VALUES
        ($1, $2, $5, 'homepage_top'),
        ($1, $2, $6, 'homepage_middle'),
        ($1, $3, $5, 'homepage_top'),
        ($1, $4, $5, 'homepage_top')`,
      [
        SITE.id,
        pages[0][0],
        pages[1][0],
        pages[2][0],
        banners[0][0],
        banners[1][0],
      ],
    );
    await queryRunner.query(
      `INSERT INTO "site_variables" ("site_id", "name", "identifier", "value") VALUES ($1, 'Название проекта', 'clinic_name', 'Skinova'), ($1, 'Предложение консультации', 'consultation_offer', 'Бесплатная консультация косметолога')`,
      [SITE.id],
    );
    await queryRunner.query(
      `INSERT INTO "site_search_settings" ("site_id", "searchable_sections", "popular_queries", "recommended_queries") VALUES ($1, '["articles","categories","pages"]'::jsonb, $2::jsonb, $3::jsonb)`,
      [
        SITE.id,
        JSON.stringify([
          { query: 'уход за кожей', label: 'Уход за кожей' },
          { query: 'биоревитализация', label: 'Биоревитализация' },
        ]),
        JSON.stringify([
          { query: 'SPF', label: 'Как выбрать SPF' },
          { query: 'ретиноиды', label: 'Материалы о ретиноидах' },
        ]),
      ],
    );
    await queryRunner.query(
      `INSERT INTO "page_activities" ("site_id", "page_id", "user_id", "action", "description", "changes") SELECT $1, "id", NULL, 'imported', 'Страница импортирована из утверждённого проекта Skinova', $2::jsonb FROM "pages" WHERE "site_id" = $1`,
      [SITE.id, JSON.stringify({ owner: OWNER })],
    );
    await queryRunner.query(
      `INSERT INTO "category_activities" ("category_id", "user_id", "action", "message") SELECT "id", NULL, 'imported', 'Рубрика импортирована из проекта Skinova' FROM "categories" WHERE "site_id" = $1`,
      [SITE.id],
    );
    await queryRunner.query(
      `INSERT INTO "article_activities" ("article_id", "user_id", "type", "message", "from_status", "to_status") SELECT article."id", admin."id", 'status_changed', 'Материал импортирован из проекта Skinova', NULL, 'published' FROM "articles" article CROSS JOIN LATERAL (SELECT "id" FROM "users" WHERE "platform_role" = 'wispo_admin' ORDER BY "created_at" LIMIT 1) admin WHERE article."site_id" = $1`,
      [SITE.id],
    );
  }

  public async down(): Promise<void> {
    // Imported content becomes user-owned after the first CMS edit. A rollback
    // must not silently delete an independent workspace and its publications.
    return Promise.resolve();
  }
}
