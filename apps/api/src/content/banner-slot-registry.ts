import { PageKind } from '../database/entities';

export type BannerSlotDefinition = {
  id: string;
  name: string;
  description: string;
  renderer: string;
  supports: {
    desktopImage: boolean;
    mobileImage: boolean;
    title: boolean;
    subtitle: boolean;
    button: boolean;
  };
  required: { desktopImage: boolean };
  desktop: {
    layout: string;
    aspectRatio?: string;
    minWidth?: number;
    minHeight?: number;
  };
  mobile: {
    layout: string;
    aspectRatio?: string;
    fallbackToDesktop: boolean;
  };
};

const HOMEPAGE_BANNER_SLOTS: Record<string, readonly BannerSlotDefinition[]> = {
  'skinova-home@1': [
    {
      id: 'homepage_top',
      name: 'Верхняя промо-полоса',
      description: 'Компактное предложение над шапкой сайта.',
      renderer: 'skinova-promo-strip',
      supports: {
        desktopImage: false,
        mobileImage: false,
        title: true,
        subtitle: true,
        button: true,
      },
      required: { desktopImage: false },
      desktop: { layout: 'Промо-полоса, высота от 50 px' },
      mobile: {
        layout: 'Компактная промо-полоса',
        fallbackToDesktop: true,
      },
    },
    {
      id: 'homepage_middle',
      name: 'Баннер консультации',
      description: 'Широкий баннер между блоками материалов.',
      renderer: 'skinova-consultation',
      supports: {
        desktopImage: true,
        mobileImage: true,
        title: true,
        subtitle: true,
        button: true,
      },
      required: { desktopImage: true },
      desktop: {
        layout: 'Широкий баннер',
        aspectRatio: '15:4',
        minWidth: 1800,
        minHeight: 480,
      },
      mobile: {
        layout: 'Широкий баннер с адаптивным кадрированием',
        aspectRatio: '15:4',
        fallbackToDesktop: true,
      },
    },
  ],
};

export function bannerSlotsForPage(page: {
  kind: PageKind;
  systemTemplateKey: string | null;
  systemTemplateVersion: string | null;
}): BannerSlotDefinition[] {
  if (
    page.kind !== PageKind.HOMEPAGE ||
    !page.systemTemplateKey ||
    !page.systemTemplateVersion
  )
    return [];
  return [
    ...(HOMEPAGE_BANNER_SLOTS[
      `${page.systemTemplateKey}@${page.systemTemplateVersion}`
    ] ?? []),
  ];
}

export function isAllowedBannerLink(value: string | null | undefined) {
  const link = value?.trim();
  if (!link) return true;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  try {
    const parsed = new URL(link);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export type BannerSlotContent = {
  mediaId?: string | null;
  mobileMediaId?: string | null;
  title?: string | null;
  subtitle?: string | null;
  buttonText?: string | null;
};

export function bannerSlotCompatibilityError(
  slot: BannerSlotDefinition,
  banner: BannerSlotContent,
): string | null {
  if (!slot.supports.desktopImage && banner.mediaId)
    return 'Эта зона не поддерживает изображение для компьютера';
  if (!slot.supports.mobileImage && banner.mobileMediaId)
    return 'Эта зона не поддерживает изображение для телефона';
  if (!slot.supports.title && banner.title)
    return 'Эта зона не поддерживает заголовок';
  if (!slot.supports.subtitle && banner.subtitle)
    return 'Эта зона не поддерживает подзаголовок';
  if (!slot.supports.button && banner.buttonText)
    return 'Эта зона не поддерживает кнопку';
  if (slot.required.desktopImage && !banner.mediaId)
    return 'Для этой зоны требуется изображение для компьютера';

  const hasVisibleContent = Boolean(
    (slot.supports.desktopImage && banner.mediaId) ||
    (slot.supports.title && banner.title?.trim()) ||
    (slot.supports.subtitle && banner.subtitle?.trim()) ||
    (slot.supports.button && banner.buttonText?.trim()),
  );
  return hasVisibleContent
    ? null
    : 'Баннер не содержит элементов, отображаемых в этой зоне';
}

export function bannerGeometryError(
  label: string,
  dimensions: { width: number; height: number },
  constraints: {
    aspectRatio?: string;
    minWidth?: number;
    minHeight?: number;
  },
): string | null {
  const expected = [
    constraints.minWidth && constraints.minHeight
      ? `не меньше ${constraints.minWidth} × ${constraints.minHeight} px`
      : null,
    constraints.aspectRatio ? `формат ${constraints.aspectRatio}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  if (
    (constraints.minWidth && dimensions.width < constraints.minWidth) ||
    (constraints.minHeight && dimensions.height < constraints.minHeight)
  )
    return `${label}: ожидается ${expected}, получено ${dimensions.width} × ${dimensions.height} px`;
  if (constraints.aspectRatio) {
    const [ratioWidth, ratioHeight] = constraints.aspectRatio
      .split(':')
      .map(Number);
    const expectedRatio = ratioWidth / ratioHeight;
    const actualRatio = dimensions.width / dimensions.height;
    if (
      !Number.isFinite(expectedRatio) ||
      !Number.isFinite(actualRatio) ||
      Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.01
    )
      return `${label}: ожидается ${expected}, получено ${dimensions.width} × ${dimensions.height} px`;
  }
  return null;
}
