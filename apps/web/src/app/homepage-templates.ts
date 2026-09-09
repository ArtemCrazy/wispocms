export const ARMATUREX_HOME_TEMPLATE = {
  key: "armaturex-home-v1",
  version: "1",
  title: "Armaturex — корпоративная главная",
} as const;

export const HOMEPAGE_TEMPLATE_REGISTRY = [ARMATUREX_HOME_TEMPLATE] as const;

export function getHomepageTemplate(
  key: string | null,
  version: string | null,
) {
  return (
    HOMEPAGE_TEMPLATE_REGISTRY.find(
      (template) => template.key === key && template.version === version,
    ) ?? null
  );
}

export type HomepageTemplateRef = {
  key: string | null;
  version: string | null;
};

export type TemplatePageBlock = {
  id: string;
  type: "hero" | "text" | "cta";
  title?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  mediaId?: string;
  data?: Record<string, unknown>;
};

export type ArmaturexLink = { label: string; href: string };
export type ArmaturexStat = { value: string; label: string };
export type ArmaturexCatalogItem = {
  name: string;
  count: string;
  href: string;
  asset: string;
  imageMediaId?: string;
  meta?: string;
  subitems: ArmaturexLink[];
};
export type ArmaturexTerm = {
  number: string;
  title: string;
  text: string;
  href: string;
  asset: string;
  imageMediaId?: string;
};
export type ArmaturexFaq = { question: string; answer: string };

export type ArmaturexHomepageContent = {
  eyebrow: string;
  title: string;
  lead: string;
  primaryCta: ArmaturexLink;
  secondaryCta: ArmaturexLink;
  stats: ArmaturexStat[];
  catalogTitle: string;
  catalogNote: string;
  catalog: ArmaturexCatalogItem[];
  termsTitle: string;
  terms: ArmaturexTerm[];
  faqTitle: string;
  faq: ArmaturexFaq[];
  requestTitle: string;
  requestLead: string;
  requestFormTitle: string;
  requestSubmitLabel: string;
};

const catalogDefaults: ArmaturexCatalogItem[] = [
  [
    "Задвижки",
    "40",
    "zadvizhki",
    "zadvizhka-blueprint-v1.png",
    ["Чугунные", "Стальные", "С электроприводом"],
  ],
  [
    "Краны LD",
    "18",
    "krany-ld",
    "kran-ld-blueprint-v1.png",
    ["Фланцевые", "Под приварку", "Муфтовые"],
  ],
  [
    "Клапаны запорные",
    "15",
    "klapany-zapornye",
    "klapan-zap-blueprint-v1.png",
    ["Стальные", "Ковкий чугун", "Нержавеющие"],
  ],
  [
    "Краны шаровые",
    "14",
    "krany",
    "kran-blueprint-v1.png",
    ["Фланцевые", "Под приварку", "Муфтовые"],
  ],
  [
    "Отводы",
    "12",
    "otvody",
    "otvod-blueprint-v1.png",
    ["Крутоизогнутые", "Секционные", "По стали"],
  ],
  [
    "Клапаны обратные",
    "10",
    "klapany-obratnye",
    "klapan-obr-blueprint-v1.png",
    ["Поворотные", "Подъёмные"],
  ],
  [
    "Затворы дисковые",
    "8",
    "zatvory",
    "zatvor-blueprint-v1.png",
    ["Межфланцевые", "Фланцевые", "Шланговые"],
  ],
  [
    "Переходы",
    "8",
    "perekhody",
    "perekhod-blueprint-v1.png",
    ["Концентрические", "Эксцентрические"],
  ],
  ["Тройники", "3", "troyniki", "troynik-blueprint-v1.png", []],
  ["Фланцы", "3", "flantsy", "flanets-blueprint-v1.png", []],
  ["Электроприводы", "1", "elektroprivody", "privod-blueprint-v1.png", []],
  [
    "Регуляторы давления",
    "1",
    "regulyatory-davleniya",
    "regulyator-blueprint-v1.png",
    [],
  ],
].map(([name, count, , asset, subitems]) => ({
  name: String(name),
  count: String(count),
  href: `#request`,
  asset: String(asset),
  subitems: (subitems as string[]).map((label) => ({
    label,
    href: "#request",
  })),
}));

