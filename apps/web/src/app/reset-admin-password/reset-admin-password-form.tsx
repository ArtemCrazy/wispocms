"use client";

import { type FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export function ResetAdminPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setMessage("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/admin-password-reset/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          Array.isArray(payload?.message)
            ? payload.message.join(", ")
            : (payload?.message ?? "Не удалось изменить пароль"),
        );
      setComplete(true);
      setMessage("Пароль изменён. Все прежние сессии администратора завершены.");
      form.reset();
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось изменить пароль",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-reset-page">
      <section className="admin-reset-card">
        <span className="admin-reset-mark">W</span>
        <h1>Новый пароль администратора</h1>
        <p>
          Ссылка действует 30 минут и после сохранения завершает все прежние
          сессии Wispo CMS.
        </p>
        {message ? (
          <div className="admin-reset-message" role="status">
            {message}
          </div>
        ) : null}
        {!token ? (
          <div className="admin-reset-message error">
            В ссылке отсутствует токен подтверждения.
          </div>
        ) : complete ? (
          <Link className="admin-reset-link" href="/">
            Вернуться ко входу
          </Link>
        ) : (
          <form onSubmit={submit}>
            <label>
              <span>Новый пароль</span>
              <input
                name="newPassword"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              <span>Повторите пароль</span>
              <input
                name="confirmation"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <button disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить новый пароль"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
