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

const PROVISIONING_OWNER = '1789502400000-armaturex-home-v1';
const IDS = {
  site: 'a8100000-0000-4000-8000-000000000001',
  homepage: 'a8100000-0000-4000-8000-000000000002',
  privacy: 'a8100000-0000-4000-8000-000000000003',
  notFound: 'a8100000-0000-4000-8000-000000000004',
  thankYou: 'a8100000-0000-4000-8000-000000000005',
  captureForm: 'a8100000-0000-4000-8000-000000000006',
  privacyState: 'a8100000-0000-4000-8000-000000000007',
} as const;

export class SeedArmaturexHomepage1789502400000 implements MigrationInterface {
  name = 'SeedArmaturexHomepage1789502400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const workspaces = (await queryRunner.query(
      `SELECT "id" FROM "workspaces" WHERE "slug" = 'crazy-studio' LIMIT 1`,
    )) as Array<{ id: string }>;
    if (!workspaces[0])
      throw new Error(
        'Cannot provision Armaturex: workspace crazy-studio is missing',
      );

    const existingSites = (await queryRunner.query(
      `SELECT "id" FROM "sites" WHERE "slug" = 'armaturex' LIMIT 1`,
    )) as Array<{ id: string }>;
    if (existingSites[0])
      throw new Error(
        'Cannot provision Armaturex: site slug armaturex already exists',
      );

    const legalModels = (await queryRunner.query(
      `SELECT "id" FROM "privacy_legal_models"
       ORDER BY ("status" = 'approved') DESC,
         "approved_at" DESC NULLS LAST, "created_at" DESC
       LIMIT 1`,
    )) as Array<{ id: string }>;
    if (!legalModels[0])
      throw new Error(
        'Cannot provision Armaturex: privacy legal model is missing',
      );

    await queryRunner.query(
      `INSERT INTO "sites" (
        "id", "workspace_id", "name", "slug", "site_type", "seo_title",
        "seo_description", "no_index", "notification_email", "global_data",
        "layout_settings", "is_active"
      ) VALUES ($1, $2, 'Armaturex', 'armaturex', 'corporate', $3, $4, true,
        'armcompany@mail.ru', $5::jsonb, $6::jsonb, true)`,
      [
        IDS.site,
        workspaces[0].id,
        'Трубопроводная арматура от производителя — поставки по России и СНГ',
        'Трубопроводная арматура со склада: задвижки, краны, клапаны, затворы, отводы и фланцы. Счёт в течение 15 минут, отгрузка по России и СНГ.',
        JSON.stringify({
          __provisioning: { owner: PROVISIONING_OWNER },
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
    );
    await queryRunner.query(
      `INSERT INTO "pages" (
        "id", "site_id", "title", "slug", "kind", "status", "blocks",
        "seo_title", "seo_description", "no_index",
        "system_template_key", "system_template_version"
      ) VALUES ($1, $2, 'Главная', '', 'homepage', 'draft', $3::jsonb, $4, $5,
        true, 'armaturex-home-v1', '1')`,
      [
        IDS.homepage,
        IDS.site,
        JSON.stringify(blocks),
        'Трубопроводная арматура от производителя — поставки по России и СНГ',
        'Трубопроводная арматура со склада: 1000+ типоразмеров, сертификаты ГОСТ, поставки по России и СНГ.',
      ],
    );

    await queryRunner.query(
      `INSERT INTO "pages" (
        "id", "site_id", "title", "slug", "kind", "status", "blocks",
        "seo_title", "seo_description", "canonical_url", "no_index",
        "system_template_key", "system_template_version"
      ) VALUES
        ($1, $2, 'Политика конфиденциальности', 'privacy-policy', 'page',
          'draft', $3::jsonb, NULL, NULL, NULL, false, NULL, NULL),
        ($4, $2, 'Страница 404', '404', 'page', 'draft', $5::jsonb,
          NULL, NULL, NULL, true, 'signal', '1'),
        ($6, $2, 'Спасибо', 'thank-you', 'page', 'draft', '[]'::jsonb,
          NULL, NULL, NULL, true, NULL, NULL),
        ($7, $2, 'Форма захвата', 'capture-form', 'page', 'draft', '[]'::jsonb,
          NULL, NULL, NULL, true, NULL, NULL)`,
      [
        IDS.privacy,
        IDS.site,
        JSON.stringify([
          {
            id: 'media-system-v1-privacy',
            type: 'text',
            title: 'Политика конфиденциальности',
            text: '',
          },
        ]),
        IDS.notFound,
        JSON.stringify([
          {
            id: 'media-system-v1-404',
            type: 'hero',
            title: 'Страница не найдена',
            text: 'Проверьте адрес или вернитесь на главную страницу.',
            buttonLabel: 'На главную',
            buttonUrl: '/',
          },
        ]),
        IDS.thankYou,
        IDS.captureForm,
      ],
    );

    await queryRunner.query(
      `INSERT INTO "privacy_policy_states" (
        "id", "site_id", "page_id", "legal_model_id", "settings",
        "display_template_key", "display_template_version",
        "display_template_config", "mode", "legacy_content_preserved"
      ) VALUES ($1, $2, $3, $4, '{}'::jsonb, 'system-policy', '1',
        '{}'::jsonb, 'automatic', false)`,
      [IDS.privacyState, IDS.site, IDS.privacy, legalModels[0].id],
    );
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // Provisioned content becomes user-owned immediately. A data no-op is the
    // only rollback that cannot erase edits made after this migration ran.
    return Promise.resolve();
  }
}
