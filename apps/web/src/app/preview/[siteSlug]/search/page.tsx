import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicData, queryValue } from "../../../public-server-data";

type SearchResult = {
  query: string;
  results: Array<{
    id: string;
    type: "article" | "page" | "category";
    title: string;
    excerpt: string;
    path: string;
  }>;
};

export const metadata: Metadata = {
  title: "Поиск",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { siteSlug } = await params;
  const query = queryValue((await searchParams).q)?.trim() ?? "";
  const response =
    query.length >= 2
      ? await loadPublicData<SearchResult>(
          `/api/public/sites/${encodeURIComponent(siteSlug)}/search?q=${encodeURIComponent(query)}`,
        )
      : null;

  return (
    <main className="public-search-page">
      <Link href={`/preview/${siteSlug}`} className="public-search-back">
        ← На главную
      </Link>
      <section>
        <small>ПОИСК ПО САЙТУ</small>
        <h1>Поиск</h1>
        <form>
          <input
            type="search"
            name="q"
            minLength={2}
            maxLength={100}
            required
            defaultValue={query}
            placeholder="Введите запрос"
          />
          <button>Найти</button>
        </form>
      </section>
      {response?.ok ? (
        <section className="public-search-results">
          <h2>Результаты: {response.data.results.length}</h2>
          {response.data.results.map((item) => (
            <article key={`${item.type}-${item.id}`}>
              <small>
                {item.type === "article"
                  ? "СТАТЬЯ"
                  : item.type === "category"
                    ? "КАТЕГОРИЯ"
                    : "СТРАНИЦА"}
              </small>
              <h3>
                <Link href={`/preview/${siteSlug}${item.path}`}>
                  {item.title}
                </Link>
              </h3>
              {item.excerpt ? <p>{item.excerpt}</p> : null}
            </article>
          ))}
          {!response.data.results.length ? (
            <p>По вашему запросу ничего не найдено.</p>
          ) : null}
        </section>
      ) : response ? (
        <p className="public-search-error">Поиск временно недоступен.</p>
      ) : null}
    </main>
  );
}
