"use client";

/* eslint-disable @next/next/no-page-custom-font, @next/next/no-css-tags */
import { useEffect, useState } from "react";
import {
  SkinovaArticleBanner,
  type SkinovaBanner,
  SkinovaConsultationBanner,
  SkinovaPromoBanner,
} from "../skinova-site";
import {
  SKINOVA_ARTICLE_BANNER_RENDERER,
  SKINOVA_BANNER_PREVIEW_MESSAGE,
  type SkinovaBannerPreviewPayload,
} from "../skinova-banner-preview-context";

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
  const visibleValues = [
    payload.banner.title,
    payload.banner.subtitle,
    payload.banner.buttonText,
    ...(payload.renderer === "skinova-promo-strip"
      ? []
      : [payload.banner.mediaId]),
  ];
  const isEmpty = !visibleValues.some((value) => value?.trim());

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
      {payload.renderer === "skinova-promo-strip" ? (
        <SkinovaPromoBanner
          banner={banner}
          siteSlug="skinova"
          onOpenFallback={() => undefined}
          onClose={() => undefined}
        />
      ) : payload.renderer === "skinova-consultation" ? (
        <SkinovaConsultationBanner
          banner={banner}
          desktopImage={desktopImage}
          mobileImage={mobileImage}
          siteSlug="skinova"
          onOpenFallback={() => undefined}
        />
      ) : payload.renderer === SKINOVA_ARTICLE_BANNER_RENDERER ? (
        <SkinovaArticleBanner
          banner={banner}
          mediaBaseUrl={mediaBaseUrl}
          mediaFileSuffix="/file"
          onOpenFallback={() => undefined}
          useDefaultAsset={false}
          useDefaultContent={false}
        />
      ) : null}
      {isEmpty ? (
        <div className="skinova-preview-empty">
          <strong>Заполните баннер</strong>
          <span>{payload.emptyHint}</span>
        </div>
      ) : null}
    </main>
  );
}
