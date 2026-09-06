"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  NotFoundTemplate,
  safeNotFoundTemplate,
  type NotFoundTemplateData,
} from "../../../../not-found-template";

type PublicNotFoundData = {
  site: { name: string; slug: string };
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

  return (
    <NotFoundTemplate
      template={data?.template ?? safeNotFoundTemplate}
      siteName={data?.site.name ?? "Wispo"}
      homeHref={`/preview/${siteSlug}`}
    />
  );
}
