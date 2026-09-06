import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { PublicContactForm } from "../../../../public-contact-form";
import {
  PublicSiteFooter,
  PublicSiteGlobals,
  PublicSiteLayout,
} from "../../../../public-site-footer";
import { PublicSiteHeader } from "../../../../public-site-header";
import {
  absolutePublicUrl,
  loadPublicData,
  queryValue,
} from "../../../../public-server-data";

type Article = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  bodyDocument: {
    version: 1;
    blocks: Array<
      | { id: string; type: "heading"; text: string; level: 2 | 3 | 4 }
      | { id: string; type: "paragraph"; text: string; href?: string | null }
      | {
          id: string;
          type: "image";
          mediaId: string;
          alt?: string;
          caption?: string;
        }
      | { id: string; type: "bullet_list"; items: string[] }
      | { id: string; type: "numbered_list"; items: string[] }
      | { id: string; type: "quote"; text: string; cite?: string }
    >;
  } | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  publishedAt: string | null;
  coverMedia: { id: string; altText: string | null } | null;
  previewMedia: { id: string; altText: string | null } | null;
  category: { name: string } | null;
  author: { fullName: string } | null;
};
type PublicBanner = {
  id: string;
  title: string | null;
  linkUrl: string | null;
  media: { id: string; altText: string | null } | null;
};
type ArticleData = {
  site: {
    name: string;
    slug: string;
    domain: string | null;
    globalData: PublicSiteGlobals;
    layoutSettings: PublicSiteLayout;
    seoTitle: string | null;
    seoDescription: string | null;
    canonicalUrl: string | null;
    seoImageMediaId: string | null;
    noIndex: boolean;
  };
  article: Article;
  pages: Array<{ id: string; title: string; slug: string }>;
  related: Article[];
  banners: PublicBanner[];
  redirectTo: string | null;
};

type PublicArticlePageProps = {
  params: Promise<{ siteSlug: string; articleSlug: string }>;
  searchParams: Promise<{
    cmsSiteId?: string | string[];
    cmsArticleId?: string | string[];
  }>;
};

async function loadArticle(siteSlug: string, articleSlug: string) {
  return loadPublicData<ArticleData>(
    `/api/public/sites/${encodeURIComponent(siteSlug)}/articles/${encodeURIComponent(articleSlug)}`,
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicArticlePageProps): Promise<Metadata> {
  const query = await searchParams;
  if (queryValue(query.cmsSiteId) && queryValue(query.cmsArticleId))
    return {
      title: "Предпросмотр материала",
      robots: { index: false, follow: false },
    };

  const { siteSlug, articleSlug } = await params;
  const result = await loadArticle(siteSlug, articleSlug);
  if (!result.ok)
    return { title: "Материал не найден", robots: { index: false } };

  const { site, article } = result.data;
  const title =
    article.seoTitle || `${article.title} — ${site.seoTitle || site.name}`;
  const description =
    article.seoDescription || article.excerpt || article.body.slice(0, 300);
  const canonical =
    article.canonicalUrl ||
    (site.canonicalUrl
      ? `${site.canonicalUrl}/articles/${article.slug}`
      : undefined);
  const noIndex = article.noIndex || site.noIndex;
  const imageId = article.coverMedia?.id || site.seoImageMediaId;
  const image = imageId
    ? absolutePublicUrl(
        `/api/public/sites/${encodeURIComponent(site.slug)}/media/${imageId}`,
      )
    : undefined;

  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: !noIndex, follow: !noIndex },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      images: image ? [image] : undefined,
      publishedTime: article.publishedAt || undefined,
    },
  };
}

