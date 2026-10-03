"use client";

import { useEffect, useRef, useState } from "react";
import {
  SKINOVA_ARTICLE_BANNER_RENDERER,
  SKINOVA_BANNER_PREVIEW_MESSAGE,
  type SkinovaBannerPreviewPayload,
} from "./skinova-banner-preview-context";
import { SKINOVA_TEMPLATE_PACKAGE_MANIFEST } from "./template-package-contract";
import { resolveSlotComponent } from "./template-runtime-registry";

function previewDimensions(
  implementationKey: string | null,
  mode: "desktop" | "mobile",
  compact: boolean,
  empty: boolean,
) {
  if (implementationKey === SKINOVA_ARTICLE_BANNER_RENDERER)
    return { width: 320, height: 390 };
  if (implementationKey === "skinova-promo-strip")
    return {
      width: mode === "mobile" || compact ? 390 : 720,
      height: empty ? 110 : 58,
    };
  return {
    width: mode === "mobile" || compact ? 390 : 720,
    height: mode === "mobile" || compact ? 245 : 145,
  };
}

export function SkinovaBannerPreviewFrame({
  payload,
  compact = false,
  label,
}: {
  payload: SkinovaBannerPreviewPayload;
  compact?: boolean;
  label: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const slotRuntime = resolveSlotComponent({
    packageId: SKINOVA_TEMPLATE_PACKAGE_MANIFEST.packageId,
    packageVersion: SKINOVA_TEMPLATE_PACKAGE_MANIFEST.packageVersion,
    rendererKey: payload.renderer,
  });
  const values = [
    payload.banner.title,
    payload.banner.subtitle,
    payload.banner.buttonText,
    ...(slotRuntime?.implementationKey === "skinova-promo-strip"
      ? []
      : [payload.banner.mediaId]),
  ];
  const empty = !values.some((value) => value?.trim());
  const dimensions = previewDimensions(
    slotRuntime?.implementationKey ?? null,
    payload.mode,
    compact,
    empty,
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () =>
      setScale(Math.min(1, frame.clientWidth / dimensions.width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [dimensions.width]);

  useEffect(() => {
    if (!loaded) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: SKINOVA_BANNER_PREVIEW_MESSAGE, payload },
      window.location.origin,
    );
  }, [loaded, payload]);

  return (
    <div
      ref={frameRef}
      className={`skinova-preview-frame${compact ? " compact" : ""}`}
      style={{
        height: compact
          ? Math.min(170, Math.max(40, dimensions.height * scale))
          : Math.max(40, dimensions.height * scale),
      }}
      aria-label={label}
    >
      <iframe
        ref={iframeRef}
        src="/banner-preview"
        title={label}
        sandbox="allow-scripts allow-same-origin"
        loading={compact ? "lazy" : "eager"}
        tabIndex={-1}
        aria-hidden="true"
        onLoad={() => setLoaded(true)}
        style={{
          width: dimensions.width,
          height: dimensions.height,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}
