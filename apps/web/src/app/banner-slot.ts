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
