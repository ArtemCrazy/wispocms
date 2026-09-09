import { MigrationInterface, QueryRunner } from 'typeorm';

const catalog = [
  [
    'Задвижки',
    '40',
    'zadvizhka-blueprint-v1.png',
    ['Чугунные', 'Стальные', 'С электроприводом'],
  ],
  [
    'Краны LD',
    '18',
    'kran-ld-blueprint-v1.png',
    ['Фланцевые', 'Под приварку', 'Муфтовые'],
  ],
  [
    'Клапаны запорные',
    '15',
    'klapan-zap-blueprint-v1.png',
    ['Стальные', 'Ковкий чугун', 'Нержавеющие'],
  ],
  [
    'Краны шаровые',
    '14',
    'kran-blueprint-v1.png',
    ['Фланцевые', 'Под приварку', 'Муфтовые'],
  ],
  [
    'Отводы',
    '12',
    'otvod-blueprint-v1.png',
    ['Крутоизогнутые', 'Секционные', 'По стали'],
  ],
  [
    'Клапаны обратные',
    '10',
    'klapan-obr-blueprint-v1.png',
    ['Поворотные', 'Подъёмные'],
  ],
  [
    'Затворы дисковые',
    '8',
    'zatvor-blueprint-v1.png',
    ['Межфланцевые', 'Фланцевые', 'Шланговые'],
  ],
  [
    'Переходы',
    '8',
    'perekhod-blueprint-v1.png',
    ['Концентрические', 'Эксцентрические'],
  ],
  ['Тройники', '3', 'troynik-blueprint-v1.png', []],
  ['Фланцы', '3', 'flanets-blueprint-v1.png', []],
  ['Электроприводы', '1', 'privod-blueprint-v1.png', []],
  ['Регуляторы давления', '1', 'regulyator-blueprint-v1.png', []],
].map(([name, count, asset, subitems]) => ({
  name,
  count,
  href: '#request',
  asset,
  subitems: (subitems as string[]).map((label) => ({
    label,
    href: '#request',
  })),
}));

const blocks = [
  {
    id: 'armaturex-home-v1-hero',
    type: 'hero',
    title: 'Трубопроводная арматура',
    text: 'Задвижки, затворы, краны, фланцы и детали трубопровода. Отгружаем по России и странам СНГ, счёт выставляем в течение 15 минут.',
    buttonLabel: 'Перейти в каталог',
    buttonUrl: '#catalog',
    data: {
      eyebrow: 'Комплексные поставки со склада',
      secondaryCta: { label: 'Оставить заявку', href: '#request' },
    },
  },
  {
    id: 'armaturex-home-v1-stats',
    type: 'text',
    title: 'Показатели',
    data: {
      items: [
        { value: '1000+', label: 'типоразмеров в наличии' },
        { value: 'ГОСТ', label: 'сертификаты на изделия' },
        { value: '12 лет', label: 'на рынке арматуры' },
      ],
    },
  },
  {
    id: 'armaturex-home-v1-catalog',
    type: 'text',
    title: 'Каталог',
    text: '12 разделов каталога',
    data: { items: catalog },
  },
  {
    id: 'armaturex-home-v1-terms',
    type: 'text',
    title: 'Условия поставки',
    data: {
      items: [
        {
          number: '01',
          title: 'Отсрочка платежа',
          text: 'Для постоянных клиентов, по согласованию после первых поставок',
          href: '#request',
          asset: 'terms-payment-v1.png',
        },
        {
          number: '02',
          title: 'Доставка',
          text: 'До транспортной компании в черте города — бесплатно, дальше за счёт получателя',
          href: '#request',
          asset: 'terms-delivery-v1.png',
        },
        {
          number: '03',
          title: 'Документы',
          text: 'Накладная, счёт-фактура, сертификат соответствия на каждую партию',
          href: '#request',
          asset: 'terms-documents-v1.png',
        },
      ],
    },
  },
  {
    id: 'armaturex-home-v1-faq',
    type: 'text',
    title: 'Вопросы и ответы',
    data: {
      items: [
        {
          question: 'Нужной позиции нет в каталоге. Привезёте?',
          answer:
            'Да. Каталог показывает основные группы, а подобрать можем любую трубопроводную арматуру и детали трубопровода. Пришлите марку или описание задачи — найдём и посчитаем.',
        },
        {
          question: 'Как узнать цену?',
          answer:
            'Оставьте заявку или напишите на почту: марка, диаметр, давление и количество. Счёт и коммерческое предложение готовим в течение 15 минут.',
        },
        {
          question: 'Позиция есть на складе?',
          answer:
            'Ходовую номенклатуру держим на складе — это больше тысячи позиций. По остальному называем срок поставки сразу в ответе на запрос.',
        },
        {
          question: 'Как считается доставка?',
          answer:
            'Отгружаем по России и странам СНГ. До транспортной компании в черте города везём бесплатно, дальше стоимость считает перевозчик по вашему тарифу.',
        },
        {
          question: 'Какие документы даёте на партию?',
          answer:
            'Накладную, счёт-фактуру и сертификат соответствия. Если нужны дополнительные документы, скажите при оформлении заказа.',
        },
        {
          question: 'Работаете с отсрочкой платежа?',
          answer:
            'Для постоянных клиентов — да, по согласованию после первых поставок. Первую поставку оформляем по счёту.',
        },
      ],
    },
  },
  {
    id: 'armaturex-home-v1-request',
    type: 'cta',
    title: 'Подготовим счёт и КП в течение 15 минут',
    text: 'Пришлите марку и типоразмер или техническое задание — ответим на почту.',
    buttonLabel: 'Отправить',
    data: { formTitle: 'Заявка на КП' },
  },
];

