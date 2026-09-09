import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PublicContactForm } from "../../public-contact-form";
import {
  PublicSiteFooter,
  PublicSiteGlobals,
  PublicSiteLayout,
} from "../../public-site-footer";
import { PublicSiteHeader } from "../../public-site-header";
import { ArmaturexHome } from "../../armaturex-home";
import {
  isArmaturexHomepage,
  resolveArmaturexContent,
} from "../../homepage-templates";
import {
  absolutePublicUrl,
  loadPublicData,
  queryValue,
} from "../../public-server-data";

type PageBlock = {
  id: string;
  type: "hero" | "text" | "cta";
  title?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  mediaId?: string;
  data?: Record<string, unknown>;
};
type PublicPage = {
  id: string;
  title: string;
  slug: string;
  kind: "homepage" | "page";
  blocks: PageBlock[];
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  systemTemplateKey: string | null;
  systemTemplateVersion: string | null;
};
type PublicArticle = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  publishedAt: string | null;
  coverMedia: { id: string; altText: string | null } | null;
  previewMedia: { id: string; altText: string | null } | null;
  category: { name: string } | null;
  author: { fullName: string } | null;
};
type PublicBanner = {
  id: string;
  placement: "homepage_top" | "homepage_middle" | "article_sidebar";
  title: string | null;
  linkUrl: string | null;
  media: { id: string; altText: string | null } | null;
};
type PublicSiteData = {
  site: {
    name: string;
    slug: string;
    domain: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    globalData: PublicSiteGlobals;
    layoutSettings: PublicSiteLayout;
    canonicalUrl: string | null;
    seoImageMediaId: string | null;
    noIndex: boolean;
  };
  pages: PublicPage[];
  articles: PublicArticle[];
  banners: PublicBanner[];
};

type PublicSitePageProps = {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{
    cmsSiteId?: string | string[];
    cmsPageId?: string | string[];
  }>;
};

