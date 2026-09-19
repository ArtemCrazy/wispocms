/** A label is a saved snapshot, never the current library prompt's title. */
export function preparationVersionLabel(version: {
  number: number;
  prompt_title?: string | null;
}) {
  return `${version.prompt_title?.trim() || "Запрос без сохранённого названия"} · версия ${version.number}`;
}

export function preparationDraftTitle(
  draft: { prompt_title?: string | null; instruction: string },
  prompts: Array<{ title: string; content: string }>,
) {
  if (draft.prompt_title != null) return draft.prompt_title;
  // Only prefill a new request when the copied text has one exact match.
  // This must never infer titles of historical versions.
  const matches = prompts.filter(
    (prompt) => prompt.content.trim() === draft.instruction.trim(),
  );
  return matches.length === 1 ? matches[0].title : "";
}
