export type ManagedChunkTextField = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
  widget: "text" | "textarea";
  constraints?: { minLength?: number; maxLength?: number };
};

export type ManagedChunkImageField = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
  widget: "image";
  constraints?: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };
};

export type ManagedChunkNumberField = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
  widget: "number";
  constraints?: { min?: number; max?: number; step?: number };
};

export type ManagedChunkBooleanField = {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
  nullable?: boolean;
  widget: "boolean";
};

export type ManagedChunkField =
  | ManagedChunkTextField
  | ManagedChunkImageField
  | ManagedChunkNumberField
  | ManagedChunkBooleanField;

export type ManagedChunkCatalogDefinition = {
  contractId: string;
  key: string;
  schemaVersion: string;
  title: string;
  fields: ManagedChunkField[];
};

export type ManagedChunkCatalogCategory = {
  key: string;
  title: string;
  order: number;
  iconKey: string;
  definitions: ManagedChunkCatalogDefinition[];
};

export type ManagedChunkCatalog = {
  categories: ManagedChunkCatalogCategory[];
};

export type ManagedChunkReviewState =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved";

export type ManagedChunkInstanceSummary = {
  id: string;
  displayName: string;
  categoryKey: string;
  definitionKey: string;
  schemaVersion: string;
  reviewState: ManagedChunkReviewState;
  updatedAt: string;
};

export type ManagedChunkRevisionData = {
  id: string;
  versionNumber: number;
  data: Record<string, unknown>;
};

export type ManagedChunkInstanceDetail = ManagedChunkInstanceSummary & {
  fields: ManagedChunkField[];
  published: ManagedChunkRevisionData | null;
  draft: ManagedChunkRevisionData | null;
  allowedActions: string[];
};

export type ManagedChunkImageValue = {
  mediaId: string;
  alt: string;
  decorative: boolean;
};

export type ManagedChunkMediaItem = {
  id: string;
  originalName: string;
  altText: string | null;
  mimeType: string;
  site: { id: string; name: string; slug: string } | null;
};

export function siteManagedChunkImages(
  items: readonly ManagedChunkMediaItem[],
  siteId: string,
): ManagedChunkMediaItem[] {
  return items.filter(
    (item) => item.site?.id === siteId && item.mimeType.startsWith("image/"),
  );
}

const supportedWidgets = new Set(["text", "textarea", "image", "number", "boolean"]);

function assertSupportedField(field: ManagedChunkField): void {
  if (!supportedWidgets.has(field.widget)) {
    throw new Error(`Неподдерживаемый виджет чанка: ${String(field.widget)}`);
  }
}

function initialNumber(field: ManagedChunkNumberField): number {
  const minimum = field.constraints?.min;
  const maximum = field.constraints?.max;
  if (minimum !== undefined) return minimum;
  if (maximum !== undefined && maximum < 0) return maximum;
  return 0;
}

export function initialManagedChunkData(
  fields: readonly ManagedChunkField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    assertSupportedField(field);
    if (Object.hasOwn(result, field.key)) {
      throw new Error(`Повторяющееся поле чанка: ${field.key}`);
    }
    switch (field.widget) {
      case "text":
      case "textarea":
        result[field.key] = field.nullable ? null : "";
        break;
      case "image":
        result[field.key] = null;
        break;
      case "number":
        result[field.key] = initialNumber(field);
        break;
      case "boolean":
        result[field.key] = false;
        break;
    }
  }
  return result;
}

function normalizeText(field: ManagedChunkTextField, value: unknown): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`Некорректное значение поля «${field.label}»`);
  }
  const normalized = (value ?? "").trim();
  if (!normalized && field.nullable) return null;
  const minimum = field.constraints?.minLength;
  const maximum = field.constraints?.maxLength;
  if (minimum !== undefined && normalized.length < minimum) {
    throw new Error(`Поле «${field.label}» короче допустимого`);
  }
  if (maximum !== undefined && normalized.length > maximum) {
    throw new Error(`Поле «${field.label}» длиннее допустимого`);
  }
  return normalized;
}

