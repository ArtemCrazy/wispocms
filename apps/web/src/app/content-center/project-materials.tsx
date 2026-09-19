"use client";

import { useRef } from "react";
import {
  FILE_ACCEPT,
  SOURCE_CATEGORIES,
  fileSize,
  type ProjectMaterial,
  type SourceCategory,
} from "./materials";
import styles from "./content-center-view.module.css";

export function ProjectMaterials({
  materials,
  busy,
  base,
  add,
  edit,
  remove,
  upload,
}: {
  materials: ProjectMaterial[];
  busy: boolean;
  base: string;
  add: (kind: "text" | "url", category?: SourceCategory) => void;
  edit: (material: ProjectMaterial) => void;
  remove: (material: ProjectMaterial) => void;
  upload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const files = materials.filter((m) => m.kind === "file");
  const texts = materials.filter((m) => m.kind === "text");
  return (
    <>
      <article className={styles.card} aria-label="Материалы и данные проекта">
        <div className={styles.cardHead}>
          <h2>Материалы и данные проекта</h2>
          <span className={styles.badge}>{materials.length} / 50</span>
        </div>
        <p className={styles.muted}>
          Добавьте информацию о проекте: ссылки, файлы и материалы клиента.
          Изменение источников не меняет уже готовые версии.
        </p>
        <h3 className={styles.subheading}>Ссылки на онлайн-ресурсы</h3>
        <div className={styles.sourceRows}>
          {SOURCE_CATEGORIES.map((category) => (
            <div key={category.id} className={styles.sourceRow}>
              <strong>{category.label}</strong>
              <div className={styles.sourceItems}>
                {materials
                  .filter(
                    (m) =>
                      m.kind === "url" &&
                      (m.url_category ?? "other") === category.id,
                  )
                  .map((m) => (
                    <div key={m.id} className={styles.sourceItem}>
                      <button
                        disabled={busy}
                        onClick={() => edit(m)}
                        title={m.source_url ?? m.title}
                        aria-label={`Изменить ссылку «${m.title}»`}
                      >
                        {m.source_url}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => remove(m)}
                        aria-label={`Удалить ссылку «${m.title}»`}
                      >
                        ×
                      </button>
                      {m.source_error && (
                        <span className={styles.sourceWarning}>
                          {m.source_error}
                        </span>
                      )}
                    </div>
                  ))}
                <button
                  disabled={busy || materials.length >= 50}
                  onClick={() => add("url", category.id)}
                  aria-label={`Добавить ссылку: ${category.label}`}
                >
                  + Добавить
                </button>
              </div>
              <p className={styles.muted}>{category.hint}</p>
            </div>
          ))}
        </div>
      </article>
      <article className={styles.card} aria-label="Файлы проекта">
        <div className={styles.cardHead}>
          <h2>Файлы проекта</h2>
          <span className={styles.muted}>
            {fileSize(
              files.reduce((sum, file) => sum + (file.file_size ?? 0), 0),
            )}{" "}
            из 50 МБ
          </span>
        </div>
        <p className={styles.muted}>
          Документы, таблицы, презентации и изображения с информацией о проекте.
        </p>
        <div className={styles.uploadArea}>
          <input
            ref={input}
            className={styles.fileInput}
            type="file"
            accept={FILE_ACCEPT}
            disabled={busy}
            aria-label="Выбрать файл проекта"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
          <button
            disabled={busy || materials.length >= 50}
            onClick={() => input.current?.click()}
          >
            + Загрузить файл
          </button>
          <p className={styles.muted}>
            PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD, CSV · до 10 МБ на файл.
            Текст — UTF-8, до 40 000 символов.
          </p>
        </div>
        {files.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.fileTable}>
              <caption>Добавленные файлы</caption>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Размер</th>
                  <th>Дата добавления</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <strong>{file.file_name ?? file.title}</strong>
                      <div className={styles.muted}>
                        {file.characters
                          ? "Текст извлечён"
                          : "Оригинал сохранён · обработка после подключения AI"}
                      </div>
                    </td>
                    <td>
                      {file.file_name?.split(".").pop()?.toUpperCase() ?? "—"}
                    </td>
                    <td>{fileSize(file.file_size)}</td>
                    <td>
                      {new Date(
                        file.created_at ?? file.updated_at,
                      ).toLocaleString("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <a
                          href={`${base}/materials/${file.id}/file`}
                          download={file.file_name ?? file.title}
                          className={styles.download}
                          aria-label={`Скачать ${file.title}`}
                        >
                          Скачать
                        </a>
                        <button
                          disabled={busy}
                          onClick={() => remove(file)}
                          aria-label={`Удалить файл «${file.title}»`}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>
            Файлов пока нет. Загрузите первый документ или изображение.
          </div>
        )}
        <p className={styles.muted}>
          Оригиналы доступны только сотрудникам с доступом к этому workspace.
          Загрузка файла ещё не означает, что AI его обработал.
        </p>
      </article>
      <article className={styles.card} aria-label="Текстовые материалы">
        <div className={styles.cardHead}>
          <h2>Текстовые материалы</h2>
          <button
            disabled={busy || materials.length >= 50}
            onClick={() => add("text")}
          >
            + Добавить текст
          </button>
        </div>
        <p className={styles.muted}>
          Сведения от клиента, заметки или текст источника, который нельзя
          прочитать по ссылке.
        </p>
        {texts.map((m) => (
          <div key={m.id} className={styles.material}>
            <strong>{m.title}</strong>
            <p>{m.characters.toLocaleString("ru-RU")} симв.</p>
            <div className={styles.actions}>
              <button disabled={busy} onClick={() => edit(m)}>
                Открыть и изменить
              </button>
              <button
                disabled={busy}
                onClick={() => remove(m)}
                aria-label={`Удалить материал «${m.title}»`}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </article>
    </>
  );
}
