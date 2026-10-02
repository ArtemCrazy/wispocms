"use client";

import type { FormEvent } from "react";
import {
  type ManagedUserRole,
} from "./team-access-summary";
import { TeamSelect } from "./team-select";

export type TeamUserEditor = {
  userId: string;
  email: string;
  fullName: string;
  role: ManagedUserRole;
  siteIds: string[];
  requiresApproval: boolean;
  isActive: boolean;
};

type EditorSite = {
  id: string;
  name: string;
  workspaceName: string;
};

const roleNames: Record<ManagedUserRole, string> = {
  wispo_admin: "Администратор Wispo",
  site_owner: "Владелец сайта",
  content_manager: "Контент-менеджер",
};

export function TeamUserEditorModal({
  editor,
  sites,
  siteQuery,
  message,
  busy,
  protectedUser,
  passwordOpen,
  onChange,
  onRoleChange,
  onSiteQueryChange,
  onToggleSite,
  onTogglePassword,
  onResetPassword,
  onRequestAdminPasswordReset,
  onSave,
  onClose,
}: {
  editor: TeamUserEditor;
  sites: EditorSite[];
  siteQuery: string;
  message: string;
  busy: boolean;
  protectedUser: boolean;
  passwordOpen: boolean;
  onChange: (changes: Partial<TeamUserEditor>) => void;
  onRoleChange: (role: ManagedUserRole) => void;
  onSiteQueryChange: (query: string) => void;
  onToggleSite: (siteId: string) => void;
  onTogglePassword: () => void;
  onResetPassword: (event: FormEvent<HTMLFormElement>) => void;
  onRequestAdminPasswordReset: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="team-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="team-user-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-user-modal-title"
      >
        <header>
          <div>
            <h2 id="team-user-modal-title">Редактирование пользователя</h2>
            <p>Измените данные, роль и доступ пользователя к сайтам</p>
          </div>
          <button
            type="button"
            className="team-modal-close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>
        <div className="team-modal-body">
          {message ? (
            <div className="inline-message" role="status">
              {message}
            </div>
          ) : null}
          <div className="team-editor-grid">
            <label>
              <span>Имя и фамилия</span>
              <input
                value={editor.fullName}
                minLength={2}
                maxLength={160}
                autoFocus
                onChange={(event) => onChange({ fullName: event.target.value })}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                value={editor.email}
                aria-label="Email"
                readOnly
                className="team-readonly-field"
              />
            </label>
            <div className="team-editor-field">
              <span>Роль</span>
              <TeamSelect
                label="Роль"
                value={editor.role}
                disabled={protectedUser}
                options={Object.entries(roleNames).map(([value, label]) => ({
                  value: value as ManagedUserRole,
                  label,
                }))}
                onChange={onRoleChange}
              />
            </div>
            <label>
              <span>Статус доступа</span>
              <span className="team-status-editor">
                <span>
                  <i className={editor.isActive ? "active" : ""} />
                  {editor.isActive ? "Активен" : "Отключён"}
                </span>
                <label className="team-switch-control">
                  <input
                    type="checkbox"
                    aria-label="Аккаунт активен"
                    checked={editor.isActive}
                    disabled={protectedUser || editor.role === "wispo_admin"}
                    onChange={(event) =>
                      onChange({ isActive: event.target.checked })
                    }
                  />
                  <span aria-hidden="true" />
                </label>
              </span>
            </label>
          </div>
          {editor.role === "wispo_admin" ? (
            <div className="team-admin-access-note">
              <strong>Полный доступ</strong>
              <span>
                Администратор Wispo автоматически работает со всеми сайтами и
                разделами платформы.
              </span>
            </div>
          ) : (
            <>
              <div className="team-editor-section-heading">
                <div>
                  <h3>Доступные сайты</h3>
                  <p>
                    {editor.role === "site_owner"
                      ? "Владельцу можно назначить один сайт"
                      : "Можно выбрать один или несколько сайтов"}
                  </p>
                </div>
                <em>Выбрано: {editor.siteIds.length}</em>
              </div>
              <label className="team-site-search">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="9" cy="9" r="5.5" />
                  <path d="m13 13 3.5 3.5" />
                </svg>
                <input
                  value={siteQuery}
                  placeholder="Найти сайт"
                  aria-label="Поиск доступных сайтов"
                  onChange={(event) => onSiteQueryChange(event.target.value)}
                />
              </label>
              <div className="team-site-picker">
                {sites.map((site) => (
                  <label key={site.id}>
                    <input
                      type="checkbox"
                      checked={editor.siteIds.includes(site.id)}
                      onChange={() => onToggleSite(site.id)}
                    />
                    <span>
                      <b>{site.name}</b>
                      <small>{site.workspaceName}</small>
                    </span>
                  </label>
                ))}
                {sites.length === 0 ? (
                  <small className="team-site-picker-empty">
                    Сайты не найдены
                  </small>
                ) : null}
              </div>
              {editor.role === "content_manager" ? (
                <>
                  <div className="team-editor-section-heading permissions">
                    <div>
                      <h3>Дополнительные возможности</h3>
                      <p>Настройки применяются ко всем выбранным сайтам</p>
                    </div>
                  </div>
                  <div className="team-permission-grid">
                  <label>
                    <input
                      type="checkbox"
                      checked={editor.requiresApproval}
                      onChange={(event) =>
                        onChange({ requiresApproval: event.target.checked })
                      }
                    />
                    <span>
                      <b>Требует согласования</b>
                      <small>
                        Публикация только после подтверждения владельцем
                      </small>
                    </span>
                  </label>
                  </div>
                </>
              ) : null}
            </>
          )}
          {passwordOpen ? (
            <form className="team-modal-password" onSubmit={onResetPassword}>
              <div>
                <strong>Новый пароль</strong>
                <small>Не менее 10 символов</small>
              </div>
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Новый пароль"
                required
              />
              <input
                name="confirmation"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Повторите пароль"
                required
              />
              <button disabled={busy}>Сохранить пароль</button>
            </form>
          ) : null}
        </div>
        <footer>
          <div>
            {editor.role === "wispo_admin" && protectedUser ? (
              <button
                type="button"
                className="team-password-button"
                disabled={busy}
                onClick={onRequestAdminPasswordReset}
              >
                Отправить ссылку на email
              </button>
            ) : !protectedUser && editor.role !== "wispo_admin" ? (
              <button
                type="button"
                className="team-password-button"
                onClick={onTogglePassword}
              >
                Новый пароль
              </button>
            ) : null}
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            disabled={busy || editor.fullName.trim().length < 2}
            onClick={onSave}
          >
            {busy ? "Сохраняем…" : "Сохранить изменения"}
          </button>
        </footer>
      </section>
    </div>
  );
}
