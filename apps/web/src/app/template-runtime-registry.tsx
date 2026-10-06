import {
  SkinovaArticleBanner,
  SkinovaArticlePage,
  SkinovaCategoryPage,
  SkinovaConsultationBanner,
  SkinovaHome,
  SkinovaPromoBanner,
  SkinovaSystemPage,
} from "./skinova-site";
import {
  resolveSlotRuntime,
  resolveTemplateRuntime,
} from "./template-runtime-catalog";
import type {
  SlotRuntimeCapability,
  SlotRuntimeIdentity,
  TemplateComponentCapability,
} from "./template-runtime-catalog";
import type { TemplateRuntimeIdentity } from "./template-package-contract";

type TemplateComponentBindings = {
  "skinova-home": typeof SkinovaHome;
  "skinova-article": typeof SkinovaArticlePage;
  "skinova-category": typeof SkinovaCategoryPage;
  "skinova-system-page": typeof SkinovaSystemPage;
};

type SlotComponentBindings = {
  "skinova-promo-strip": typeof SkinovaPromoBanner;
  "skinova-consultation": typeof SkinovaConsultationBanner;
  "skinova-article-sidebar": typeof SkinovaArticleBanner;
};

const skinovaTemplateRenderers = {
  "skinova-home": SkinovaHome,
  "skinova-article": SkinovaArticlePage,
  "skinova-category": SkinovaCategoryPage,
  "skinova-system-page": SkinovaSystemPage,
} satisfies TemplateComponentBindings;

const skinovaSlotRenderers = {
  "skinova-promo-strip": SkinovaPromoBanner,
  "skinova-consultation": SkinovaConsultationBanner,
  "skinova-article-sidebar": SkinovaArticleBanner,
} satisfies SlotComponentBindings;

export type ResolvedTemplateComponent = {
  [Key in keyof TemplateComponentBindings]: {
    implementationKey: Key;
    capability: Extract<
      TemplateComponentCapability,
      { implementationKey: Key }
    >;
    renderer: TemplateComponentBindings[Key];
  };
}[keyof TemplateComponentBindings];

export type ResolvedSlotComponent = {
  [Key in keyof SlotComponentBindings]: {
    implementationKey: Key;
    capability: Extract<SlotRuntimeCapability, { implementationKey: Key }>;
    renderer: SlotComponentBindings[Key];
  };
}[keyof SlotComponentBindings];

export function resolveTemplateComponent(
  identity: TemplateRuntimeIdentity,
): ResolvedTemplateComponent | null {
  const capability = resolveTemplateRuntime(identity);
  if (!capability || capability.bindingKind !== "component") return null;
  switch (capability.implementationKey) {
    case "skinova-home":
      return {
        implementationKey: "skinova-home",
        capability,
        renderer: skinovaTemplateRenderers["skinova-home"],
      };
    case "skinova-article":
      return {
        implementationKey: "skinova-article",
        capability,
        renderer: skinovaTemplateRenderers["skinova-article"],
      };
    case "skinova-category":
      return {
        implementationKey: "skinova-category",
        capability,
        renderer: skinovaTemplateRenderers["skinova-category"],
      };
    case "skinova-system-page":
      return {
        implementationKey: "skinova-system-page",
        capability,
        renderer: skinovaTemplateRenderers["skinova-system-page"],
      };
  }
}

export function resolveSlotComponent(
  identity: SlotRuntimeIdentity,
): ResolvedSlotComponent | null {
  const capability = resolveSlotRuntime(identity);
  if (!capability) return null;
  switch (capability.implementationKey) {
    case "skinova-promo-strip":
      return {
        implementationKey: "skinova-promo-strip",
        capability,
        renderer: skinovaSlotRenderers["skinova-promo-strip"],
      };
    case "skinova-consultation":
      return {
        implementationKey: "skinova-consultation",
        capability,
        renderer: skinovaSlotRenderers["skinova-consultation"],
      };
    case "skinova-article-sidebar":
      return {
        implementationKey: "skinova-article-sidebar",
        capability,
        renderer: skinovaSlotRenderers["skinova-article-sidebar"],
      };
  }
}
