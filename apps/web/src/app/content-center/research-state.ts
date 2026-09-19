export const RESEARCH_TYPES = [
  { id: "competitive", label: "Конкурентный анализ" },
  { id: "jtbd", label: "JTBD" },
  { id: "demand", label: "Анализ спроса" },
  { id: "seo", label: "SEO-анализ" },
] as const;
export const RESEARCH_STEPS = [
  { id: "data", label: "Данные" },
  { id: "sources", label: "Поиск источников" },
  { id: "result", label: "Результат" },
] as const;
export type ResearchType = (typeof RESEARCH_TYPES)[number]["id"];
export type ResearchStep = (typeof RESEARCH_STEPS)[number]["id"];
export type ResearchCategory = { id: string; name: string; enabled: boolean };
export type ResearchSource = {
  id: string;
  name: string;
  url: string;
  categoryId: string;
  included: boolean;
  description: string;
};
export type ResearchDraft = {
  revision: number;
  contextKind: "conclusions" | "full";
  direction: string;
  categories: ResearchCategory[];
  sources: ResearchSource[];
};
export type ResearchConfirmation = {
  id: string;
  draft_revision: number;
  preparation_version_id: string | null;
  context_kind: string;
  context_text: string | null;
  direction: string;
  categories: ResearchCategory[];
  sources: ResearchSource[];
  actor_name: string;
  created_at: string;
};
export type ResearchOverview = {
  draft: ResearchDraft;
  prepared: {
    id: string;
    number: number;
    content: string;
    created_at: string;
  } | null;
  conclusions: null;
  confirmations: Omit<
    ResearchConfirmation,
    "sources" | "categories" | "context_text"
  >[];
  searchConnected: boolean;
};
export function researchLocation(params: URLSearchParams): {
  type: ResearchType;
  step: ResearchStep;
} {
  return {
    type:
      RESEARCH_TYPES.find((item) => item.id === params.get("research"))?.id ??
      "competitive",
    step:
      RESEARCH_STEPS.find((item) => item.id === params.get("researchStep"))
        ?.id ?? "data",
  };
}
export function researchReady(
  draft: ResearchDraft,
  prepared: ResearchOverview["prepared"],
) {
  if (prepared && draft.contextKind === "conclusions")
    return "Структурированные выводы пока не сформированы. На вкладке «Данные» выберите полный результат.";
  if (!prepared && !draft.direction.trim())
    return "Укажите направление исследования — обработанных материалов пока нет.";
  if (!draft.sources.some((source) => source.included))
    return "Выберите хотя бы один источник для исследования.";
  return null;
}
