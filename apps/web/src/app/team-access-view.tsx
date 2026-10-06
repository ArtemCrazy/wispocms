"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  capabilityLabels,
  formatSiteSummary,
  managedUserRole,
  type ManagedUserRole,
} from "./team-access-summary";
import {
  TeamUserEditorModal,
  type TeamUserEditor,
} from "./team-user-editor-modal";

type WorkspaceItem = { id: string; name: string; sites: Array<{ id: string; name: string }> };
type UserItem = {
  id: string;
  email: string;
  fullName: string;
  platformRole: string;
  isActive: boolean;
  siteAccesses: Array<{
    siteId: string;
    siteName: string;
    workspaceId: string;
    workspaceName: string;
    role: "site_owner" | "content_manager";
    requiresApproval: boolean;
  }>;
};

const roleNames: Record<string, string> = {
  site_owner: "Владелец сайта",
  content_manager: "Контент-менеджер",
};

const managedRoleNames: Record<ManagedUserRole, string> = {
  wispo_admin: "Администратор Wispo",
  site_owner: "Владелец сайта",
  content_manager: "Контент-менеджер",
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
  const [editor, setEditor] = useState<TeamUserEditor | null>(null);
  const [siteQuery, setSiteQuery] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [createRole, setCreateRole] = useState<"site_owner" | "content_manager">(
    "content_manager",
  );
  const sites = workspaces.flatMap((workspace) =>
    workspace.sites.map((site) => ({ ...site, workspaceName: workspace.name })),
  );
  const visibleEditorSites = sites.filter((site) =>
    `${site.name} ${site.workspaceName}`
      .toLowerCase()
      .includes(siteQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!editor) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditor(null);
        setResettingUserId(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [editor]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users
    .filter((user) => {
      const matchesQuery = `${user.fullName} ${user.email} ${user.siteAccesses.map((item) => `${item.siteName} ${item.workspaceName}`).join(" ")}`
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
      const siteIds = data.getAll("siteIds").map(String);
      await api("/api/platform/users", {
        method: "POST",
        body: JSON.stringify({
          fullName: data.get("fullName"),
          email: data.get("email"),
          password: data.get("password"),
          siteAccesses: siteIds.map((siteId) => ({
            siteId,
            role: createRole,
            requiresApproval:
              createRole === "content_manager" &&
              data.get("requiresApproval") === "on",
          })),
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

  function openEditor(user: UserItem) {
    const role = managedUserRole(user);
    setEditor({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role,
      siteIds:
        role === "wispo_admin"
          ? []
          : user.siteAccesses.map((access) => access.siteId),
      requiresApproval: user.siteAccesses.some(
        (access) => access.requiresApproval,
      ),
      isActive: user.isActive,
    });
    setSiteQuery("");
    setResettingUserId(null);
    setMessage("");
  }

  function changeEditorRole(role: ManagedUserRole) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        role,
        siteIds:
          role === "wispo_admin"
            ? []
            : role === "site_owner"
              ? current.siteIds.slice(0, 1)
              : current.siteIds,
        requiresApproval:
          role === "content_manager" ? current.requiresApproval : false,
        isActive: role === "wispo_admin" ? true : current.isActive,
      };
    });
  }

  function toggleEditorSite(siteId: string) {
    setEditor((current) => {
      if (!current || current.role === "wispo_admin") return current;
      if (current.role === "site_owner")
        return { ...current, siteIds: [siteId] };
      return {
        ...current,
        siteIds: current.siteIds.includes(siteId)
          ? current.siteIds.filter((assignedId) => assignedId !== siteId)
          : [...current.siteIds, siteId],
      };
    });
  }

  async function updateUser() {
    if (!editor) return;
    if (editor.role !== "wispo_admin" && editor.siteIds.length === 0) {
      setMessage("Выберите хотя бы один сайт");
      return;
    }
    const original = users.find((user) => user.id === editor.userId);
    if (
      original?.isActive &&
      !editor.isActive &&
      !window.confirm(
        `Отключить доступ для ${editor.fullName}? Пользователь больше не сможет войти в CMS.`,
      )
    )
      return;

    setBusyUserId(editor.userId);
    setMessage("");
    try {
      await api(`/api/platform/users/${editor.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          fullName: editor.fullName,
          role: editor.role,
          siteIds: editor.siteIds,
          requiresApproval: editor.requiresApproval,
          isActive: editor.isActive,
        }),
      });
      setMessage(`Данные ${editor.fullName} обновлены`);
      setEditor(null);
      setResettingUserId(null);
      await reload();
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Не удалось обновить пользователя",
      );
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

  const editorUser = editor
    ? users.find((user) => user.id === editor.userId)
    : null;
  const editorProtected = editor?.userId === currentUserId;

  return (
    <section className="platform-section team-access-section">
      <div className="section-heading">
        <div>
          <h1>Команда и доступы</h1>
          <p>Роли и доступ к конкретным сайтам</p>
        </div>
        <button className="primary-button team-add-user" onClick={() => setCreating(true)}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
          Добавить сотрудника
        </button>
      </div>
      {message ? <div className="inline-message" role="status">{message}</div> : null}
      {creating ? (
        <form className="user-form employee-create-form" onSubmit={createUser}>
          <input name="fullName" placeholder="Имя и фамилия" required minLength={2} maxLength={160} />
          <input name="email" type="email" placeholder="Почта" required />
          <input name="password" type="password" placeholder="Временный пароль, от 10 символов" minLength={10} maxLength={128} autoComplete="new-password" required />
          <label>Роль
            <select name="role" value={createRole} onChange={(event) => setCreateRole(event.target.value as typeof createRole)}>
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
            <small>{createRole === "site_owner" ? "Владельцу можно назначить ровно один сайт." : "Контент-менеджеру можно назначить несколько сайтов."}</small>
          </fieldset>
          {createRole === "content_manager" ? (
            <label className="project-settings-toggle">
              <input type="checkbox" name="requiresApproval" />
              <span>Требовать согласование перед публикацией</span>
            </label>
          ) : null}
          <div className="employee-form-actions">
            <button disabled={busyUserId === "new"}>{busyUserId === "new" ? "Создаём…" : "Создать сотрудника"}</button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        </form>
      ) : null}
      <div className="team-toolbar">
        <label>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13 13 3.5 3.5" />
          </svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти по имени, почте или сайту" aria-label="Поиск сотрудников" />
        </label>
        <select aria-label="Фильтр по статусу" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="inactive">Отключённые</option>
        </select>
        <small>Показано {visibleUsers.length} из {users.length}</small>
      </div>
      <div
        className="team-table employee-team-table"
        role="table"
        aria-label="Команда и доступы"
      >
        <div className="team-head" role="row">
          <span role="columnheader">Пользователь</span>
          <span role="columnheader">Роль</span>
          <span role="columnheader">Сайты</span>
          <span role="columnheader">Дополнительные возможности</span>
          <span role="columnheader">Статус</span>
          <span role="columnheader" aria-label="Действия" />
        </div>
        {visibleUsers.map((user) => {
          const administrator = user.platformRole === "wispo_admin";
          const role = managedUserRole(user);
          const capabilities = capabilityLabels({
            administrator,
            requiresApproval: user.siteAccesses.some(
              (access) => access.requiresApproval,
            ),
          });
          return (
            <div className="team-row" role="row" key={user.id}>
              <span role="cell" className="team-user">
                <i>
                  {user.fullName
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </i>
                <b>{user.fullName}</b>
                <small>{user.email}</small>
              </span>
              <span role="cell">{managedRoleNames[role]}</span>
              <span role="cell" className="team-sites-summary">
                {formatSiteSummary(
                  user.siteAccesses.map((access) => access.siteName),
                  administrator,
                )}
              </span>
              <span role="cell" className="team-capabilities">
                {capabilities.length ? (
                  capabilities.map((capability) => (
                    <em
                      className={administrator ? "full-access" : ""}
                      key={capability}
                    >
                      {capability}
                    </em>
                  ))
                ) : (
                  <small>—</small>
                )}
              </span>
              <span role="cell" className="team-status">
                <em className={user.isActive ? "active" : ""}>
                  {user.isActive ? "Активен" : "Отключён"}
                </em>
              </span>
              <span role="cell" className="team-row-action">
                <button
                  type="button"
                  disabled={busyUserId === user.id}
                  onClick={() => openEditor(user)}
                >
                  Редактировать
                </button>
              </span>
            </div>
          );
        })}
        {visibleUsers.length === 0 ? (
          <div className="team-empty">Пользователи не найдены</div>
        ) : null}
      </div>
      {editor && editorUser ? (
        <TeamUserEditorModal
          editor={editor}
          sites={visibleEditorSites}
          siteQuery={siteQuery}
          message={message}
          busy={busyUserId === editor.userId}
          protectedUser={Boolean(editorProtected)}
          passwordOpen={resettingUserId === editor.userId}
          onChange={(changes) =>
            setEditor((current) =>
              current ? { ...current, ...changes } : current,
            )
          }
          onRoleChange={changeEditorRole}
          onSiteQueryChange={setSiteQuery}
          onToggleSite={toggleEditorSite}
          onTogglePassword={() =>
            setResettingUserId((current) =>
              current === editor.userId ? null : editor.userId,
            )
          }
          onResetPassword={(event) => void resetPassword(event, editorUser)}
          onSave={() => void updateUser()}
          onClose={() => {
            setEditor(null);
            setResettingUserId(null);
          }}
        />
      ) : null}
    </section>
  );
}