function normalizeImage(
  field: ManagedChunkImageField,
  value: unknown,
): ManagedChunkImageValue | null {
  if (value === null || value === "" || value === undefined) {
    if (!field.nullable && field.required) {
      throw new Error(`Выберите изображение для поля «${field.label}»`);
    }
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Некорректное изображение в поле «${field.label}»`);
  }
  const image = value as Record<string, unknown>;
  if (
    Object.keys(image).some(
      (key) => !["mediaId", "alt", "decorative"].includes(key),
    ) ||
    typeof image.mediaId !== "string" ||
    !image.mediaId ||
    typeof image.alt !== "string" ||
    typeof image.decorative !== "boolean"
  ) {
    throw new Error(`Некорректное изображение в поле «${field.label}»`);
  }
  return {
    mediaId: image.mediaId,
    alt: image.alt.trim(),
    decorative: image.decorative,
  };
}

function normalizeNumber(field: ManagedChunkNumberField, value: unknown): number | null {
  if ((value === "" || value === null || value === undefined) && field.nullable) {
    return null;
  }
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`Некорректное число в поле «${field.label}»`);
  }
  const { min, max, step } = field.constraints ?? {};
  if (min !== undefined && normalized < min) {
    throw new Error(`Значение поля «${field.label}» меньше допустимого`);
  }
  if (max !== undefined && normalized > max) {
    throw new Error(`Значение поля «${field.label}» больше допустимого`);
  }
  const stepBase = min ?? 0;
  if (
    step !== undefined &&
    step > 0 &&
    Math.abs((normalized - stepBase) / step - Math.round((normalized - stepBase) / step)) >
      Number.EPSILON * 10
  ) {
    throw new Error(`Значение поля «${field.label}» не соответствует шагу`);
  }
  return normalized;
}

export function normalizeManagedChunkDraft(
  fields: readonly ManagedChunkField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const keys = new Set(fields.map((field) => field.key));
  const unknownKey = Object.keys(values).find((key) => !keys.has(key));
  if (unknownKey) throw new Error(`Неизвестное поле чанка: ${unknownKey}`);

  const result: Record<string, unknown> = {};
  for (const field of fields) {
    assertSupportedField(field);
    if (Object.hasOwn(result, field.key)) {
      throw new Error(`Повторяющееся поле чанка: ${field.key}`);
    }
    const value = values[field.key];
    switch (field.widget) {
      case "text":
      case "textarea":
        result[field.key] = normalizeText(field, value);
        break;
      case "image":
        result[field.key] = normalizeImage(field, value);
        break;
      case "number":
        result[field.key] = normalizeNumber(field, value);
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          throw new Error(`Некорректный переключатель «${field.label}»`);
        }
        result[field.key] = value;
        break;
    }
  }
  return result;
}

export function managedChunkDraftDirty(
  fields: readonly ManagedChunkField[],
  baseline: Record<string, unknown>,
  values: Record<string, unknown>,
  baselineDisplayName = "",
  displayName = baselineDisplayName,
): boolean {
  try {
    return (
      baselineDisplayName !== displayName ||
      JSON.stringify(normalizeManagedChunkDraft(fields, baseline)) !==
        JSON.stringify(normalizeManagedChunkDraft(fields, values))
    );
  } catch {
    return true;
  }
}
export function managedChunkActions(detail: ManagedChunkInstanceDetail) {
  const allowed = new Set(detail.allowedActions);
  return {
    save: allowed.has("save"),
    submit: allowed.has("submit"),
    approve: allowed.has("approve"),
    requestChanges: allowed.has("request_changes"),
    publish: allowed.has("publish"),
    restore: allowed.has("restore"),
  };
}

export type ManagedChunkUiAction = keyof ReturnType<typeof managedChunkActions>;

export function managedChunkWorkflowEnabled(
  detail: ManagedChunkInstanceDetail,
  action: Exclude<ManagedChunkUiAction, "save">,
  dirty: boolean,
): boolean {
  return !dirty && managedChunkActions(detail)[action];
}