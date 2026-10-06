"use client";

/* eslint-disable @next/next/no-page-custom-font, @next/next/no-css-tags */
import { useEffect, useState } from "react";
import type { SkinovaBanner } from "../skinova-site";
import {
  SKINOVA_BANNER_PREVIEW_MESSAGE,
  type SkinovaBannerPreviewPayload,
} from "../skinova-banner-preview-context";
import { SKINOVA_TEMPLATE_PACKAGE_MANIFEST } from "../template-package-contract";
import { resolveSlotComponent } from "../template-runtime-registry";

export default function BannerPreviewPage() {
  const [payload, setPayload] = useState<SkinovaBannerPreviewPayload | null>(
    null,
  );

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== SKINOVA_BANNER_PREVIEW_MESSAGE
      )
        return;
      setPayload(event.data.payload as SkinovaBannerPreviewPayload);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  if (!payload) return null;
  const mediaBaseUrl = `/api/sites/${payload.siteId}/content/media`;
  const banner: SkinovaBanner = {
    id: payload.banner.id,
    placement: payload.banner.placement ?? null,
    title: payload.banner.title,
    subtitle: payload.banner.subtitle,
    buttonText: payload.banner.buttonText,
    linkUrl: payload.banner.linkUrl,
    media: payload.banner.mediaId
      ? { id: payload.banner.mediaId, altText: null }
      : null,
    mobileMedia: payload.banner.mobileMediaId
      ? { id: payload.banner.mobileMediaId, altText: null }
      : null,
  };
  const desktopImage = payload.banner.mediaId
    ? `${mediaBaseUrl}/${payload.banner.mediaId}/file`
    : "";
  const mobileImage = payload.banner.mobileMediaId
    ? `${mediaBaseUrl}/${payload.banner.mobileMediaId}/file`
    : desktopImage;
  const slotRuntime = resolveSlotComponent({
    packageId: SKINOVA_TEMPLATE_PACKAGE_MANIFEST.packageId,
    packageVersion: SKINOVA_TEMPLATE_PACKAGE_MANIFEST.packageVersion,
    rendererKey: payload.renderer,
  });
  const visibleValues = [
    payload.banner.title,
    payload.banner.subtitle,
    payload.banner.buttonText,
    ...(slotRuntime?.implementationKey === "skinova-promo-strip"
      ? []
      : [payload.banner.mediaId]),
  ];
  const isEmpty = !visibleValues.some((value) => value?.trim());
  if (!slotRuntime)
    return (
      <main className="skinova-site skinova-banner-render-surface">
        <div className="skinova-preview-empty">
          <strong>Шаблон недоступен</strong>
          <span>Этот вариант баннера отсутствует в текущей сборке сайта.</span>
        </div>
      </main>
    );

  let preview = null;
  switch (slotRuntime.implementationKey) {
    case "skinova-promo-strip": {
      const BannerRenderer = slotRuntime.renderer;
      preview = (
        <BannerRenderer
          banner={banner}
          siteSlug="skinova"
          onOpenFallback={() => undefined}
          onClose={() => undefined}
        />
      );
      break;
    }
    case "skinova-consultation": {
      const BannerRenderer = slotRuntime.renderer;
      preview = (
        <BannerRenderer
          banner={banner}
          desktopImage={desktopImage}
          mobileImage={mobileImage}
          siteSlug="skinova"
          onOpenFallback={() => undefined}
        />
      );
      break;
    }
    case "skinova-article-sidebar": {
      const BannerRenderer = slotRuntime.renderer;
      preview = (
        <BannerRenderer
          banner={banner}
          mediaBaseUrl={mediaBaseUrl}
          mediaFileSuffix="/file"
          onOpenFallback={() => undefined}
          useDefaultAsset={false}
          useDefaultContent={false}
        />
      );
      break;
    }
  }

  return (
    <main
      className={`skinova-site skinova-banner-render-surface ${payload.mode}`}
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Onest:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/skinova/styles.css" />
      {preview}
      {isEmpty ? (
        <div className="skinova-preview-empty">
          <strong>Заполните баннер</strong>
          <span>{payload.emptyHint}</span>
        </div>
      ) : null}
    </main>
  );
}