export const ARMATUREX_DEFAULT_CONTENT: ArmaturexHomepageContent = {
  eyebrow: "Комплексные поставки со склада",
  title: "Трубопроводная арматура",
  lead: "Задвижки, затворы, краны, фланцы и детали трубопровода. Отгружаем по России и странам СНГ, счёт выставляем в течение 15 минут.",
  primaryCta: { label: "Перейти в каталог", href: "#catalog" },
  secondaryCta: { label: "Оставить заявку", href: "#request" },
  stats: [
    { value: "1000+", label: "типоразмеров в наличии" },
    { value: "ГОСТ", label: "сертификаты на изделия" },
    { value: "12 лет", label: "на рынке арматуры" },
  ],
  catalogTitle: "Каталог",
  catalogNote: "12 разделов каталога",
  catalog: catalogDefaults,
  termsTitle: "Условия поставки",
  terms: [
    {
      number: "01",
      title: "Отсрочка платежа",
      text: "Для постоянных клиентов, по согласованию после первых поставок",
      href: "#request",
      asset: "terms-payment-v1.png",
    },
    {
      number: "02",
      title: "Доставка",
      text: "До транспортной компании в черте города — бесплатно, дальше за счёт получателя",
      href: "#request",
      asset: "terms-delivery-v1.png",
    },
    {
      number: "03",
      title: "Документы",
      text: "Накладная, счёт-фактура, сертификат соответствия на каждую партию",
      href: "#request",
      asset: "terms-documents-v1.png",
    },
  ],
  faqTitle: "Вопросы и ответы",
  faq: [
    {
      question: "Нужной позиции нет в каталоге. Привезёте?",
      answer:
        "Да. Каталог показывает основные группы, а подобрать можем любую трубопроводную арматуру и детали трубопровода. Пришлите марку или описание задачи — найдём и посчитаем.",
    },
    {
      question: "Как узнать цену?",
      answer:
        "Оставьте заявку или напишите на почту: марка, диаметр, давление и количество. Счёт и коммерческое предложение готовим в течение 15 минут.",
    },
    {
      question: "Позиция есть на складе?",
      answer:
        "Ходовую номенклатуру держим на складе — это больше тысячи позиций. По остальному называем срок поставки сразу в ответе на запрос.",
    },
    {
      question: "Как считается доставка?",
      answer:
        "Отгружаем по России и странам СНГ. До транспортной компании в черте города везём бесплатно, дальше стоимость считает перевозчик по вашему тарифу.",
    },
    {
      question: "Какие документы даёте на партию?",
      answer:
        "Накладную, счёт-фактуру и сертификат соответствия. Если нужны дополнительные документы, скажите при оформлении заказа.",
    },
    {
      question: "Работаете с отсрочкой платежа?",
      answer:
        "Для постоянных клиентов — да, по согласованию после первых поставок. Первую поставку оформляем по счёту.",
    },
  ],
  requestTitle: "Подготовим счёт и КП в течение 15 минут",
  requestLead:
    "Пришлите марку и типоразмер или техническое задание — ответим на почту.",
  requestFormTitle: "Заявка на КП",
  requestSubmitLabel: "Отправить",
};

const text = (value: unknown, fallback: string, max = 5000) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const records = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];

export function armaturexBlocks(
  content = ARMATUREX_DEFAULT_CONTENT,
): TemplatePageBlock[] {
  return [
    {
      id: "armaturex-home-v1-hero",
      type: "hero",
      title: content.title,
      text: content.lead,
      buttonLabel: content.primaryCta.label,
      buttonUrl: content.primaryCta.href,
      data: { eyebrow: content.eyebrow, secondaryCta: content.secondaryCta },
    },
    {
      id: "armaturex-home-v1-stats",
      type: "text",
      title: "Показатели",
      data: { items: content.stats },
    },
    {
      id: "armaturex-home-v1-catalog",
      type: "text",
      title: content.catalogTitle,
      text: content.catalogNote,
      data: { items: content.catalog },
    },
    {
      id: "armaturex-home-v1-terms",
      type: "text",
      title: content.termsTitle,
      data: { items: content.terms },
    },
    {
      id: "armaturex-home-v1-faq",
      type: "text",
      title: content.faqTitle,
      data: { items: content.faq },
    },
    {
      id: "armaturex-home-v1-request",
      type: "cta",
      title: content.requestTitle,
      text: content.requestLead,
      buttonLabel: content.requestSubmitLabel,
      data: { formTitle: content.requestFormTitle },
    },
  ];
}

