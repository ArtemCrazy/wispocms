import styles from "./content-center-view.module.css";
import { materialSourceUrl } from "./materials";

export function siteMaterialTitle(sourceUrl: string): string {
  const url = new URL(materialSourceUrl(sourceUrl));
  return `${url.host}${url.pathname.replace(/\/$/, "")}`.slice(0, 160);
}

export function SiteMaterialFields({
  sourceUrl,
  onChange,
}: {
  sourceUrl: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`${styles.field} ${styles.firstField}`}>
      <input
        autoFocus
        aria-label="Адрес сайта"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={2048}
        value={sourceUrl}
        placeholder="example.ru"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
