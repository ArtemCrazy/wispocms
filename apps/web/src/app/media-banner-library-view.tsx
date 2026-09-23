"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bannerLinkSelectValue,
  type BannerSlotDefinition,
} from "./banner-slot";
import { LatestValueQueue } from "./latest-value-queue";
import {
  assignedSkinovaPreviewContexts,
  chooseSkinovaPreviewContext,
  skinovaBannerPreviewContexts,
} from "./skinova-banner-preview-context";
import { SkinovaBannerPreviewFrame } from "./skinova-banner-preview-frame";
import {
  revisionActions,
  type ArticleRevisionCurrent as BannerRevisionCurrent,
} from "./article-revision-actions";

type MediaItem = {
  id: string;
  originalName: string;
  width: number | null;
  height: number | null;
};
type LinkItem = {
  id: string;
  title?: string;
  name?: string;
  slug: string;
  kind?: "homepage" | "page";
  bannerSlots?: BannerSlotDefinition[];
};
export type MediaBanner = {
  id: string;
  name: string;
  placement: string | null;
  title: string | null;
  subtitle: string | null;
  buttonText: string | null;
  linkUrl: string | null;
  mediaId: string | null;
  mobileMediaId: string | null;
  media: MediaItem | null;
  mobileMedia: MediaItem | null;
  isActive: boolean;
  updatedAt: string;
  draftRevisionId?: string | null;
};

type BannerRevisionVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
};

type BannerAssignment = {
  bannerId: string;
  zone: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  return payload as T;
}

type Draft = Pick<
  MediaBanner,
  | "name"
  | "title"
  | "subtitle"
  | "buttonText"
  | "linkUrl"
  | "mediaId"
  | "mobileMediaId"
  | "isActive"
>;

type BannerSaveJob = {
  siteId: string;
  bannerId: string;
  draft: Draft;
};

