"use client";

import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { SiteTypePicker, type SiteType } from "./site-type-picker";
import { AuditLogView } from "./audit-log-view";
import { TeamAccessView } from "./team-access-view";

type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  sites: Array<{
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    siteType: SiteType;
    isActive: boolean;
  }>;
};

type UserItem = {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  accountKind: "legacy" | "wispo" | "site";
  homeSiteId: string | null;
  isActive: boolean;
  memberships: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    role: string;
    siteIds: string[];
  }>;
};

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

export function PlatformView({
  view,
  currentUserId,
  onChanged,
}: {
  view: "overview" | "workspaces" | "team" | "audit";
  currentUserId?: string;
  onChanged?: () => Promise<void>;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [workspaceRows, userRows] = await Promise.all([
        api<WorkspaceItem[]>("/api/platform/workspaces"),
        api<UserItem[]>("/api/platform/users"),
      ]);
      setWorkspaces(workspaceRows);
      setUsers(userRows);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось загрузить данные",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([load(), onChanged?.()]);
  }, [load, onChanged]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<WorkspaceItem[]>("/api/platform/workspaces"),
      api<UserItem[]>("/api/platform/users"),
    ])
      .then(([workspaceRows, userRows]) => {
        if (active) {
          setWorkspaces(workspaceRows);
          setUsers(userRows);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить данные",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading)
    return <div className="section-state">Загружаем данные платформы…</div>;
  if (error) return <div className="section-state error">{error}</div>;
  if (view === "overview")
    return <Overview workspaces={workspaces} users={users} />;
  if (view === "workspaces")
    return <Workspaces workspaces={workspaces} reload={refresh} />;
  if (view === "audit") return <AuditLogView />;
  return (
    <TeamAccessView
      users={users}
      workspaces={workspaces}
      currentUserId={currentUserId}
      reload={refresh}
    />
  );
}

function Overview({
  workspaces,
  users,
}: {
  workspaces: WorkspaceItem[];
  users: UserItem[];
}) {
  const siteCount = workspaces.reduce(
    (sum, workspace) => sum + workspace.sites.length,
    0,
  );
  return (
    <section className="platform-section">
      <div className="section-heading">
        <div>
          <h1>Обзор платформы</h1>
          <p>Структура Wispo CMS и доступы команды</p>
        </div>
      </div>
      <div className="platform-stats">
        <article>
          <span>▦</span>
          <b>{workspaces.length}</b>
          <small>Рабочих пространств</small>
        </article>
        <article>
          <span>◇</span>
          <b>{siteCount}</b>
          <small>Подключённых сайтов</small>
        </article>
        <article>
          <span>♙</span>
          <b>{users.length}</b>
          <small>Пользователей</small>
        </article>
        <article>
          <span>✓</span>
          <b>{users.filter((user) => user.isActive).length}</b>
          <small>Активных доступов</small>
        </article>
      </div>
      <div className="platform-panel">
        <h2>Текущая структура</h2>
        {workspaces.map((workspace) => (
          <div className="structure-row" key={workspace.id}>
            <strong>{workspace.name}</strong>
            <span>{workspace.sites.length} сайт(а)</span>
            <span>{workspace.memberCount} участник(а)</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Workspaces({
  workspaces,
  reload,
}: {
  workspaces: WorkspaceItem[];
  reload: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [siteWorkspace, setSiteWorkspace] = useState<string | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [siteStatusFilter, setSiteStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [siteTypeFilter, setSiteTypeFilter] = useState("all");

  const normalizedQuery = query.trim().toLowerCase();
  const totalSiteCount = workspaces.reduce(
    (sum, workspace) => sum + workspace.sites.length,
    0,
  );
  const visibleWorkspaces = workspaces.reduce<WorkspaceItem[]>(
    (result, workspace) => {
      const workspaceMatches = `${workspace.name} ${workspace.slug}`
        .toLowerCase()
        .includes(normalizedQuery);
      const sites = workspace.sites.filter((site) => {
        const matchesStatus =
          siteStatusFilter === "all" ||
          (siteStatusFilter === "active" ? site.isActive : !site.isActive);
        const matchesType =
          siteTypeFilter === "all" || site.siteType === siteTypeFilter;
        const matchesQuery =
          normalizedQuery === "" ||
          workspaceMatches ||
          `${site.name} ${site.slug} ${site.domain ?? ""}`
            .toLowerCase()
            .includes(normalizedQuery);
        return matchesStatus && matchesType && matchesQuery;
      });
      const siteFiltersAreEmpty =
        siteStatusFilter === "all" && siteTypeFilter === "all";
      if (
        sites.length > 0 ||
        (siteFiltersAreEmpty && workspaceMatches)
      ) {
        result.push({ ...workspace, sites });
      }
      return result;
    },
    [],
  );
  const visibleSiteCount = visibleWorkspaces.reduce(
    (sum, workspace) => sum + workspace.sites.length,
    0,
  );

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/platform/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          slug: data.get("slug"),
        }),
      });
      setCreating(false);
      setMessage("Пространство создано");
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Ошибка");
    }
  }

  async function updateWorkspace(
    event: FormEvent<HTMLFormElement>,
    workspace: WorkspaceItem,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusyId(workspace.id);
    setMessage("");
    try {
      await api(`/api/platform/workspaces/${workspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: data.get("name") }),
      });
      setEditingWorkspaceId(null);
      setMessage("Название пространства обновлено");
      await reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить пространство",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function createSite(
    event: FormEvent<HTMLFormElement>,
    workspaceId: string,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/platform/workspaces/${workspaceId}/sites`, {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          slug: data.get("slug"),
          domain: data.get("domain"),
          siteType: data.get("siteType"),
        }),
      });
      setSiteWorkspace(null);
      setMessage("Сайт добавлен");
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Ошибка");
    }
  }

  async function updateSite(
    event: FormEvent<HTMLFormElement>,
    site: WorkspaceItem["sites"][number],
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusyId(site.id);
    setMessage("");
    try {
      await api(`/api/platform/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.get("name"),
          domain: String(data.get("domain") ?? "").trim() || null,
          siteType: data.get("siteType"),
          isActive: site.isActive,
        }),
      });
      setEditingSiteId(null);
      setMessage(`Сайт «${site.name}» обновлён`);
      await reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось обновить сайт",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggleSite(site: WorkspaceItem["sites"][number]) {
    if (
      site.isActive &&
      !window.confirm(
        `Отключить сайт «${site.name}»? Публичная версия станет недоступна.`,
      )
    )
      return;
    setBusyId(site.id);
    setMessage("");
    try {
      await api(`/api/platform/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: site.name,
          domain: site.domain,
          isActive: !site.isActive,
        }),
      });
      setMessage(
        site.isActive
          ? `Сайт «${site.name}» отключён`
          : `Сайт «${site.name}» включён`,
      );
      await reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось изменить статус сайта",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="platform-section">
      <div className="section-heading">
        <div>
          <h1>Рабочие пространства</h1>
          <p>Уровень владения сайтами и командами</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}>
          ＋ Добавить workspace
        </button>
      </div>
      {message ? (
        <div className="inline-message" role="status">
          {message}
        </div>
      ) : null}
      {creating ? (
        <form className="inline-form" onSubmit={createWorkspace}>
          <input name="name" placeholder="Название" required minLength={2} />
          <input
            name="slug"
            placeholder="slug-latin"
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          />
          <button>Создать</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setCreating(false)}
          >
            Отмена
          </button>
        </form>
      ) : null}
      <div className="team-toolbar workspace-toolbar">
        <label>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти workspace, сайт или домен"
            aria-label="Поиск проектов и сайтов"
          />
          {query ? (
            <button
              type="button"
              aria-label="Очистить поиск проектов"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          ) : null}
        </label>
        <select
          aria-label="Фильтр сайтов по статусу"
          value={siteStatusFilter}
          onChange={(event) =>
            setSiteStatusFilter(
              event.target.value as "all" | "active" | "inactive",
            )
          }
        >
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="inactive">Отключённые</option>
        </select>
        <select
          aria-label="Фильтр сайтов по типу"
          value={siteTypeFilter}
          onChange={(event) => setSiteTypeFilter(event.target.value)}
        >
          <option value="all">Все типы сайтов</option>
          <option value="media">Медиа</option>
          <option value="corporate">Корпоративные</option>
          <option value="ecommerce">Интернет-магазины</option>
          <option value="landing">Лендинги</option>
        </select>
        <small>
          {visibleWorkspaces.length} из {workspaces.length} пространств ·{" "}
          {visibleSiteCount} из {totalSiteCount} сайтов
        </small>
      </div>
      <div className="workspace-grid">
        {visibleWorkspaces.map((workspace) => (
          <article className="workspace-card" key={workspace.id}>
            <header>
              <span>{workspace.name.slice(0, 2).toUpperCase()}</span>
              <div>
                <h2>{workspace.name}</h2>
                <p>{workspace.slug}</p>
              </div>
              <div className="workspace-head-actions">
                <em>{workspace.memberCount} участник(а)</em>
                <button
                  onClick={() => {
                    setEditingWorkspaceId(workspace.id);
                    setEditingSiteId(null);
                  }}
                >
                  Изменить
                </button>
              </div>
            </header>
            {editingWorkspaceId === workspace.id ? (
              <form
                className="workspace-edit-form"
                onSubmit={(event) => void updateWorkspace(event, workspace)}
              >
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  defaultValue={workspace.name}
                />
                <span>Системный адрес: {workspace.slug}</span>
                <div>
                  <button disabled={busyId === workspace.id}>
                    {busyId === workspace.id ? "Сохраняем…" : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingWorkspaceId(null)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : null}
            <div className="site-list">
              {workspace.sites.map((site) => (
                <Fragment key={site.id}>
                  <div
                    className={`site-row ${site.isActive ? "" : "inactive"}`}
                  >
                    <span className="site-status" />
                    <span className="site-meta">
                      <strong>{site.name}</strong>
                      <small>
                        {site.domain ?? site.slug} ·{" "}
                        {{
                          media: "Медиа",
                          corporate: "Корпоративный",
                          ecommerce: "Интернет-магазин",
                          landing: "Лендинг",
                        }[site.siteType] ?? site.siteType}
                      </small>
                    </span>
                    <span className="site-row-actions">
                      <em>{site.isActive ? "Активен" : "Отключён"}</em>
                      <button
                        onClick={() => {
                          setEditingSiteId(site.id);
                          setEditingWorkspaceId(null);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        disabled={busyId === site.id}
                        className={site.isActive ? "disable" : "enable"}
                        onClick={() => void toggleSite(site)}
                      >
                        {busyId === site.id
                          ? "…"
                          : site.isActive
                            ? "Отключить"
                            : "Включить"}
                      </button>
                    </span>
                  </div>
                  {editingSiteId === site.id ? (
                    <form
                      className="site-edit-form"
                      onSubmit={(event) => void updateSite(event, site)}
                    >
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={160}
                        defaultValue={site.name}
                      />
                      <input
                        name="domain"
                        maxLength={255}
                        placeholder="domain.ru"
                        defaultValue={site.domain ?? ""}
                      />
                      <select name="siteType" defaultValue={site.siteType}>
                        <option value="media">Медиа-сайт</option>
                        <option value="corporate">Корпоративный</option>
                        <option value="ecommerce">Интернет-магазин</option>
                        <option value="landing">Лендинг</option>
                      </select>
                      <span>Системный адрес: {site.slug}</span>
                      <div>
                        <button disabled={busyId === site.id}>
                          {busyId === site.id ? "Сохраняем…" : "Сохранить"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEditingSiteId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : null}
                </Fragment>
              ))}
            </div>
            {siteWorkspace === workspace.id ? (
              <form
                className="site-form"
                onSubmit={(event) => void createSite(event, workspace.id)}
              >
                <input name="name" placeholder="Название сайта" required />
                <input
                  name="slug"
                  placeholder="уникальный-slug"
                  title="Системный адрес должен быть уникальным среди всех сайтов Wispo"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                />
                <input name="domain" placeholder="domain.ru (необязательно)" />
                <SiteTypePicker />
                <div>
                  <button>Добавить</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSiteWorkspace(null)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="add-site"
                onClick={() => setSiteWorkspace(workspace.id)}
              >
                ＋ Добавить сайт
              </button>
            )}
          </article>
        ))}
        {visibleWorkspaces.length === 0 ? (
          <div className="workspace-empty">
            Проекты и сайты по выбранным условиям не найдены
          </div>
        ) : null}
      </div>
    </section>
  );
}
