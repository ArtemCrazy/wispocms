"use client";

import {
  armaturexBlocks,
  resolveArmaturexContent,
  type ArmaturexHomepageContent,
  type TemplatePageBlock,
} from "./homepage-templates";

type MediaItem = { id: string; originalName: string; altText: string | null };

export function ArmaturexHomeEditor({
  blocks,
  media,
  disabled,
  onChange,
}: {
  blocks: TemplatePageBlock[];
  media: MediaItem[];
  disabled: boolean;
  onChange: (blocks: TemplatePageBlock[]) => void;
}) {
  const content = resolveArmaturexContent(blocks);
  const update = (next: ArmaturexHomepageContent) =>
    onChange(armaturexBlocks(next));
  const field = <K extends keyof ArmaturexHomepageContent>(
    key: K,
    value: ArmaturexHomepageContent[K],
  ) => update({ ...content, [key]: value });

  return (
    <div className="blocks-column armaturex-template-editor">
      <article className="block-card">
        <header>
          <span aria-hidden="true">01</span>
          <strong>Первый экран и кнопки</strong>
        </header>
        <label>
          Надзаголовок
          <input
            disabled={disabled}
            value={content.eyebrow}
            maxLength={160}
            onChange={(event) => field("eyebrow", event.target.value)}
          />
        </label>
        <label>
          Главный заголовок
          <input
            disabled={disabled}
            value={content.title}
            maxLength={240}
            onChange={(event) => field("title", event.target.value)}
          />
        </label>
        <label>
          Описание
          <textarea
            disabled={disabled}
            value={content.lead}
            rows={4}
            maxLength={5000}
            onChange={(event) => field("lead", event.target.value)}
          />
        </label>
        <div className="block-grid">
          <label>
            Основная кнопка
            <input
              disabled={disabled}
              value={content.primaryCta.label}
              maxLength={80}
              onChange={(event) =>
                field("primaryCta", {
                  ...content.primaryCta,
                  label: event.target.value,
                })
              }
            />
          </label>
          <label>
            Ссылка
            <input
              disabled={disabled}
              value={content.primaryCta.href}
              maxLength={500}
              onChange={(event) =>
                field("primaryCta", {
                  ...content.primaryCta,
                  href: event.target.value,
                })
              }
            />
          </label>
        </div>
        <div className="block-grid">
          <label>
            Вторая кнопка
            <input
              disabled={disabled}
              value={content.secondaryCta.label}
              maxLength={80}
              onChange={(event) =>
                field("secondaryCta", {
                  ...content.secondaryCta,
                  label: event.target.value,
                })
              }
            />
          </label>
          <label>
            Ссылка
            <input
              disabled={disabled}
              value={content.secondaryCta.href}
              maxLength={500}
              onChange={(event) =>
                field("secondaryCta", {
                  ...content.secondaryCta,
                  href: event.target.value,
                })
              }
            />
          </label>
        </div>
      </article>

      <article className="block-card">
        <header>
          <span aria-hidden="true">02</span>
          <strong>Показатели</strong>
        </header>
        {content.stats.map((item, index) => (
          <div className="block-grid" key={index}>
            <label>
              Значение
              <input
                disabled={disabled}
                value={item.value}
                maxLength={40}
                onChange={(event) =>
                  field(
                    "stats",
                    content.stats.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, value: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Подпись
              <input
                disabled={disabled}
                value={item.label}
                maxLength={160}
                onChange={(event) =>
                  field(
                    "stats",
                    content.stats.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, label: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
      </article>

      <article className="block-card">
        <header>
          <span aria-hidden="true">03</span>
          <strong>Каталог на главной</strong>
        </header>
        <div className="block-grid">
          <label>
            Заголовок
            <input
              disabled={disabled}
              value={content.catalogTitle}
              maxLength={200}
              onChange={(event) => field("catalogTitle", event.target.value)}
            />
          </label>
          <label>
            Подпись
            <input
              disabled={disabled}
              value={content.catalogNote}
              maxLength={200}
              onChange={(event) => field("catalogNote", event.target.value)}
            />
          </label>
        </div>
        {content.catalog.map((item, index) => (
          <details className="template-repeater" key={index}>
            <summary>
              {index + 1}. {item.name}
            </summary>
            <div className="block-grid">
              <label>
                Название
                <input
                  disabled={disabled}
                  value={item.name}
                  maxLength={120}
                  onChange={(event) =>
                    field(
                      "catalog",
                      content.catalog.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, name: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Количество
                <input
                  disabled={disabled}
                  value={item.count}
                  maxLength={20}
                  onChange={(event) =>
                    field(
                      "catalog",
                      content.catalog.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, count: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
            </div>
            <label>
              Безопасная ссылка
              <input
                disabled={disabled}
                value={item.href}
                maxLength={500}
                onChange={(event) =>
                  field(
                    "catalog",
                    content.catalog.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, href: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Изображение из медиатеки
              <select
                disabled={disabled}
                value={item.imageMediaId ?? ""}
                onChange={(event) =>
                  field(
                    "catalog",
                    content.catalog.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            imageMediaId: event.target.value || undefined,
                          }
                        : row,
                    ),
                  )
                }
              >
                <option value="">Изображение шаблона</option>
                {media.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.altText || asset.originalName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Подразделы, строка «Название | ссылка»
              <textarea
                disabled={disabled}
                rows={4}
                value={item.subitems
                  .map((subitem) => `${subitem.label} | ${subitem.href}`)
                  .join("\n")}
                onChange={(event) =>
                  field(
                    "catalog",
                    content.catalog.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            subitems: event.target.value
                              .split("\n")
                              .filter(Boolean)
                              .slice(0, 8)
                              .map((line) => {
                                const [label, href] = line.split("|");
                                return {
                                  label: label.trim(),
                                  href: href?.trim() || "#request",
                                };
                              }),
                          }
                        : row,
                    ),
                  )
                }
              />
            </label>
          </details>
        ))}
      </article>

      <article className="block-card">
        <header>
          <span aria-hidden="true">04</span>
          <strong>Условия поставки</strong>
        </header>
        <label>
          Заголовок
          <input
            disabled={disabled}
            value={content.termsTitle}
            maxLength={200}
            onChange={(event) => field("termsTitle", event.target.value)}
          />
        </label>
        {content.terms.map((item, index) => (
          <details className="template-repeater" key={index}>
            <summary>
              {item.number}. {item.title}
            </summary>
            <label>
              Название
              <input
                disabled={disabled}
                value={item.title}
                maxLength={160}
                onChange={(event) =>
                  field(
                    "terms",
                    content.terms.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, title: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Описание
              <textarea
                disabled={disabled}
                value={item.text}
                rows={3}
                maxLength={1000}
                onChange={(event) =>
                  field(
                    "terms",
                    content.terms.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, text: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Ссылка
              <input
                disabled={disabled}
                value={item.href}
                maxLength={500}
                onChange={(event) =>
                  field(
                    "terms",
                    content.terms.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, href: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Изображение из медиатеки
              <select
                disabled={disabled}
                value={item.imageMediaId ?? ""}
                onChange={(event) =>
                  field(
                    "terms",
                    content.terms.map((row, rowIndex) =>
                      rowIndex === index
                        ? {
                            ...row,
                            imageMediaId: event.target.value || undefined,
                          }
                        : row,
                    ),
                  )
                }
              >
                <option value="">Изображение шаблона</option>
                {media.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.altText || asset.originalName}
                  </option>
                ))}
              </select>
            </label>
          </details>
        ))}
      </article>

      <article className="block-card">
        <header>
          <span aria-hidden="true">05</span>
          <strong>Вопросы и ответы</strong>
        </header>
        <label>
          Заголовок
          <input
            disabled={disabled}
            value={content.faqTitle}
            maxLength={200}
            onChange={(event) => field("faqTitle", event.target.value)}
          />
        </label>
        {content.faq.map((item, index) => (
          <details className="template-repeater" key={index}>
            <summary>
              {index + 1}. {item.question}
            </summary>
            <label>
              Вопрос
              <input
                disabled={disabled}
                value={item.question}
                maxLength={300}
                onChange={(event) =>
                  field(
                    "faq",
                    content.faq.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, question: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Ответ
              <textarea
                disabled={disabled}
                value={item.answer}
                rows={4}
                maxLength={3000}
                onChange={(event) =>
                  field(
                    "faq",
                    content.faq.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, answer: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
          </details>
        ))}
      </article>

      <article className="block-card">
        <header>
          <span aria-hidden="true">06</span>
          <strong>Заявка</strong>
        </header>
        <label>
          Заголовок
          <input
            disabled={disabled}
            value={content.requestTitle}
            maxLength={240}
            onChange={(event) => field("requestTitle", event.target.value)}
          />
        </label>
        <label>
          Описание
          <textarea
            disabled={disabled}
            value={content.requestLead}
            rows={3}
            maxLength={1000}
            onChange={(event) => field("requestLead", event.target.value)}
          />
        </label>
        <div className="block-grid">
          <label>
            Название формы
            <input
              disabled={disabled}
              value={content.requestFormTitle}
              maxLength={120}
              onChange={(event) =>
                field("requestFormTitle", event.target.value)
              }
            />
          </label>
          <label>
            Текст кнопки
            <input
              disabled={disabled}
              value={content.requestSubmitLabel}
              maxLength={80}
              onChange={(event) =>
                field("requestSubmitLabel", event.target.value)
              }
            />
          </label>
        </div>
        <p>
          Вложения отключены: текущий защищённый endpoint принимает только
          текстовые данные.
        </p>
      </article>
    </div>
  );
}
