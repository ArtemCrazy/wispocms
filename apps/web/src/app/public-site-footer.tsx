export type PublicSiteGlobals = {
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
  telegramUrl?: string;
  vkUrl?: string;
};

export type PublicSiteLayout = {
  logoText?: string;
  showPages?: boolean;
  showArticles?: boolean;
  ctaLabel?: string;
  ctaUrl?: string;
  footerDescription?: string;
  showContacts?: boolean;
  showSocials?: boolean;
};

export function PublicSiteFooter({
  siteName,
  globals,
  layout,
}: {
  siteName: string;
  globals?: PublicSiteGlobals;
  layout?: PublicSiteLayout;
}) {
  const phoneHref = globals?.phone
    ? `tel:${globals.phone.replace(/[^+\d]/g, "")}`
    : null;
  return (
    <footer className="public-footer">
      <div>
        <strong>{globals?.companyName || siteName}</strong>
        {layout?.footerDescription ? (
          <span>{layout.footerDescription}</span>
        ) : layout?.showContacts !== false && globals?.address ? (
          <span>{globals.address}</span>
        ) : null}
      </div>
      {layout?.showContacts !== false || layout?.showSocials !== false ? (
        <div className="public-footer-contacts">
          {layout?.showContacts !== false && globals?.phone ? (
            <a href={phoneHref ?? undefined}>{globals.phone}</a>
          ) : null}
          {layout?.showContacts !== false && globals?.email ? (
            <a href={`mailto:${globals.email}`}>{globals.email}</a>
          ) : null}
          {layout?.showSocials !== false && globals?.telegramUrl ? (
            <a href={globals.telegramUrl} target="_blank" rel="noreferrer">
              Telegram
            </a>
          ) : null}
          {layout?.showSocials !== false && globals?.vkUrl ? (
            <a href={globals.vkUrl} target="_blank" rel="noreferrer">
              ВКонтакте
            </a>
          ) : null}
        </div>
      ) : null}
      <small>© {new Date().getFullYear()}</small>
    </footer>
  );
}
