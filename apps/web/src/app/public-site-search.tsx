"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type SearchResult = {
  id: string;
  type: "article" | "page";
  title: string;
  excerpt: string;
  path: string;
};

export function PublicSiteSearch({ siteSlug }: { siteSlug: string }) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const query = String(new FormData(form).get("q") ?? "").trim();
    if (query.length < 2) {
      setResults([]);
      setMessage("Введите минимум 2 символа");
      setOpen(true);
      return;
    }

    setLoading(true);
    setMessage("");
    setOpen(true);
    try {
      const response = await fetch(
        `/api/public/sites/${encodeURIComponent(siteSlug)}/search?q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.message ?? "Не удалось выполнить поиск");
      const nextResults = (payload?.results ?? []) as SearchResult[];
      setResults(nextResults);
      setMessage(nextResults.length ? "" : "Ничего не найдено");
    } catch (reason) {
      setResults([]);
      setMessage(
        reason instanceof Error ? reason.message : "Не удалось выполнить поиск",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="public-search">
      <form role="search" onSubmit={(event) => void search(event)}>
        <input
          name="q"
          type="search"
          minLength={2}
          maxLength={100}
          placeholder="Поиск по сайту"
          aria-label="Поиск по сайту"
          onFocus={() => {
            if (results.length || message) setOpen(true);
          }}
        />
        <button disabled={loading} aria-label="Найти">
          {loading ? "…" : "⌕"}
        </button>
      </form>
      {open ? (
        <div className="public-search-results">
          <header>
            <strong>Результаты поиска</strong>
            <button onClick={() => setOpen(false)} aria-label="Закрыть поиск">
              ×
            </button>
          </header>
          {message ? <p>{message}</p> : null}
          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id}`}
              href={`/preview/${siteSlug}${result.path === "/" ? "" : result.path}`}
              onClick={() => setOpen(false)}
            >
              <small>{result.type === "article" ? "Статья" : "Страница"}</small>
              <strong>{result.title}</strong>
              {result.excerpt ? <span>{result.excerpt}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
