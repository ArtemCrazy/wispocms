import skinovaManifestTemplate from "../../template-packages/skinova/manifest.template.json" with { type: "json" };
import type {
  TemplatePackageManifestTemplate,
  TemplatePackageTemplate,
  TemplatePackageTemplateKind,
  TemplateRuntimeIdentity,
} from "./template-package-contract";

export type TemplateComponentImplementationKey =
  | "skinova-home"
  | "skinova-article"
  | "skinova-category"
  | "skinova-system-page";

export type TemplateIntegratedImplementationKey =
  | "skinova-home"
  | "skinova-chrome";

const slotImplementations = {
  "skinova-promo-strip": "skinova-promo-strip",
  "skinova-consultation": "skinova-consultation",
  "skinova-article-sidebar": "skinova-article-sidebar",
} as const;

export type SlotComponentImplementationKey = keyof typeof slotImplementations;

type TemplateRuntimeCapabilityBase = TemplateRuntimeIdentity & {
  identity: string;
  template: TemplatePackageTemplate;
};

export type TemplateComponentCapability = {
  [Key in TemplateComponentImplementationKey]: TemplateRuntimeCapabilityBase & {
    bindingKind: "component";
    implementationKey: Key;
  };
}[TemplateComponentImplementationKey];

export type TemplateIntegratedCapability = {
  [Key in TemplateIntegratedImplementationKey]: TemplateRuntimeCapabilityBase & {
    bindingKind: "integrated";
    implementationKey: Key;
  };
}[TemplateIntegratedImplementationKey];

export type TemplateRuntimeCapability =
  | TemplateComponentCapability
  | TemplateIntegratedCapability;

export type SlotRuntimeIdentity = {
  packageId: string;
  packageVersion: string;
  rendererKey: string;
};

export type SlotRuntimeCapability = {
  [Key in SlotComponentImplementationKey]: SlotRuntimeIdentity & {
    identity: string;
    implementationKey: Key;
  };
}[SlotComponentImplementationKey];

const manifest =
  skinovaManifestTemplate as unknown as TemplatePackageManifestTemplate;

const templateImplementations = {
  homepage: { implementationKey: "skinova-home", bindingKind: "component" },
  articles_list: {
    implementationKey: "skinova-home",
    bindingKind: "integrated",
  },
  article: { implementationKey: "skinova-article", bindingKind: "component" },
  category: {
    implementationKey: "skinova-category",
    bindingKind: "component",
  },
  header: { implementationKey: "skinova-chrome", bindingKind: "integrated" },
  footer: { implementationKey: "skinova-chrome", bindingKind: "integrated" },
  system_page: {
    implementationKey: "skinova-system-page",
    bindingKind: "component",
  },
} as const satisfies Record<
  TemplatePackageTemplateKind,
  | {
      implementationKey: TemplateComponentImplementationKey;
      bindingKind: "component";
    }
  | {
      implementationKey: TemplateIntegratedImplementationKey;
      bindingKind: "integrated";
    }
>;

export function templateRuntimeIdentity(identity: TemplateRuntimeIdentity) {
  return [
    identity.packageId,
    identity.packageVersion,
    identity.kind,
    identity.key,
    identity.templateVersion,
  ].join(":");
}

export function slotRuntimeIdentity(identity: SlotRuntimeIdentity) {
  return [
    identity.packageId,
    identity.packageVersion,
    identity.rendererKey,
  ].join(":");
}

export const SKINOVA_TEMPLATE_RUNTIME_CATALOG: TemplateRuntimeCapability[] =
  manifest.templates.map((template) => ({
    packageId: manifest.packageId,
    packageVersion: manifest.packageVersion,
    kind: template.kind,
    key: template.key,
    templateVersion: template.version,
    identity: templateRuntimeIdentity({
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      kind: template.kind,
      key: template.key,
      templateVersion: template.version,
    }),
    template,
    ...templateImplementations[template.kind],
  }));

const slotRendererKeys = manifest.templates.flatMap((template) =>
  (template.slots ?? []).map((slot) => slot.renderer),
);

function requireSlotImplementationKey(rendererKey: string) {
  if (rendererKey in slotImplementations)
    return rendererKey as SlotComponentImplementationKey;
  throw new Error(`Skinova slot renderer ${rendererKey} has no runtime binding`);
}

export const SKINOVA_SLOT_RUNTIME_CATALOG: SlotRuntimeCapability[] =
  slotRendererKeys.map((rendererKey) => {
    const implementationKey = requireSlotImplementationKey(rendererKey);
    return {
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      rendererKey,
      identity: slotRuntimeIdentity({
        packageId: manifest.packageId,
        packageVersion: manifest.packageVersion,
        rendererKey,
      }),
      implementationKey,
    } as SlotRuntimeCapability;
  });

const templateRuntimeCatalog = new Map<string, TemplateRuntimeCapability>(
  SKINOVA_TEMPLATE_RUNTIME_CATALOG.map((capability) => [
    capability.identity,
    capability,
  ]),
);

const slotRuntimeCatalog = new Map<string, SlotRuntimeCapability>(
  SKINOVA_SLOT_RUNTIME_CATALOG.map((capability) => [
    capability.identity,
    capability,
  ]),
);

export function resolveTemplateRuntime(identity: TemplateRuntimeIdentity) {
  return templateRuntimeCatalog.get(templateRuntimeIdentity(identity)) ?? null;
}

export function resolveSlotRuntime(identity: SlotRuntimeIdentity) {
  return slotRuntimeCatalog.get(slotRuntimeIdentity(identity)) ?? null;
}