async function loadSite(siteSlug: string) {
  return loadPublicData<PublicSiteData>(
    `/api/public/sites/${encodeURIComponent(siteSlug)}`,
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicSitePageProps): Promise<Metadata> {
  const query = await searchParams;
  if (queryValue(query.cmsSiteId) && queryValue(query.cmsPageId))
    return {
      title: "Предпросмотр CMS",
      robots: { index: false, follow: false },
    };

  const { siteSlug } = await params;
  const result = await loadSite(siteSlug);
  if (!result.ok) return { title: "Сайт не найден", robots: { index: false } };

  const { site, pages } = result.data;
  const homepage = pages.find((page) => page.kind === "homepage");
  const title = homepage?.seoTitle || site.seoTitle || site.name;
  const description = homepage?.seoDescription || site.seoDescription || "";
  const canonical = homepage?.canonicalUrl || site.canonicalUrl || undefined;
  const noIndex = homepage?.noIndex ?? site.noIndex;
  const image = site.seoImageMediaId
    ? absolutePublicUrl(
        `/api/public/sites/${encodeURIComponent(site.slug)}/media/${site.seoImageMediaId}`,
      )
    : undefined;

  return {
    title,
    description: description || undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: !noIndex, follow: !noIndex },
    openGraph: {
      title,
      description: description || undefined,
      url: canonical,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PublicSitePage({
  params,
  searchParams,
}: PublicSitePageProps) {
  const { siteSlug } = await params;
  const query = await searchParams;
  const siteId = queryValue(query.cmsSiteId);
  const pageId = queryValue(query.cmsPageId);
  const cmsPreview = siteId && pageId ? { siteId, pageId } : null;
  const result = cmsPreview
    ? await loadPublicData<PublicSiteData>(
        `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/pages/${encodeURIComponent(cmsPreview.pageId)}/preview`,
        (await cookies()).toString(),
      )
    : await loadSite(siteSlug);

  if (!result.ok) {
    const message =
      result.status === 404 ? "Сайт не найден" : "Не удалось загрузить сайт";
    return (
      <main className="public-state">
        <span>W</span>
        <h1>{message}</h1>
        <Link href="/">Вернуться в Wispo CMS</Link>
      </main>
    );
  }

  const data = result.data;
  const homepage = data.pages.find((page) => page.kind === "homepage");
  const topBanners = data.banners.filter(
    (banner) => banner.placement === "homepage_top",
  );
  const middleBanners = data.banners.filter(
    (banner) => banner.placement === "homepage_middle",
  );
  const mediaUrl = (mediaId: string) =>
    cmsPreview
      ? `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/media/${mediaId}/file`
      : `/api/public/sites/${encodeURIComponent(siteSlug)}/media/${mediaId}`;
  const hero = homepage?.blocks.find((block) => block.type === "hero");
  const otherBlocks =
    homepage?.blocks.filter((block) => block.id !== hero?.id) ?? [];

  if (
    homepage &&
    isArmaturexHomepage({
      key: homepage.systemTemplateKey,
      version: homepage.systemTemplateVersion,
    })
  ) {
    const organizationSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name:
        data.site.globalData.legalName ||
        data.site.globalData.companyName ||
        data.site.name,
      url: data.site.canonicalUrl || undefined,
      email: data.site.globalData.email || undefined,
      telephone: data.site.globalData.phone || undefined,
      address: data.site.globalData.address
        ? {
            "@type": "PostalAddress",
            streetAddress: data.site.globalData.address,
            addressCountry: "RU",
          }
        : undefined,
      areaServed: "RU",
    };
    return (
      <>
        {cmsPreview ? (
          <div className="cms-preview-bar cms-preview-bar--armaturex">
            <strong>Предпросмотр CMS</strong>
            <span>Главная страница ещё не опубликована для посетителей</span>
            <Link href="/">Вернуться в CMS</Link>
          </div>
        ) : null}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationSchema).replace(/</g, "\\u003c"),
          }}
        />
        <ArmaturexHome
          siteName={data.site.name}
          siteSlug={siteSlug}
          content={resolveArmaturexContent(homepage.blocks)}
          globals={data.site.globalData}
          layout={data.site.layoutSettings}
          cmsSiteId={cmsPreview?.siteId}
        />
      </>
    );
  }

  return (
    <div className="public-site">
      {cmsPreview ? (
        <div className="cms-preview-bar">
          <strong>Предпросмотр CMS</strong>
          <span>Главная страница ещё не опубликована для посетителей</span>
          <Link href="/">Вернуться в CMS</Link>
        </div>
      ) : null}
      <PublicSiteHeader
        siteName={data.site.name}
        siteSlug={siteSlug}
        pages={data.pages.filter((page) => page.kind === "page")}
        layout={data.site.layoutSettings}
      />

      {topBanners.map((banner) => (
        <a
          key={banner.id}
          className="public-banner"
          href={banner.linkUrl || "#articles"}
        >
          {banner.media ? (
            <Image
              unoptimized
              fill
              sizes="100vw"
              src={mediaUrl(banner.media.id)}
              alt={banner.media.altText ?? ""}
            />
          ) : null}
          <span>{banner.title || "Подробнее"}</span>
          <b>→</b>
        </a>
      ))}

      <main>
        <section className="public-hero">
          {hero?.mediaId ? (
            <Image
              unoptimized
              fill
              priority
              sizes="100vw"
              src={mediaUrl(hero.mediaId)}
              alt=""
            />
          ) : null}
          <div>
            <small>WISPO MEDIA</small>
            <h1>{hero?.title || data.site.seoTitle || data.site.name}</h1>
            <p>
              {hero?.text ||
                data.site.seoDescription ||
                "Материалы, новости и истории проекта."}
            </p>
            {hero?.buttonLabel ? (
              <a href={hero.buttonUrl || "#articles"}>{hero.buttonLabel}</a>
            ) : null}
          </div>
        </section>

        {otherBlocks.map((block) => (
          <section
            key={block.id}
            id={block.id}
            className={`public-block ${block.type}`}
          >
            <small>
              {block.type === "cta" ? "ПРИСОЕДИНЯЙТЕСЬ" : "О ПРОЕКТЕ"}
            </small>
            <h2>{block.title}</h2>
            {block.text ? <p>{block.text}</p> : null}
            {block.buttonLabel ? (
              <a href={block.buttonUrl || "#articles"}>{block.buttonLabel} →</a>
            ) : null}
          </section>
        ))}

        {middleBanners.map((banner) => (
          <a
            key={banner.id}
            className="public-banner middle"
            href={banner.linkUrl || "#articles"}
          >
            {banner.media ? (
              <Image
                unoptimized
                fill
                sizes="1200px"
                src={mediaUrl(banner.media.id)}
                alt={banner.media.altText ?? ""}
              />
            ) : null}
            <span>{banner.title || "Подробнее"}</span>
            <b>→</b>
          </a>
        ))}

        <section className="public-articles" id="articles">
          <header>
            <div>
              <small>ПУБЛИКАЦИИ</small>
              <h2>Последние материалы</h2>
            </div>
            <span>{data.articles.length} материалов</span>
          </header>
          {data.articles.length ? (
            <div>
              {data.articles.map((article) => (
                <article key={article.id}>
                  {article.previewMedia || article.coverMedia ? (
                    <Link
                      className="public-article-cover"
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      <Image
                        unoptimized
                        fill
                        sizes="(max-width: 760px) 100vw, 33vw"
                        src={mediaUrl(
                          (article.previewMedia ?? article.coverMedia)!.id,
                        )}
                        alt={
                          (article.previewMedia ?? article.coverMedia)!
                            .altText ?? article.title
                        }
                      />
                    </Link>
                  ) : (
                    <Link
                      className="public-article-cover empty"
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      W
                    </Link>
                  )}
                  <small>{article.category?.name ?? "Материал"}</small>
                  <h3>
                    <Link
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      {article.title}
                    </Link>
                  </h3>
                  <p>{article.excerpt || article.body.slice(0, 180)}</p>
                  <footer>
                    <span>{article.author?.fullName ?? data.site.name}</span>
                    <Link
                      href={`/preview/${siteSlug}/articles/${article.slug}`}
                    >
                      Читать →
                    </Link>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <div className="public-empty">
              <span>▤</span>
              <h3>Опубликованных материалов пока нет</h3>
              <p>
                После публикации статьи в CMS она автоматически появится здесь.
              </p>
            </div>
          )}
        </section>

        <PublicContactForm siteSlug={siteSlug} siteName={data.site.name} />
      </main>
      <PublicSiteFooter
        siteName={data.site.name}
        globals={data.site.globalData}
        layout={data.site.layoutSettings}
      />
    </div>
  );
}
