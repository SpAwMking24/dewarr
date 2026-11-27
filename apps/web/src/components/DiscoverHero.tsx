import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, Calendar, Headphones, Plus, Sparkles, Star } from "lucide-react";
import { api, result } from "../api/client";
import BookCover from "./BookCover";
import { browseCache } from "../queryPolicies";

/** Two large featured cards drawn from the trending shelf, in the NovelNest style. */
export default function DiscoverHero() {
  const trending = useQuery({
    queryKey: ["discover-hero"],
    ...browseCache,
    staleTime: 300_000,
    retry: false,
    queryFn: async ({ signal }) =>
      result(
        await api.GET("/api/discovery/hardcover/{shelf}", {
          signal,
          params: { path: { shelf: "trending" }, query: { page: 1 } },
        }),
      ),
  });
  const picks = (trending.data?.items || []).slice(0, 2);
  if (!picks.length) return null;
  return (
    <section className="hero-row" aria-label="Featured books">
      {picks.map((item, index) => {
        const book = item.book;
        const to = item.work
          ? `/books/${item.work.id}`
          : book.provider && book.external_id
            ? `/discover/books/${book.provider}/${encodeURIComponent(book.external_id)}`
            : `/search?q=${encodeURIComponent(book.title)}`;
        const summary =
          item.work?.description ||
          item.reason ||
          (book.genres.length
            ? `Featured in ${book.genres.slice(0, 3).join(", ")}.`
            : "Popular with readers right now.");
        return (
          <article
            className="hero-card"
            key={`${book.provider}:${book.external_id}:${index}`}
          >
            <div className="hero-copy">
              <h2>
                <Link to={to}>{book.title}</Link>
                {book.rating ? (
                  <span className="hero-rating">
                    <Star size={11} fill="currentColor" aria-hidden />{" "}
                    {Number(book.rating).toFixed(1)}
                  </span>
                ) : null}
              </h2>
              <p className="hero-author">
                Written by : {book.authors.join(", ") || "Author unknown"}
              </p>
              <div className="hero-meta">
                {book.publication_year && (
                  <span>
                    <Calendar size={12} aria-hidden /> {book.publication_year}
                  </span>
                )}
                {book.genres.slice(0, 2).map((g) => (
                  <span key={g}>
                    <Sparkles size={12} aria-hidden /> {g}
                  </span>
                ))}
              </div>
              <div className="hero-desc">
                <strong>Description</strong>
                <p>{summary}</p>
              </div>
              <div className="hero-actions">
                <Link className="hero-button solid" to={to}>
                  <Headphones size={15} aria-hidden />
                  Get this book
                </Link>
                <Link
                  className="hero-button"
                  to={`/search?q=${encodeURIComponent(book.title)}`}
                >
                  <BookOpen size={15} aria-hidden />
                  Find downloads
                </Link>
                <Link
                  className="hero-diamond"
                  to={to}
                  aria-label={`Open ${book.title}`}
                  title="Open book details"
                >
                  <Plus size={14} aria-hidden />
                </Link>
              </div>
            </div>
            <Link
              className="hero-cover"
              to={to}
              aria-label={`View ${book.title}`}
            >
              <span className="hero-ribbon">Trending</span>
              <BookCover
                title={book.title}
                providerBook={
                  book.external_id
                    ? { provider: book.provider, external_id: book.external_id }
                    : undefined
                }
                cover={book.cover_url}
                actions={false}
              />
            </Link>
          </article>
        );
      })}
    </section>
  );
}
