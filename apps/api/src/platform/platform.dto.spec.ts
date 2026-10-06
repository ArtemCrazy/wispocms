import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateSiteDto,
  CreateUserDto,
  ManagedUserRole,
  UpdateManagedUserDto,
} from './platform.dto';

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

  it('rejects the legacy role and siteIds payload', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...base,
        role: 'site_owner',
        siteIds: [siteId],
      }),
    );
    expect(errors.map((error) => error.property)).toContain('siteAccesses');
  });

  it('accepts an explicit per-site role and approval flag', async () => {
    const candidate = plainToInstance(CreateUserDto, {
      ...base,
      siteAccesses: [
        {
          siteId,
          role: 'content_manager',
          requiresApproval: true,
        },
      ],
    });
    const errors = await validate(candidate, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(candidate.siteAccesses[0]).not.toHaveProperty('canEditCode');
  });

  it('rejects a legacy developer role inside a site assignment', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        ...base,
        siteAccesses: [
          {
            siteId,
            role: 'site_developer',
            requiresApproval: false,
          },
        ],
      }),
    );
    expect(
      errors[0]?.children?.[0]?.children?.map((error) => error.property),
    ).toContain('role');
  });
});

describe('UpdateManagedUserDto', () => {
  const siteId = '77bbc150-03f9-4ae4-9713-a7c8de79897d';

  it('accepts one atomic content-manager update', async () => {
    const errors = await validate(
      plainToInstance(UpdateManagedUserDto, {
        fullName: 'Анна Ковалёва',
        role: ManagedUserRole.CONTENT_MANAGER,
        siteIds: [siteId],
        requiresApproval: true,
        isActive: true,
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects an unsupported managed role', async () => {
    const errors = await validate(
      plainToInstance(UpdateManagedUserDto, {
        fullName: 'Анна Ковалёва',
        role: 'site_developer',
        siteIds: [siteId],
        requiresApproval: false,
        isActive: true,
      }),
    );

    expect(errors.map((error) => error.property)).toContain('role');
  });
});
