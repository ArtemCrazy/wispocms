import { BadRequestException, ConflictException } from '@nestjs/common';
import { ContentService } from './content.service';
import { PlatformRole } from '../database/entities';

describe('ContentService media management', () => {
  const actor = { userId: 'admin-id', platformRole: PlatformRole.WISPO_ADMIN };

  function setup(overrides?: {
    articleUsed?: boolean;
    bannerUsed?: boolean;
    pageUsed?: boolean;
    nestedPageSection?: 'catalog' | 'terms';
    corruptArmaturexPage?: boolean;
  }) {
    const sites = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'site-id', workspaceId: 'workspace-id' }),
      find: jest.fn().mockResolvedValue([{ id: 'site-id' }]),
      existsBy: jest.fn().mockResolvedValue(false),
    };
    const articles = {
      existsBy: jest.fn().mockResolvedValue(overrides?.articleUsed ?? false),
      find: jest.fn().mockResolvedValue([]),
    };
    const banners = {
      existsBy: jest.fn().mockResolvedValue(overrides?.bannerUsed ?? false),
    };
    const nestedPage = overrides?.nestedPageSection
      ? [
          {
            systemTemplateKey: 'armaturex-home-v1',
            systemTemplateVersion: '1',
            blocks: [
              null,
              {
                id: `armaturex-home-v1-${overrides.nestedPageSection}`,
                type: 'text',
                data: { items: [{ imageMediaId: 'media-id' }] },
              },
            ],
          },
        ]
      : [];
    const corruptPage = overrides?.corruptArmaturexPage
      ? [
          {
            systemTemplateKey: 'armaturex-home-v1',
            systemTemplateVersion: '1',
            blocks: [
              {
                id: 'armaturex-home-v1-catalog',
                type: 'text',
                data: { items: [null, 'damaged', { imageMediaId: 42 }] },
              },
            ],
          },
        ]
      : [];
    const pages = {
      find: jest
        .fn()
        .mockResolvedValue(
          overrides?.pageUsed
            ? [{ blocks: [{ mediaId: 'media-id' }] }]
            : nestedPage.length
              ? nestedPage
              : corruptPage,
        ),
    };
    const mediaItem = {
      id: 'media-id',
      workspaceId: 'workspace-id',
      siteId: 'site-id',
      storageNamespace: 'site-id',
      storedName: 'stored.jpg',
      altText: 'Старое описание',
    };
    const media = {
      findOne: jest.fn().mockResolvedValue(mediaItem),
      find: jest.fn().mockResolvedValue([mediaItem]),
      existsBy: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockImplementation((item) => Promise.resolve(item)),
      remove: jest.fn().mockResolvedValue(mediaItem),
    };
    const emptyRepository = {};
    const categories = { existsBy: jest.fn().mockResolvedValue(false) };
    const service = new ContentService(
      sites as never,
      emptyRepository as never,
      categories as never,
      emptyRepository as never,
      articles as never,
      emptyRepository as never,
      media as never,
      pages as never,
      banners as never,
    );
    return { service, sites, media, mediaItem };
  }

  it('lists one shared workspace library from any site in that workspace', async () => {
    const { service, media, mediaItem } = setup();
    await expect(service.listMedia('second-site-id', actor)).resolves.toEqual([
      { ...mediaItem, site: null },
    ]);
    expect(media.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'workspace-id' } }),
    );
  });

  it('does not expose a media record from another workspace', async () => {
    const { service, media } = setup();
    media.findOne.mockResolvedValue(null);
    await expect(
      service.getMediaFile('site-id', 'foreign-media-id', actor),
    ).rejects.toBeInstanceOf(Error);
    expect(media.findOne).toHaveBeenCalledWith({
      where: { id: 'foreign-media-id', workspaceId: 'workspace-id' },
    });
  });

  it('updates and trims an image alt description', async () => {
    const { service, media, mediaItem } = setup();

    await expect(
      service.updateMedia('site-id', 'media-id', actor, {
        altText: '  Новое описание  ',
      }),
    ).resolves.toMatchObject({ altText: 'Новое описание' });
    expect(media.save).toHaveBeenCalledWith(mediaItem);
  });

  it('rejects a non-image before writing a media record', async () => {
    const { service, media } = setup();

    await expect(
      service.uploadMedia(
        'site-id',
        actor,
        {
          originalname: 'malware.png',
          mimetype: 'image/png',
          size: 25,
          buffer: Buffer.from('<script>alert(1)</script>'),
        },
        'Поддельное изображение',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(media.save).not.toHaveBeenCalled();
  });

  it('refuses to delete an image used in content', async () => {
    const { service, media } = setup({ pageUsed: true });

    await expect(
      service.deleteMedia('site-id', 'media-id', actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(media.remove).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'terms'] as const)(
    'refuses to delete an image used only by Armaturex %s data',
    async (nestedPageSection) => {
      const { service, media } = setup({ nestedPageSection });

      await expect(
        service.deleteMedia('site-id', 'media-id', actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(media.remove).not.toHaveBeenCalled();
    },
  );

  it('deletes an unused image record', async () => {
    const { service, media } = setup();

    await expect(
      service.deleteMedia('site-id', 'media-id', actor),
    ).resolves.toEqual({
      id: 'media-id',
      deleted: true,
    });
    expect(media.remove).toHaveBeenCalledTimes(1);
  });

  it('does not let damaged historical Armaturex JSON break media deletion', async () => {
    const { service, media } = setup({ corruptArmaturexPage: true });

    await expect(
      service.deleteMedia('site-id', 'media-id', actor),
    ).resolves.toMatchObject({ deleted: true });
    expect(media.remove).toHaveBeenCalledTimes(1);
  });
});
