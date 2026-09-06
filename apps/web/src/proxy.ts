import { NextResponse, type NextRequest } from "next/server";

function normalizedHost(value: string | null) {
  const input = value?.trim().toLowerCase();
  if (!input || /[\/\\?#@\s]/.test(input) || input.startsWith("[")) return null;
  const hostname = input.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.split(".").some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
    return null;
  return hostname;
}

function cmsHosts() {
  const hosts = new Set(["localhost", "127.0.0.1"]);
  for (const value of [
    process.env.PUBLIC_APP_URL,
    ...(process.env.WISPO_RESERVED_HOSTS ?? "").split(","),
  ]) {
    if (!value) continue;
    try {
      hosts.add(new URL(value.includes("://") ? value : `https://${value}`).hostname);
    } catch {
      // Invalid deployment configuration must not widen host trust.
    }
  }
  return hosts;
}

function publicRewritePath(siteSlug: string, pathname: string) {
  if (pathname === "/") return `/preview/${siteSlug}`;
  if (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /^\/(?:articles|categories|pages)\/[^/]+\/?$/.test(pathname)
  )
    return `/preview/${siteSlug}${pathname}`;
  return null;
}

export async function proxy(request: NextRequest) {
  const host = normalizedHost(request.headers.get("host"));
  if (!host) return new NextResponse("Not found", { status: 404 });
  if (cmsHosts().has(host)) return NextResponse.next();

  const apiBase = process.env.API_PROXY_URL ?? "http://localhost:4000";
  let resolved: { slug?: string } | null = null;
  try {
    const response = await fetch(
      new URL(`/api/public/sites/resolve-host?host=${encodeURIComponent(host)}`, apiBase),
      { cache: "no-store" },
    );
    if (response.ok) resolved = (await response.json()) as { slug?: string };
  } catch {
    return new NextResponse("Site unavailable", { status: 503 });
  }
  if (!resolved?.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resolved.slug))
    return new NextResponse("Not found", { status: 404 });

  const previewPrefix = `/preview/${resolved.slug}`;
  if (request.nextUrl.pathname === previewPrefix) {
    return NextResponse.redirect(new URL("/", request.url), 308);
  }
  if (request.nextUrl.pathname.startsWith(`${previewPrefix}/`)) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname.slice(previewPrefix.length), request.url),
      308,
    );
  }
  const destination = publicRewritePath(resolved.slug, request.nextUrl.pathname);
  if (!destination) return new NextResponse("Not found", { status: 404 });
  const headers = new Headers(request.headers);
  headers.set("x-wispo-public-host", host);
  headers.set("x-wispo-site-slug", resolved.slug);
  const url = request.nextUrl.clone();
  url.pathname = destination;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|_wispo-assets|favicon.ico|preview).*)",
    "/preview/:path*",
  ],
};

export const __test = { normalizedHost, publicRewritePath };
