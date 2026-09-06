"use client";

import { FormEvent, useState } from "react";

export function LoginScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Не удалось войти");
      }

      await onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-aside">
        <div className="login-intro">
          <h1>Весь контент сайтов в одном рабочем пространстве</h1>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <h2>Войдите в Wispo CMS</h2>
          <p className="login-subtitle">
            Используйте данные администратора рабочего пространства.
          </p>

          <label>
            Электронная почта
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.ru"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Не менее 8 символов"
              autoComplete="current-password"
              minLength={8}
              required
            />
          </label>

          {error ? (
            <div className="login-error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="login-submit" disabled={submitting}>
            {submitting ? "Входим…" : "Войти"}
            <span>→</span>
          </button>
          <small className="login-note">
            Доступ выдаёт администратор Wispo.
          </small>
        </form>
      </section>
    </main>
  );
}