export function MediaBannerLibraryView({
  siteId,
  siteName,
  canEdit = true,
  canApprove = false,
  onBackToAssignments,
  createOnOpenKey,
  initialPreviewRenderer,
}: {
  siteId?: string;
  siteName?: string;
  canEdit?: boolean;
  canApprove?: boolean;
  onBackToAssignments?: () => void;
  createOnOpenKey?: number;
  initialPreviewRenderer?: string;
}) {
  const [items, setItems] = useState<MediaBanner[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [links, setLinks] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [revisionCurrent, setRevisionCurrent] = useState<
    BannerRevisionCurrent | null | undefined
  >(undefined);
  const [versions, setVersions] = useState<BannerRevisionVersion[]>([]);
  const [revisionPreview, setRevisionPreview] = useState<Draft | null>(null);
  const [slots, setSlots] = useState<BannerSlotDefinition[]>([]);
  const [assignments, setAssignments] = useState<BannerAssignment[]>([]);
  const [previewRenderers, setPreviewRenderers] = useState<
    Record<string, string>
  >({});
  const hydrated = useRef(false);
  const createdForKey = useRef<number | undefined>(undefined);
  const revisionRef = useRef<BannerRevisionCurrent | null | undefined>(
    undefined,
  );
  const saveQueue = useRef<LatestValueQueue<BannerSaveJob> | null>(null);
  useEffect(() => {
    saveQueue.current = new LatestValueQueue(async (job) => {
      setSaving(true);
      try {
        const updated = await request<MediaBanner>(
          `/api/sites/${job.siteId}/content/banners/${job.bannerId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...job.draft,
              expectedDraftRevisionId: revisionRef.current?.draft?.id ?? null,
            }),
          },
        );
        setItems((current) =>
          current.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          ),
        );
        const revisionBase = `/api/sites/${job.siteId}/content/banners/${job.bannerId}/revisions`;
        const current = await request<BannerRevisionCurrent | null>(
          `${revisionBase}/current`,
        );
        const history = current
          ? await request<BannerRevisionVersion[]>(revisionBase)
          : [];
        revisionRef.current = current;
        setRevisionCurrent(current);
        setVersions(history);
        setRevisionPreview(null);
        setMessage("Новая версия баннера сохранена");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Не удалось сохранить баннер",
        );
      } finally {
        setSaving(false);
      }
    });
    return () => {
      saveQueue.current = null;
    };
  }, []);

  const reloadRevision = useCallback(
    async (bannerId: string) => {
      if (!siteId) return;
      const revisionBase = `/api/sites/${siteId}/content/banners/${bannerId}/revisions`;
      const current = await request<BannerRevisionCurrent | null>(
        `${revisionBase}/current`,
      );
      const history = current
        ? await request<BannerRevisionVersion[]>(revisionBase)
        : [];
      revisionRef.current = current;
      setRevisionCurrent(current);
      setVersions(history);
    },
    [siteId],
  );

  const load = useCallback(async () => {
    if (!siteId) return;
    const [banners, mediaRows, pages, articles, categories] = await Promise.all(
      [
        request<MediaBanner[]>(`/api/sites/${siteId}/content/banners`),
        request<MediaItem[]>(`/api/sites/${siteId}/content/media`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/pages`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/articles`),
        request<LinkItem[]>(`/api/sites/${siteId}/content/categories`),
      ],
    );
    const homepage = pages.find((item) => item.kind === "homepage");
    const homepageSlots = homepage?.bannerSlots ?? [];
    const assignmentRows = homepage
      ? await request<BannerAssignment[]>(
          `/api/sites/${siteId}/content/pages/${homepage.id}/banner-assignments`,
        )
      : [];
    let loadedBanners = banners;
    if (
      createOnOpenKey !== undefined &&
      createdForKey.current !== createOnOpenKey &&
      canEdit
    ) {
      const created = await request<MediaBanner>(
        `/api/sites/${siteId}/content/banners`,
        {
          method: "POST",
          body: JSON.stringify({ name: "Новый баннер", isActive: true }),
        },
      );
      createdForKey.current = createOnOpenKey;
      loadedBanners = [created, ...banners];
      const contexts = skinovaBannerPreviewContexts(homepageSlots);
      const chosen = chooseSkinovaPreviewContext(
        contexts,
        [],
        initialPreviewRenderer,
      );
      if (chosen)
        setPreviewRenderers((current) => ({
          ...current,
          [created.id]: chosen.renderer,
        }));
      setMessage("Баннер создан — изменения дальше сохраняются автоматически");
    }
    setItems(loadedBanners);
    setMedia(mediaRows);
    setSlots(homepageSlots);
    setAssignments(assignmentRows);
    setLinks([
      ...pages.map((item) => ({
        value: item.kind === "homepage" ? "/" : `/pages/${item.slug}`,
        label: `Страница: ${item.title ?? item.name}`,
      })),
      ...articles.map((item) => ({
        value: `/articles/${item.slug}`,
        label: `Статья: ${item.title ?? item.name}`,
      })),
      ...categories.map((item) => ({
        value: `/categories/${item.slug}`,
        label: `Категория: ${item.title ?? item.name}`,
      })),
    ]);
    const active =
      loadedBanners.find((item) => item.id === selectedId) ??
      loadedBanners[0] ??
      null;
    if (active) {
      setSelectedId(active.id);
      setDraft({
        name: active.name,
        title: active.title,
        subtitle: active.subtitle,
        buttonText: active.buttonText,
        linkUrl: active.linkUrl,
        mediaId: active.mediaId,
        mobileMediaId: active.mobileMediaId,
        isActive: active.isActive,
      });
      const contexts = skinovaBannerPreviewContexts(homepageSlots);
      const assigned = assignedSkinovaPreviewContexts(
        active,
        assignmentRows,
        contexts,
      );
      const chosen = chooseSkinovaPreviewContext(
        contexts,
        assigned,
        initialPreviewRenderer,
      );
      if (chosen)
        setPreviewRenderers((current) => ({
          ...current,
          [active.id]: current[active.id] ?? chosen.renderer,
        }));
      await reloadRevision(active.id);
    } else {
      revisionRef.current = null;
      setRevisionCurrent(null);
      setVersions([]);
    }
    hydrated.current = true;
  }, [
    canEdit,
    createOnOpenKey,
    initialPreviewRenderer,
    reloadRevision,
    selectedId,
    siteId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
    // Selection is synchronized locally; reloading it must not restart the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    if (
      !siteId ||
      !selectedId ||
      !draft ||
      !hydrated.current ||
      !canEdit ||
      revisionRef.current === undefined
    )
      return;
    const timer = window.setTimeout(() => {
      saveQueue.current?.enqueue({
        siteId,
        bannerId: selectedId,
        draft,
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [canEdit, draft, selectedId, siteId]);

  function select(item: MediaBanner) {
    hydrated.current = false;
    revisionRef.current = undefined;
    setRevisionCurrent(undefined);
    setVersions([]);
    setRevisionPreview(null);
    setSelectedId(item.id);
    setDraft({
      name: item.name,
      title: item.title,
      subtitle: item.subtitle,
      buttonText: item.buttonText,
      linkUrl: item.linkUrl,
      mediaId: item.mediaId,
      mobileMediaId: item.mobileMediaId,
      isActive: item.isActive,
    });
    const contexts = skinovaBannerPreviewContexts(slots);
    const assigned = assignedSkinovaPreviewContexts(
      item,
      assignments,
      contexts,
    );
    const chosen = chooseSkinovaPreviewContext(
      contexts,
      assigned,
      previewRenderers[item.id],
    );
    if (chosen)
      setPreviewRenderers((current) => ({
        ...current,
        [item.id]: chosen.renderer,
      }));
    void reloadRevision(item.id)
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Не удалось загрузить версию баннера",
        ),
      )
      .finally(() => {
        hydrated.current = true;
      });
  }

  async function create() {
    if (!siteId || !canEdit) return;
    try {
      const item = await request<MediaBanner>(
        `/api/sites/${siteId}/content/banners`,
        {
          method: "POST",
          body: JSON.stringify({ name: "Новый баннер", isActive: true }),
        },
      );
      setItems((current) => [item, ...current]);
      const chosen = chooseSkinovaPreviewContext(
        skinovaBannerPreviewContexts(slots),
        [],
      );
      if (chosen)
        setPreviewRenderers((current) => ({
          ...current,
          [item.id]: chosen.renderer,
        }));
      select(item);
      setMessage("Баннер создан — изменения дальше сохраняются автоматически");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось создать баннер",
      );
    }
  }

  async function remove() {
    if (
      !siteId ||
      !selectedId ||
      !canApprove ||
      !window.confirm("Удалить этот баннер?")
    )
      return;
    try {
      await saveQueue.current?.idle();
      await request(`/api/sites/${siteId}/content/banners/${selectedId}`, {
        method: "DELETE",
      });
      setSelectedId(null);
      setDraft(null);
      setMessage("Баннер удалён");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось удалить баннер",
      );
    }
  }

  async function changeBannerRevision(
    action: "submit" | "approve" | "request-changes" | "publish",
  ) {
    if (!siteId || !selectedId || !revisionCurrent?.draft) return;
    setWorkflowBusy(true);
    try {
      await saveQueue.current?.idle();
      const revisionBase = `/api/sites/${siteId}/content/banners/${selectedId}/revisions`;
      const openedRevisionId = revisionCurrent.draft.id;
      const latest = await request<BannerRevisionCurrent | null>(
        `${revisionBase}/current`,
      );
      if (!latest?.draft || latest.draft.id !== openedRevisionId) {
        await reloadRevision(selectedId);
        throw new Error(
          "Черновик уже изменён. Загружена актуальная версия баннера",
        );
      }
      const available = revisionActions(latest, { canEdit, canApprove });
      const allowed =
        action === "request-changes" ? available.requestChanges : available[action];
      if (!allowed) throw new Error("Действие больше недоступно");
      const reason =
        action === "request-changes"
          ? window.prompt("Укажите причину возврата баннера на доработку")
          : null;
      if (action === "request-changes" && !reason?.trim()) return;
      if (
        action === "publish" &&
        !window.confirm("Опубликовать одобренную версию баннера?")
      )
        return;
      await request(
        `${revisionBase}/${encodeURIComponent(openedRevisionId)}/${action}`,
        {
          method: "POST",
          ...(reason
            ? { body: JSON.stringify({ reason: reason.trim() }) }
            : {}),
        },
      );
      await reloadRevision(selectedId);
      if (action === "submit")
        setMessage("Версия баннера отправлена владельцу сайта на проверку");
      else if (action === "approve")
        setMessage("Версия баннера одобрена. Теперь её можно опубликовать");
      else if (action === "request-changes")
        setMessage("Версия баннера возвращена на доработку");
      else {
        setItems((current) =>
          current.map((item) =>
            item.id === selectedId && draft ? { ...item, ...draft } : item,
          ),
        );
        setMessage("Одобренная версия баннера опубликована");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить состояние версии баннера",
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function previewBannerRevision() {
    if (!siteId || !selectedId || !revisionCurrent?.draft) return;
    setWorkflowBusy(true);
    try {
      await saveQueue.current?.idle();
      const preview = await request<MediaBanner>(
        `/api/sites/${siteId}/content/banners/${selectedId}/revisions/${revisionCurrent.draft.id}/preview`,
      );
      setRevisionPreview({
        name: preview.name,
        title: preview.title,
        subtitle: preview.subtitle,
        buttonText: preview.buttonText,
        linkUrl: preview.linkUrl,
        mediaId: preview.mediaId,
        mobileMediaId: preview.mobileMediaId,
        isActive: preview.isActive,
      });
      setMessage(`Открыта сохранённая версия №${revisionCurrent.draft.versionNumber}`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось открыть версию баннера",
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function restoreBannerRevision(version: BannerRevisionVersion) {
    if (!siteId || !selectedId || !revisionCurrent?.draft || !canEdit) return;
    setWorkflowBusy(true);
    try {
      await saveQueue.current?.idle();
      await request(
        `/api/sites/${siteId}/content/banners/${selectedId}/revisions/${version.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedDraftRevisionId: revisionCurrent.draft.id,
          }),
        },
      );
      await load();
      setMessage(`Версия №${version.versionNumber} восстановлена как новый черновик`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось восстановить версию баннера",
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  const previewContexts = skinovaBannerPreviewContexts(slots);
  const selectedBanner = items.find((item) => item.id === selectedId) ?? null;
  const selectedAssignedContexts = selectedBanner
    ? assignedSkinovaPreviewContexts(
        selectedBanner,
        assignments,
        previewContexts,
      )
    : [];
  const selectedPreviewContext = chooseSkinovaPreviewContext(
    previewContexts,
    selectedAssignedContexts,
    selectedId ? previewRenderers[selectedId] : null,
  );
  const currentRevisionActions = revisionCurrent
    ? revisionActions(revisionCurrent, { canEdit, canApprove })
    : null;
  const canEditDraft = canEdit && revisionCurrent !== undefined;

  function previewPayload(
    item: MediaBanner,
    content: Draft,
    renderer: string,
    emptyHint: string,
    mode: "desktop" | "mobile",
  ) {
    return {
      renderer,
      mode,
      siteId: siteId ?? "",
      banner: {
        id: item.id,
        placement: item.placement,
        title: content.title,
        subtitle: content.subtitle,
        buttonText: content.buttonText,
        linkUrl: content.linkUrl,
        mediaId: content.mediaId,
        mobileMediaId: content.mobileMediaId,
      },
      emptyHint,
    };
  }

  function draftFor(item: MediaBanner): Draft {
    if (item.id === selectedId && draft) return draft;
    return {
      name: item.name,
      title: item.title,
      subtitle: item.subtitle,
      buttonText: item.buttonText,
      linkUrl: item.linkUrl,
      mediaId: item.mediaId,
      mobileMediaId: item.mobileMediaId,
      isActive: item.isActive,
    };
  }

  function previewContextFor(item: MediaBanner) {
    return chooseSkinovaPreviewContext(
      previewContexts,
      assignedSkinovaPreviewContexts(item, assignments, previewContexts),
      previewRenderers[item.id],
    );
  }

  return (
    <section className="media-module-shell media-banner-library">
      <header className="media-module-heading">
        <div>
          <small>САЙТ</small>
          <h1>Баннеры</h1>
        </div>
        <p>
          Универсальная библиотека {siteName ? `сайта «${siteName}»` : "сайта"}.
          Место показа назначается на странице.
        </p>
        {onBackToAssignments ? (
          <button
            type="button"
            className="secondary"
            onClick={onBackToAssignments}
          >
            ← Вернуться к назначениям
          </button>
        ) : null}
      </header>
      <div className="media-list-toolbar">
        <span>{items.length} баннеров</span>
        {canEdit ? (
          <button type="button" onClick={() => void create()}>
            + Создать баннер
          </button>
        ) : null}
      </div>
      {message ? (
        <p className="inline-message">{saving ? "Сохраняем…" : message}</p>
      ) : null}
      <div className="media-banner-workspace">
        <div className="media-banner-cards">
          {items.map((item) => {
            const context = previewContextFor(item);
            const content = draftFor(item);
            return context ? (
              <article
                key={item.id}
                className={`media-banner-card${selectedId === item.id ? " active" : ""}`}
              >
                <SkinovaBannerPreviewFrame
                  compact
                  label={`${item.name}: ${context.label}`}
                  payload={previewPayload(
                    item,
                    content,
                    context.renderer,
                    context.emptyHint,
                    "desktop",
                  )}
                />
                <button type="button" onClick={() => select(item)}>
                  <strong>{item.name}</strong>
                  <small>{context.label}</small>
                  <small>
                    {new Date(item.updatedAt).toLocaleString("ru-RU")}
                  </small>
                </button>
              </article>
            ) : null;
          })}
          {!items.length ? (
            <div className="empty-media">
              <h2>Баннеров пока нет</h2>
              <p>Создайте баннер и затем назначьте его зоне страницы.</p>
            </div>
          ) : null}
        </div>
        {draft ? (
          <aside className="media-editor-card media-banner-editor">
            <div className="autosave-indicator">
              {revisionCurrent === undefined
                ? "Загружаем версию…"
                : saving
                  ? "Сохраняем…"
                  : "Автосохранение черновика включено"}
            </div>
            <section className="workflow-panel">
              <strong>
                Версия баннера{" "}
                {revisionCurrent?.draft
                  ? `№${revisionCurrent.draft.versionNumber}`
                  : "не создана"}
              </strong>
              <p className="publication-hint">
                {revisionCurrent?.draft
                  ? `Состояние: ${revisionCurrent.reviewState}. Публичный баннер не меняется до выпуска одобренной версии.`
                  : revisionCurrent === undefined
                    ? "Загружаем состояние согласования."
                    : "Измените баннер, чтобы создать первую версию."}
              </p>
              <div className="workflow-actions">
                {currentRevisionActions?.submit ? (
                  <button
                    type="button"
                    disabled={workflowBusy || saving}
                    onClick={() => void changeBannerRevision("submit")}
                  >
                    Отправить владельцу на проверку
                  </button>
                ) : null}
                {currentRevisionActions?.requestChanges ? (
                  <button
                    type="button"
                    className="changes"
                    disabled={workflowBusy || saving}
                    onClick={() => void changeBannerRevision("request-changes")}
                  >
                    Вернуть на доработку
                  </button>
                ) : null}
                {currentRevisionActions?.approve ? (
                  <button
                    type="button"
                    className="publish"
                    disabled={workflowBusy || saving}
                    onClick={() => void changeBannerRevision("approve")}
                  >
                    Одобрить версию
                  </button>
                ) : null}
                {currentRevisionActions?.publish ? (
                  <button
                    type="button"
                    className="publish"
                    disabled={workflowBusy || saving}
                    onClick={() => void changeBannerRevision("publish")}
                  >
                    Опубликовать одобренную версию
                  </button>
                ) : null}
              </div>
              {revisionCurrent?.draft ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={workflowBusy || saving}
                  onClick={() => void previewBannerRevision()}
                >
                  Просмотреть выбранную версию
                </button>
              ) : null}
              {revisionPreview && selectedBanner && selectedPreviewContext ? (
                <div
                  className="media-banner-revision-preview"
                  role="region"
                  aria-label="Предпросмотр версии баннера"
                >
                  <SkinovaBannerPreviewFrame
                    compact
                    label={`${revisionPreview.name}: сохранённая версия`}
                    payload={previewPayload(
                      selectedBanner,
                      revisionPreview,
                      selectedPreviewContext.renderer,
                      selectedPreviewContext.emptyHint,
                      "desktop",
                    )}
                  />
                </div>
              ) : null}
              {versions.length ? (
                <div className="activity-list">
                  <strong>История версий</strong>
                  {versions.map((version) => (
                    <article key={version.id}>
                      <div>
                        <strong>Версия №{version.versionNumber}</strong>
                        <small>
                          {new Intl.DateTimeFormat("ru", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(version.createdAt))}
                        </small>
                      </div>
                      {canEdit &&
                      version.id !== revisionCurrent?.draft?.id ? (
                        <button
                          type="button"
                          disabled={workflowBusy || saving}
                          onClick={() => void restoreBannerRevision(version)}
                        >
                          Восстановить как новый черновик
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
            <label>
              Внутреннее название
              <input
                value={draft.name}
                readOnly={!canEditDraft}
                onChange={(event) => field("name", event.target.value)}
              />
            </label>
            {selectedBanner && selectedPreviewContext ? (
              <section
                className="media-banner-previews"
                aria-label="Живой предпросмотр баннера"
              >
                <div className="media-banner-preview-heading">
                  <div>
                    <strong>Живой предпросмотр</strong>
                    <small>Поля ниже меняют макет сразу.</small>
                  </div>
                  {(selectedAssignedContexts.length
                    ? selectedAssignedContexts
                    : previewContexts
                  ).length > 1 ? (
                    <label>
                      Показать как
                      <select
                        value={selectedPreviewContext.renderer}
                        onChange={(event) =>
                          setPreviewRenderers((current) => ({
                            ...current,
                            [selectedBanner.id]: event.target.value,
                          }))
                        }
                      >
                        {(selectedAssignedContexts.length
                          ? selectedAssignedContexts
                          : previewContexts
                        ).map((context) => (
                          <option key={context.id} value={context.renderer}>
                            {context.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <small>Показ: {selectedPreviewContext.label}</small>
                  )}
                </div>
                <div className="media-banner-preview-grid">
                  <figure>
                    <figcaption>Компьютер</figcaption>
                    <SkinovaBannerPreviewFrame
                      label={`${selectedBanner.name}: компьютер`}
                      payload={previewPayload(
                        selectedBanner,
                        draft,
                        selectedPreviewContext.renderer,
                        selectedPreviewContext.emptyHint,
                        "desktop",
                      )}
                    />
                  </figure>
                  <figure className="mobile">
                    <figcaption>Телефон</figcaption>
                    <SkinovaBannerPreviewFrame
                      label={`${selectedBanner.name}: телефон`}
                      payload={previewPayload(
                        selectedBanner,
                        draft,
                        selectedPreviewContext.renderer,
                        selectedPreviewContext.emptyHint,
                        "mobile",
                      )}
                    />
                  </figure>
                </div>
              </section>
            ) : null}
            {selectedPreviewContext?.supportsDesktopImage ? (
              <label>
                {selectedPreviewContext.renderer ===
                "skinova-article-sidebar"
                  ? "Изображение"
                  : "Изображение для компьютера"}
                <select
                  value={draft.mediaId ?? ""}
                  disabled={!canEditDraft}
                  onChange={(event) =>
                    field("mediaId", event.target.value || null)
                  }
                >
                  <option value="">Не выбрано</option>
                  {media.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.originalName}
                    </option>
                  ))}
                </select>
                {selectedPreviewContext.desktopHint ? (
                  <small className="media-banner-field-hint">
                    {selectedPreviewContext.desktopHint}
                  </small>
                ) : null}
              </label>
            ) : null}
            {selectedPreviewContext?.supportsMobileImage ? (
              <label>
                Изображение для телефона
                <select
                  value={draft.mobileMediaId ?? ""}
                  disabled={!canEditDraft}
                  onChange={(event) =>
                    field("mobileMediaId", event.target.value || null)
                  }
                >
                  <option value="">
                    Использовать изображение для компьютера
                  </option>
                  {media.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.originalName}
                    </option>
                  ))}
                </select>
                {selectedPreviewContext.mobileHint ? (
                  <small className="media-banner-field-hint">
                    {selectedPreviewContext.mobileHint}
                  </small>
                ) : null}
              </label>
            ) : null}
            <label>
              Ссылка
              <select
                value={bannerLinkSelectValue(
                  draft.linkUrl,
                  links.map((item) => item.value),
                )}
                disabled={!canEditDraft}
                onChange={(event) =>
                  field(
                    "linkUrl",
                    event.target.value === "external"
                      ? ""
                      : event.target.value || null,
                  )
                }
              >
                <option value="">Без ссылки</option>
                {links.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                <option value="external">Внешний адрес…</option>
              </select>
            </label>
            {bannerLinkSelectValue(
              draft.linkUrl,
              links.map((item) => item.value),
            ) === "external" ? (
              <label>
                Внешний адрес
                <input
                  type="url"
                  placeholder="https://example.ru"
                  value={draft.linkUrl ?? ""}
                  readOnly={!canEditDraft}
                  onChange={(event) => field("linkUrl", event.target.value)}
                />
              </label>
            ) : null}
            <label>
              Заголовок
              <input
                value={draft.title ?? ""}
                readOnly={!canEditDraft}
                onChange={(event) => field("title", event.target.value || null)}
              />
            </label>
            <label>
              Подзаголовок
              <textarea
                rows={3}
                value={draft.subtitle ?? ""}
                readOnly={!canEditDraft}
                onChange={(event) =>
                  field("subtitle", event.target.value || null)
                }
              />
            </label>
            <label>
              Текст кнопки
              <input
                value={draft.buttonText ?? ""}
                readOnly={!canEditDraft}
                onChange={(event) =>
                  field("buttonText", event.target.value || null)
                }
              />
            </label>
            <label className="item-seo-checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                disabled={!canEditDraft}
                onChange={(event) => field("isActive", event.target.checked)}
              />
              <span>Баннер активен</span>
            </label>
            {canApprove ? (
              <button
                type="button"
                className="danger"
                onClick={() => void remove()}
              >
                Удалить баннер
              </button>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
