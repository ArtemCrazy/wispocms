import type { SitePage } from './site-crawler';

export type PreparationTopic = {
  sourceId: string;
  key: string;
  label: string;
};

/** Navigation-level grouping, not an AI claim about the meaning of every page.
 * Keep sources separate: identical topics on two sites are not identical facts.
 */
export function preparationTopic(
  page: SitePage,
  sourceId: string,
): PreparationTopic {
  const topic = (key: string, label: string) => ({ sourceId, key, label });
  if (page.group === 'Блог и новости')
    return topic('editorial', 'Статьи и новости');
  if (page.group === 'Юридические документы')
    return topic('legal', 'Юридические документы');
  if (
    [
      'Главная',
      'О компании',
      'Контакты',
      'Команда',
      'Лицензии и документы',
    ].includes(page.group)
  )
    return topic('company', 'Компания, команда и контакты');

  let path = '';
  try {
    path = decodeURI(new URL(page.url).pathname);
  } catch {
    // A missing/malformed URL must not prevent processing a supplied text.
  }
  if (
    page.group === 'Цены и условия' ||
    /(?:^|\/)(?:delivery|shipping|payment|warranty|guarantee|returns?|dostavka|oplata|garantiya)(?:[/.\-_]|$)/i.test(
      path,
    ) ||
    /^(?:доставка|оплата|гаранти[яи]|возврат|условия покупки)(?:\s|$|[.:—-])/i.test(
      page.title.trim(),
    )
  )
    return topic('conditions', 'Цены и условия покупки');
  return topic('offering', 'Продукты и услуги');
}
