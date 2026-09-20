"use client";

import { useRef } from "react";
import {
  FILE_ACCEPT,
  SOURCE_CATEGORIES,
  fileSize,
  isSocialFeedMaterial,
  socialIconNetwork,
  displaySourceChipUrl,
  type ProjectMaterial,
  type SourceCategory,
} from "./materials";
import styles from "./content-center-view.module.css";
import { SocialIcon, WebsiteIcon } from "./social-icon";

export function ProjectMaterials({
  materials,
  busy,
  base,
  add,
  edit,
  remove,
  upload,
  showSources,
}: {
  materials: ProjectMaterial[];
  busy: boolean;
  base: string;
  add: (kind: "text" | "url", category?: SourceCategory) => void;
  edit: (material: ProjectMaterial) => void;
  remove: (material: ProjectMaterial) => void;
  upload: (file: File) => void;
  showSources?: (material: ProjectMaterial) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const documents = materials.filter(
    (m) => m.kind === "file" || m.kind === "text",
  );
  return (
    <article className={styles.card} aria-label="Материалы и данные проекта">
      <div className={styles.cardHead}>
        <h2>Материалы и данные проекта</h2>
      </div>
      <p className={styles.muted}>
        Добавьте информацию о проекте: ссылки, файлы и материалы клиента.
        Изменение источников не меняет уже готовые версии.
      </p>
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
                    <div className={styles.sourceChip}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => edit(m)}
                        title={m.source_url ?? m.title}
                        aria-label={`Изменить ссылку «${m.title}»`}
                      >
                        {m.url_category === "site" ? (
                          <WebsiteIcon />
                        ) : (
                          <SocialIcon network={socialIconNetwork(m)} />
                        )}
                        <span className={styles.sourceUrlText}>
                          {displaySourceChipUrl(m.source_url)}
                        </span>
                      </button>
                      {(m.site_checked_at ||
                        m.url_category === "site" ||
                        isSocialFeedMaterial(m)) &&
                        showSources && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => showSources(m)}
                            title="Информация об источнике"
                            aria-label={`Информация об источнике «${m.title}»`}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <circle cx="12" cy="12" r="9" />
                              <path d="M12 11v6" />
                              <circle
                                cx="12"
                                cy="7.5"
                                r=".75"
                                fill="currentColor"
                                stroke="none"
                              />
                            </svg>
                          </button>
                        )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(m)}
                        title="Удалить ссылку"
                        aria-label={`Удалить ссылку «${m.title}»`}
                      >
                        ×
                      </button>
                    </div>
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
      <section
        className={styles.materialsSection}
        aria-label="Файлы и тексты проекта"
      >
        <div className={styles.cardHead}>
          <h3>Файлы и тексты проекта</h3>
        </div>
        <p className={styles.muted}>
          Загрузите документы, таблицы, презентации и изображения или добавьте
          текст вручную.
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
          <div className={styles.actions}>
            <button
              disabled={busy || materials.length >= 50}
              onClick={() => input.current?.click()}
            >
              + Загрузить файл
            </button>
            <button
              disabled={busy || materials.length >= 50}
              onClick={() => add("text")}
            >
              + Добавить текст
            </button>
          </div>
          <p className={styles.muted}>
            PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD, CSV · до 10 МБ на файл.
          </p>
        </div>
        {documents.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.fileTable}>
              <caption>Добавленные файлы и тексты</caption>
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
                {documents.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <strong>
                        {file.kind === "file"
                          ? (file.file_name ?? file.title)
                          : file.title}
                      </strong>
                      <div className={styles.muted}>
                        {file.kind === "text"
                          ? "Добавлен вручную"
                          : file.characters
                            ? "Текст извлечён"
                            : "Оригинал сохранён · обработка после подключения AI"}
                      </div>
                    </td>
                    <td>
                      {file.kind === "text"
                        ? "Текст"
                        : (file.file_name?.split(".").pop()?.toUpperCase() ??
                          "—")}
                    </td>
                    <td>
                      {file.kind === "text"
                        ? `${file.characters.toLocaleString("ru-RU")} симв.`
                        : fileSize(file.file_size)}
                    </td>
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
                        {file.kind === "file" ? (
                          <a
                            href={`${base}/materials/${file.id}/file`}
                            download={file.file_name ?? file.title}
                            className={styles.download}
                            aria-label={`Скачать ${file.title}`}
                          >
                            Скачать
                          </a>
                        ) : (
                          <button disabled={busy} onClick={() => edit(file)}>
                            Открыть и изменить
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() => remove(file)}
                          aria-label={`Удалить ${file.kind === "file" ? "файл" : "материал"} «${file.title}»`}
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
        ) : null}
      </section>
    </article>
  );
}
