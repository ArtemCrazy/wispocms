"use client";

import { ClipboardEvent, useRef, useState } from "react";

export type ArticleDocumentBlock =
  | { id: string; type: "heading"; text: string; level: 2 | 3 | 4 }
  | { id: string; type: "paragraph"; text: string; href?: string | null }
  | {
      id: string;
      type: "image";
      mediaId: string;
      alt?: string;
      caption?: string;
    }
  | { id: string; type: "bullet_list"; items: string[] }
  | { id: string; type: "numbered_list"; items: string[] }
  | { id: string; type: "quote"; text: string; cite?: string };

export type ArticleDocument = { version: 1; blocks: ArticleDocumentBlock[] };

type MediaOption = { id: string; originalName: string; altText: string | null };

export function legacyDocument(body: string): ArticleDocument {
  return {
    version: 1,
    blocks: body.trim()
      ? [{ id: "legacy-body", type: "paragraph", text: body }]
      : [],
  };
}

export function documentText(document: ArticleDocument) {
  return document.blocks
    .flatMap((block) => {
      if (block.type === "image") return [block.alt, block.caption];
      if (block.type === "bullet_list" || block.type === "numbered_list")
        return block.items;
      return block.type === "quote" ? [block.text, block.cite] : [block.text];
    })
    .filter(Boolean)
    .join("\n\n");
}

function blockId() {
  return `block-${crypto.randomUUID()}`;
}

function newBlock(type: ArticleDocumentBlock["type"]): ArticleDocumentBlock {
  if (type === "heading") return { id: blockId(), type, level: 2, text: "" };
  if (type === "image") return { id: blockId(), type, mediaId: "", alt: "" };
  if (type === "bullet_list" || type === "numbered_list")
    return { id: blockId(), type, items: [""] };
  if (type === "quote") return { id: blockId(), type, text: "", cite: "" };
  return { id: blockId(), type: "paragraph", text: "", href: null };
}

function PlainPasteTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const plain = event.clipboardData.getData("text/plain");
    if (!plain) return;
    event.preventDefault();
    const element = event.currentTarget;
    const next = `${element.value.slice(0, element.selectionStart)}${plain}${element.value.slice(element.selectionEnd)}`;
    element.value = next;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return <textarea {...props} onPaste={paste} />;
}

