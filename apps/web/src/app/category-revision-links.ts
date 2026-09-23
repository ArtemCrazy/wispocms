export function categoryRevisionApiBase(siteId: string, categoryId: string) {
  return `/api/sites/${encodeURIComponent(siteId)}/content/categories/${encodeURIComponent(categoryId)}/revisions`;
}

export function categoryRevisionPreviewPath({
  siteSlug,
  siteId,
  categoryId,
  categorySlug,
  revisionId,
}: {
  siteSlug: string;
  siteId: string;
  categoryId: string;
  categorySlug: string;
  revisionId: string;
}) {
  return `/preview/${encodeURIComponent(siteSlug)}/categories/${encodeURIComponent(categorySlug)}?cmsSiteId=${encodeURIComponent(siteId)}&cmsCategoryId=${encodeURIComponent(categoryId)}&cmsRevisionId=${encodeURIComponent(revisionId)}`;
}
