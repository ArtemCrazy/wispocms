export function resolvePublicBannerHref(
  siteSlug: string,
  value: string | null | undefined,
  fallback = "#articles",
) {
  const href = value?.trim();
  if (!href) return fallback;
  if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith("#"))
    return href;
  if (!href.startsWith("/") || href.startsWith("//")) return fallback;

  const encodedSite = encodeURIComponent(siteSlug);
  const currentPreviewPrefix = `/preview/${encodedSite}`;
  if (
    href === currentPreviewPrefix ||
    href.startsWith(`${currentPreviewPrefix}/`)
  )
    return href;

  const legacyPage = href.match(/^\/preview\/([^/]+)$/);
  if (legacyPage)
    return legacyPage[1] === siteSlug
      ? currentPreviewPrefix
      : `${currentPreviewPrefix}/pages/${encodeURIComponent(legacyPage[1])}`;

  const normalized = href.replace(/^\/articles\/category\//, "/categories/");
  return normalized === "/"
    ? currentPreviewPrefix
    : `${currentPreviewPrefix}${normalized}`;
}
