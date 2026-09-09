import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSiteDto } from './platform.dto';

describe('CreateSiteDto', () => {
  const base = {
    name: 'Corporate site',
    slug: 'corporate-site',
  };

  it('requires an explicit site type', async () => {
    const errors = await validate(plainToInstance(CreateSiteDto, base));

    expect(errors.some((error) => error.property === 'siteType')).toBe(true);
  });

  it('rejects an unsupported site type', async () => {
    const errors = await validate(
      plainToInstance(CreateSiteDto, { ...base, siteType: 'shop' }),
    );

    expect(errors.some((error) => error.property === 'siteType')).toBe(true);
  });

  it.each(['media', 'corporate', 'ecommerce', 'landing'])(
    'accepts the %s site profile',
    async (siteType) => {
      const errors = await validate(
        plainToInstance(CreateSiteDto, { ...base, siteType }),
      );

      expect(errors).toHaveLength(0);
    },
  );
});
