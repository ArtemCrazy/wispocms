"use client";

import { type FormEvent, useMemo, useState } from "react";

type ProjectMember = {
  id: string;
  fullName: string;
  email: string;
  role: string;
};

type ProjectSite = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  siteType: "media" | "corporate" | "ecommerce" | "landing";
  isActive: boolean;
  createdAt: string;
  creator: { id: string; fullName: string; email: string } | null;
};

type ProjectSiteUpdate = Pick<
  ProjectSite,
  "id" | "name" | "slug" | "domain" | "siteType" | "isActive"
> & {
  workspaceId: string;
  pages: Array<{
    id: string;
    title: string;
    slug: string;
    kind: "homepage" | "page";
    status: "draft" | "published";
  }>;
};

type ProjectWorkspace = {
  id: string;
  name: string;
  slug: string;
  members: ProjectMember[];
  sites: ProjectSite[];
};

type PlatformUser = {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  accountKind: "legacy" | "wispo" | "site";
  isActive: boolean;
  memberships: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    role: string;
    siteIds: string[];
  }>;
};

type SettingsContext = {
  workspace: ProjectWorkspace;
  site: ProjectSite | null;
};

const siteTypeNames = {
  media: "Медиа-сайт",
  corporate: "Корпоративный сайт",
  ecommerce: "Интернет-магазин",
  landing: "Лендинг",
};

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function pluralizeRu(count: number, forms: [string, string, string]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ?? "Ошибка запроса"),
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function AllProjectsView({
  workspaces,
  onOpenSite,
  canManageProjects,
  onChanged,
}: {
  workspaces: ProjectWorkspace[];
  onOpenSite: (siteId: string) => void;
  canManageProjects: boolean;
  onChanged: (siteUpdate?: ProjectSiteUpdate) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(),
  );
  const [settingsContext, setSettingsContext] = useState<SettingsContext | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const projects = useMemo(
    () =>
      workspaces.flatMap((workspace) =>
        workspace.sites.map((site) => ({ site, workspace })),
      ),
    [workspaces],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = projects.filter(({ site, workspace }) => {
    const matchesStatus =
      status === "all" ||
      (status === "active" ? site.isActive : !site.isActive);
    const matchesQuery =
      `${site.name} ${site.slug} ${site.domain ?? ""} ${workspace.name} ${workspace.members.map((member) => member.fullName).join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });
  const visibleWorkspaceGroups = workspaces
    .map((workspace) => ({
      workspace,
      projects: visibleProjects.filter(
        (project) => project.workspace.id === workspace.id,
      ),
    }))
    .filter((group) => group.projects.length > 0);

  const selectedWorkspace = settingsContext?.workspace ?? null;
  const employeeUsers = users.filter((user) => user.accountKind === "wispo" && user.platformRole !== "wispo_admin");

  async function openSettings(context: SettingsContext) {
    setSettingsContext(context);
    setMessage("");
    setLoadingUsers(true);
    try {
      setUsers(await api<PlatformUser[]>("/api/platform/users"));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить доступы");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function refreshUsers() {
    setUsers(await api<PlatformUser[]>("/api/platform/users"));
    await onChanged();
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settingsContext?.site || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const updatedSite = await api<ProjectSiteUpdate>(
        `/api/platform/sites/${settingsContext.site.id}`,
        {
        method: "PATCH",
        body: JSON.stringify({
          name: data.get("name"),
          domain: String(data.get("domain") ?? "").trim() || null,
          siteType: data.get("siteType"),
          workspaceId: data.get("workspaceId"),
          isActive: data.get("isActive") === "on",
        }),
        },
      );
      await onChanged(updatedSite);
      setSettingsContext(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось сохранить проект");
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/platform/workspaces/${selectedWorkspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: data.get("name") }),
      });
      setMessage("Название рабочего пространства обновлено");
      await onChanged();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось сохранить рабочее пространство",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleTeamMember(user: PlatformUser, assigned: boolean) {
    if (!settingsContext?.site || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const siteIds = user.memberships
        .flatMap((membership) => membership.siteIds)
        .filter((siteId) => siteId !== settingsContext.site!.id);
      if (!assigned) siteIds.push(settingsContext.site.id);
      await api(`/api/platform/users/${user.id}/sites`, {
        method: "PUT",
        body: JSON.stringify({ siteIds }),
      });
      setMessage(
        assigned
          ? `${user.fullName} отключён от проекта`
          : `${user.fullName} добавлен в проект`,
      );
      await refreshUsers();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось изменить команду");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="all-projects-view">
      <header className="all-projects-heading">
        <div>
          <div className="all-projects-title-line">
            <h1>Все проекты</h1>
            <span>
              {projects.length}{" "}
              {pluralizeRu(projects.length, ["проект", "проекта", "проектов"])}
            </span>
          </div>
          <p>Сайты всех доступных рабочих пространств и закреплённые команды.</p>
        </div>
      </header>

      <div className="all-projects-toolbar">
        <label>
          <span className="weeek-icon weeek-icon-search" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти проект…" aria-label="Поиск проектов" />
        </label>
        <span className="all-projects-status-filter">
          <select value={status} onChange={(event) => setStatus(event.target.value as "all" | "active" | "inactive")} aria-label="Фильтр по статусу">
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Отключённые</option>
          </select>
          <i className="weeek-icon weeek-icon-chevron" aria-hidden="true" />
        </span>
        <small>Показано {visibleProjects.length} из {projects.length}</small>
      </div>

      <div className="all-projects-table" role="table" aria-label="Все проекты">
        <div className="all-projects-row all-projects-table-head" role="row">
          <span role="columnheader">Проект</span>
          <span role="columnheader">Статус</span>
          <span role="columnheader">Сотрудники</span>
          <span role="columnheader">Доступ</span>
          <span role="columnheader">Настройки</span>
        </div>
        {visibleWorkspaceGroups.map((group, groupIndex) => (
          <div
            className="all-projects-workspace-group"
            role="rowgroup"
            key={group.workspace.id}
          >
            <header className="all-projects-workspace-header">
              <button
                className="all-projects-workspace-toggle"
                type="button"
                aria-expanded={!collapsedWorkspaces.has(group.workspace.id)}
                aria-label={`${collapsedWorkspaces.has(group.workspace.id) ? "Развернуть" : "Свернуть"} сайты рабочего пространства ${group.workspace.name}`}
                onClick={() =>
                  setCollapsedWorkspaces((current) => {
                    const next = new Set(current);
                    if (next.has(group.workspace.id)) {
                      next.delete(group.workspace.id);
                    } else {
                      next.add(group.workspace.id);
                    }
                    return next;
                  })
                }
              >
                <span className="weeek-icon weeek-icon-projects" aria-hidden="true" />
              </button>
              <span>
                <strong>{group.workspace.name}</strong>
                <small>
                  {group.projects.length}{" "}
                  {pluralizeRu(group.projects.length, ["сайт", "сайта", "сайтов"])}
                </small>
              </span>
              {canManageProjects ? (
                <button
                  className="all-projects-workspace-settings"
                  type="button"
                  aria-label={`Доступ и команда рабочего пространства ${group.workspace.name}`}
                  title="Доступ и команда"
                  onClick={() =>
                    void openSettings({
                      workspace: group.workspace,
                      site: null,
                    })
                  }
                >
                  <i className="weeek-icon weeek-icon-settings" aria-hidden="true" />
                </button>
              ) : null}
            </header>
            <div
              className={`all-projects-workspace-projects${collapsedWorkspaces.has(group.workspace.id) ? " is-collapsed" : ""}`}
              aria-hidden={collapsedWorkspaces.has(group.workspace.id)}
            >
              <div>
                {group.projects.map((project, siteIndex) => {
                  const { site, workspace } = project;
                  const team = workspace.members;
                  const colorIndex = (groupIndex + siteIndex) % 4;
                  return (
                <div className="all-projects-row" role="row" key={site.id}>
                  <button
                    className="all-project-name"
                    role="cell"
                    onClick={() => onOpenSite(site.id)}
                  >
                    <i className={`tone-${colorIndex + 1}`}>
                      {site.name.slice(0, 1).toUpperCase()}
                    </i>
                    <span>
                      <strong>{site.name}</strong>
                      <small>{siteTypeNames[site.siteType]}</small>
                    </span>
                  </button>
                  <span
                    className={`project-status ${site.isActive ? "active" : "inactive"}`}
                    role="cell"
                  >
                    <i /> {site.isActive ? "Активен" : "Отключён"}
                  </span>
                  <span className="project-person" role="cell">
                    {team[0] ? (
                      <>
                        <i>{initials(team[0].fullName)}</i>
                        <span title={team[0].email}>{team[0].fullName}</span>
                      </>
                    ) : (
                      <small>Не назначен</small>
                    )}
                  </span>
                  <span className="project-team" role="cell">
                    <span className="project-team-avatars">
                      {team.slice(0, 3).map((member) => (
                        <i
                          key={member.id}
                          title={`${member.fullName} · ${member.email}`}
                        >
                          {initials(member.fullName)}
                        </i>
                      ))}
                    </span>
                    <small>
                      {team.length ? `${team.length} чел.` : "Нет команды"}
                    </small>
                  </span>
                  <span className="project-settings-cell" role="cell">
                    {canManageProjects ? (
                      <button
                        type="button"
                        onClick={() =>
                          void openSettings({ workspace, site })
                        }
                      >
                        <i
                          className="weeek-icon weeek-icon-settings"
                          aria-hidden="true"
                        />
                        Настройки сайта
                      </button>
                    ) : (
                      <small>Нет доступа</small>
                    )}
                  </span>
                </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
        {!visibleProjects.length ? <div className="all-projects-empty"><strong>Проекты не найдены</strong><span>Измените поисковый запрос или фильтр статуса.</span></div> : null}
      </div>

      {settingsContext ? (
        <div className="project-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsContext(null); }}>
          <aside className="project-settings-drawer" role="dialog" aria-modal="true" aria-label={`Настройки ${settingsContext.site?.name ?? settingsContext.workspace.name}`}>
            <header>
              <div><small>{settingsContext.site ? "НАСТРОЙКИ САЙТА" : "НАСТРОЙКИ WORKSPACE"}</small><h2>{settingsContext.site?.name ?? settingsContext.workspace.name}</h2></div>
              <button type="button" aria-label="Закрыть настройки" onClick={() => setSettingsContext(null)}>×</button>
            </header>
            {message ? <div className="project-settings-message" role="status">{message}</div> : null}
            {settingsContext.site ? (
              <form className="project-settings-section" onSubmit={(event) => void saveProject(event)}>
                <div><h3>Основные настройки сайта</h3><p>Название, тип, рабочее пространство и доступность сайта.</p></div>
                <label>Название сайта<input name="name" required minLength={2} maxLength={160} defaultValue={settingsContext.site.name} /></label>
                <label>Домен<input name="domain" maxLength={255} defaultValue={settingsContext.site.domain ?? ""} placeholder="example.ru" /></label>
                <div className="project-settings-fields-row">
                  <label>Тип сайта<select name="siteType" defaultValue={settingsContext.site.siteType}><option value="media">Медиа-сайт</option><option value="corporate">Корпоративный</option><option value="ecommerce">Интернет-магазин</option><option value="landing">Лендинг</option></select></label>
                  <label>Рабочее пространство<select name="workspaceId" defaultValue={settingsContext.workspace.id}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
                </div>
                <label className="project-settings-toggle"><input name="isActive" type="checkbox" defaultChecked={settingsContext.site.isActive} /><span><strong>Сайт включён</strong><small>Если отключить, публичная версия станет недоступна.</small></span></label>
                <button className="primary-button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить сайт"}</button>
              </form>
            ) : (
              <form className="project-settings-section" onSubmit={(event) => void saveWorkspace(event)}>
                <div><h3>Рабочее пространство</h3><p>Общий клиентский контур, объединяющий сайты и доступы.</p></div>
                <label>Название workspace<input name="name" required minLength={2} maxLength={160} defaultValue={settingsContext.workspace.name} /></label>
                <label>Системный адрес<input value={settingsContext.workspace.slug} disabled readOnly /></label>
                <button className="primary-button" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить workspace"}</button>
              </form>
            )}

            {settingsContext.site ? <section className="project-settings-section">
              <div><h3>Сотрудники Wispo</h3><p>Назначьте сотрудников, которым доступен этот сайт.</p></div>
              {loadingUsers ? <p className="project-settings-loading">Загружаем сотрудников…</p> : employeeUsers.length ? (
                <div className="project-settings-team">
                  {employeeUsers.map((user) => {
                    const assigned = user.memberships.some((membership) => membership.siteIds?.includes(settingsContext.site!.id));
                    return <label key={user.id}><span><i>{initials(user.fullName)}</i><b>{user.fullName}</b><small>{user.email}</small></span><input type="checkbox" checked={assigned} disabled={busy} onChange={() => void toggleTeamMember(user, assigned)} /></label>;
                  })}
                </div>
              ) : <p className="project-settings-loading">Сотрудники Wispo пока не добавлены.</p>}
            </section> : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