export default async function PublicArticlePage({
  params,
  searchParams,
}: PublicArticlePageProps) {
  const { siteSlug, articleSlug } = await params;
  const query = await searchParams;
  const siteId = queryValue(query.cmsSiteId);
  const articleId = queryValue(query.cmsArticleId);
  const cmsPreview = siteId && articleId ? { siteId, articleId } : null;
  const result = cmsPreview
    ? await loadPublicData<ArticleData>(
        `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/articles/${encodeURIComponent(cmsPreview.articleId)}/preview`,
        (await cookies()).toString(),
      )
    : await loadArticle(siteSlug, articleSlug);

  if (!result.ok) {
    const message =
      result.status === 404
        ? "Материал не найден или ещё не опубликован"
        : "Не удалось загрузить материал";
    return (
      <main className="public-state">
        <span>W</span>
        <h1>{message}</h1>
        <Link href={`/preview/${siteSlug}`}>Вернуться на сайт</Link>
      </main>
    );
  }

  const data = result.data;
  if (!cmsPreview && data.redirectTo && data.redirectTo !== articleSlug)
    permanentRedirect(
      `/preview/${encodeURIComponent(siteSlug)}/articles/${encodeURIComponent(data.redirectTo)}`,
    );
  const { article, site, pages, related, banners } = data;
  const mediaUrl = (mediaId: string) =>
    cmsPreview
      ? `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/media/${mediaId}/file`
      : `/api/public/sites/${encodeURIComponent(siteSlug)}/media/${mediaId}`;
  const paragraphs = article.body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="public-site public-article-page">
      {cmsPreview ? (
        <div className="cms-preview-bar">
          <strong>Предпросмотр CMS</strong>
          <span>Материал ещё не опубликован для посетителей</span>
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
            <small>{article.category?.name ?? "Материал"}</small>
            <h1>{article.title}</h1>
            {article.excerpt ? <p>{article.excerpt}</p> : null}
            <footer>
              <span>{article.author?.fullName ?? site.name}</span>
              {article.publishedAt ? (
                <time>
                  {new Intl.DateTimeFormat("ru", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(new Date(article.publishedAt))}
                </time>
              ) : null}
            </footer>
          </div>
        </header>
        {article.coverMedia ? (
          <div className="public-article-main-cover">
            <Image
              unoptimized
              fill
              priority
              sizes="1200px"
              src={mediaUrl(article.coverMedia.id)}
              alt={article.coverMedia.altText ?? article.title}
            />
          </div>
        ) : null}
        <div
          className={`public-article-content ${banners.length ? "" : "without-sidebar"}`}
        >
          <article className="public-article-body">
            {article.bodyDocument?.blocks.length || paragraphs.length ? (
              article.bodyDocument?.blocks.length ? (
                article.bodyDocument.blocks.map((block) => {
                  if (block.type === "heading") {
                    const Heading = `h${block.level}` as "h2" | "h3" | "h4";
                    return <Heading key={block.id}>{block.text}</Heading>;
                  }
                  if (block.type === "paragraph")
                    return block.href ? (
                      <p key={block.id}>
                        <a href={block.href}>{block.text}</a>
                      </p>
                    ) : (
                      <p key={block.id}>{block.text}</p>
                    );
                  if (block.type === "image")
                    return (
                      <figure key={block.id}>
                        <Image
                          unoptimized
                          width={1200}
                          height={675}
                          src={mediaUrl(block.mediaId)}
                          alt={block.alt ?? ""}
                        />
                        {block.caption ? (
                          <figcaption>{block.caption}</figcaption>
                        ) : null}
                      </figure>
                    );
                  if (block.type === "bullet_list")
                    return (
                      <ul key={block.id}>
                        {block.items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    );
                  if (block.type === "numbered_list")
                    return (
                      <ol key={block.id}>
                        {block.items.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ol>
                    );
                  return (
                    <blockquote key={block.id}>
                      <p>{block.text}</p>
                      {block.cite ? <cite>{block.cite}</cite> : null}
                    </blockquote>
                  );
                })
              ) : (
                paragraphs.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))
              )
            ) : (
              <p>Текст материала пока не добавлен.</p>
            )}
          </article>
          {banners.length ? (
            <aside
              className="public-article-sidebar"
              aria-label="Дополнительные материалы"
            >
              {banners.map((banner) => (
                <a
                  key={banner.id}
                  className="public-banner"
                  href={banner.linkUrl || `/preview/${siteSlug}`}
                >
                  {banner.media ? (
                    <Image
                      unoptimized
                      fill
                      sizes="280px"
                      src={mediaUrl(banner.media.id)}
                      alt={banner.media.altText ?? ""}
                    />
                  ) : null}
                  <span>{banner.title || "Подробнее"}</span>
                  <b>→</b>
                </a>
              ))}
            </aside>
          ) : null}
        </div>
        {related.length ? (
          <section className="public-related">
            <header>
              <small>ЕЩЁ ПО ТЕМЕ</small>
              <h2>Другие материалы</h2>
            </header>
            <div>
              {related.map((item) => (
                <Link
                  key={item.id}
                  href={`/preview/${siteSlug}/articles/${item.slug}`}
                >
                  {item.previewMedia || item.coverMedia ? (
                    <span>
                      <Image
                        unoptimized
                        fill
                        sizes="320px"
                        src={mediaUrl(
                          (item.previewMedia ?? item.coverMedia)!.id,
                        )}
                        alt={
                          (item.previewMedia ?? item.coverMedia)!.altText ??
                          item.title
                        }
                      />
                    </span>
                  ) : null}
                  <small>{item.category?.name ?? "Материал"}</small>
                  <strong>{item.title}</strong>
                  <b>Читать →</b>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <PublicContactForm siteSlug={siteSlug} siteName={site.name} />
      </main>
      <PublicSiteFooter
        siteName={site.name}
        globals={site.globalData}
        layout={site.layoutSettings}
      />
    </div>
  );
}
