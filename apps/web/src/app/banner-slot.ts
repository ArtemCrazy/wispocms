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

export function bannerAssetRequirement(
  value: BannerSlotDefinition["desktop"] | BannerSlotDefinition["mobile"],
) {
  const dimensions =
    "minWidth" in value && value.minWidth && value.minHeight
      ? `от ${value.minWidth} × ${value.minHeight} px`
      : null;
  return [
    value.layout,
    value.aspectRatio ? `формат ${value.aspectRatio}` : null,
    dimensions,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type BannerSlotContent = {
  mediaId?: string | null;
  mobileMediaId?: string | null;
  title?: string | null;
  subtitle?: string | null;
  buttonText?: string | null;
  media?: { width?: number | null; height?: number | null } | null;
  mobileMedia?: { width?: number | null; height?: number | null } | null;
};

function geometryIsCompatible(
  media: { width?: number | null; height?: number | null } | null | undefined,
  constraints: {
    aspectRatio?: string;
    minWidth?: number;
    minHeight?: number;
  },
) {
  if (!media?.width || !media.height) return true;
  if (constraints.minWidth && media.width < constraints.minWidth) return false;
  if (constraints.minHeight && media.height < constraints.minHeight)
    return false;
  if (!constraints.aspectRatio) return true;
  const [width, height] = constraints.aspectRatio.split(":").map(Number);
  const expected = width / height;
  return Math.abs(media.width / media.height - expected) / expected <= 0.01;
}

export function bannerCompatibilityError(
  slot: BannerSlotDefinition,
  banner: BannerSlotContent,
) {
  if (!slot.supports.desktopImage && banner.mediaId)
    return "не поддерживает изображение для компьютера";
  if (!slot.supports.mobileImage && banner.mobileMediaId)
    return "не поддерживает изображение для телефона";
  if (!slot.supports.title && banner.title)
    return "не поддерживает заголовок";
  if (!slot.supports.subtitle && banner.subtitle)
    return "не поддерживает подзаголовок";
  if (!slot.supports.button && banner.buttonText)
    return "не поддерживает кнопку";
  if (slot.required.desktopImage && !banner.mediaId)
    return "требуется изображение для компьютера";
  if (banner.mediaId && !geometryIsCompatible(banner.media, slot.desktop))
    return "изображение для компьютера не соответствует размеру зоны";
  if (
    banner.mobileMediaId &&
    !geometryIsCompatible(banner.mobileMedia, slot.mobile)
  )
    return "изображение для телефона не соответствует размеру зоны";
  const hasVisibleContent = Boolean(
    (slot.supports.desktopImage && banner.mediaId) ||
      (slot.supports.title && banner.title?.trim()) ||
      (slot.supports.subtitle && banner.subtitle?.trim()) ||
      (slot.supports.button && banner.buttonText?.trim()),
  );
  return hasVisibleContent ? null : "нет отображаемого содержимого";
}

export function bannerLinkSelectValue(
  value: string | null | undefined,
  internalValues: string[],
) {
  const normalized = value?.trim();
  if (!normalized) return "";
  return internalValues.includes(normalized) ? normalized : "external";
}
