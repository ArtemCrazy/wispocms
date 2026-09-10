"use client";

/* eslint-disable @next/next/no-img-element, @next/next/no-page-custom-font, @next/next/no-css-tags */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

const ASSET_ROOT = "/skinova/assets";

export type SkinovaCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  icon?: string | null;
};

export type SkinovaArticle = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  bodyDocument?: {
    version: 1;
    blocks: Array<
      | { id: string; type: "heading"; text: string; level: 2 | 3 | 4 }
      | { id: string; type: "paragraph"; text: string; href?: string | null }
      | { id: string; type: "bullet_list"; items: string[] }
      | { id: string; type: "numbered_list"; items: string[] }
      | { id: string; type: "quote"; text: string; cite?: string }
      | {
          id: string;
          type: "image";
          mediaId: string;
          alt?: string;
          caption?: string;
        }
    >;
  } | null;
  publishedAt: string | null;
  category?: { id?: string; name: string; slug?: string } | null;
  author?: { fullName: string } | null;
  coverMedia?: { id: string; altText: string | null } | null;
  previewMedia?: { id: string; altText: string | null } | null;
  displayTemplateKey?: string;
  displayTemplateConfig?: {
    imageAsset?: string;
    readMinutes?: number;
    views?: string;
    tags?: string[];
    dateLabel?: string;
  };
};

export type SkinovaBanner = {
  id: string;
  placement: string | null;
  title: string | null;
  subtitle: string | null;
  buttonText: string | null;
  linkUrl: string | null;
  media?: { id: string; altText: string | null } | null;
};

type SkinovaGlobals = {
  telegramUrl?: string;
  vkUrl?: string;
};

type SkinovaLayout = {
  footerDescription?: string;
};

function icon(id: string, className = "icon") {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`${ASSET_ROOT}/icons/sprite.svg#icon-${id}`} />
    </svg>
  );
}

const categoryIcons: Record<string, string> = {
  kozha: "droplet",
  ukhod: "bottle",
  kosmetologiya: "dropper",
  "esteticheskaya-meditsina": "lotus",
  "preparaty-i-ingredienty": "flask",
  "mify-i-razbory": "myth-analysis",
};

function articleImage(
  article: SkinovaArticle,
  index = 0,
  mediaBaseUrl?: string,
  mediaFileSuffix = "",
) {
  const media = article.previewMedia || article.coverMedia;
  if (media && mediaBaseUrl)
    return `${mediaBaseUrl}/${media.id}${mediaFileSuffix}`;
  const configured = article.displayTemplateConfig?.imageAsset;
  if (configured) return `${ASSET_ROOT}/images/${configured}`;
  const fallbacks = [
    "article-skincare.webp",
    "article-pigmentation.webp",
    "article-retinoids.webp",
    "article-laser.webp",
  ];
  return `${ASSET_ROOT}/images/${fallbacks[index % fallbacks.length]}`;
}

