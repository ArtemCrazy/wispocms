import Link from "next/link";
import type { PublicSiteLayout } from "./public-site-footer";
import { PublicSiteSearch } from "./public-site-search";

type HeaderPage = { id: string; title: string; slug: string };

function safeHref(value?: string) {
  if (!value) return "#contact";
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value) ? value : "#contact";
}

export function PublicSiteHeader({
  siteName,
  siteSlug,
  pages,
  layout,
  activePageId,
}: {
  siteName: string;
  siteSlug: string;
  pages: HeaderPage[];
  layout?: PublicSiteLayout;
  activePageId?: string;
}) {
  const showPages = layout?.showPages ?? true;
  const showArticles = layout?.showArticles ?? true;
  return (
    <header className="public-header">
      <Link className="public-logo" href={`/preview/${siteSlug}`}>
        {layout?.logoText || siteName}
      </Link>
      <nav>
        {showPages
          ? pages.map((page) => (
              <Link
                key={page.id}
                className={page.id === activePageId ? "active" : ""}
                href={`/preview/${siteSlug}/pages/${page.slug}`}
              >
                {page.title}
              </Link>
            ))
          : null}
        {showArticles ? (
          <Link href={`/preview/${siteSlug}#articles`}>Статьи</Link>
        ) : null}
      </nav>
      <PublicSiteSearch siteSlug={siteSlug} />
      {layout?.ctaLabel ? (
        <a className="public-cms-link" href={safeHref(layout.ctaUrl)}>
          {layout.ctaLabel} ↗
        </a>
      ) : (
        <span />
      )}
    </header>
  );
}
