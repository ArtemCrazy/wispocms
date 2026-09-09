"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { MediaBanner } from "./media-banner-library-view";

type Page = { id: string; kind: "homepage" | "page" };
type Assignment = {
  id: string;
  zone: string;
  bannerId: string;
  banner: MediaBanner;
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

const zones = [
  {
    id: "homepage_top",
    name: "Верх главной",
    hint: "Первый баннер после шапки",
  },
  {
    id: "homepage_middle",
    name: "Середина главной",
    hint: "Баннер между блоками материалов",
  },
];

export function PageBannerAssignmentsView({
  siteId,
  canEdit,
  onOpenLibrary,
}: {
  siteId: string;
  canEdit: boolean;
  onOpenLibrary?: () => void;
}) {
  const [pageId, setPageId] = useState("");
  const [banners, setBanners] = useState<MediaBanner[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [pages, bannerRows] = await Promise.all([
      request<Page[]>(`/api/sites/${siteId}/content/pages`),
      request<MediaBanner[]>(`/api/sites/${siteId}/content/banners`),
    ]);
    const homepageId = pages.find((item) => item.kind === "homepage")?.id ?? "";
    setPageId(homepageId);
    setBanners(bannerRows.filter((item) => item.isActive));
    setAssignments(
      homepageId
        ? await request(
            `/api/sites/${siteId}/content/pages/${homepageId}/banner-assignments`,
          )
        : [],
    );
  }, [siteId]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load().catch((error) => setMessage(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load]);

  async function assign(zone: string, bannerId: string) {
    if (!pageId || !canEdit) return;
    try {
      if (bannerId) {
        setAssignments(
          await request(
            `/api/sites/${siteId}/content/pages/${pageId}/banner-assignments`,
            {
              method: "PUT",
              body: JSON.stringify({ zone, bannerId }),
            },
          ),
        );
        setMessage("Баннер назначен");
      } else {
        await request(
          `/api/sites/${siteId}/content/pages/${pageId}/banner-assignments/${encodeURIComponent(zone)}`,
          { method: "DELETE" },
        );
        setAssignments((current) =>
          current.filter((item) => item.zone !== zone),
        );
        setMessage("Назначение снято");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось изменить назначение",
      );
    }
  }

  if (!pageId)
    return (
      <div className="empty-media">
        <h2>Главная ещё не создана</h2>
        <p>
          {message || "Создайте главную страницу, чтобы назначить баннеры."}
        </p>
      </div>
    );

  return (
    <section className="page-banner-assignments">
      <header>
        <div>
          <small>ЗОНЫ СТРАНИЦЫ</small>
          <h2>Баннеры главной</h2>
        </div>
        {onOpenLibrary ? (
          <button type="button" className="secondary" onClick={onOpenLibrary}>
            Открыть библиотеку
          </button>
        ) : null}
      </header>
      {message ? <p className="inline-message">{message}</p> : null}
      <div className="banner-zone-list">
        {zones.map((zone) => {
          const assigned = assignments.find((item) => item.zone === zone.id);
          return (
            <article key={zone.id}>
              <div className="banner-zone-preview">
                {assigned?.banner.mediaId ? (
                  <Image
                    src={`/api/sites/${siteId}/content/media/${assigned.banner.mediaId}/file`}
                    width={420}
                    height={210}
                    alt=""
                  />
                ) : (
                  <span>Зона свободна</span>
                )}
              </div>
              <div>
                <small>{zone.hint}</small>
                <h3>{zone.name}</h3>
                <strong>{assigned?.banner.name ?? "Баннер не назначен"}</strong>
              </div>
              <label>
                Выбрать или заменить
                <select
                  value={assigned?.bannerId ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => void assign(zone.id, event.target.value)}
                >
                  <option value="">Не назначен</option>
                  {banners.map((banner) => (
                    <option key={banner.id} value={banner.id}>
                      {banner.name}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          );
        })}
      </div>
    </section>
  );
}
