"use client";

import { FormEvent, useState } from "react";

export function PublicContactForm({ siteSlug, siteName }: { siteSlug: string; siteName: string }) {
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!String(data.get("phone") ?? "").trim() && !String(data.get("email") ?? "").trim()) {
      setState("error");
      setMessage("Укажите телефон или электронную почту");
      return;
    }
    setState("sending");
    setMessage("");
    try {
      const response = await fetch(`/api/public/sites/${encodeURIComponent(siteSlug)}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone") || undefined,
          email: data.get("email") || undefined,
          message: data.get("message") || undefined,
          website: data.get("website") || undefined,
          consent: data.get("consent") === "on",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join(", ") : payload?.message ?? "Не удалось отправить заявку");
      form.reset();
      setState("success");
      setMessage("Спасибо! Заявка отправлена, мы свяжемся с вами.");
    } catch (reason) {
      setState("error");
      setMessage(reason instanceof Error ? reason.message : "Не удалось отправить заявку");
    }
  }

  return <section className="public-contact" id="contact">
    <div className="public-contact-copy"><small>СВЯЗАТЬСЯ</small><h2>Обсудим ваш проект?</h2><p>Оставьте контакты — команда {siteName} получит заявку по электронной почте.</p></div>
    <form onSubmit={submit}>
      <label><span>Ваше имя</span><input name="name" required minLength={2} maxLength={120} autoComplete="name" placeholder="Как к вам обращаться" /></label>
      <div><label><span>Телефон</span><input name="phone" type="tel" maxLength={30} pattern="\+?[0-9 ()-]{7,30}" autoComplete="tel" placeholder="+7 999 000-00-00" /></label><label><span>Почта</span><input name="email" type="email" maxLength={255} autoComplete="email" placeholder="name@company.ru" /></label></div>
      <label><span>О задаче</span><textarea name="message" rows={4} maxLength={2000} placeholder="Коротко расскажите, чем можем помочь" /></label>
      <label className="public-contact-trap" aria-hidden="true"><span>Сайт</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="public-contact-consent"><input name="consent" type="checkbox" required /><span>Согласен на обработку персональных данных для ответа на заявку</span></label>
      <footer><p className={state} role="status" aria-live="polite">{message}</p><button disabled={state === "sending"}>{state === "sending" ? "Отправляем…" : "Отправить заявку"}</button></footer>
    </form>
  </section>;
}