export function resolveArmaturexContent(
  blocks: TemplatePageBlock[],
): ArmaturexHomepageContent {
  const defaults = ARMATUREX_DEFAULT_CONTENT;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const hero = byId.get("armaturex-home-v1-hero");
  const stats = byId.get("armaturex-home-v1-stats");
  const catalog = byId.get("armaturex-home-v1-catalog");
  const terms = byId.get("armaturex-home-v1-terms");
  const faq = byId.get("armaturex-home-v1-faq");
  const request = byId.get("armaturex-home-v1-request");
  const secondary = record(hero?.data?.secondaryCta);

  return {
    eyebrow: text(hero?.data?.eyebrow, defaults.eyebrow, 160),
    title: text(hero?.title, defaults.title, 240),
    lead: text(hero?.text, defaults.lead),
    primaryCta: {
      label: text(hero?.buttonLabel, defaults.primaryCta.label, 80),
      href: text(hero?.buttonUrl, defaults.primaryCta.href, 500),
    },
    secondaryCta: {
      label: text(secondary.label, defaults.secondaryCta.label, 80),
      href: text(secondary.href, defaults.secondaryCta.href, 500),
    },
    stats: records(stats?.data?.items)
      .slice(0, 8)
      .map((item, index) => ({
        value: text(item.value, defaults.stats[index]?.value ?? "—", 40),
        label: text(
          item.label,
          defaults.stats[index]?.label ?? "Показатель",
          160,
        ),
      })),
    catalogTitle: text(catalog?.title, defaults.catalogTitle, 200),
    catalogNote: text(catalog?.text, defaults.catalogNote, 200),
    catalog: records(catalog?.data?.items)
      .slice(0, 24)
      .map((item, index) => {
        const fallback = defaults.catalog[index] ?? defaults.catalog[0];
        return {
          name: text(item.name, fallback.name, 120),
          count: text(item.count, fallback.count, 20),
          href: text(item.href, "#request", 500),
          asset: text(item.asset, fallback.asset, 120),
          imageMediaId:
            typeof item.imageMediaId === "string"
              ? item.imageMediaId
              : undefined,
          meta:
            typeof item.meta === "string" ? item.meta.slice(0, 240) : undefined,
          subitems: records(item.subitems)
            .slice(0, 8)
            .map((subitem) => ({
              label: text(subitem.label, "Подраздел", 100),
              href: text(subitem.href, "#request", 500),
            })),
        };
      }),
    termsTitle: text(terms?.title, defaults.termsTitle, 200),
    terms: records(terms?.data?.items)
      .slice(0, 6)
      .map((item, index) => {
        const fallback = defaults.terms[index] ?? defaults.terms[0];
        return {
          number: text(item.number, fallback.number, 10),
          title: text(item.title, fallback.title, 160),
          text: text(item.text, fallback.text, 1000),
          href: text(item.href, "#request", 500),
          asset: text(item.asset, fallback.asset, 120),
          imageMediaId:
            typeof item.imageMediaId === "string"
              ? item.imageMediaId
              : undefined,
        };
      }),
    faqTitle: text(faq?.title, defaults.faqTitle, 200),
    faq: records(faq?.data?.items)
      .slice(0, 20)
      .map((item, index) => ({
        question: text(
          item.question,
          defaults.faq[index]?.question ?? "Вопрос",
          300,
        ),
        answer: text(item.answer, defaults.faq[index]?.answer ?? "Ответ", 3000),
      })),
    requestTitle: text(request?.title, defaults.requestTitle, 240),
    requestLead: text(request?.text, defaults.requestLead, 1000),
    requestFormTitle: text(
      request?.data?.formTitle,
      defaults.requestFormTitle,
      120,
    ),
    requestSubmitLabel: text(
      request?.buttonLabel,
      defaults.requestSubmitLabel,
      80,
    ),
  };
}

export function isArmaturexHomepage(page: HomepageTemplateRef) {
  return (
    getHomepageTemplate(page.key, page.version)?.key ===
    ARMATUREX_HOME_TEMPLATE.key
  );
}
