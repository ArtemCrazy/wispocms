"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type SiteUser = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  role: "site_content_manager" | "site_developer";
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
  return response.json();
}

export function SiteUsersView({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [users, setUsers] = useState<SiteUser[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setUsers(await api<SiteUser[]>(`/api/sites/${siteId}/users`));
  }, [siteId]);

  useEffect(() => {
    let active = true;
    api<SiteUser[]>(`/api/sites/${siteId}/users`)
      .then((rows) => {
        if (active) setUsers(rows);
      })
      .catch((reason) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить пользователей");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [siteId]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusyUserId("new");
    setMessage("");
    try {
      await api(`/api/sites/${siteId}/users`, {
        method: "POST",
        body: JSON.stringify({
          fullName: data.get("fullName"),
          email: data.get("email"),
          password: data.get("password"),
          role: data.get("role"),
        }),
      });
      form.reset();
      setCreating(false);
      await reload();
      setMessage("Пользователь создан");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось создать пользователя");
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleStatus(user: SiteUser) {
    if (user.isActive && !window.confirm(`Отключить доступ для ${user.fullName}?`)) return;
    setBusyUserId(user.id);
    setMessage("");
    try {
      await api(`/api/sites/${siteId}/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await reload();
      setMessage(user.isActive ? "Доступ отключён" : "Доступ включён");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось изменить доступ");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="platform-section">
      <div className="section-heading">
        <div>
          <h1>Пользователи сайта</h1>
          <p>{siteName}: сотрудники работают только с этим сайтом</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}>Добавить пользователя</button>
      </div>
      {message ? <div className="inline-message" role="status">{message}</div> : null}
      {creating ? (
        <form className="user-form employee-create-form" onSubmit={(event) => void createUser(event)}>
          <input name="fullName" placeholder="Имя и фамилия" required minLength={2} maxLength={160} />
          <input name="email" type="email" placeholder="Почта" required />
          <input name="password" type="password" placeholder="Временный пароль, от 10 символов" autoComplete="new-password" required minLength={10} maxLength={128} />
          <label>Роль
            <select name="role" defaultValue="site_content_manager">
              <option value="site_content_manager">Контент-менеджер</option>
              <option value="site_developer">Разработчик</option>
            </select>
          </label>
          <div className="employee-form-actions">
            <button disabled={busyUserId === "new"}>{busyUserId === "new" ? "Создаём…" : "Создать пользователя"}</button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button>
          </div>
        </form>
      ) : null}
      {loading ? <p>Загружаем пользователей…</p> : users.length ? (
        <div className="team-table employee-team-table">
          <div className="team-head">
            <span>Пользователь</span><span>Роль</span><span>Сайт</span><span>Статус и доступ</span>
          </div>
          {users.map((user) => (
            <div className="employee-team-entry" key={user.id}>
              <div className="team-row">
                <span><b>{user.fullName}</b><small>{user.email}</small></span>
                <span>{user.role === "site_developer" ? "Разработчик" : "Контент-менеджер"}</span>
                <span>{siteName}</span>
                <span className="team-access">
                  <em className={user.isActive ? "active" : ""}>{user.isActive ? "Активен" : "Отключён"}</em>
                  <button disabled={busyUserId === user.id} onClick={() => void toggleStatus(user)}>{user.isActive ? "Отключить" : "Включить"}</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : <p>В этом сайте пока нет сотрудников. Добавьте контент-менеджера или разработчика.</p>}
    </section>
  );
}
