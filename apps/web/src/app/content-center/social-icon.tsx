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

/** A neutral globe identifies a website without suggesting a specific brand. */
export function WebsiteIcon() {
  return <DecorativeSourceIcon src="/globe.svg" />;
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
