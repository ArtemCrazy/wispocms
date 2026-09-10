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
