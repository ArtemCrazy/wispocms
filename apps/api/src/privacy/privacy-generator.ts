import { createHash } from 'crypto';
import type {
  PrivacyLegalModelEntity,
  PrivacyLegalRule,
  PrivacySettings,
  SiteGlobalData,
} from '../database/entities';

const labels: Record<string, string> = {
  name: 'Имя',
  phone: 'Телефон',
  email: 'Email',
  address: 'Адрес',
  birth_date: 'Дата рождения',
  process_inquiries: 'Обработка обращений',
  respond_to_request: 'Ответ на заявку пользователя',
  order_processing: 'Оформление заказа',
  newsletter: 'Рассылка',
  account_registration: 'Регистрация личного кабинета',
  analytics: 'Система аналитики',
  crm: 'CRM',
  email_service: 'Email-сервис',
  advertising: 'Рекламные системы',
  other: 'Другие внешние сервисы',
  web_forms: 'Веб-формы',
  account: 'Регистрация и личный кабинет',
  cookies: 'Файлы cookie',
  analytics_systems: 'Системы аналитики',
  direct_contact: 'Прямое обращение по email или телефону',
  file_uploads: 'Загрузка файлов',
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  return value;
}

export function privacyFingerprint(
  globals: SiteGlobalData,
  settings: PrivacySettings,
  legalModelVersion: string,
  displayTemplate?: {
    key: string;
    version: string;
    config?: Record<string, unknown>;
  },
) {
  const relevantGlobals = {
    organizationType: globals.organizationType ?? null,
    legalName: globals.legalName ?? globals.companyName ?? null,
    inn: globals.inn ?? null,
    ogrn: globals.ogrn ?? null,
    legalAddress: globals.legalAddress ?? globals.address ?? null,
  };
  return createHash('sha256')
    .update(
      JSON.stringify(
        stable({
          globals: relevantGlobals,
          settings,
          legalModelVersion,
          displayTemplate: displayTemplate ?? null,
        }),
      ),
    )
    .digest('hex');
}

export function privacyMissingFields(
  globals: SiteGlobalData,
  settings: PrivacySettings,
) {
  const missing: string[] = [];
  if (!globals.organizationType) missing.push('Тип организации');
  if (!(globals.legalName ?? globals.companyName)?.trim())
    missing.push('Полное юридическое наименование');
  if (!globals.inn?.trim()) missing.push('ИНН');
  if (
    (globals.organizationType === 'ip' || globals.organizationType === 'ooo') &&
    !globals.ogrn?.trim()
  )
    missing.push('ОГРН / ОГРНИП');
  if (!(globals.legalAddress ?? globals.address)?.trim())
    missing.push('Юридический адрес');
  if (!(settings.dataCategories?.length ?? 0))
    missing.push('Категории персональных данных');
  if (!(settings.purposes?.length ?? 0)) missing.push('Цели обработки');
  if (!(settings.collectionMethods?.length ?? 0))
    missing.push('Способы сбора данных');
  if (
    settings.services?.includes('other') &&
    !settings.otherServiceDescription?.trim()
  )
    missing.push('Описание других внешних сервисов');
  if (settings.thirdPartyTransfer && !settings.thirdPartyDescription?.trim())
    missing.push('Описание получателей и цели передачи');
  return missing;
}

function ruleApplies(rule: PrivacyLegalRule, settings: PrivacySettings) {
  if (!rule.when) return true;
  if ('boolean' in rule.when) return settings[rule.when.boolean] === true;
  const values = settings[rule.when.setting];
  if (!Array.isArray(values) || values.length === 0) return false;
  return (
    !rule.when.hasAny?.length ||
    rule.when.hasAny.some((key) => values.includes(key))
  );
}

function list(values?: string[]) {
  return values?.map((key) => labels[key] ?? key).join(', ') || 'не указано';
}

export function generatePrivacyDraft(
  globals: SiteGlobalData,
  settings: PrivacySettings,
  model: Pick<
    PrivacyLegalModelEntity,
    'version' | 'status' | 'sections' | 'rules'
  >,
) {
  const conditional = new Map(
    model.rules.map((rule) => [rule.sectionKey, rule]),
  );
  const output = [
    '# Политика конфиденциальности',
    '',
    ...(model.status === 'draft'
      ? [
          '> Черновик юридической модели. Текст не утверждён и недоступен для публикации.',
          '',
        ]
      : []),
  ];
  const organizationType = globals.organizationType;
  const organizationNameLabel =
    organizationType === 'ip'
      ? 'ФИО / наименование ИП'
      : organizationType === 'self_employed'
        ? 'ФИО'
        : 'Наименование';
  const addressLabel =
    organizationType === 'ip' ? 'Адрес регистрации' : 'Адрес';
  for (const section of model.sections) {
    const rule = conditional.get(section.key);
    if (rule && !ruleApplies(rule, settings)) continue;
    output.push(`## ${section.title}`, '', section.body);
    if (section.key === 'operator')
      output.push(
        '',
        `${organizationNameLabel}: ${globals.legalName ?? globals.companyName ?? 'не указано'}`,
        `ИНН: ${globals.inn ?? 'не указан'}`,
        ...(organizationType === 'ooo' || organizationType === 'ip'
          ? [
              `${organizationType === 'ip' ? 'ОГРНИП' : 'ОГРН'}: ${globals.ogrn ?? 'не указан'}`,
            ]
          : organizationType === 'other' && globals.ogrn
            ? [`Регистрационный номер: ${globals.ogrn}`]
            : []),
        `${addressLabel}: ${globals.legalAddress ?? globals.address ?? 'не указан'}`,
      );
    if (section.key === 'data_categories')
      output.push('', `Выбранные категории: ${list(settings.dataCategories)}.`);
    if (section.key === 'purposes')
      output.push('', `Выбранные цели: ${list(settings.purposes)}.`);
    if (section.key === 'collection_methods')
      output.push(
        '',
        `Способы сбора данных: ${list(settings.collectionMethods)}.`,
      );
    if (section.key === 'services')
      output.push(
        '',
        `Выбранные сервисы: ${list(settings.services)}.`,
        ...(settings.otherServiceDescription
          ? [`Другие сервисы: ${settings.otherServiceDescription.trim()}.`]
          : []),
      );
    if (section.key === 'third_parties' && settings.thirdPartyDescription)
      output.push(
        '',
        `Получатели и цель: ${settings.thirdPartyDescription.trim()}.`,
      );
    output.push('');
  }
  return output.join('\n').trim();
}
