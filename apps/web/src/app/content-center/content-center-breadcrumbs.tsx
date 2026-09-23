import type { ContentCenterScreen } from "./navigation";
import styles from "./content-center-view.module.css";

export function ContentCenterBreadcrumbs({
  workspaceName,
  screen,
  title,
  onWorkspaceOpen,
  onNavigate,
}: {
  workspaceName: string;
  screen: ContentCenterScreen;
  title: string;
  onWorkspaceOpen: () => void;
  onNavigate: (screen: ContentCenterScreen) => void;
}) {
  const parents = [
    { label: workspaceName, onClick: onWorkspaceOpen },
    ...(screen === "root"
      ? []
      : [{ label: "Контент-центр", onClick: () => onNavigate("root") }]),
    ...(screen === "history" || screen === "document"
      ? [{ label: "Подготовка информации", onClick: () => onNavigate("preparation") }]
      : []),
  ];

  return (
    <nav className={styles.breadcrumbs} aria-label="Хлебные крошки">
      <ol>
        {parents.map((parent, index) => (
          <li key={index}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <button type="button" className={styles.link} onClick={parent.onClick}>
              {parent.label}
            </button>
          </li>
        ))}
        <li>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{title}</span>
        </li>
      </ol>
    </nav>
  );
}
