import Link from "next/link";

export type NotFoundTemplateData = {
  key: string;
  version: string;
  name: string;
  description: string;
  eyebrow: string;
  code: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  tone: "violet" | "lime";
  alignment: "center" | "left";
  visual: "orbit" | "grid";
};

export const safeNotFoundTemplate: NotFoundTemplateData = {
  key: "signal",
  version: "1",
  name: "Сигнал",
  description: "Безопасная системная страница.",
  eyebrow: "Ошибка навигации",
  code: "404",
  title: "Страница не найдена",
  text: "Похоже, такой страницы больше нет или адрес введён неверно.",
  buttonLabel: "Вернуться на главную",
  buttonUrl: "/",
  tone: "violet",
  alignment: "center",
  visual: "orbit",
};

export function NotFoundTemplate({
  template,
  siteName,
  homeHref,
  preview = false,
}: {
  template: NotFoundTemplateData;
  siteName: string;
  homeHref: string;
  preview?: boolean;
}) {
  const buttonHref = template.buttonUrl === "/" ? homeHref : template.buttonUrl;
  return (
    <main
      className={`not-found-template tone-${template.tone} align-${template.alignment} visual-${template.visual} ${preview ? "is-preview" : ""}`}
    >
      <div className="not-found-template-brand">{siteName}</div>
      <div className="not-found-template-art" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <section>
        <small>{template.eyebrow}</small>
        <strong aria-hidden="true">{template.code}</strong>
        <h1>{template.title}</h1>
        <p>{template.text}</p>
        <Link href={buttonHref}>{template.buttonLabel} →</Link>
      </section>
    </main>
  );
}
