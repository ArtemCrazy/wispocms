import assert from "node:assert/strict";
import {
  initialManagedChunkData,
  managedChunkActions,
  managedChunkDraftDirty,
  managedChunkWorkflowEnabled,
  normalizeManagedChunkDraft,
  siteManagedChunkImages,
  type ManagedChunkField,
  type ManagedChunkInstanceDetail,
  type ManagedChunkMediaItem,
} from "./managed-chunks-model";

const fields: ManagedChunkField[] = [
  {
    key: "title",
    label: "Заголовок",
    widget: "text",
    nullable: true,
    constraints: { maxLength: 200 },
  },
  {
    key: "subtitle",
    label: "Подзаголовок",
    widget: "textarea",
    nullable: true,
  },
  { key: "media_id", label: "Изображение", widget: "image", nullable: true },
  {
    key: "sort_order",
    label: "Порядок",
    widget: "number",
    required: true,
    constraints: { min: 0, max: 9999, step: 1 },
  },
  {
    key: "is_active",
    label: "Активен",
    widget: "boolean",
    required: true,
  },
];

assert.deepEqual(initialManagedChunkData(fields), {
  title: null,
  subtitle: null,
  media_id: null,
  sort_order: 0,
  is_active: false,
});

assert.deepEqual(
  normalizeManagedChunkDraft(fields, {
    title: "  Новая линия  ",
    subtitle: "",
    media_id: {
      mediaId: "437ce5ec-e048-4330-b09f-520a93e3cbe7",
      alt: "  Девушка с кремом  ",
      decorative: false,
    },
    sort_order: "12",
    is_active: true,
  }),
  {
    title: "Новая линия",
    subtitle: null,
    media_id: {
      mediaId: "437ce5ec-e048-4330-b09f-520a93e3cbe7",
      alt: "Девушка с кремом",
      decorative: false,
    },
    sort_order: 12,
    is_active: true,
  },
);

const detail = {
  allowedActions: ["save", "submit", "request_changes", "restore"],
} as ManagedChunkInstanceDetail;
assert.deepEqual(managedChunkActions(detail), {
  save: true,
  submit: true,
  approve: false,
  requestChanges: true,
  publish: false,
  restore: true,
});

assert.throws(
  () => normalizeManagedChunkDraft(fields, { ...initialManagedChunkData(fields), extra: true }),
  /Неизвестное поле чанка/,
);
assert.throws(
  () => initialManagedChunkData([{ key: "body", label: "Текст", widget: "html" } as never]),
  /Неподдерживаемый виджет чанка/,
);

const mediaItems: ManagedChunkMediaItem[] = [
  {
    id: "same-site-image",
    originalName: "hero.webp",
    altText: null,
    mimeType: "image/webp",
    site: { id: "site-1", name: "Skinova", slug: "skinova" },
  },
  {
    id: "foreign-site-image",
    originalName: "foreign.webp",
    altText: null,
    mimeType: "image/webp",
    site: { id: "site-2", name: "Другой сайт", slug: "other" },
  },
  {
    id: "same-site-file",
    originalName: "brief.pdf",
    altText: null,
    mimeType: "application/pdf",
    site: { id: "site-1", name: "Skinova", slug: "skinova" },
  },
];
assert.deepEqual(
  siteManagedChunkImages(mediaItems, "site-1").map((item) => item.id),
  ["same-site-image"],
);

const baselineValues = initialManagedChunkData(fields);
assert.equal(managedChunkDraftDirty(fields, baselineValues, baselineValues), false);
assert.equal(
  managedChunkDraftDirty(fields, baselineValues, baselineValues, "", "Новый чанк"),
  true,
);
const dirtyValues = { ...baselineValues, title: "Изменённый заголовок" };
assert.equal(managedChunkDraftDirty(fields, baselineValues, dirtyValues), true);
assert.equal(managedChunkWorkflowEnabled(detail, "submit", false), true);
assert.equal(
  managedChunkWorkflowEnabled(
    detail,
    "submit",
    managedChunkDraftDirty(fields, baselineValues, dirtyValues),
  ),
  false,
);