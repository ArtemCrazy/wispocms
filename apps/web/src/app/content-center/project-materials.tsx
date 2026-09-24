"use client";

import { useRef } from "react";
import {
  FILE_ACCEPT,
  SOURCE_CATEGORIES,
  fileSize,
  materialFileBadge,
  isSocialFeedMaterial,
  socialIconNetwork,
  displayMapSourceId,
  displaySourceChipUrl,
  type ProjectMaterial,
  type SourceCategory,
} from "./materials";
import styles from "./content-center-view.module.css";
import { MapIcon, MarketplaceIcon, SocialIcon, WebsiteIcon } from "./social-icon";
import { mapProviderForUrl } from "./map-material-fields";
import { marketplaceForUrl } from "./marketplace-material-fields";

function MapSourceIcon({ sourceUrl }: { sourceUrl: string | null }) {
  const provider = mapProviderForUrl(sourceUrl ?? "");
  return provider === "other" ? null : <MapIcon provider={provider} />;
}

function MarketplaceSourceIcon({ sourceUrl }: { sourceUrl: string | null }) {
  const marketplace = marketplaceForUrl(sourceUrl ?? "");
  return marketplace === "other" ? null : <MarketplaceIcon marketplace={marketplace} />;
}

function FileTypeBadge({
  fileName,
  kind,
  mediaType,
}: {
  fileName: string | null;
  kind: "file" | "text";
  mediaType?: string | null;
}) {
  const { label, color } = materialFileBadge(fileName, kind, mediaType);
  return (
    <svg className={styles.materialFileBadge} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="36" height="36" rx="6" fill={color} />
      <text
        x="20"
        y="20"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Segoe UI, Arial, sans-serif"
        fontSize="11"
        fontWeight="800"
        fill="#fff"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </svg>
  );
}

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
            <div className={styles.sourceLabel}>
              <strong>{category.label}</strong>
              {category.hint && (
                <span className={styles.sourceHint}>{category.hint}</span>
              )}
            </div>
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
                        ) : m.url_category === "maps" ? (
                          <MapSourceIcon sourceUrl={m.source_url} />
                        ) : m.url_category === "marketplace" ? (
                          <MarketplaceSourceIcon sourceUrl={m.source_url} />
                        ) : (
                          <SocialIcon network={socialIconNetwork(m)} />
                        )}
                        <span className={styles.sourceUrlText}>
                          {m.url_category === "maps"
                            ? displayMapSourceId(m.source_url)
                            : displaySourceChipUrl(m.source_url)}
                        </span>
                      </button>
                      {(m.site_checked_at ||
                        m.url_category === "site" ||
                        m.url_category === "maps" ||
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
              {category.id === "other" &&
                documents.map((document) => (
                  <div key={document.id} className={styles.sourceItem}>
                    <div className={styles.sourceChip}>
                      {document.kind === "file" ? (
                        <a
                          href={`${base}/materials/${document.id}/file`}
                          download={document.file_name ?? document.title}
                          title={`Скачать ${document.file_name ?? document.title}${document.file_size ? ` · ${fileSize(document.file_size)}` : ""}`}
                          aria-label={`Скачать файл «${document.title}»`}
                        >
                          <FileTypeBadge
                            fileName={document.file_name ?? document.title}
                            kind="file"
                            mediaType={document.media_type}
                          />
                          <span className={styles.sourceUrlText}>
                            {document.file_name ?? document.title}
                          </span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className={styles.materialPrimary}
                          disabled={busy}
                          onClick={() => edit(document)}
                          title="Открыть и изменить текст"
                          aria-label={`Открыть и изменить текст «${document.title}»`}
                        >
                          <FileTypeBadge fileName={document.title} kind="text" />
                          <span className={styles.sourceUrlText}>
                            {document.title}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(document)}
                        title="Удалить материал"
                        aria-label={`Удалить ${document.kind === "file" ? "файл" : "материал"} «${document.title}»`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              <button
                disabled={busy || materials.length >= 50}
                onClick={() => add("url", category.id)}
                aria-label={`Добавить ссылку: ${category.label}`}
              >
                {category.id === "other" ? "+ Ссылку" : "+ Добавить"}
              </button>
              {category.id === "other" && (
                <>
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
                    aria-label="Загрузить файл проекта"
                  >
                    + Файл
                  </button>
                  <button
                    disabled={busy || materials.length >= 50}
                    onClick={() => add("text")}
                    aria-label="Добавить текст проекта"
                  >
                    + Текст
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
