import type { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ siteSlug: string }> },
) {
  const { siteSlug } = await params;
  const apiBase = process.env.API_PROXY_URL ?? "http://localhost:4000";
  const response = await fetch(
    `${apiBase}/api/public/sites/${encodeURIComponent(siteSlug)}`,
    { cache: "no-store" },
  );
  if (!response.ok)
    return new Response("Site not found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const data = (await response.json()) as {
    site: { canonicalUrl?: string | null; noIndex: boolean };
  };
  const publicOrigin = (
    process.env.PUBLIC_APP_URL ?? request.nextUrl.origin
  ).replace(/\/$/, "");
  const fallbackBase = `${publicOrigin}/preview/${encodeURIComponent(siteSlug)}`;
  const publicBase = (data.site.canonicalUrl || fallbackBase).replace(/\/$/, "");
  const sitemap = `${publicBase}/sitemap.xml`;
  const body = data.site.noIndex
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
