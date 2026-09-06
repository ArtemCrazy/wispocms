export type PublicSeoSite = {
  name: string;
  slug: string;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  seoImageMediaId: string | null;
  noIndex: boolean;
};

export function PublicSeo({
  site,
  title,
  description,
  seoTitle,
  seoDescription,
  canonicalUrl,
  noIndex,
  path = "",
}: {
  site: PublicSeoSite;
  title?: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  path?: string;
}) {
  const finalTitle =
    seoTitle ||
    (title
      ? `${title} — ${site.seoTitle || site.name}`
      : site.seoTitle || site.name);
  const finalDescription =
    seoDescription || description || site.seoDescription || "";
  const canonical =
    canonicalUrl === null
      ? undefined
      : canonicalUrl ||
        (site.canonicalUrl ? `${site.canonicalUrl}${path}` : undefined);
  const preventIndexing = noIndex ?? site.noIndex;
  const image = site.seoImageMediaId
    ? `/api/public/sites/${encodeURIComponent(site.slug)}/media/${site.seoImageMediaId}`
    : undefined;
  return (
    <>
      <title>{finalTitle}</title>
      {finalDescription ? (
        <meta name="description" content={finalDescription} />
      ) : null}
      <meta
        name="robots"
        content={preventIndexing ? "noindex, nofollow" : "index, follow"}
      />
      {canonical ? <link rel="canonical" href={canonical} /> : null}
      <meta property="og:title" content={finalTitle} />
      {finalDescription ? (
        <meta property="og:description" content={finalDescription} />
      ) : null}
      {canonical ? <meta property="og:url" content={canonical} /> : null}
      {image ? <meta property="og:image" content={image} /> : null}
    </>
  );
}
