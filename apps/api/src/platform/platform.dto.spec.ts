import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSiteDto, CreateUserDto } from './platform.dto';

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

describe('CreateUserDto', () => {
  const base = {
    fullName: 'Иван Петров',
    email: 'ivan@example.test',
    password: 'long-password',
  };
  const siteId = '77bbc150-03f9-4ae4-9713-a7c8de79897d';

  it('rejects the old roleless workspace assignment payload', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...base,
        workspaceIds: [siteId],
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['role', 'siteIds']),
    );
  });

  it('accepts an explicit role and site assignment', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...base,
        role: 'site_owner',
        siteIds: [siteId],
      }),
    );
    expect(errors).toHaveLength(0);
  });
});
