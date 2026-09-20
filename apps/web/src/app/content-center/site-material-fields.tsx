import styles from "./content-center-view.module.css";

export function siteMaterialTitle(sourceUrl: string): string {
  const url = new URL(sourceUrl.trim());
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
    <div className={styles.field}>
      <input
        autoFocus
        aria-label="Адрес сайта"
        type="url"
        required
        maxLength={2048}
        value={sourceUrl}
        placeholder="https://example.ru"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
