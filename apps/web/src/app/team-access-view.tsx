"use client";

import { type FormEvent, useState } from "react";

type WorkspaceItem = { id: string; name: string; sites: Array<{ id: string; name: string }> };
type UserItem = {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  accountKind: "legacy" | "wispo" | "site";
  homeSiteId: string | null;
  isActive: boolean;
  memberships: Array<{ workspaceId: string; workspaceName: string; role: string; siteIds: string[] }>;
};

const roleNames: Record<string, string> = {
  site_owner: "Владелец сайта",
  wispo_manager: "Менеджер Wispo",
  site_content_manager: "Контент-менеджер сайта",
  wispo_developer: "Разработчик Wispo",
  site_developer: "Разработчик сайта",
};

async function api(url: string, init?: RequestInit) {
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
}

export function TeamAccessView({
  users,
  workspaces,
  currentUserId,
  reload,
}: {
  users: UserItem[];
  workspaces: WorkspaceItem[];
  currentUserId?: string;
  reload: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [createRole, setCreateRole] = useState("wispo_manager");
  const sites = workspaces.flatMap((workspace) =>
    workspace.sites.map((site) => ({ ...site, workspaceName: workspace.name })),
  );

  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users
    .filter((user) => {
      const matchesQuery = `${user.fullName} ${user.email} ${user.memberships.map((item) => item.workspaceName).join(" ")}`
        .toLowerCase()
        .includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? user.isActive : !user.isActive);
      return matchesQuery && matchesStatus;
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName, "ru"));

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusyUserId("new");
    setMessage("");
    try {
      await api("/api/platform/users", {
        method: "POST",
        body: JSON.stringify({
          fullName: data.get("fullName"),
          email: data.get("email"),
          password: data.get("password"),
          role: data.get("role"),
          siteIds: data.getAll("siteIds"),
        }),
      });
      form.reset();
      setCreating(false);
      setMessage("Аккаунт сотрудника создан");
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Ошибка");
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleSite(user: UserItem, siteId: string) {
    const assigned = new Set(user.memberships.flatMap((item) => item.siteIds));
    if (assigned.has(siteId)) assigned.delete(siteId);
    else assigned.add(siteId);
    setBusyUserId(user.id);
    setMessage("");
    try {
      await api(`/api/platform/users/${user.id}/sites`, {
        method: "PUT",
        body: JSON.stringify({ siteIds: [...assigned] }),
      });
      setMessage(`Доступы ${user.fullName} обновлены`);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось изменить доступы");
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleStatus(user: UserItem) {
    if (
      user.isActive &&
      !window.confirm(`Отключить доступ для ${user.fullName}? Пользователь больше не сможет войти в CMS.`)
    )
      return;
    setBusyUserId(user.id);
    try {
      await api(`/api/platform/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      setMessage(user.isActive ? `Доступ для ${user.fullName} отключён` : `Доступ для ${user.fullName} включён`);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось изменить статус");
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, user: UserItem) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== data.get("confirmation")) {
      setMessage("Пароли не совпадают");
      return;
    }
    setBusyUserId(user.id);
    try {
      await api(`/api/platform/users/${user.id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      setResettingUserId(null);
      setMessage(`Временный пароль для ${user.fullName} обновлён`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось сбросить пароль");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="platform-section">
      <div className="section-heading">
        <div>
          <h1>Команда и доступы</h1>
          <p>Роли и доступ к конкретным сайтам</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}>
          ＋ Добавить сотрудника
        </button>
      </div>
      {message ? <div className="inline-message" role="status">{message}</div> : null}
      {creating ? (
        <form className="user-form employee-create-form" onSubmit={createUser}>
          <input name="fullName" placeholder="Имя и фамилия" required minLength={2} maxLength={160} />
          <input name="email" type="email" placeholder="Почта" required />
          <input name="password" type="password" placeholder="Временный пароль, от 10 символов" minLength={10} maxLength={128} autoComplete="new-password" required />
          <label>Роль
            <select name="role" value={createRole} onChange={(event) => setCreateRole(event.target.value)}>
              {Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <fieldset className="workspace-access-list">
            <legend>Сайты</legend>
            {sites.map((site) => (
              <label key={site.id}>
                <input type="checkbox" name="siteIds" value={site.id} />
                <span>{site.name} · {site.workspaceName}</span>
              </label>
            ))}
            <small>{createRole.startsWith("site_") ? "Для аккаунта сайта выберите ровно один сайт." : "Сотруднику Wispo можно назначить несколько сайтов."}</small>
          </fieldset>
          <div className="employee-form-actions">
            <button disabled={busyUserId === "new"}>{busyUserId === "new" ? "Создаём…" : "Создать сотрудника"}</button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        </form>
      ) : null}
      <div className="team-toolbar">
        <label>
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по имени, почте или сайту" aria-label="Поиск сотрудников" />
        </label>
        <select aria-label="Фильтр по статусу" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="inactive">Отключённые</option>
        </select>
        <small>Показано {visibleUsers.length} из {users.length}</small>
      </div>
      <div className="team-table employee-team-table">
        <div className="team-head">
          <span>Пользователь</span><span>Роль</span><span>Сайты</span><span>Статус и доступ</span>
        </div>
        {visibleUsers.map((user) => {
          const administrator = user.platformRole === "wispo_admin";
          const protectedUser = administrator || user.id === currentUserId;
          return (
            <div className="employee-team-entry" key={user.id}>
              <div className="team-row">
                <span><i>{user.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</i><b>{user.fullName}</b><small>{user.email}</small></span>
                <span>{administrator ? "Администратор Wispo" : roleNames[user.memberships[0]?.role] ?? "Не назначена"}</span>
                <fieldset className="workspace-access-list compact" disabled={administrator || user.accountKind !== "wispo" || busyUserId === user.id}>
                  {administrator ? <small>Все сайты</small> : sites.map((site) => (
                    <label key={site.id}>
                      <input type="checkbox" checked={user.memberships.some((item) => item.siteIds?.includes(site.id))} onChange={() => void toggleSite(user, site.id)} />
                      <span>{site.name}</span>
                    </label>
                  ))}
                  {!administrator && user.accountKind === "site" ? <small>Аккаунт ограничен своим сайтом.</small> : null}
                  {!administrator && user.accountKind === "legacy" ? <small>Старая роль не даёт доступа к сайтам.</small> : null}
                  {!administrator && !sites.length ? <small>Нет сайтов</small> : null}
                </fieldset>
                <span className="team-access">
                  <em className={user.isActive ? "active" : ""}>{user.isActive ? "Активен" : "Отключён"}</em>
                  {!protectedUser ? <><button disabled={busyUserId === user.id} onClick={() => setResettingUserId(user.id)}>Новый пароль</button><button disabled={busyUserId === user.id} className={user.isActive ? "disable" : "enable"} onClick={() => void toggleStatus(user)}>{user.isActive ? "Отключить" : "Включить"}</button></> : <small>Защищён</small>}
                </span>
              </div>
              {resettingUserId === user.id ? (
                <form className="team-password-row" onSubmit={(event) => void resetPassword(event, user)}>
                  <span><strong>Новый временный пароль</strong><small>Пароль не попадёт в журнал изменений.</small></span>
                  <input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="Не менее 10 символов" required />
                  <input name="confirmation" type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="Повторите пароль" required />
                  <div><button disabled={busyUserId === user.id}>Сохранить</button><button type="button" className="secondary" onClick={() => setResettingUserId(null)}>Отмена</button></div>
                </form>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