export class SeedArmaturexHomepage1789502400000 implements MigrationInterface {
  name = 'SeedArmaturexHomepage1789502400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const workspaces = (await queryRunner.query(
      `SELECT "id" FROM "workspaces" WHERE "slug" = 'crazy-studio' LIMIT 1`,
    )) as Array<{ id: string }>;
    if (!workspaces[0]) return;

    const sites = (await queryRunner.query(
      `INSERT INTO "sites" (
        "workspace_id", "name", "slug", "site_type", "seo_title",
        "seo_description", "no_index", "notification_email", "global_data",
        "layout_settings", "is_active"
      ) VALUES ($1, 'Armaturex', 'armaturex', 'corporate', $2, $3, true,
        'armcompany@mail.ru', $4::jsonb, $5::jsonb, true)
      ON CONFLICT ("workspace_id", "slug") DO UPDATE SET
        "name" = EXCLUDED."name",
        "site_type" = EXCLUDED."site_type",
        "seo_title" = EXCLUDED."seo_title",
        "seo_description" = EXCLUDED."seo_description",
        "no_index" = true,
        "notification_email" = EXCLUDED."notification_email",
        "global_data" = EXCLUDED."global_data",
        "layout_settings" = EXCLUDED."layout_settings",
        "is_active" = true
      RETURNING "id"`,
      [
        workspaces[0].id,
        'Трубопроводная арматура от производителя — поставки по России и СНГ',
        'Трубопроводная арматура со склада: задвижки, краны, клапаны, затворы, отводы и фланцы. Счёт в течение 15 минут, отгрузка по России и СНГ.',
        JSON.stringify({
          companyName: 'Первая арматурная компания',
          organizationType: 'ooo',
          legalName: 'ООО «Первая арматурная компания»',
          phone: '+7 351 200-21-11',
          email: 'armcompany@mail.ru',
          address: 'Челябинск, ул. Артиллерийская, 117/2, оф. 2',
          legalAddress: 'Челябинск, ул. Артиллерийская, 117/2, оф. 2',
        }),
        JSON.stringify({
          logoText: 'Первая арматурная компания',
          showPages: true,
          showArticles: false,
          ctaLabel: 'Оставить заявку',
          ctaUrl: '#request',
          footerDescription:
            'Поставки трубопроводной арматуры по России и странам СНГ: задвижки, краны, затворы, фланцы и детали трубопровода со склада.',
          showContacts: true,
          showSocials: false,
        }),
      ],
    )) as Array<{ id: string }>;
    if (!sites[0]) {
      throw new Error('Cannot seed Armaturex: site upsert returned no id');
    }
    const siteId = sites[0].id;
    await queryRunner.query(
      `INSERT INTO "pages" (
        "site_id", "title", "slug", "kind", "status", "blocks",
        "seo_title", "seo_description", "no_index",
        "system_template_key", "system_template_version"
      ) VALUES ($1, 'Главная', '', 'homepage', 'draft', $2::jsonb, $3, $4,
        true, 'armaturex-home-v1', '1')
      ON CONFLICT ("site_id", "slug") DO UPDATE SET
        "title" = EXCLUDED."title",
        "kind" = 'homepage',
        "blocks" = EXCLUDED."blocks",
        "seo_title" = EXCLUDED."seo_title",
        "seo_description" = EXCLUDED."seo_description",
        "no_index" = true,
        "system_template_key" = 'armaturex-home-v1',
        "system_template_version" = '1'`,
      [
        siteId,
        JSON.stringify(blocks),
        'Трубопроводная арматура от производителя — поставки по России и СНГ',
        'Трубопроводная арматура со склада: 1000+ типоразмеров, сертификаты ГОСТ, поставки по России и СНГ.',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "sites"
       WHERE "slug" = 'armaturex'
         AND "domain" IS NULL
         AND "workspace_id" = (
           SELECT "id" FROM "workspaces" WHERE "slug" = 'crazy-studio'
         )`,
    );
  }
}