function formatDate(value: string | null, fallback?: string) {
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    if (!fallback) return "Материал Skinova";
    const fallbackDate = new Date(fallback);
    if (Number.isNaN(fallbackDate.getTime())) return "Материал Skinova";
    return new Intl.DateTimeFormat("ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(fallbackDate);
  }
  return new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function SkinovaConsultationForm({ siteSlug }: { siteSlug: string }) {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState("sending");
    setMessage("");
    try {
      const response = await fetch(
        `/api/public/sites/${encodeURIComponent(siteSlug)}/contact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            phone: data.get("phone"),
            website: data.get("website") || undefined,
            consent: data.get("consent") === "on",
            message: "Запись на консультацию косметолога",
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : payload?.message || "Не удалось отправить заявку",
        );
      form.reset();
      setState("success");
      setMessage("Спасибо! Мы свяжемся с вами в ближайшее время.");
    } catch (reason) {
      setState("error");
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить заявку",
      );
    }
  }

  return (
    <form className="consultation-form" onSubmit={submit}>
      <label className="consultation-form__field" htmlFor="consultation-name">
        <span>Ваше имя</span>
        <input
          id="consultation-name"
          name="name"
          autoComplete="name"
          placeholder="Как к вам обращаться"
          required
          minLength={2}
          maxLength={120}
        />
      </label>
      <label className="consultation-form__field" htmlFor="consultation-phone">
        <span>Телефон</span>
        <input
          id="consultation-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+7 999 000-00-00"
          required
          pattern="\+?[0-9 ()-]{7,30}"
          maxLength={30}
        />
      </label>
      <label className="skinova-honeypot" aria-hidden="true">
        <span>Сайт</span>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label className="consultation-form__consent">
        <input type="checkbox" name="consent" required />
        <span>Согласен с обработкой персональных данных</span>
      </label>
      <button
        className="button consultation-form__submit"
        type="submit"
        disabled={state === "sending"}
      >
        {state === "sending" ? "Отправляем…" : "Отправить заявку"}
      </button>
      {message ? (
        <p
          className={`skinova-form-status ${state}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

function SkinovaChrome({
  siteSlug,
  categories,
  globals,
  layout,
  promo,
  children,
}: {
  siteSlug: string;
  categories: SkinovaCategory[];
  globals?: SkinovaGlobals;
  layout?: SkinovaLayout;
  promo?: SkinovaBanner | null;
  children: (openConsultation: () => void) => ReactNode;
}) {
  const roots = categories.filter((item) => !item.parentId);
  const [openCategory, setOpenCategory] = useState(roots[0]?.id ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [promoVisible, setPromoVisible] = useState(true);
  const [consultationOpen, setConsultationOpen] = useState(false);
  const openConsultation = () => setConsultationOpen(true);
  const promoTitle = promo?.title || "Бесплатная консультация косметолога";
  const promoSubtitle =
    promo?.subtitle || "Фотодинамическая терапия Heleo4 за 0 ₽";

  return (
    <div className="skinova-site">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Onest:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/skinova/styles.css" />
      <a className="skip-link" href="#main-content">
        Перейти к материалам
      </a>
      {promoVisible ? (
        <div className="promo">
          <div className="promo__inner shell">
            <p className="promo__lead">
              {icon("gift")}
              <span>{promoTitle}</span>
            </p>
            <span className="promo__divider" aria-hidden="true" />
            <p className="promo__offer">{promoSubtitle}</p>
            <button
              className="button button--small"
              type="button"
              onClick={openConsultation}
            >
              {promo?.buttonText || "Записаться"}
            </button>
            <button
              className="icon-button promo__close"
              type="button"
              aria-label="Закрыть предложение"
              onClick={() => setPromoVisible(false)}
            >
              {icon("close")}
            </button>
          </div>
        </div>
      ) : null}
      <header className="masthead">
        <div className="masthead__inner shell">
          <Link
            className="brand"
            href={`/preview/${siteSlug}`}
            aria-label="Skinova — на главную"
          >
            <img
              src={`${ASSET_ROOT}/logo.svg`}
              width="196"
              height="64"
              alt="Skinova"
            />
          </Link>
          <span className="masthead__divider" aria-hidden="true" />
          <p className="masthead__descriptor">
            Разбираем проблемы кожи, косметические средства,
            <br />
            процедуры и эстетическую медицину.
          </p>
          <form
            className="search search--open"
            action={`/preview/${siteSlug}/search`}
            role="search"
          >
            <label className="visually-hidden" htmlFor="skinova-search">
              Поиск по статьям
            </label>
            <input
              className="search__input"
              id="skinova-search"
              name="q"
              type="search"
              placeholder="Поиск по статьям…"
              autoComplete="off"
            />
            <button
              className="search__toggle"
              type="submit"
              aria-label="Перейти к поиску"
            >
              {icon("search", "icon icon--large")}
            </button>
          </form>
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={menuOpen ? "Закрыть категории" : "Открыть категории"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {icon(menuOpen ? "close" : "menu")}
          </button>
        </div>
      </header>
      <div className="page-shell shell">
        <aside
          className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}
          aria-label="Категории статей"
        >
          <div className="sidebar__inner">
            <nav className="category-nav">
              {roots.map((root) => {
                const isOpen = openCategory === root.id;
                const children = categories.filter(
                  (item) => item.parentId === root.id,
                );
                return (
                  <section
                    className={`category ${isOpen ? "category--open" : ""}`}
                    key={root.id}
                  >
                    <button
                      className="category__toggle"
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenCategory(isOpen ? "" : root.id)}
                    >
                      <span className="category__name">
                        {icon(
                          root.icon || categoryIcons[root.slug] || "droplet",
                        )}
                        <span className="category__label">{root.name}</span>
                      </span>
                      {icon("chevron-down", "icon category__chevron")}
                    </button>
                    <div className="category__panel" aria-hidden={!isOpen}>
                      {children.length ? (
                        children.map((child) => (
                          <Link
                            className="subcategory"
                            key={child.id}
                            href={`/preview/${siteSlug}/categories/${child.slug}`}
                            onClick={() => setMenuOpen(false)}
                          >
                            {child.name}
                          </Link>
                        ))
                      ) : (
                        <Link
                          className="subcategory"
                          href={`/preview/${siteSlug}/categories/${root.slug}`}
                          onClick={() => setMenuOpen(false)}
                        >
                          Все материалы
                        </Link>
                      )}
                    </div>
                  </section>
                );
              })}
            </nav>
            <div className="socials" aria-label="Социальные сети">
              {globals?.telegramUrl ? (
                <a
                  className="socials__link"
                  href={globals.telegramUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Telegram"
                >
                  {icon("telegram")}
                </a>
              ) : null}
              {globals?.vkUrl ? (
                <a
                  className="socials__link"
                  href={globals.vkUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="ВКонтакте"
                >
                  {icon("vk")}
                </a>
              ) : null}
              <a
                className="socials__link"
                href="#articles"
                aria-label="Материалы"
              >
                {icon("youtube")}
              </a>
            </div>
          </div>
        </aside>
        {children(openConsultation)}
      </div>
      <footer className="footer">
        <div className="footer__inner shell">
          <Link
            className="footer__brand"
            href={`/preview/${siteSlug}`}
            aria-label="Skinova — на главную"
          >
            <img
              src={`${ASSET_ROOT}/logo.svg`}
              width="154"
              height="59"
              alt="Skinova"
            />
          </Link>
          <p>
            {layout?.footerDescription ||
              "Разбираем проблемы кожи, косметические средства, процедуры и эстетическую медицину."}
          </p>
          <Link
            className="footer__policy"
            href={`/preview/${siteSlug}/pages/privacy-policy`}
          >
            Политика конфиденциальности
          </Link>
          <span>Сайт разработан WISPO</span>
        </div>
      </footer>
      {menuOpen ? (
        <button
          className="sidebar-backdrop skinova-backdrop"
          aria-label="Закрыть категории"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      {consultationOpen ? (
        <div
          className="skinova-modal-backdrop"
          role="presentation"
          onMouseDown={() => setConsultationOpen(false)}
        >
          <div
            className="consultation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="consultation-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="mfp-close"
              type="button"
              aria-label="Закрыть"
              onClick={() => setConsultationOpen(false)}
            >
              ×
            </button>
            <p className="consultation-modal__eyebrow">
              Персональная консультация
            </p>
            <h2 id="consultation-modal-title">Записаться к косметологу</h2>
            <p className="consultation-modal__lead">
              Оставьте контакты — администратор свяжется с вами и подберёт
              удобное время.
            </p>
            <SkinovaConsultationForm siteSlug={siteSlug} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SkinovaCard({
  article,
  index,
  siteSlug,
  mediaBaseUrl,
  mediaFileSuffix,
}: {
  article: SkinovaArticle;
  index: number;
  siteSlug: string;
  mediaBaseUrl?: string;
  mediaFileSuffix?: string;
}) {
  return (
    <article className="article-card">
      <Link
        className="article-card__link"
        href={`/preview/${siteSlug}/articles/${article.slug}`}
      >
        <span className="article-card__media">
          <img
            src={articleImage(
              article,
              index,
              mediaBaseUrl,
              mediaFileSuffix,
            )}
            alt={article.title}
            width="900"
            height="600"
            loading="lazy"
          />
        </span>
        <div className="article-card__body">
          <div className="meta">
            <time>
              {formatDate(
                article.publishedAt,
                article.displayTemplateConfig?.dateLabel,
              )}
            </time>
            <span>•</span>
            <span>
              {article.displayTemplateConfig?.readMinutes || 6} мин чтения
            </span>
            <span>•</span>
            <span className="meta__views">
              {icon("eye", "icon icon--small")}
              {article.displayTemplateConfig?.views || "1 204"}
            </span>
          </div>
          <h2>{article.title}</h2>
        </div>
      </Link>
    </article>
  );
}

export function SkinovaHome({
  siteSlug,
  categories,
  articles,
  banners,
  globals,
  layout,
  homepage,
  mediaBaseUrl,
  mediaFileSuffix,
}: {
  siteSlug: string;
  categories: SkinovaCategory[];
  articles: SkinovaArticle[];
  banners: SkinovaBanner[];
  globals?: SkinovaGlobals;
  layout?: SkinovaLayout;
  homepage?: {
    blocks: Array<{
      type: string;
      title?: string;
      text?: string;
      buttonLabel?: string;
      buttonUrl?: string;
      mediaId?: string;
    }>;
  };
  mediaBaseUrl?: string;
  mediaFileSuffix?: string;
}) {
  const hero =
    articles.find((item) => item.slug === "biorevitalizatsiya") || articles[0];
  const cards = articles.filter((item) => item.id !== hero?.id);
  const promo =
    banners.find((item) => item.placement === "homepage_top") || null;
  const consultation =
    banners.find((item) => item.placement === "homepage_middle") || null;
  const homepageHero = homepage?.blocks.find((block) => block.type === "hero");
  const heroImage =
    homepageHero?.mediaId && mediaBaseUrl
      ? `${mediaBaseUrl}/${homepageHero.mediaId}${mediaFileSuffix || ""}`
      : `${ASSET_ROOT}/images/hero-bioprevitalization.webp`;
  const consultationImage =
    consultation?.media && mediaBaseUrl
      ? `${mediaBaseUrl}/${consultation.media.id}${mediaFileSuffix || ""}`
      : `${ASSET_ROOT}/images/consultation-banner.webp`;
  const [query, setQuery] = useState("");
  const visibleCards = useMemo(
    () =>
      cards.filter((item) =>
        `${item.title} ${item.excerpt || ""} ${item.category?.name || ""} ${(item.displayTemplateConfig?.tags || []).join(" ")}`
          .toLocaleLowerCase("ru")
          .includes(query.trim().toLocaleLowerCase("ru")),
      ),
    [cards, query],
  );
  return (
    <SkinovaChrome
      siteSlug={siteSlug}
      categories={categories}
      globals={globals}
      layout={layout}
      promo={promo}
    >
      {(openConsultation) => (
        <main className="content" id="main-content">
          {hero ? (
            <article className="hero-article">
              <img
                className="hero-article__media"
                src={heroImage}
                alt={homepageHero?.title || hero.title}
                width="1600"
                height="900"
              />
              <div className="hero-article__body">
                <div className="meta">
                  <time>
                    {formatDate(
                      hero.publishedAt,
                      hero.displayTemplateConfig?.dateLabel,
                    )}
                  </time>
                  <span>•</span>
                  <span>
                    {hero.displayTemplateConfig?.readMinutes || 7} мин чтения
                  </span>
                  <span>•</span>
                  <span className="meta__views">
                    {icon("eye", "icon icon--small")}
                    {hero.displayTemplateConfig?.views || "12 842"}
                  </span>
                </div>
                <h1>{homepageHero?.title || hero.title}</h1>
                <p>{homepageHero?.text || hero.excerpt}</p>
                <Link
                  className="button"
                  href={
                    homepageHero?.buttonUrl
                      ? `/preview/${siteSlug}${homepageHero.buttonUrl}`
                      : `/preview/${siteSlug}/articles/${hero.slug}`
                  }
                >
                  {homepageHero?.buttonLabel || "Читать статью"}
                </Link>
              </div>
            </article>
          ) : null}
          <section
            className="articles"
            id="articles"
            aria-label="Последние статьи"
          >
            <label className="skinova-inline-search">
              <span>Поиск по материалам</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название, рубрика или тема"
              />
            </label>
            <div className="article-grid">
              {visibleCards.slice(0, 3).map((article, index) => (
                <SkinovaCard
                  key={article.id}
                  article={article}
                  index={index}
                  siteSlug={siteSlug}
                  mediaBaseUrl={mediaBaseUrl}
                  mediaFileSuffix={mediaFileSuffix}
                />
              ))}
            </div>
            <aside
              className="consultation"
              aria-label="Консультация косметолога"
            >
              <img
                src={consultationImage}
                alt=""
                width="1800"
                height="480"
                loading="lazy"
              />
              <div className="consultation__content">
                <span className="consultation__icon">
                  {icon("calendar", "icon icon--large")}
                </span>
                <div>
                  <h2>{consultation?.title || "Консультация косметолога"}</h2>
                  <p>
                    {consultation?.subtitle ||
                      "Разберитесь, какие процедуры подходят именно вашей коже. Подберём индивидуальный план на консультации."}
                  </p>
                </div>
                <button
                  className="button consultation__button"
                  type="button"
                  onClick={openConsultation}
                >
                  {consultation?.buttonText || "Записаться на консультацию"}
                </button>
              </div>
            </aside>
            <div className="article-grid article-grid--more">
              {visibleCards.slice(3).map((article, index) => (
                <SkinovaCard
                  key={article.id}
                  article={article}
                  index={index + 3}
                  siteSlug={siteSlug}
                  mediaBaseUrl={mediaBaseUrl}
                  mediaFileSuffix={mediaFileSuffix}
                />
              ))}
            </div>
            {!visibleCards.length ? (
              <p className="empty-state">
                По вашему запросу ничего не найдено.
              </p>
            ) : null}
          </section>
        </main>
      )}
    </SkinovaChrome>
  );
}

function renderArticleBlocks(article: SkinovaArticle) {
  const blocks = article.bodyDocument?.blocks || [];
  if (!blocks.length)
    return article.body
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((text, index) => <p key={index}>{text}</p>);
  return blocks.map((block) => {
    if (block.type === "heading") {
      const Heading = `h${block.level}` as "h2" | "h3" | "h4";
      return (
        <Heading key={block.id} id={block.id}>
          {block.text}
        </Heading>
      );
    }
    if (block.type === "paragraph")
      return (
        <p key={block.id}>
          {block.href ? <a href={block.href}>{block.text}</a> : block.text}
        </p>
      );
    if (block.type === "bullet_list")
      return (
        <ul key={block.id}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    if (block.type === "numbered_list")
      return (
        <ol key={block.id}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    if (block.type === "quote")
      return (
        <blockquote key={block.id}>
          <p>{block.text}</p>
          {block.cite ? <cite>{block.cite}</cite> : null}
        </blockquote>
      );
    return null;
  });
}

export function SkinovaArticlePage({
  siteSlug,
  article,
  related,
  categories,
  globals,
  layout,
  banner,
  mediaBaseUrl,
  mediaFileSuffix,
}: {
  siteSlug: string;
  article: SkinovaArticle;
  related: SkinovaArticle[];
  categories: SkinovaCategory[];
  globals?: SkinovaGlobals;
  layout?: SkinovaLayout;
  banner?: SkinovaBanner | null;
  mediaBaseUrl?: string;
  mediaFileSuffix?: string;
}) {
  return (
    <SkinovaChrome
      siteSlug={siteSlug}
      categories={categories}
      globals={globals}
      layout={layout}
    >
      {(openConsultation) => (
        <main className="content article-page" id="main-content">
          <div className="article-layout">
            <article className="article-column">
              <header className="article-header">
                <h1>{article.title}</h1>
                <div className="article-header__meta">
                  <div className="article-author">
                    <img
                      src={`${ASSET_ROOT}/images/expert-maria.webp`}
                      alt={article.author?.fullName || "Эксперт Skinova"}
                      width="96"
                      height="96"
                    />
                    <span>
                      <strong>
                        {article.author?.fullName || "Мария Васильевна"}
                      </strong>
                      <small>Врач-косметолог</small>
                    </span>
                  </div>
                  <div className="meta">
                    <time>
                      {formatDate(
                        article.publishedAt,
                        article.displayTemplateConfig?.dateLabel,
                      )}
                    </time>
                    <span>•</span>
                    <span>
                      {article.displayTemplateConfig?.readMinutes || 7} мин
                      чтения
                    </span>
                  </div>
                </div>
              </header>
              <figure className="article-cover">
                <img
                  src={
                    article.slug === "biorevitalizatsiya"
                      ? `${ASSET_ROOT}/images/article-biorevitalization-cover.webp`
                      : articleImage(
                          article,
                          0,
                          mediaBaseUrl,
                          mediaFileSuffix,
                        )
                  }
                  alt={article.title}
                  width="1536"
                  height="1024"
                />
              </figure>
              <div className="article-body">{renderArticleBlocks(article)}</div>
            </article>
            <aside className="article-rail" aria-label="Навигация по статье">
              <nav className="article-toc">
                <h2>Содержание статьи</h2>
                {article.bodyDocument?.blocks
                  .filter((block) => block.type === "heading")
                  .map((block) => (
                    <a key={block.id} href={`#${block.id}`}>
                      {"text" in block ? block.text : "Раздел"}
                    </a>
                  ))}
              </nav>
              <aside className="article-ad">
                <img
                  src={
                    banner?.media && mediaBaseUrl
                      ? `${mediaBaseUrl}/${banner.media.id}${mediaFileSuffix || ""}`
                      : `${ASSET_ROOT}/images/article-vials-cta.webp`
                  }
                  alt=""
                  width="840"
                  height="1050"
                />
                <div>
                  <h2>
                    {banner?.title ||
                      "Подберём препарат и схему процедуры после консультации специалиста"}
                  </h2>
                  <button
                    className="button button--small"
                    type="button"
                    onClick={openConsultation}
                  >
                    {banner?.buttonText || "Записаться на консультацию"}
                  </button>
                </div>
                <p>
                  <span>
                    {banner?.subtitle ||
                      "Есть противопоказания. Необходима консультация специалиста."}
                  </span>
                </p>
              </aside>
            </aside>
          </div>
          {related.length ? (
            <section className="reader-opinions">
              <h2>Ещё по теме</h2>
              <div className="article-grid">
                {related.slice(0, 3).map((item, index) => (
                  <SkinovaCard
                    key={item.id}
                    article={item}
                    index={index}
                    siteSlug={siteSlug}
                    mediaBaseUrl={mediaBaseUrl}
                    mediaFileSuffix={mediaFileSuffix}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </main>
      )}
    </SkinovaChrome>
  );
}

export function SkinovaCategoryPage({
  siteSlug,
  category,
  articles,
  subcategories,
  globals,
  layout,
  mediaBaseUrl,
  mediaFileSuffix,
}: {
  siteSlug: string;
  category: SkinovaCategory & { description?: string | null };
  articles: SkinovaArticle[];
  subcategories: SkinovaCategory[];
  globals?: SkinovaGlobals;
  layout?: SkinovaLayout;
  mediaBaseUrl?: string;
  mediaFileSuffix?: string;
}) {
  const categories = category.parentId
    ? [category, ...subcategories]
    : [
        category,
        ...subcategories.map((item) => ({ ...item, parentId: category.id })),
      ];
  return (
    <SkinovaChrome
      siteSlug={siteSlug}
      categories={categories}
      globals={globals}
      layout={layout}
    >
      {() => (
        <main className="content" id="main-content">
          <header className="skinova-category-head">
            <Link href={`/preview/${siteSlug}`}>← Все материалы</Link>
            <span>Рубрика</span>
            <h1>{category.name}</h1>
            {category.description ? <p>{category.description}</p> : null}
          </header>
          {subcategories.length ? (
            <nav className="skinova-category-links">
              {subcategories.map((item) => (
                <Link
                  key={item.id}
                  href={`/preview/${siteSlug}/categories/${item.slug}`}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          ) : null}
          <section className="articles">
            <div className="article-grid article-grid--more">
              {articles.map((article, index) => (
                <SkinovaCard
                  key={article.id}
                  article={article}
                  index={index}
                  siteSlug={siteSlug}
                  mediaBaseUrl={mediaBaseUrl}
                  mediaFileSuffix={mediaFileSuffix}
                />
              ))}
            </div>
            {!articles.length ? (
              <p className="empty-state">
                В этой рубрике пока нет опубликованных материалов.
              </p>
            ) : null}
          </section>
        </main>
      )}
    </SkinovaChrome>
  );
}

export function SkinovaSystemPage({
  siteSlug,
  title,
  text,
  kind,
  categories,
  banners,
  globals,
  layout,
}: {
  siteSlug: string;
  title: string;
  text: string;
  kind: "privacy" | "not-found";
  categories: SkinovaCategory[];
  banners: SkinovaBanner[];
  globals?: SkinovaGlobals;
  layout?: SkinovaLayout;
}) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const body: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    body.push(
      <ul key={`list-${body.length}`}>
        {list.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, index) => {
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith("## "))
      body.push(<h2 key={`${index}-${line}`}>{line.slice(3)}</h2>);
    else if (line.startsWith("# ")) return;
    else if (line.startsWith("> "))
      body.push(<aside key={`${index}-${line}`}>{line.slice(2)}</aside>);
    else body.push(<p key={`${index}-${line}`}>{line}</p>);
  });
  flushList();
  const promo =
    banners.find((item) => item.placement === "homepage_top") ?? null;
  return (
    <SkinovaChrome
      siteSlug={siteSlug}
      categories={categories}
      globals={globals}
      layout={layout}
      promo={promo}
    >
      {() => (
        <main className={`skinova-system-content ${kind}`} id="main-content">
          <span>
            {kind === "not-found"
              ? "Ошибка навигации"
              : "Правовая информация"}
          </span>
          {kind === "not-found" ? <strong>404</strong> : null}
          <h1>{title}</h1>
          {body}
          <Link className="button" href={`/preview/${siteSlug}`}>
            Вернуться на главную
          </Link>
        </main>
      )}
    </SkinovaChrome>
  );
}
