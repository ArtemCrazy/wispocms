import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
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
import {
  NotFoundTemplate,
  type NotFoundTemplateData,
} from "../../../../not-found-template";
import {
  SkinovaSystemPage,
  type SkinovaBanner,
  type SkinovaCategory,
} from "../../../../skinova-site";
import { SKINOVA_HEADER_TEMPLATE_KEY } from "../../../../skinova-template";

type PageBlock = {
  id: string;
  type: "hero" | "text" | "cta";
  title?: string;
  text?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  mediaId?: string;
};
type PublicPageData = {
  redirectTo?: string;
  redirectStatus?: 301 | 302;
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
  page: {
    id: string;
    title: string;
    slug: string;
    blocks: PageBlock[];
    seoTitle: string | null;
    seoDescription: string | null;
    canonicalUrl: string | null;
    noIndex: boolean;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImageMediaId: string | null;
    structuredData: Record<string, unknown> | null;
  };
  pages: Array<{ id: string; title: string; slug: string }>;
  banners: SkinovaBanner[];
  categories: SkinovaCategory[];
  privacyDisplay: {
    key: "system-policy" | "compact-policy";
    version: string;
    config: { showSectionNumbers?: boolean; accentTone?: "violet" | "neutral" };
  } | null;
  notFoundDisplay: NotFoundTemplateData | null;
};

function safeHref(value?: string) {
  if (!value) return "#";
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value) ? value : "#";
}

function PrivacyDocument({
  text,
  display,
}: {
  text: string;
  display: NonNullable<PublicPageData["privacyDisplay"]>;
}) {
  const lines = text.split(/\n+/).map((line) => line.trim());
  return (
    <article
      className={`public-privacy-document ${display.key === "compact-policy" ? "compact" : "standard"} ${display.config.accentTone === "neutral" ? "neutral" : "violet"}`}
    >
      {lines.map((value, index) => {
        if (!value) return null;
        if (value.startsWith("## ")) {
          const sectionNumber = lines
            .slice(0, index + 1)
            .filter((line) => line.startsWith("## ")).length;
          return (
            <h2 key={`${index}-${value}`}>
              {display.config.showSectionNumbers ? `${sectionNumber}. ` : ""}
              {value.slice(3)}
            </h2>
          );
        }
        if (value.startsWith("# "))
          return <h1 key={`${index}-${value}`}>{value.slice(2)}</h1>;
        if (value.startsWith("> "))
          return <aside key={`${index}-${value}`}>{value.slice(2)}</aside>;
        return <p key={`${index}-${value}`}>{value}</p>;
      })}
    </article>
  );
}

type PublicInnerPageProps = {
  params: Promise<{ siteSlug: string; pageSlug: string }>;
  searchParams: Promise<{
    cmsSiteId?: string | string[];
    cmsPageId?: string | string[];
  }>;
};

