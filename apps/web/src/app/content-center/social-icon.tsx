import styles from "./content-center-view.module.css";

function DecorativeSourceIcon({ src }: { src: string }) {
  return (
    // Tiny local SVGs do not benefit from raster image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.socialIcon}
      src={src}
      width={20}
      height={20}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

/** The HTML shield visually identifies a website alongside the social brands. */
export function WebsiteIcon() {
  return <DecorativeSourceIcon src="/icons/source/website.svg" />;
}

/** Local, unmodified SVG assets: see docs/social-icons.md for provenance. */
export function SocialIcon({
  network,
}: {
  network: "vk" | "telegram" | "youtube" | "instagram" | null;
}) {
  if (!network) return null;
  return <DecorativeSourceIcon src={`/icons/social/${network}.svg`} />;
}
