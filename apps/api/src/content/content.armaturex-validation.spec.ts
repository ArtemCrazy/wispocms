import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PageKind,
  PageStatus,
  PlatformRole,
  type PageBlock,
} from '../database/entities';
import {
  validateArmaturexPageBlocks,
  validateGenericPageBlocks,
} from './armaturex-home-validation';
import { ContentService } from './content.service';

const foreignMediaId = '22222222-2222-4222-8222-222222222222';

function validBlocks(): PageBlock[] {
  return [
    {
      id: 'armaturex-home-v1-hero',
      type: 'hero',
      title: 'Арматура',
      text: 'Поставки',
      buttonLabel: 'Каталог',
      buttonUrl: '#catalog',
      data: {
        eyebrow: 'Со склада',
        secondaryCta: { label: 'Заявка', href: '#request' },
      },
    },
    {
      id: 'armaturex-home-v1-stats',
      type: 'text',
      data: { items: [{ value: '1000+', label: 'позиций' }] },
    },
    {
      id: 'armaturex-home-v1-catalog',
      type: 'text',
      data: {
        items: [
          {
            name: 'Задвижки',
            count: '40',
            href: '#request',
            asset: 'zadvizhka-blueprint-v1.png',
            subitems: [{ label: 'Стальные', href: '#request' }],
          },
        ],
      },
    },
    {
      id: 'armaturex-home-v1-terms',
      type: 'text',
      data: {
        items: [
          {
            number: '01',
            title: 'Доставка',
            text: 'По России',
            href: '#request',
            asset: 'terms-delivery-v1.png',
          },
        ],
      },
    },
    {
      id: 'armaturex-home-v1-faq',
      type: 'text',
      data: { items: [{ question: 'Цена?', answer: 'По запросу' }] },
    },
    {
      id: 'armaturex-home-v1-request',
      type: 'cta',
      data: { formTitle: 'Заявка' },
    },
  ];
}

describe('Armaturex homepage API validation', () => {
  it('rejects unknown structured keys and any structured data on generic pages', () => {
    const blocks = validBlocks();
    blocks[0].data = { ...blocks[0].data, surprise: true };
    expect(() => validateArmaturexPageBlocks(blocks)).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateGenericPageBlocks([{ id: 'plain', type: 'text', data: {} }]),
    ).toThrow(BadRequestException);
  });

  it('rejects unsafe links and non-allowlisted bundled assets', () => {
    const unsafe = validBlocks();
    const unsafeItem = (
      unsafe[2].data?.items as Array<Record<string, unknown>>
    )[0];
    unsafeItem.href = 'javascript:alert(1)';
    expect(() => validateArmaturexPageBlocks(unsafe)).toThrow(
      /недопустимую ссылку/,
    );

    const asset = validBlocks();
    const assetItem = (
      asset[2].data?.items as Array<Record<string, unknown>>
    )[0];
    assetItem.asset = '../../secret.png';
    expect(() => validateArmaturexPageBlocks(asset)).toThrow(/не разрешён/);

    const media = validBlocks();
    const mediaItem = (
      media[2].data?.items as Array<Record<string, unknown>>
    )[0];
    mediaItem.imageMediaId = 'not-a-uuid';
    expect(() => validateArmaturexPageBlocks(media)).toThrow(
      /должен быть UUID/,
    );
  });

  it('rejects oversized and overly deep payloads before persistence', () => {
    const oversized = validBlocks();
    oversized[4].data = {
      items: Array.from({ length: 20 }, (_, index) => ({
        question: `Вопрос ${index}`,
        answer: 'я'.repeat(3000),
      })),
    };
    expect(() => validateArmaturexPageBlocks(oversized)).toThrow(
      /payload превышает/,
    );

    const deep = validBlocks();
    let value: Record<string, unknown> = {};
    deep[0].data = { eyebrow: 'Со склада', secondaryCta: value };
    for (let index = 0; index < 10; index += 1) value = value.child = {};
    expect(() => validateArmaturexPageBlocks(deep)).toThrow(/глубин/);
  });

  it('rejects a nested media ID outside the site workspace', async () => {
    const blocks = validBlocks();
    const catalogItem = (
      blocks[2].data?.items as Array<Record<string, unknown>>
    )[0];
    catalogItem.imageMediaId = foreignMediaId;
    const site = { id: 'site-id', workspaceId: 'workspace-id' };
    const sites = { findOne: jest.fn().mockResolvedValue(site) };
    const pages = {
      findOne: jest.fn().mockResolvedValue({
        id: 'page-id',
        siteId: site.id,
        slug: '',
        kind: PageKind.HOMEPAGE,
        status: PageStatus.DRAFT,
        systemTemplateKey: 'armaturex-home-v1',
        systemTemplateVersion: '1',
      }),
    };
    const media = { existsBy: jest.fn().mockResolvedValue(false) };
    const emptyRepository = {};
    const service = new ContentService(
      sites as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      emptyRepository as never,
      media as never,
      pages as never,
      emptyRepository as never,
    );

    await expect(
      service.updatePage(
        site.id,
        'page-id',
        { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN },
        {
          title: 'Главная',
          slug: '',
          kind: PageKind.HOMEPAGE,
          status: PageStatus.DRAFT,
          blocks,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(media.existsBy).toHaveBeenCalledWith({
      id: foreignMediaId,
      workspaceId: 'workspace-id',
    });
  });
});