async function loadPage(siteSlug: string, pageSlug: string) {
  return loadPublicData<PublicPageData>(
    `/api/public/sites/${encodeURIComponent(siteSlug)}/pages/${encodeURIComponent(pageSlug)}`,
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicInnerPageProps): Promise<Metadata> {
  const query = await searchParams;
  if (queryValue(query.cmsSiteId) && queryValue(query.cmsPageId))
    return {
      title: "Предпросмотр страницы",
      robots: { index: false, follow: false },
    };

  const { siteSlug, pageSlug } = await params;
  const result = await loadPage(siteSlug, pageSlug);
  if (!result.ok)
    return { title: "Страница не найдена", robots: { index: false } };

  const { site, page } = result.data;
  const title =
    page.seoTitle || `${page.title} — ${site.seoTitle || site.name}`;
  const description =
    page.seoDescription || page.blocks.find((block) => block.text)?.text || "";
  const canonical =
    page.canonicalUrl ||
    (site.canonicalUrl ? `${site.canonicalUrl}/pages/${page.slug}` : undefined);
  const noIndex = page.noIndex || site.noIndex;
  const imageId = page.ogImageMediaId || site.seoImageMediaId;
  const image = imageId
    ? absolutePublicUrl(
        `/api/public/sites/${encodeURIComponent(site.slug)}/media/${imageId}`,
      )
    : undefined;

  return {
    title,
    description: description || undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: !noIndex, follow: !noIndex },
    openGraph: {
      title: page.ogTitle || title,
      description: page.ogDescription || description || undefined,
      url: canonical,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PublicInnerPage({
  params,
  searchParams,
}: PublicInnerPageProps) {
  const { siteSlug, pageSlug } = await params;
  const query = await searchParams;
  const siteId = queryValue(query.cmsSiteId);
  const pageId = queryValue(query.cmsPageId);
  const cmsPreview = siteId && pageId ? { siteId, pageId } : null;
  const result = cmsPreview
    ? await loadPublicData<PublicPageData>(
        `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/pages/${encodeURIComponent(cmsPreview.pageId)}/preview`,
        (await cookies()).toString(),
      )
    : await loadPage(siteSlug, pageSlug);

  if (!result.ok) {
    if (result.status === 404) notFound();
    const message = "Не удалось загрузить страницу";
    return (
      <main className="public-state">
        <span>W</span>
        <h1>{message}</h1>
        <Link href={`/preview/${siteSlug}`}>Вернуться на сайт</Link>
      </main>
    );
  }

  if (result.data.redirectTo) {
    const target = `/preview/${encodeURIComponent(siteSlug)}${result.data.redirectTo}`;
    if (result.data.redirectStatus === 302) redirect(target);
    permanentRedirect(target);
  }

  const data = result.data;
  const { page, pages, site } = data;
  if (
    site.layoutSettings.headerTemplateKey === SKINOVA_HEADER_TEMPLATE_KEY &&
    (page.slug === "404" || page.slug === "privacy-policy")
  ) {
    const firstBlock = page.blocks[0];
    return (
      <>
        {cmsPreview ? (
          <div className="cms-preview-bar">
            <strong>Предпросмотр CMS</strong>
            <span>Системная страница Skinova</span>
            <Link href="/">Вернуться в CMS</Link>
          </div>
        ) : null}
        <SkinovaSystemPage
          siteSlug={siteSlug}
          title={firstBlock?.title || page.title}
          text={
            firstBlock?.text ||
            "Проверьте адрес или вернитесь на главную страницу."
          }
          kind={page.slug === "404" ? "not-found" : "privacy"}
          categories={data.categories}
          banners={data.banners}
          globals={site.globalData}
          layout={site.layoutSettings}
        />
      </>
    );
  }
  if (page.slug === "404" && data.notFoundDisplay) {
    return (
      <div className="not-found-preview-wrap">
        {cmsPreview ? (
          <div className="cms-preview-bar">
            <strong>Предпросмотр CMS</strong>
            <span>Выбранный шаблон до активации</span>
            <Link href="/">Вернуться в CMS</Link>
          </div>
        ) : null}
        <NotFoundTemplate
          template={data.notFoundDisplay}
          siteName={site.name}
          homeHref={`/preview/${siteSlug}`}
          preview={Boolean(cmsPreview)}
        />
      </div>
    );
  }
  const mediaUrl = (mediaId: string) =>
    cmsPreview
      ? `/api/sites/${encodeURIComponent(cmsPreview.siteId)}/content/media/${mediaId}/file`
      : `/api/public/sites/${encodeURIComponent(siteSlug)}/media/${mediaId}`;

  return (
    <div
      className={`public-site public-page-detail ${page.slug === "privacy-policy" ? `privacy-template-${data.privacyDisplay?.key ?? "system-policy"}` : ""}`}
    >
      {page.structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(page.structuredData).replace(
              /</g,
              "\\u003c",
            ),
          }}
        />
      ) : null}
      {cmsPreview ? (
        <div className="cms-preview-bar">
          <strong>Предпросмотр CMS</strong>
          <span>Страница ещё не опубликована для посетителей</span>
          <Link href="/">Вернуться в CMS</Link>
        </div>
      ) : null}
      <PublicSiteHeader
        siteName={site.name}
        siteSlug={siteSlug}
        pages={pages}
        layout={site.layoutSettings}
        activePageId={page.id}
      />
      <main>
        <header className="public-page-title">
          <div>
            <Link href={`/preview/${siteSlug}`}>← На главную</Link>
            <small>СТРАНИЦА</small>
            <h1>{page.title}</h1>
          </div>
        </header>
        <div className="public-page-blocks">
          {page.slug === "privacy-policy" &&
          page.blocks[0]?.text &&
          data.privacyDisplay ? (
            <PrivacyDocument
              text={page.blocks[0].text}
              display={data.privacyDisplay}
            />
          ) : page.blocks.length ? (
            page.blocks.map((block) => (
              <section
                key={block.id}
                className={`public-page-block ${block.type}`}
              >
                {block.mediaId ? (
                  <Image
                    unoptimized
                    fill
                    priority={block.type === "hero"}
                    sizes="100vw"
                    src={mediaUrl(block.mediaId)}
                    alt=""
                  />
                ) : null}
                <div>
                  <small>
                    {block.type === "hero"
                      ? "WISPO MEDIA"
                      : block.type === "cta"
                        ? "СЛЕДУЮЩИЙ ШАГ"
                        : "О ПРОЕКТЕ"}
                  </small>
                  {block.title ? <h2>{block.title}</h2> : null}
                  {block.text ? <p>{block.text}</p> : null}
                  {block.buttonLabel ? (
                    <a href={safeHref(block.buttonUrl)}>
                      {block.buttonLabel} →
                    </a>
                  ) : null}
                </div>
              </section>
            ))
          ) : (
            <section className="public-page-empty">
              <span>◇</span>
              <h2>Содержимое страницы пока не добавлено</h2>
            </section>
          )}
        </div>
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
