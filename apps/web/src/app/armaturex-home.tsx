"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useState } from "react";
import type { PublicSiteGlobals, PublicSiteLayout } from "./public-site-footer";
import type { ArmaturexHomepageContent } from "./homepage-templates";
import styles from "./armaturex-home.module.css";

const ASSET_BASE = "/templates/armaturex-home-v1";
const c = (...names: string[]) =>
  names
    .flatMap((name) => name.split(" "))
    .map((name) => styles[name])
    .filter(Boolean)
    .join(" ");

type ArmaturexHomeProps = {
  siteName: string;
  siteSlug: string;
  content: ArmaturexHomepageContent;
  globals?: PublicSiteGlobals;
  layout?: PublicSiteLayout & { logoMediaId?: string };
  cmsSiteId?: string;
};

function safeHref(value: string) {
  const href = value.trim();
  if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) {
    return href;
  }
  try {
    const url = new URL(href);
    return ["https:", "http:", "tel:", "mailto:"].includes(url.protocol)
      ? href
      : "#request";
  } catch {
    return "#request";
  }
}

function phoneHref(phone?: string) {
  return phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : "#request";
}

export function ArmaturexHome({
  siteName,
  siteSlug,
  content,
  globals = {},
  layout = {},
  cmsSiteId,
}: ArmaturexHomeProps) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [viewerEnabled, setViewerEnabled] = useState(false);
  const [formState, setFormState] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [formMessage, setFormMessage] = useState("");
  const phone = globals.phone || "+7 351 200-21-11";
  const email = globals.email || "armcompany@mail.ru";
  const companyName =
    globals.companyName || globals.legalName || "Первая арматурная компания";
  const mediaUrl = (id: string) =>
    cmsSiteId
      ? `/api/sites/${encodeURIComponent(cmsSiteId)}/content/media/${encodeURIComponent(id)}/file`
      : `/api/public/sites/${encodeURIComponent(siteSlug)}/media/${encodeURIComponent(id)}`;
  const imageUrl = (mediaId: string | undefined, asset: string) =>
    mediaId ? mediaUrl(mediaId) : `${ASSET_BASE}/img/${asset}`;
  const logoUrl = layout.logoMediaId
    ? mediaUrl(layout.logoMediaId)
    : `${ASSET_BASE}/img/logo.webp`;

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 68.01rem)");
    const sync = () => setViewerEnabled(desktop.matches);
    sync();
    desktop.addEventListener("change", sync);
    return () => desktop.removeEventListener("change", sync);
  }, []);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const contact = String(data.get("contact") ?? "").trim();
    const isEmail = contact.includes("@");
    if (!contact) {
      setFormState("error");
      setFormMessage("Укажите телефон или электронную почту");
      return;
    }
    setFormState("sending");
    setFormMessage("");
    try {
      const response = await fetch(
        `/api/public/sites/${encodeURIComponent(siteSlug)}/contact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            email: isEmail ? contact : undefined,
            phone: isEmail ? undefined : contact,
            message: data.get("message") || undefined,
            website: data.get("website") || undefined,
            consent: data.get("consent") === "on",
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : (payload?.message ?? "Не удалось отправить заявку"),
        );
      form.reset();
      setFormState("success");
      setFormMessage("Спасибо! Заявка отправлена, мы свяжемся с вами.");
    } catch (reason) {
      setFormState("error");
      setFormMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить заявку",
      );
    }
  }

  return (
    <div
      className={c(
        "armaturex-home-v1",
        cmsSiteId ? "armaturex-home-v1--preview" : "",
      )}
    >
      <header className={c("header")}>
        <div className={c("header__bar")}>
          <a
            className={c("logo")}
            href="#top"
            aria-label={layout.logoText || siteName}
          >
            <img
              className={c("logo__img")}
              src={logoUrl}
              width="380"
              height="160"
              alt={layout.logoText || companyName}
            />
          </a>
          <div className={c("finder")}>
            <button
              className={c("finder__catalog")}
              type="button"
              aria-expanded={catalogOpen}
              aria-controls="armaturex-catalog-menu"
              onClick={() => setCatalogOpen((value) => !value)}
            >
              <span className={c("finder__bars")} />
              Каталог
            </button>
            <form
              className={c("finder__form")}
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                document
                  .getElementById("catalog")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <input
                className={c("finder__field")}
                name="q"
                type="search"
                placeholder="Марка, диаметр или тип"
                aria-label="Поиск по каталогу"
                autoComplete="off"
              />
              <button className={c("finder__submit")} type="submit">
                Найти
              </button>
            </form>
          </div>
          <div className={c("finder__contacts")}>
            <a className={c("finder__phone")} href={phoneHref(phone)}>
              {phone}
            </a>
            <a className={c("finder__mail")} href={`mailto:${email}`}>
              {email}
            </a>
          </div>
          <div className={c("header__quick")}>
            <a
              className={c("header__quick-btn")}
              href={phoneHref(phone)}
              aria-label="Позвонить"
            >
              ☎
            </a>
            <a
              className={c("header__quick-btn")}
              href={`mailto:${email}`}
              aria-label="Написать на почту"
            >
              ✉
            </a>
            <button
              className={c("burger", mobileOpen ? "burger--open" : "")}
              type="button"
              aria-expanded={mobileOpen}
              aria-controls="armaturex-mobile-nav"
              aria-label="Меню"
              onClick={() => setMobileOpen((value) => !value)}
            >
              <span className={c("burger__line")} />
              <span className={c("burger__line")} />
            </button>
          </div>
        </div>
        <div className={c("header__strip")}>
          <div className={c("header__strip-inner")}>
            <nav className={c("header__nav")} aria-label="Основная навигация">
              {content.catalog.slice(0, 10).map((item) => (
                <a
                  className={c("header__link")}
                  href={safeHref(item.href)}
                  key={item.name}
                >
                  {item.name}
                </a>
              ))}
              <a
                className={c("header__link header__link--aside")}
                href="#request"
              >
                Контакты
              </a>
            </nav>
          </div>
        </div>
        <div
          className={c("drop")}
          id="armaturex-catalog-menu"
          hidden={!catalogOpen}
        >
          <div className={c("drop__inner")}>
            {content.catalog.map((item) => (
              <a
                className={c("drop__item")}
                href={safeHref(item.href)}
                key={item.name}
                onClick={() => setCatalogOpen(false)}
              >
                <img
                  className={c("drop__icon")}
                  src={imageUrl(
                    item.imageMediaId,
                    `dark/${item.asset.replace(/-blueprint-v1\.png$/, "").replace("privod", "privod")}.webp`,
                  )}
                  width="160"
                  height="160"
                  alt=""
                />
                <span className={c("drop__name")}>{item.name}</span>
                <span className={c("drop__count")}>{item.count}</span>
              </a>
            ))}
          </div>
        </div>
        <nav
          className={c("mobile")}
          id="armaturex-mobile-nav"
          hidden={!mobileOpen}
          aria-label="Мобильная навигация"
        >
          <a
            className={c("mobile__link mobile__link--strong")}
            href="#catalog"
            onClick={() => setMobileOpen(false)}
          >
            Каталог
          </a>
          <div className={c("mobile__cats")}>
            {content.catalog.map((item) => (
              <a
                className={c("mobile__cat")}
                href={safeHref(item.href)}
                key={item.name}
                onClick={() => setMobileOpen(false)}
              >
                {item.name}
                <span className={c("mobile__cat-count")}>{item.count}</span>
              </a>
            ))}
          </div>
          <a className={c("mobile__phone")} href={phoneHref(phone)}>
            {phone}
          </a>
          <a className={c("mobile__mail")} href={`mailto:${email}`}>
            {email}
          </a>
        </nav>
      </header>

      <main id="top">
        <section className={c("hero")}>
          <div className={c("hero__inner")}>
            <div className={c("hero__content")}>
              <p className={c("hero__eyebrow")}>{content.eyebrow}</p>
              <h1 className={c("hero__title")}>{content.title}</h1>
              <p className={c("hero__lead")}>{content.lead}</p>
              <div className={c("hero__actions")}>
                <a
                  className={c("button button--primary")}
                  href={safeHref(content.primaryCta.href)}
                >
                  {content.primaryCta.label}
                </a>
                <a
                  className={c("button")}
                  href={safeHref(content.secondaryCta.href)}
                >
                  {content.secondaryCta.label}
                </a>
              </div>
            </div>
            <div className={c("viewer")}>
              <div className={c("viewer__stage")}>
                {viewerEnabled ? (
                  <iframe
                    className={c("viewer__frame")}
                    src={`${ASSET_BASE}/model/viewer-frame.html`}
                    title="Интерактивная 3D-модель задвижки"
                    loading="eager"
                  />
                ) : null}
                {!viewerEnabled ? (
                  <p className={c("viewer__hint")}>3D-модель</p>
                ) : null}
              </div>
            </div>
          </div>
          <ul className={c("facts")}>
            {content.stats.map((item) => (
              <li
                className={c("facts__item")}
                key={`${item.value}-${item.label}`}
              >
                <b className={c("facts__value")}>{item.value}</b>
                <span className={c("facts__label")}>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={c("catalog")} id="catalog">
          <div className={c("catalog__inner")}>
            <div className={c("section-head")}>
              <h2 className={c("section-head__title")}>
                {content.catalogTitle}
              </h2>
              <p className={c("section-head__note")}>{content.catalogNote}</p>
            </div>
            <ul className={c("catalog__list")}>
              {content.catalog.map((item) => (
                <li key={item.name}>
                  <article className={c("tile tile--photo")}>
                    <img
                      className={c("tile__photo")}
                      src={imageUrl(item.imageMediaId, item.asset)}
                      width="320"
                      height="320"
                      alt=""
                      loading="lazy"
                    />
                    <a className={c("tile__name")} href={safeHref(item.href)}>
                      {item.name}
                    </a>
                    <span className={c("tile__count")}>{item.count}</span>
                    {item.subitems.length ? (
                      <div className={c("tile__subs")}>
                        {item.subitems.map((subitem) => (
                          <a
                            className={c("tile__sub")}
                            href={safeHref(subitem.href)}
                            key={subitem.label}
                          >
                            {subitem.label}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className={c("tile__meta")}>
                        {item.meta || "Подбор по параметрам и ГОСТ"}
                      </span>
                    )}
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={c("terms")} id="terms">
          <div className={c("terms__inner")}>
            <div className={c("section-head section-head--plain")}>
              <h2 className={c("section-head__title")}>{content.termsTitle}</h2>
            </div>
            <div className={c("terms__cards")}>
              {content.terms.map((item) => (
                <a
                  className={c("terms__card")}
                  href={safeHref(item.href)}
                  key={item.number}
                >
                  <span className={c("terms__card-number")}>{item.number}</span>
                  <span className={c("terms__card-photo")} aria-hidden="true">
                    <img
                      src={imageUrl(item.imageMediaId, item.asset)}
                      width="1254"
                      height="1254"
                      alt=""
                      loading="lazy"
                    />
                  </span>
                  <h3 className={c("terms__card-title")}>{item.title}</h3>
                  <p className={c("terms__card-text")}>{item.text}</p>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className={c("faq")} id="faq">
          <div className={c("faq__inner")}>
            <div className={c("section-head section-head--plain")}>
              <h2 className={c("section-head__title")}>{content.faqTitle}</h2>
            </div>
            <div className={c("faq__list")}>
              {content.faq.map((item) => (
                <article className={c("faq__item")} key={item.question}>
                  <h3 className={c("faq__question")}>{item.question}</h3>
                  <p className={c("faq__answer")}>{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={c("request")} id="request">
          <div className={c("request__inner")}>
            <div>
              <h2 className={c("request__title")}>{content.requestTitle}</h2>
              <p className={c("request__lead")}>{content.requestLead}</p>
              <div className={c("request__contacts")}>
                <span className={c("request__contact-label")}>
                  Пишите на почту
                </span>
                <a
                  className={c("request__contact-value")}
                  href={`mailto:${email}`}
                >
                  {email}
                </a>
              </div>
              <img
                className={c("request__proposal")}
                src={`${ASSET_BASE}/img/kp.webp`}
                width="620"
                height="819"
                alt="Коммерческое предложение"
                loading="lazy"
              />
            </div>
            <form className={c("request-form")} onSubmit={submitRequest}>
              <p className={c("request-form__title")}>
                {content.requestFormTitle}
              </p>
              <label className={c("field")}>
                <span className={c("field__label")}>Фамилия Имя</span>
                <input
                  className={c("field__input")}
                  name="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Иванов Иван"
                  autoComplete="name"
                />
              </label>
              <label className={c("field")}>
                <span className={c("field__label")}>Телефон или почта</span>
                <input
                  className={c("field__input")}
                  name="contact"
                  required
                  maxLength={255}
                  placeholder="+7 000 000-00-00 или email@example.com"
                />
              </label>
              <label className={c("field")}>
                <span className={c("field__label")}>Что нужно</span>
                <textarea
                  className={c("field__input field__input--area")}
                  name="message"
                  rows={3}
                  maxLength={2000}
                  placeholder="Марка, диаметр, давление или описание задачи"
                />
              </label>
              <p className={c("request-form__attachment-note")}>
                Файлы пока не принимаются — приложите ссылку в описании заявки.
              </p>
              <label
                className={c("field public-contact-trap")}
                aria-hidden="true"
              >
                <span>Сайт</span>
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
              <label className={c("consent")}>
                <input
                  className={c("consent__box")}
                  name="consent"
                  type="checkbox"
                  required
                />
                <span className={c("consent__text")}>
                  Даю согласие на обработку персональных данных в соответствии с{" "}
                  <a
                    className={c("consent__link")}
                    href={`/preview/${encodeURIComponent(siteSlug)}/pages/privacy-policy`}
                  >
                    политикой сайта
                  </a>
                  .
                </span>
              </label>
              <button
                className={c("request-form__submit")}
                disabled={formState === "sending"}
              >
                {formState === "sending"
                  ? "Отправляем…"
                  : content.requestSubmitLabel}
              </button>
              <p
                className={c(
                  "request-form__status",
                  `request-form__status--${formState}`,
                )}
                role="status"
                aria-live="polite"
              >
                {formMessage}
              </p>
            </form>
          </div>
        </section>
      </main>

      <footer className={c("footer")}>
        <div className={c("footer__inner")}>
          <div>
            <a className={c("logo logo--footer")} href="#top">
              <img
                className={c("logo__img")}
                src={logoUrl}
                width="380"
                height="160"
                alt={layout.logoText || companyName}
              />
            </a>
            <p className={c("footer__text")}>
              {layout.footerDescription ||
                "Поставки трубопроводной арматуры по России и странам СНГ: задвижки, краны, затворы, фланцы и детали трубопровода со склада."}
            </p>
            <p className={c("footer__legal")}>
              {globals.legalName || companyName}
            </p>
          </div>
          <div className={c("footer__col--contacts")}>
            <p className={c("footer__heading")}>Контакты</p>
            <a className={c("footer__phone")} href={phoneHref(phone)}>
              {phone}
            </a>
            <a className={c("footer__mail")} href={`mailto:${email}`}>
              {email}
            </a>
            {globals.address ? (
              <p className={c("footer__address")}>{globals.address}</p>
            ) : null}
            <p className={c("footer__legal")}>
              © {new Date().getFullYear()} Все права защищены.
            </p>
          </div>
          <div className={c("footer__lists")}>
            <div>
              <p className={c("footer__heading")}>Каталог</p>
              <nav className={c("footer__list")}>
                {content.catalog.map((item) => (
                  <a href={safeHref(item.href)} key={item.name}>
                    {item.name}
                  </a>
                ))}
              </nav>
            </div>
            <div>
              <p className={c("footer__heading")}>Информация</p>
              <nav className={c("footer__list")}>
                <a href="#terms">Условия поставки</a>
                <a href="#faq">Вопросы и ответы</a>
                <a href="#request">Контакты</a>
              </nav>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
