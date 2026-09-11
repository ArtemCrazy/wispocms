import type { BannerSlotDefinition } from "./banner-slot";

export const SKINOVA_ARTICLE_BANNER_RENDERER = "skinova-article-sidebar";

export type SkinovaBannerPreviewContext = {
  id: string;
  label: string;
  renderer: string;
  supportsDesktopImage: boolean;
  supportsMobileImage: boolean;
  desktopHint: string | null;
  mobileHint: string | null;
  emptyHint: string;
};

export type BannerPreviewAssignment = {
  bannerId: string;
  zone: string;
};

export const SKINOVA_BANNER_PREVIEW_MESSAGE = "wispo:skinova-banner-preview";

export type SkinovaBannerPreviewPayload = {
  renderer: string;
  mode: "desktop" | "mobile";
  siteId: string;
  banner: {
    id: string;
    placement?: string | null;
    title: string | null;
    subtitle: string | null;
    buttonText: string | null;
    linkUrl: string | null;
    mediaId: string | null;
    mobileMediaId: string | null;
  };
  emptyHint: string;
};

export function skinovaBannerPreviewContexts(
  slots: BannerSlotDefinition[],
): SkinovaBannerPreviewContext[] {
  const contexts = slots
    .filter((slot) =>
      ["skinova-promo-strip", "skinova-consultation"].includes(slot.renderer),
    )
    .map((slot) => ({
      id: slot.id,
      label: slot.name,
      renderer: slot.renderer,
      supportsDesktopImage: slot.supports.desktopImage,
      supportsMobileImage: slot.supports.mobileImage,
      desktopHint:
        slot.renderer === "skinova-consultation"
          ? "Рекомендуем 1800 × 480 px, формат 15:4."
          : null,
      mobileHint:
        slot.renderer === "skinova-consultation"
          ? "Необязательно: без отдельного файла используется изображение для компьютера."
          : null,
      emptyHint:
        slot.renderer === "skinova-promo-strip"
          ? "Добавьте заголовок, подзаголовок или текст кнопки."
          : "Выберите изображение для компьютера; текст и кнопка необязательны.",
    }));

  if (contexts.length)
    contexts.push({
      id: "article_sidebar",
      label: "Баннер статьи",
      renderer: SKINOVA_ARTICLE_BANNER_RENDERER,
      supportsDesktopImage: true,
      supportsMobileImage: false,
      desktopHint: "Рекомендуем вертикальное изображение для боковой колонки статьи.",
      mobileHint: null,
      emptyHint: "Добавьте изображение, заголовок или текст кнопки.",
    });

  return contexts;
}

export function assignedSkinovaPreviewContexts(
  banner: { id: string; placement?: string | null },
  assignments: BannerPreviewAssignment[],
  contexts: SkinovaBannerPreviewContext[],
) {
  const contextIds = new Set(
    assignments
      .filter((assignment) => assignment.bannerId === banner.id)
      .map((assignment) => assignment.zone),
  );
  if (banner.placement === "article_sidebar") contextIds.add("article_sidebar");
  return contexts.filter((context) => contextIds.has(context.id));
}

export function chooseSkinovaPreviewContext(
  available: SkinovaBannerPreviewContext[],
  assigned: SkinovaBannerPreviewContext[],
  preferredRenderer?: string | null,
) {
  const choices = assigned.length ? assigned : available;
  return (
    choices.find((context) => context.renderer === preferredRenderer) ??
    choices[0] ??
    null
  );
}
