"use client";

import { useEffect, useRef, useState } from "react";
import {
  SKINOVA_ARTICLE_BANNER_RENDERER,
  SKINOVA_BANNER_PREVIEW_MESSAGE,
  type SkinovaBannerPreviewPayload,
} from "./skinova-banner-preview-context";

function previewDimensions(
  renderer: string,
  mode: "desktop" | "mobile",
  compact: boolean,
  empty: boolean,
) {
  if (renderer === SKINOVA_ARTICLE_BANNER_RENDERER)
    return { width: 320, height: 390 };
  if (renderer === "skinova-promo-strip")
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
  const values = [
    payload.banner.title,
    payload.banner.subtitle,
    payload.banner.buttonText,
    ...(payload.renderer === "skinova-promo-strip"
      ? []
      : [payload.banner.mediaId]),
  ];
  const empty = !values.some((value) => value?.trim());
  const dimensions = previewDimensions(
    payload.renderer,
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
