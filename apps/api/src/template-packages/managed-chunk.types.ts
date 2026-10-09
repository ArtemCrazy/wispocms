import type {
  TemplatePackageManifest,
  TemplatePackageTemplate,
} from './template-package.types';

export const MANAGED_CHUNK_WIDGETS = [
  'text',
  'textarea',
  'html',
  'number',
  'boolean',
  'select',
  'link',
  'image',
  'mediaFile',
  'group',
  'repeater',
] as const;

export const CMS_CHUNK_ICON_KEYS = [
  'banner',
  'cards',
  'content',
  'media',
  'layout',
] as const;

export const CMS_IFRAME_PROVIDER_IDS = ['youtube'] as const;

export const MANAGED_LINK_PROTOCOLS = [
  'https',
  'http',
  'mailto',
  'tel',
] as const;

export const MANAGED_LINK_TARGETS = ['_self', '_blank'] as const;

export type CmsChunkIconKey = (typeof CMS_CHUNK_ICON_KEYS)[number];
export type CmsIframeProviderId = (typeof CMS_IFRAME_PROVIDER_IDS)[number];
export type ManagedLinkProtocol = (typeof MANAGED_LINK_PROTOCOLS)[number];
export type ManagedLinkTarget = (typeof MANAGED_LINK_TARGETS)[number];

export type ManagedChunkFieldBase = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
};

export type ManagedChunkTextField = ManagedChunkFieldBase & {
  widget: 'text' | 'textarea';
  constraints?: {
    minLength?: number;
    maxLength?: number;
  };
};

export type ManagedChunkHtmlField = ManagedChunkFieldBase & {
  widget: 'html';
  constraints?: {
    minLength?: number;
    maxLength?: number;
    iframeProviders?: CmsIframeProviderId[];
  };
};

export type ManagedChunkNumberField = ManagedChunkFieldBase & {
  widget: 'number';
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
  };
};

export type ManagedChunkBooleanField = ManagedChunkFieldBase & {
  widget: 'boolean';
};

export type ManagedChunkSelectField = ManagedChunkFieldBase & {
  widget: 'select';
  options: Array<{
    value: string;
    label: string;
  }>;
};

export type ManagedChunkLinkField = ManagedChunkFieldBase & {
  widget: 'link';
  constraints?: {
    protocols?: ManagedLinkProtocol[];
    targets?: ManagedLinkTarget[];
    maxUrlLength?: number;
    maxLabelLength?: number;
  };
};

export type ManagedChunkImageField = ManagedChunkFieldBase & {
  widget: 'image';
  constraints?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };
};

export type ManagedChunkMediaFileField = ManagedChunkFieldBase & {
  widget: 'mediaFile';
};

export type ManagedChunkGroupField = ManagedChunkFieldBase & {
  widget: 'group';
  fields: ManagedChunkField[];
};

export type ManagedChunkRepeaterField = ManagedChunkFieldBase & {
  widget: 'repeater';
  fields: ManagedChunkField[];
  constraints?: {
    minItems?: number;
    maxItems?: number;
  };
};

export type ManagedChunkField =
  | ManagedChunkTextField
  | ManagedChunkHtmlField
  | ManagedChunkNumberField
  | ManagedChunkBooleanField
  | ManagedChunkSelectField
  | ManagedChunkLinkField
  | ManagedChunkImageField
  | ManagedChunkMediaFileField
  | ManagedChunkGroupField
  | ManagedChunkRepeaterField;

export type ManagedChunkCategory = {
  key: string;
  title: string;
  order: number;
  iconKey?: CmsChunkIconKey;
};

export type ManagedChunkDefinition = {
  key: string;
  schemaVersion: string;
  title: string;
  categoryKey: string;
  rendererKey: string;
  contractDigest?: string;
  fields: ManagedChunkField[];
};

export type ManagedChunkReference = {
  definitionKey: string;
  schemaVersion: string;
};

export type ManagedChunkSlot = {
  key: string;
  title: string;
  placement: string;
  maxItems: number;
  allowedChunks: ManagedChunkReference[];
};

export type TemplatePackageTemplateV2 = Omit<
  TemplatePackageTemplate,
  'slots'
> & {
  slots?: ManagedChunkSlot[];
};

export type TemplatePackageManifestV2 = Omit<
  TemplatePackageManifest,
  'manifestVersion' | 'templates'
> & {
  manifestVersion: 2;
  chunkCategories: ManagedChunkCategory[];
  chunkDefinitions: ManagedChunkDefinition[];
  templates: TemplatePackageTemplateV2[];
};
