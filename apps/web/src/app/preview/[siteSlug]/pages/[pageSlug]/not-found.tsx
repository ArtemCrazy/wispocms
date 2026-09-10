"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  NotFoundTemplate,
  safeNotFoundTemplate,
  type NotFoundTemplateData,
} from "../../../../not-found-template";
import {
  SkinovaSystemPage,
  type SkinovaBanner,
  type SkinovaCategory,
} from "../../../../skinova-site";
import { SKINOVA_HEADER_TEMPLATE_KEY } from "../../../../skinova-template";

type PublicNotFoundData = {
  site: {
    name: string;
    slug: string;
    globalData?: { telegramUrl?: string; vkUrl?: string };
    layoutSettings?: {
      headerTemplateKey?: string;
      footerDescription?: string;
    };
  };
  categories: SkinovaCategory[];
  banners: SkinovaBanner[];
  active: boolean;
  template: NotFoundTemplateData;
};

export default function PublicNotFound() {
  const params = useParams<{ siteSlug: string }>();
  const siteSlug = params.siteSlug;
  const [data, setData] = useState<PublicNotFoundData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/public/sites/${encodeURIComponent(siteSlug)}/not-found`, {
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as PublicNotFoundData) : null,
      )
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, [siteSlug]);

  if (
    data?.site.layoutSettings?.headerTemplateKey === SKINOVA_HEADER_TEMPLATE_KEY
  )
    return (
      <SkinovaSystemPage
        siteSlug={siteSlug}
        title={data.template.title}
        text={data.template.text}
        kind="not-found"
        categories={data.categories}
        banners={data.banners}
        globals={data.site.globalData}
        layout={data.site.layoutSettings}
      />
    );

  return (
    <NotFoundTemplate
      template={data?.template ?? safeNotFoundTemplate}
      siteName={data?.site.name ?? "Wispo"}
      homeHref={`/preview/${siteSlug}`}
    />
  );
}
