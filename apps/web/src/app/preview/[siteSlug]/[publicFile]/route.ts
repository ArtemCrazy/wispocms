import type { NextRequest } from "next/server";

type SitemapData = {
  site: { canonicalUrl: string | null; noIndex: boolean };
  pages: Array<{ kind: "homepage" | "page"; slug: string; updatedAt: string }>;
  articles: Array<{ slug: string; updatedAt: string }>;
  categories: Array<{ slug: string; updatedAt: string; noIndex: boolean }>;
};

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (symbol) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[symbol] ?? symbol,
  );

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ siteSlug: string; publicFile?: string }> },
) {
  const { siteSlug, publicFile } = await params;
  if (publicFile && publicFile !== "sitemap.xml")
    return new Response("Not found\n", { status: 404 });

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
  const data = (await response.json()) as SitemapData;
  const publicOrigin = (
    process.env.PUBLIC_APP_URL ?? request.nextUrl.origin
  ).replace(/\/$/, "");
  const fallbackBase = `${publicOrigin}/preview/${encodeURIComponent(siteSlug)}`;
  const base = (data.site.canonicalUrl || fallbackBase).replace(/\/$/, "");
  const urls = data.site.noIndex
    ? []
    : [
        {
          loc: base,
          lastmod: data.pages.find((page) => page.kind === "homepage")
            ?.updatedAt,
        },
        ...data.pages
          .filter((page) => page.kind === "page")
          .map((page) => ({
            loc: `${base}/pages/${page.slug}`,
            lastmod: page.updatedAt,
          })),
        ...data.articles.map((article) => ({
          loc: `${base}/articles/${article.slug}`,
          lastmod: article.updatedAt,
        })),
        ...data.categories
          .filter((category) => !category.noIndex)
          .map((category) => ({
            loc: `${base}/categories/${category.slug}`,
            lastmod: category.updatedAt,
          })),
      ];
  const rows = urls
    .map(
      (item) =>
        `<url><loc>${escapeXml(item.loc)}</loc>${item.lastmod ? `<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>` : ""}</url>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows}</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
