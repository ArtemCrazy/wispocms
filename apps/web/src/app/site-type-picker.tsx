export type SiteType = "media" | "corporate" | "landing";

const siteTypes: Array<{
  value: SiteType;
  title: string;
  description: string;
}> = [
  {
    value: "media",
    title: "Медиа-сайт",
    description: "Статьи, рубрики, авторы и редакционный процесс.",
  },
  {
    value: "corporate",
    title: "Корпоративный сайт",
    description: "Страницы, услуги, блог и корпоративные данные.",
  },
  {
    value: "landing",
    title: "Лендинг",
    description: "Одна посадочная страница, контакты и SEO.",
  },
];

export function SiteTypePicker() {
  return (
    <fieldset className="site-type-picker">
      <legend>Выберите тип сайта</legend>
      <div>
        {siteTypes.map((siteType) => (
          <label key={siteType.value}>
            <input
              type="radio"
              name="siteType"
              value={siteType.value}
              defaultChecked={siteType.value === "media"}
              required
            />
            <span>
              <strong>{siteType.title}</strong>
              <small>{siteType.description}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
