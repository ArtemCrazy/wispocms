export const CONTENT_CENTER_SECTIONS = [
  {
    id: "preparation",
    label: "Подготовка информации",
    description:
      "Соберите ссылки, файлы и сведения клиента. Подготовьте задачу и получите единый документ о проекте.",
  },
  {
    id: "research",
    label: "Исследование и анализ",
    description:
      "Подготовьте конкурентный анализ: выберите данные о проекте, соберите и подтвердите источники исследования.",
  },
  {
    id: "creation",
    label: "Создание контента",
    description:
      "Подготовка статей на основе информации о проекте и кластеров поисковых запросов.",
  },
] as const;

export type ContentCenterSection =
  (typeof CONTENT_CENTER_SECTIONS)[number]["id"];
export type ContentCenterScreen =
  ContentCenterSection | "root" | "history" | "document";

export function parseContentCenterScreen(
  value: string | null,
): ContentCenterScreen {
  if (
    value === "history" ||
    value === "document" ||
    CONTENT_CENTER_SECTIONS.some((section) => section.id === value)
  ) {
    return value as ContentCenterScreen;
  }
  return "root";
}

export function contentCenterSection(
  screen: ContentCenterScreen,
): ContentCenterSection | null {
  if (screen === "root") return null;
  return screen === "history" || screen === "document" ? "preparation" : screen;
}
