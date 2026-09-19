"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PreparedDocument } from "./prepared-document";
import {
  RESEARCH_TYPES,
  RESEARCH_STEPS,
  researchLocation,
  researchReady,
  type ResearchType,
  type ResearchStep,
  type ResearchDraft,
  type ResearchSource,
  type ResearchOverview,
  type ResearchConfirmation,
} from "./research-state";
import styles from "./content-center-view.module.css";

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(". ")
        : (payload?.message ?? "Не удалось выполнить действие"),
    );
  return payload;
}
function Modal({
  title,
  busy,
  close,
  children,
}: {
  title: string;
  busy: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <button onClick={close} disabled={busy} aria-label="Закрыть окно">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function ResearchView({
  workspaceId,
  onDirtyChange,
}: {
  workspaceId: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const base = `/api/workspaces/${workspaceId}/content-center/research`;
  const [data, setData] = useState<ResearchOverview | null>(null);
  const [draft, setDraft] = useState<ResearchDraft | null>(null);
  const [type, setType] = useState<ResearchType>("competitive");
  const [step, setStep] = useState<ResearchStep>("data");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [source, setSource] = useState<ResearchSource | null>(null);
  const [remove, setRemove] = useState<ResearchSource | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ResearchConfirmation | null>(
    null,
  );
  const alive = useRef(true);
  const load = async () => {
    const result = await api<ResearchOverview>(base);
    if (alive.current) setData(result);
    return result;
  };
  useEffect(() => {
    alive.current = true;
    const restore = () => {
      const location = researchLocation(
        new URL(window.location.href).searchParams,
      );
      setType(location.type);
      setStep(location.step);
    };
    restore();
    window.addEventListener("popstate", restore);
    void api<ResearchOverview>(base)
      .then((result) => {
        if (alive.current) {
          setData(result);
          setDraft(result.draft);
        }
      })
      .catch((reason: Error) => {
        if (alive.current) setError(reason.message);
      });
    return () => {
      alive.current = false;
      window.removeEventListener("popstate", restore);
      onDirtyChange(false);
    };
  }, [base, onDirtyChange]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  function navigate(nextType: ResearchType, nextStep = step) {
    const url = new URL(window.location.href);
    url.searchParams.set("research", nextType);
    url.searchParams.set("researchStep", nextStep);
    window.history.pushState({}, "", url);
    setType(nextType);
    setStep(nextStep);
    setError("");
  }
  function change(next: ResearchDraft) {
    setDraft(next);
    setDirty(true);
    setNotice("");
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      if (alive.current)
        setError(reason instanceof Error ? reason.message : "Ошибка");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!draft) throw new Error("Данные не загружены");
    if (!dirty && draft.revision) return draft;
    const saved = await api<ResearchDraft>(`${base}/draft`, "PUT", draft);
    setDraft(saved);
    setDirty(false);
    setNotice("Изменения сохранены");
    return saved;
  }
  async function openConfirmation(id: string) {
    const result = await api<ResearchConfirmation>(
      `${base}/confirmations/${id}`,
    );
    if (alive.current) setConfirmation(result);
  }
  useEffect(() => {
    const id = data?.confirmations[0]?.id;
    if (step !== "result" || !id) return;
    let active = true;
    void api<ResearchConfirmation>(`${base}/confirmations/${id}`)
      .then((result) => {
        if (active) setConfirmation(result);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [base, step, data?.confirmations]);

  const readiness = draft && data ? researchReady(draft, data.prepared) : null;
  return (
    <div className={styles.research}>
      <nav className={styles.researchTabs} aria-label="Виды исследований">
        {RESEARCH_TYPES.map((item) => (
          <button
            key={item.id}
            disabled={busy}
            aria-current={type === item.id ? "page" : undefined}
            onClick={() => navigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}
      {type !== "competitive" ? (
        <article className={styles.card}>
          <h2>{RESEARCH_TYPES.find((item) => item.id === type)?.label}</h2>
          <p className={styles.muted}>
            Этот вид исследования указан в ТЗ, но его рабочая логика пока не
            описана. Здесь не создаются вымышленные результаты.
          </p>
          <button onClick={() => navigate("competitive", "data")}>
            К конкурентному анализу
          </button>
        </article>
      ) : !data || !draft ? (
        <article className={styles.card}>
          {error ? (
            <button
              onClick={() =>
                void act(async () => {
                  const result = await load();
                  setDraft(result.draft);
                })
              }
            >
              Повторить загрузку
            </button>
          ) : (
            "Загружаем исследование…"
          )}
        </article>
      ) : (
        <>
          <div className={styles.researchToolbar}>
            <nav
              className={styles.researchTabs}
              aria-label="Этапы конкурентного анализа"
            >
              {RESEARCH_STEPS.map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  aria-current={step === item.id ? "page" : undefined}
                  onClick={() => navigate("competitive", item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <button
              disabled={busy || !dirty}
              onClick={() =>
                void act(async () => {
                  await save();
                })
              }
            >
              {busy ? "Сохраняем…" : "Сохранить изменения"}
            </button>
          </div>
          {dirty && (
            <p className={styles.muted}>
              Есть несохранённые изменения. Переход между вкладками их сохраняет
              в форме; для записи в workspace нажмите «Сохранить изменения».
            </p>
          )}
          <fieldset disabled={busy} className={styles.formFields}>
            {step === "data" && (
              <div className={styles.preparationStack}>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Данные для конкурентного анализа</h2>
                    {data.prepared && (
                      <span className={styles.badge}>
                        Версия {data.prepared.number}
                      </span>
                    )}
                  </div>
                  <p className={styles.muted}>
                    Используется подготовленная информация о проекте. Исходные
                    файлы и ссылки напрямую в исследование не передаются.
                  </p>
                  {!data.prepared && (
                    <div className={styles.empty}>
                      <strong>Обработанные материалы отсутствуют</strong>
                      <p>
                        Это не препятствует исследованию: перейдите к поиску
                        источников и укажите направление самостоятельно.
                      </p>
                    </div>
                  )}
                  <label className={styles.researchOption}>
                    <input
                      type="radio"
                      name="research-context"
                      checked={draft.contextKind === "conclusions"}
                      disabled
                      onChange={() =>
                        change({ ...draft, contextKind: "conclusions" })
                      }
                    />
                    <span>
                      <strong>Структурированные выводы</strong>
                      <span className={styles.muted}>
                        Вариант по умолчанию в ТЗ. Отдельные выводы пока не
                        формируются; полный документ ими не подменяется.
                      </span>
                    </span>
                    <span className={styles.badge}>Пока недоступно</span>
                  </label>
                  <label className={styles.researchOption}>
                    <input
                      type="radio"
                      name="research-context"
                      checked={draft.contextKind === "full"}
                      disabled={!data.prepared}
                      onChange={() => change({ ...draft, contextKind: "full" })}
                    />
                    <span>
                      <strong>Полный результат обработки материалов</strong>
                      <span className={styles.muted}>
                        {data.prepared
                          ? `Сохранён ${date(data.prepared.created_at)}`
                          : "Появится после успешной подготовки информации"}
                      </span>
                    </span>
                  </label>
                  <div className={styles.actions}>
                    <button
                      disabled={!data.prepared}
                      onClick={() => setPreview(!preview)}
                    >
                      {preview
                        ? "Скрыть полный результат"
                        : "Посмотреть полный результат"}
                    </button>
                    <button
                      className={styles.primary}
                      onClick={() => navigate("competitive", "sources")}
                    >
                      К поиску источников →
                    </button>
                  </div>
                </article>
                {preview && data.prepared && (
                  <article
                    className={`${styles.card} ${styles.document}`}
                    aria-label="Полный результат обработки"
                  >
                    <h2>Полный результат · версия {data.prepared.number}</h2>
                    <PreparedDocument content={data.prepared.content} />
                  </article>
                )}
              </div>
            )}
            {step === "sources" && (
              <div className={styles.preparationStack}>
                <article className={styles.card}>
                  <h2>Направление исследования</h2>
                  <p className={styles.muted}>
                    {data.prepared
                      ? `Контекст: ${draft.contextKind === "full" ? `полный результат, версия ${data.prepared.number}` : "структурированные выводы — пока недоступны"}. При необходимости уточните тематику, продукт, аудиторию или регион.`
                      : "Обработанных материалов нет. Опишите тематику, продукт, аудиторию или регион, чтобы задать направление исследования."}
                  </p>
                  <label className={styles.field}>
                    Что исследуем
                    <textarea
                      value={draft.direction}
                      maxLength={8000}
                      placeholder="Например: производители натуральной косметики в России, их продукты и контент для покупателей"
                      onChange={(event) =>
                        change({ ...draft, direction: event.target.value })
                      }
                    />
                  </label>
                </article>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Категории поиска</h2>
                    <span className={styles.muted}>
                      {draft.categories.length} / 20
                    </span>
                  </div>
                  <p className={styles.muted}>
                    Выберите категории для автоматического поиска. Ручные
                    источники можно добавлять в любую категорию; состав
                    исследования определяется выбором источников ниже.
                  </p>
                  <div className={styles.researchCategories}>
                    {draft.categories.map((category) => (
                      <div
                        key={category.id}
                        className={styles.researchCategory}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={category.enabled}
                            onChange={(event) =>
                              change({
                                ...draft,
                                categories: draft.categories.map((c) =>
                                  c.id === category.id
                                    ? { ...c, enabled: event.target.checked }
                                    : c,
                                ),
                              })
                            }
                          />
                          <span>{category.name}</span>
                        </label>
                        <button
                          disabled={
                            draft.categories.length <= 1 ||
                            draft.sources.some(
                              (s) => s.categoryId === category.id,
                            )
                          }
                          title="Категорию можно убрать, когда в ней нет источников"
                          aria-label={`Убрать категорию «${category.name}»`}
                          onClick={() =>
                            change({
                              ...draft,
                              categories: draft.categories.filter(
                                (c) => c.id !== category.id,
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className={styles.researchAddCategory}>
                    <label className={styles.field}>
                      Своя категория
                      <input
                        value={categoryName}
                        maxLength={100}
                        onChange={(event) =>
                          setCategoryName(event.target.value)
                        }
                        placeholder="Название категории"
                      />
                    </label>
                    <button
                      disabled={
                        !categoryName.trim() || draft.categories.length >= 20
                      }
                      onClick={() => {
                        if (
                          draft.categories.some(
                            (c) =>
                              c.name.toLowerCase() ===
                              categoryName.trim().toLowerCase(),
                          )
                        ) {
                          setError("Такая категория уже есть");
                          return;
                        }
                        change({
                          ...draft,
                          categories: [
                            ...draft.categories,
                            {
                              id: `custom-${crypto.randomUUID()}`,
                              name: categoryName.trim(),
                              enabled: true,
                            },
                          ],
                        });
                        setCategoryName("");
                      }}
                    >
                      + Добавить категорию
                    </button>
                  </div>
                  <div className={styles.actions}>
                    <button
                      disabled={
                        !data.searchConnected ||
                        !draft.categories.some((c) => c.enabled)
                      }
                      onClick={() =>
                        void act(async () => {
                          const saved = await save();
                          const result = await api<ResearchDraft>(
                            `${base}/search`,
                            "POST",
                            {
                              revision: saved.revision,
                              preparationVersionId: data.prepared?.id ?? null,
                            },
                          );
                          setDraft(result);
                          setDirty(false);
                          setNotice(
                            "Поиск завершён. Проверьте найденные источники.",
                          );
                        })
                      }
                    >
                      {busy
                        ? "Ищем источники…"
                        : "Найти источники автоматически"}
                    </button>
                    {!data.searchConnected && (
                      <span className={styles.muted}>
                        AI-поиск ещё не подключён. Ручное добавление работает.
                      </span>
                    )}
                  </div>
                </article>
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2>Источники исследования</h2>
                    <button
                      disabled={draft.sources.length >= 100}
                      onClick={() =>
                        setSource({
                          id: crypto.randomUUID(),
                          name: "",
                          url: "",
                          categoryId: draft.categories[0].id,
                          description: "",
                          included: true,
                        })
                      }
                    >
                      + Добавить источник
                    </button>
                  </div>
                  <p className={styles.muted}>
                    Выбрано {draft.sources.filter((s) => s.included).length} из{" "}
                    {draft.sources.length}. Ручные и автоматически найденные
                    источники равноправны. Проверьте ссылки и категории перед
                    подтверждением.
                  </p>
                  {!draft.sources.length ? (
                    <div className={styles.empty}>
                      Добавьте сайт конкурента, медиа, отраслевой ресурс или
                      другой полезный источник.
                    </div>
                  ) : (
                    draft.categories.map((category) => {
                      const sources = draft.sources.filter(
                        (s) => s.categoryId === category.id,
                      );
                      return sources.length ? (
                        <section
                          key={category.id}
                          className={styles.researchGroup}
                        >
                          <h3>{category.name}</h3>
                          {sources.map((item) => (
                            <div
                              key={item.id}
                              className={styles.researchSource}
                              data-excluded={!item.included}
                            >
                              <label className={styles.researchInclude}>
                                <input
                                  type="checkbox"
                                  checked={item.included}
                                  aria-label={`Включить «${item.name}»`}
                                  onChange={(event) =>
                                    change({
                                      ...draft,
                                      sources: draft.sources.map((s) =>
                                        s.id === item.id
                                          ? {
                                              ...s,
                                              included: event.target.checked,
                                            }
                                          : s,
                                      ),
                                    })
                                  }
                                />
                                <strong>{item.name}</strong>
                              </label>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.download}
                              >
                                {item.url}
                              </a>
                              {item.description && (
                                <p className={styles.muted}>
                                  {item.description}
                                </p>
                              )}
                              <div className={styles.researchSourceActions}>
                                <label>
                                  Категория
                                  <select
                                    value={item.categoryId}
                                    aria-label={`Категория: ${item.name}`}
                                    onChange={(event) =>
                                      change({
                                        ...draft,
                                        sources: draft.sources.map((s) =>
                                          s.id === item.id
                                            ? {
                                                ...s,
                                                categoryId: event.target.value,
                                              }
                                            : s,
                                        ),
                                      })
                                    }
                                  >
                                    {draft.categories.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button onClick={() => setSource({ ...item })}>
                                  Изменить
                                </button>
                                <button onClick={() => setRemove(item)}>
                                  Удалить
                                </button>
                                {!item.included && (
                                  <span className={styles.muted}>
                                    Не участвует в исследовании
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </section>
                      ) : null;
                    })
                  )}
                </article>
                <article className={styles.card}>
                  <h2>Итоговый список</h2>
                  <p className={styles.muted}>
                    {readiness ??
                      "Подтвердите выбранные источники. Система сохранит их состав, категории и выбранный контекст отдельным снимком."}
                  </p>
                  <div className={styles.actions}>
                    <button onClick={() => navigate("competitive", "data")}>
                      ← Данные
                    </button>
                    <button
                      className={styles.primary}
                      disabled={Boolean(readiness)}
                      onClick={() => setConfirmOpen(true)}
                    >
                      Подтвердить источники и перейти к результату →
                    </button>
                  </div>
                </article>
              </div>
            )}
            {step === "result" && (
              <div className={styles.preparationStack}>
                <div className={styles.notice}>
                  <strong>Сам анализ ещё не запускается.</strong> В ТЗ структура
                  вкладки «Результат» находится на обсуждении. Сейчас здесь
                  хранится подтверждённый состав источников, а не готовые выводы
                  исследования.
                </div>
                {!data.confirmations.length ? (
                  <article className={styles.card}>
                    <h2>Источники ещё не подтверждены</h2>
                    <p className={styles.muted}>
                      Сначала соберите и проверьте список на предыдущем этапе.
                    </p>
                    <button onClick={() => navigate("competitive", "sources")}>
                      К поиску источников →
                    </button>
                  </article>
                ) : (
                  <article className={styles.card}>
                    <div className={styles.cardHead}>
                      <h2>Подтверждённый список источников</h2>
                      <label>
                        Подтверждение
                        <select
                          aria-label="Подтверждённый список"
                          value={confirmation?.id ?? data.confirmations[0].id}
                          onChange={(event) =>
                            void act(() => openConfirmation(event.target.value))
                          }
                        >
                          {data.confirmations.map((item) => (
                            <option key={item.id} value={item.id}>
                              {date(item.created_at)} · {item.actor_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {confirmation ? (
                      <>
                        <p className={styles.muted}>
                          {date(confirmation.created_at)} ·{" "}
                          {confirmation.actor_name} ·{" "}
                          {confirmation.sources.length} источников
                        </p>
                        <p>{confirmation.direction}</p>
                        <p className={styles.muted}>
                          Контекст:{" "}
                          {confirmation.context_text
                            ? "полный результат обработки на момент подтверждения"
                            : "без обработанных материалов"}
                          . Изменения рабочего списка не меняют эту копию.
                        </p>
                        {confirmation.categories.map((category) => {
                          const sources = confirmation.sources.filter(
                            (s) => s.categoryId === category.id,
                          );
                          return sources.length ? (
                            <section
                              key={category.id}
                              className={styles.researchGroup}
                            >
                              <h3>{category.name}</h3>
                              <ul>
                                {sources.map((item) => (
                                  <li key={item.id}>
                                    <strong>{item.name}</strong> ·{" "}
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className={styles.download}
                                    >
                                      {item.url}
                                    </a>
                                    {item.description && (
                                      <p className={styles.muted}>
                                        {item.description}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null;
                        })}
                        {confirmation.context_text && (
                          <details className={styles.document}>
                            <summary>Показать использованный контекст</summary>
                            <PreparedDocument
                              content={confirmation.context_text}
                            />
                          </details>
                        )}
                      </>
                    ) : (
                      <p>Загружаем список…</p>
                    )}
                    <button onClick={() => navigate("competitive", "sources")}>
                      Вернуться к рабочему списку
                    </button>
                  </article>
                )}
              </div>
            )}
          </fieldset>
          {source && (
            <Modal
              title="Источник исследования"
              busy={busy}
              close={() => setSource(null)}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  let url: URL;
                  try {
                    url = new URL(source.url);
                    if (
                      url.protocol !== "https:" ||
                      url.username ||
                      url.password
                    )
                      throw new Error();
                  } catch {
                    setError(
                      "Нужна публичная HTTPS-ссылка без логина и пароля",
                    );
                    return;
                  }
                  url.hash = "";
                  if (
                    draft.sources.some(
                      (s) => s.id !== source.id && s.url === url.href,
                    )
                  ) {
                    setError("Этот адрес уже есть в списке");
                    return;
                  }
                  const item = {
                    ...source,
                    name: source.name.trim(),
                    url: url.href,
                  };
                  change({
                    ...draft,
                    sources: draft.sources.some((s) => s.id === item.id)
                      ? draft.sources.map((s) => (s.id === item.id ? item : s))
                      : [...draft.sources, item],
                  });
                  setSource(null);
                  setError("");
                }}
              >
                {error && (
                  <div className={styles.error} role="alert">
                    {error}
                  </div>
                )}
                <label className={styles.field}>
                  Название
                  <input
                    required
                    maxLength={160}
                    value={source.name}
                    onChange={(event) =>
                      setSource({ ...source, name: event.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Адрес источника
                  <input
                    required
                    type="url"
                    maxLength={2048}
                    placeholder="https://example.ru"
                    value={source.url}
                    onChange={(event) =>
                      setSource({ ...source, url: event.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  Категория
                  <select
                    value={source.categoryId}
                    onChange={(event) =>
                      setSource({ ...source, categoryId: event.target.value })
                    }
                  >
                    {draft.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Почему источник полезен
                  <textarea
                    maxLength={500}
                    value={source.description}
                    onChange={(event) =>
                      setSource({ ...source, description: event.target.value })
                    }
                  />
                </label>
                <div className={styles.actions}>
                  <button className={styles.primary} type="submit">
                    {draft.sources.some((item) => item.id === source.id)
                      ? "Применить изменения"
                      : "Добавить в рабочий список"}
                  </button>
                  <button type="button" onClick={() => setSource(null)}>
                    Отмена
                  </button>
                </div>
              </form>
            </Modal>
          )}
          {remove && (
            <Modal
              title="Удалить источник из рабочего списка?"
              busy={busy}
              close={() => setRemove(null)}
            >
              <p>
                «{remove.name}» будет удалён из черновика. Подтверждённые списки
                останутся без изменений.
              </p>
              <div className={styles.actions}>
                <button
                  onClick={() => {
                    change({
                      ...draft,
                      sources: draft.sources.filter((s) => s.id !== remove.id),
                    });
                    setRemove(null);
                  }}
                >
                  Удалить источник
                </button>
                <button onClick={() => setRemove(null)}>Отмена</button>
              </div>
            </Modal>
          )}
          {confirmOpen && (
            <Modal
              title="Подтвердить источники?"
              busy={busy}
              close={() => setConfirmOpen(false)}
            >
              {error && (
                <div className={styles.error} role="alert">
                  {error}
                </div>
              )}
              <p>
                Будут сохранены {draft.sources.filter((s) => s.included).length}{" "}
                выбранных источников, их категории и контекст. Это фиксация
                списка, не запуск AI-анализа.
              </p>
              <div className={styles.actions}>
                <button
                  disabled={busy}
                  className={styles.primary}
                  onClick={() =>
                    void act(async () => {
                      const saved = await save();
                      const result = await api<{ id: string }>(
                        `${base}/confirmations`,
                        "POST",
                        {
                          revision: saved.revision,
                          preparationVersionId: data.prepared?.id ?? null,
                        },
                      );
                      await load();
                      await openConfirmation(result.id);
                      setConfirmOpen(false);
                      navigate("competitive", "result");
                      setNotice("Список источников подтверждён");
                    })
                  }
                >
                  Подтвердить список
                </button>
                <button disabled={busy} onClick={() => setConfirmOpen(false)}>
                  Отмена
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