export function StructuredArticleEditor({
  value,
  onChange,
  media,
  readOnly,
}: {
  value: ArticleDocument;
  onChange: (next: ArticleDocument) => void;
  media: MediaOption[];
  readOnly?: boolean;
}) {
  const [past, setPast] = useState<ArticleDocument[]>([]);
  const [future, setFuture] = useState<ArticleDocument[]>([]);
  const addType = useRef<ArticleDocumentBlock["type"]>("paragraph");

  function commit(next: ArticleDocument) {
    setPast((items) => [...items.slice(-49), value]);
    setFuture([]);
    onChange(next);
  }

  function update(index: number, block: ArticleDocumentBlock) {
    commit({
      ...value,
      blocks: value.blocks.map((item, i) => (i === index ? block : item)),
    });
  }

  function add(index: number) {
    const blocks = [...value.blocks];
    blocks.splice(index, 0, newBlock(addType.current));
    commit({ version: 1, blocks });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= value.blocks.length) return;
    const blocks = [...value.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    commit({ version: 1, blocks });
  }

  return (
    <section
      className="structured-editor"
      aria-label="Визуальный редактор статьи"
    >
      <div className="structured-editor-toolbar">
        <label>
          Новый блок
          <select
            disabled={readOnly}
            defaultValue="paragraph"
            onChange={(event) =>
              (addType.current = event.target
                .value as ArticleDocumentBlock["type"])
            }
          >
            <option value="paragraph">Абзац</option>
            <option value="heading">Заголовок</option>
            <option value="image">Изображение</option>
            <option value="bullet_list">Маркированный список</option>
            <option value="numbered_list">Нумерованный список</option>
            <option value="quote">Цитата</option>
          </select>
        </label>
        <button type="button" disabled={readOnly} onClick={() => add(0)}>
          ＋ В начало
        </button>
        <button
          type="button"
          disabled={readOnly || !past.length}
          onClick={() => {
            const previous = past.at(-1);
            if (!previous) return;
            setPast((items) => items.slice(0, -1));
            setFuture((items) => [value, ...items]);
            onChange(previous);
          }}
        >
          ↶ Отменить
        </button>
        <button
          type="button"
          disabled={readOnly || !future.length}
          onClick={() => {
            const next = future[0];
            setFuture((items) => items.slice(1));
            setPast((items) => [...items, value]);
            onChange(next);
          }}
        >
          ↷ Повторить
        </button>
      </div>
      <p className="structured-editor-hint">
        Вставка из Word и сайтов очищается до обычного текста. Все ссылки и
        изображения проверяются сервером.
      </p>
      {value.blocks.map((block, index) => (
        <article className="structured-block" key={block.id}>
          <header>
            <span>{index + 1}</span>
            <strong>
              {
                (
                  {
                    heading: "Заголовок",
                    paragraph: "Абзац",
                    image: "Изображение",
                    bullet_list: "Маркированный список",
                    numbered_list: "Нумерованный список",
                    quote: "Цитата",
                  } as const
                )[block.type]
              }
            </strong>
            <button
              type="button"
              disabled={readOnly || index === 0}
              aria-label="Переместить блок выше"
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={readOnly || index === value.blocks.length - 1}
              aria-label="Переместить блок ниже"
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              disabled={readOnly}
              aria-label="Удалить блок"
              onClick={() =>
                commit({
                  version: 1,
                  blocks: value.blocks.filter((_, i) => i !== index),
                })
              }
            >
              ×
            </button>
          </header>
          {block.type === "heading" ? (
            <div className="structured-block-grid">
              <select
                disabled={readOnly}
                value={block.level}
                onChange={(event) =>
                  update(index, {
                    ...block,
                    level: Number(event.target.value) as 2 | 3 | 4,
                  })
                }
                aria-label="Уровень заголовка"
              >
                <option value={2}>H2</option>
                <option value={3}>H3</option>
                <option value={4}>H4</option>
              </select>
              <PlainPasteTextarea
                readOnly={readOnly}
                rows={2}
                value={block.text}
                onChange={(event) =>
                  update(index, { ...block, text: event.target.value })
                }
                placeholder="Текст заголовка"
              />
            </div>
          ) : block.type === "paragraph" ? (
            <>
              <PlainPasteTextarea
                readOnly={readOnly}
                rows={5}
                value={block.text}
                onChange={(event) =>
                  update(index, { ...block, text: event.target.value })
                }
                placeholder="Текст абзаца"
              />
              <input
                readOnly={readOnly}
                type="url"
                value={block.href ?? ""}
                onChange={(event) =>
                  update(index, { ...block, href: event.target.value || null })
                }
                placeholder="Ссылка для абзаца (необязательно)"
                aria-label="Ссылка абзаца"
              />
            </>
          ) : block.type === "image" ? (
            <div className="structured-block-grid">
              <select
                disabled={readOnly}
                required
                value={block.mediaId}
                onChange={(event) =>
                  update(index, { ...block, mediaId: event.target.value })
                }
                aria-label="Изображение блока"
              >
                <option value="">Выберите изображение</option>
                {media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.altText || item.originalName}
                  </option>
                ))}
              </select>
              <input
                readOnly={readOnly}
                value={block.alt ?? ""}
                onChange={(event) =>
                  update(index, { ...block, alt: event.target.value })
                }
                placeholder="Альтернативный текст"
              />
              <input
                readOnly={readOnly}
                value={block.caption ?? ""}
                onChange={(event) =>
                  update(index, { ...block, caption: event.target.value })
                }
                placeholder="Подпись"
              />
            </div>
          ) : block.type === "bullet_list" || block.type === "numbered_list" ? (
            <PlainPasteTextarea
              readOnly={readOnly}
              rows={5}
              value={block.items.join("\n")}
              onChange={(event) =>
                update(index, {
                  ...block,
                  items: event.target.value.split("\n"),
                })
              }
              placeholder="Один пункт на строку"
            />
          ) : (
            <div className="structured-block-grid">
              <PlainPasteTextarea
                readOnly={readOnly}
                rows={4}
                value={block.text}
                onChange={(event) =>
                  update(index, { ...block, text: event.target.value })
                }
                placeholder="Текст цитаты"
              />
              <input
                readOnly={readOnly}
                value={block.cite ?? ""}
                onChange={(event) =>
                  update(index, { ...block, cite: event.target.value })
                }
                placeholder="Источник"
              />
            </div>
          )}
          <button
            type="button"
            className="structured-add-after"
            disabled={readOnly}
            onClick={() => add(index + 1)}
          >
            ＋ Добавить блок ниже
          </button>
        </article>
      ))}
      {!value.blocks.length ? (
        <button
          type="button"
          className="structured-empty"
          disabled={readOnly}
          onClick={() => add(0)}
        >
          ＋ Добавить первый блок
        </button>
      ) : null}
    </section>
  );
}
