import {
  generatePrivacyDraft,
  privacyFingerprint,
  privacyMissingFields,
} from './privacy-generator';

const model = {
  version: 'draft-1',
  status: 'draft' as const,
  sections: [
    { key: 'general', title: 'Общие положения', body: 'PLACEHOLDER' },
    { key: 'services', title: 'Сервисы', body: 'PLACEHOLDER' },
    { key: 'cookies', title: 'Cookies', body: 'PLACEHOLDER' },
  ],
  rules: [
    { sectionKey: 'services', when: { setting: 'services' as const } },
    { sectionKey: 'cookies', when: { boolean: 'cookies' as const } },
  ],
};

describe('privacy generator', () => {
  it('includes only sections whose factual rules apply', () => {
    const text = generatePrivacyDraft(
      { legalName: 'ООО «Тест»', inn: '123', legalAddress: 'Москва' },
      {
        services: ['crm'],
        cookies: false,
        collectionMethods: ['web_forms'],
      },
      model,
    );
    expect(text).toContain('## Общие положения');
    expect(text).toContain('## Сервисы');
    expect(text).toContain('CRM');
    expect(text).not.toContain('## Cookies');
    expect(text).toContain('Текст не утверждён');
  });

  it('builds a stable fingerprint and detects relevant changes', () => {
    const globals = {
      organizationType: 'ooo' as const,
      legalName: 'ООО «Тест»',
      inn: '123',
      ogrn: '456',
      legalAddress: 'Москва',
    };
    const left = privacyFingerprint(
      globals,
      { purposes: ['newsletter'], cookies: true },
      'v1',
    );
    const same = privacyFingerprint(
      globals,
      { cookies: true, purposes: ['newsletter'] },
      'v1',
    );
    const changed = privacyFingerprint(
      { ...globals, inn: '999' },
      { cookies: true, purposes: ['newsletter'] },
      'v1',
    );
    expect(left).toBe(same);
    expect(changed).not.toBe(left);
  });

  it('reports conditional required facts without legal-format validation', () => {
    expect(
      privacyMissingFields(
        {
          organizationType: 'ooo',
          legalName: 'ООО',
          inn: '1',
          legalAddress: 'Адрес',
        },
        { dataCategories: ['email'], purposes: ['newsletter'] },
      ),
    ).toContain('ОГРН / ОГРНИП');
  });

  it('does not require or render a registration number for self-employed operators', () => {
    const globals = {
      organizationType: 'self_employed' as const,
      legalName: 'Иван Иванов',
      inn: '123',
      legalAddress: 'Москва',
    };
    expect(
      privacyMissingFields(globals, {
        dataCategories: ['email'],
        purposes: ['newsletter'],
        collectionMethods: ['web_forms'],
      }),
    ).not.toContain('ОГРН / ОГРНИП');
  });

  it('omits the draft warning for an approved legal model', () => {
    const text = generatePrivacyDraft({}, {}, { ...model, status: 'approved' });
    expect(text).not.toContain('Текст не утверждён');
  });
});
