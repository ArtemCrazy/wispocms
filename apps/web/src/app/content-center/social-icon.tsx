import styles from "./content-center-view.module.css";

/** Local, unmodified SVG assets: see docs/social-icons.md for provenance. */
export function SocialIcon({
  network,
}: {
  network: "vk" | "telegram" | "youtube" | null;
}) {
  if (!network) return null;
  return (
    // Tiny local SVGs do not benefit from raster image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.socialIcon}
      src={`/icons/social/${network}.svg`}
      width={20}
      height={20}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
