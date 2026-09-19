import { preparationTopic } from './preparation-topics';
import type { SitePage } from './site-crawler';

describe('preparation page topics', () => {
  const page = (group: string, title = group, path = '/') =>
    ({
      group,
      title,
      url: `https://example.com${path}`,
    }) as SitePage;

  it.each([
    'Главная',
    'О компании',
    'Контакты',
    'Команда',
    'Лицензии и документы',
  ])('groups %s with the company profile', (group) => {
    expect(preparationTopic(page(group), 'S1').key).toBe('company');
  });
  it.each([
    ['Цены и условия', 'Цены', '/prices'],
    ['Услуги и другие страницы', 'Shipping', '/delivery/'],
    ['Услуги и другие страницы', 'Payment', '/shop/payment.html'],
    ['Услуги и другие страницы', 'Условия доставки', '/dostavka-i-oplata/'],
    ['Услуги и другие страницы', 'Гарантия на товары', '/help/123/'],
  ])('keeps purchase conditions together: %s %s', (group, title, path) => {
    expect(preparationTopic(page(group, title, path), 'S1').key).toBe(
      'conditions',
    );
  });
  it('keeps articles and products separate, preserving source identity', () => {
    expect(
      preparationTopic(
        page('Блог и новости', 'Гарантия', '/blog/warranty/'),
        'S2',
      ),
    ).toMatchObject({ sourceId: 'S2', key: 'editorial' });
    expect(
      preparationTopic(
        page('Услуги и другие страницы', 'Диваны', '/catalog/sofa/'),
        'S1',
      ).key,
    ).toBe('offering');
  });
});
