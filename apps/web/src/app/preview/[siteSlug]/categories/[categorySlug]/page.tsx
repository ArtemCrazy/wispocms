import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { PublicSiteHeader } from "../../../../public-site-header";
import {
  PublicSiteFooter,
  PublicSiteGlobals,
  PublicSiteLayout,
} from "../../../../public-site-footer";
import {
  absolutePublicUrl,
  loadPublicData,
  queryValue,
} from "../../../../public-server-data";
import {
  SkinovaCategoryPage,
  type SkinovaArticle,
  type SkinovaCategory,
} from "../../../../skinova-site";
import {
  SKINOVA_CATEGORY_TEMPLATE_KEY,
  SKINOVA_TEMPLATE_VERSION,
} from "../../../../skinova-template";

type CategoryData = {
  site: {
    name: string;
    slug: string;
    globalData: PublicSiteGlobals;
    layoutSettings: PublicSiteLayout;
    canonicalUrl: string | null;
    noIndex: boolean;
  };
  category: {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    description: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    canonicalUrl: string | null;
    noIndex: boolean;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImageMediaId: string | null;
    structuredData: Record<string, unknown> | null;
    displayTemplateKey?: string;
    displayTemplateVersion?: string;
  };
  redirectTo: string | null;
  articles: Array<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    body: string;
    previewMedia: { id: string; altText: string | null } | null;
    coverMedia: { id: string; altText: string | null } | null;
  }>;
  children: Array<{ id: string; name: string; slug: string }>;
  pages: Array<{ id: string; title: string; slug: string }>;
};

async function loadCategory(siteSlug: string, categorySlug: string) {
  return loadPublicData<CategoryData>(
    `/api/public/sites/${encodeURIComponent(siteSlug)}/categories/${encodeURIComponent(categorySlug)}`,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ siteSlug: string; categorySlug: string }>;
}): Promise<Metadata> {
  const { siteSlug, categorySlug } = await params;
  const result = await loadCategory(siteSlug, categorySlug);
  if (!result.ok)
    return { title: "Рубрика не найдена", robots: { index: false } };
  const { site, category } = result.data;
  const canonical =
    category.canonicalUrl ||
    (site.canonicalUrl
      ? `${site.canonicalUrl.replace(/\/$/, "")}/categories/${category.slug}`
      : undefined);
  return {
    title: category.seoTitle || `${category.name} — ${site.name}`,
    description: category.seoDescription || category.description || undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: {
      index: !(site.noIndex || category.noIndex),
      follow: !(site.noIndex || category.noIndex),
    },
    openGraph: {
      title: category.ogTitle || category.seoTitle || category.name,
      description:
        category.ogDescription ||
        category.seoDescription ||
        category.description ||
        undefined,
      url: canonical,
      images: category.ogImageMediaId
        ? [
            absolutePublicUrl(
              `/api/public/sites/${encodeURIComponent(site.slug)}/media/${category.ogImageMediaId}`,
            ),
          ]
        : undefined,
    },
  };
}

export default async function PublicCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string; categorySlug: string }>;
  searchParams: Promise<{
    cmsSiteId?: string | string[];
    cmsCategoryId?: string | string[];
    cmsRevisionId?: string | string[];
  }>;
}) {
  const { siteSlug, categorySlug } = await params;
  const query = await searchParams;
  const siteId = queryValue(query.cmsSiteId);
  const categoryId = queryValue(query.cmsCategoryId);
  const revisionId = queryValue(query.cmsRevisionId);
  const cmsPreview =
    siteId && categoryId && revisionId
      ? { siteId, categoryId, revisionId }
      : null;
  const result = cmsPreview
    ? await loadPublicData<CategoryData>(
        `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/categories/${encodeURIComponent(cmsPreview.categoryId)}/revisions/${encodeURIComponent(cmsPreview.revisionId)}/preview`,
        (await cookies()).toString(),
      )
    : await loadCategory(siteSlug, categorySlug);
  if (!result.ok)
    return (
      <main className="public-state">
        <span>W</span>
        <h1>Рубрика не найдена</h1>
        <Link href={`/preview/${siteSlug}`}>Вернуться на сайт</Link>
      </main>
    );
  if (
    !cmsPreview &&
    result.data.redirectTo &&
    result.data.redirectTo !== categorySlug
  )
    permanentRedirect(
      `/preview/${encodeURIComponent(siteSlug)}/categories/${encodeURIComponent(result.data.redirectTo)}`,
    );
  const { site, category, articles, children, pages } = result.data;
  if (
    category.displayTemplateKey === SKINOVA_CATEGORY_TEMPLATE_KEY &&
    category.displayTemplateVersion === SKINOVA_TEMPLATE_VERSION
  ) {
    return (
      <>
        {cmsPreview ? (
          <div className="cms-preview-bar">
            <strong>Предпросмотр CMS</strong>
            <span>Рубрика может быть скрыта от посетителей</span>
            <Link href="/">Вернуться в CMS</Link>
          </div>
        ) : null}
        <SkinovaCategoryPage
          siteSlug={siteSlug}
          category={
            category as SkinovaCategory & {
              description?: string | null;
            }
          }
          articles={articles as SkinovaArticle[]}
          subcategories={children as SkinovaCategory[]}
          globals={site.globalData}
          layout={site.layoutSettings}
          mediaBaseUrl={
            cmsPreview
              ? `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/media`
              : `/api/public/sites/${encodeURIComponent(siteSlug)}/media`
          }
          mediaFileSuffix={cmsPreview ? "/file" : ""}
        />
      </>
    );
  }
  const mediaUrl = (id: string) =>
    `/api/public/sites/${encodeURIComponent(siteSlug)}/media/${id}`;
  return (
    <div className="public-site public-category-page">
      {category.structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(category.structuredData).replace(
              /</g,
              "\\u003c",
            ),
          }}
        />
      ) : null}
      {cmsPreview ? (
        <div className="cms-preview-bar">
          <strong>Предпросмотр CMS</strong>
          <span>Рубрика может быть скрыта от посетителей</span>
          <Link href="/">Вернуться в CMS</Link>
        </div>
      ) : null}
      <PublicSiteHeader
        siteName={site.name}
        siteSlug={siteSlug}
        pages={pages}
        layout={site.layoutSettings}
      />
      <main>
        <header className="public-article-head">
          <div>
            <Link href={`/preview/${siteSlug}#articles`}>← Все материалы</Link>
            <small>РУБРИКА</small>
            <h1>{category.name}</h1>
            {category.description ? <p>{category.description}</p> : null}
          </div>
        </header>
        {children.length ? (
          <nav
            className="public-category-children"
            aria-label="Вложенные рубрики"
          >
            {children.map((child) => (
              <Link
                key={child.id}
                href={`/preview/${siteSlug}/categories/${child.slug}`}
              >
                {child.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <section className="public-articles">
          <div>
            {articles.map((article) => {
              const image = article.previewMedia ?? article.coverMedia;
              return (
                <article key={article.id}>
                  {image ? (
                    <Link
                      className="public-article-cover"
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      <Image
                        unoptimized
                        fill
                        sizes="(max-width: 760px) 100vw, 33vw"
                        src={mediaUrl(image.id)}
                        alt={image.altText ?? article.title}
                      />
                    </Link>
                  ) : null}
                  <h2>
                    <Link
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      {article.title}
                    </Link>
                  </h2>
                  <p>{article.excerpt || article.body.slice(0, 180)}</p>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <PublicSiteFooter
        siteName={site.name}
        globals={site.globalData}
        layout={site.layoutSettings}
      />
    </div>
  );
}
