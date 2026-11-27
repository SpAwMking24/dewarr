import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Link } from "react-router-dom";
import { api, result, type Work } from "../api/client";
import { browseCache } from "../queryPolicies";
import BookCover from "./BookCover";

type CarouselEntry = {
  key: string;
  title: string;
  cover?: string | null;
  work?: Work | null;
  providerBook?: { provider: string; external_id: string };
  to: string;
  current?: boolean;
};

/** NovelNest-style horizontal shelf carousel below a book, with the selected book slightly larger. */
export default function RelatedCarousel({
  work,
  cover,
}: {
  work: Work;
  cover?: string | null;
}) {
  const related = useQuery({
    queryKey: ["discovery", "related", work.id],
    ...browseCache,
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      result(
        await api.GET("/api/discovery/related/{work_id}", {
          params: { path: { work_id: work.id } },
        }),
      ),
  });

  const primaryAuthor = work.authors[0] || "";
  const needsFallback =
    !related.isPending && (related.data?.items?.length || 0) < 3;

  const byAuthor = useQuery({
    queryKey: ["works", "carousel-author", primaryAuthor],
    enabled: needsFallback && !!primaryAuthor,
    staleTime: 60_000,
    queryFn: async () =>
      result(
        await api.GET("/api/catalog/works", {
          params: { query: { q: primaryAuthor, limit: 12 } },
        }),
      ),
  });

  const recentCatalog = useQuery({
    queryKey: ["works", "carousel-recent"],
    enabled: needsFallback,
    staleTime: 60_000,
    queryFn: async () =>
      result(
        await api.GET("/api/catalog/works", {
          params: { query: { limit: 12 } },
        }),
      ),
  });

  const seen = new Set<string>([work.id, work.title.toLowerCase()]);
  const others: CarouselEntry[] = [];

  for (const item of related.data?.items || []) {
    const id = item.work?.id || `${item.book.provider}:${item.book.external_id}`;
    if (seen.has(id) || seen.has(item.book.title.toLowerCase())) continue;
    seen.add(id);
    others.push({
      key: id,
      title: item.book.title,
      cover: item.book.cover_url,
      work: item.work,
      providerBook:
        item.book.external_id
          ? { provider: item.book.provider, external_id: item.book.external_id }
          : undefined,
      to: item.work
        ? `/books/${item.work.id}`
        : item.book.provider && item.book.external_id
          ? `/discover/books/${item.book.provider}/${encodeURIComponent(item.book.external_id)}`
          : `/search?q=${encodeURIComponent(item.book.title)}`,
    });
  }

  for (const list of [byAuthor.data?.items, recentCatalog.data?.items]) {
    for (const w of list || []) {
      if (others.length >= 10) break;
      if (seen.has(w.id) || seen.has(w.title.toLowerCase())) continue;
      seen.add(w.id);
      others.push({
        key: w.id,
        title: w.title,
        cover: w.cover_url,
        work: w,
        to: `/books/${w.id}`,
      });
    }
  }

  const currentEntry: CarouselEntry = {
    key: `current:${work.id}`,
    title: work.title,
    cover,
    work,
    to: `/books/${work.id}`,
    current: true,
  };

  // Place the selected book in the second slot when other books exist (matching NovelNest)
  const entries =
    others.length > 0
      ? [others[0], currentEntry, ...others.slice(1)]
      : [currentEntry];

  if (entries.length < 2 && related.isPending) return null;

  return (
    <section className="nn-carousel-section" aria-label="Related books">
      <div className="nn-carousel" role="list">
        {entries.map((entry) => (
          <Link
            key={entry.key}
            role="listitem"
            to={entry.to}
            aria-current={entry.current ? "page" : undefined}
            className={`nn-carousel-item${entry.current ? " is-current" : ""}`}
          >
            <div className="nn-carousel-cover">
              <BookCover
                title={entry.title}
                cover={entry.cover}
                work={entry.work}
                providerBook={entry.providerBook}
                actions={false}
              />
              {entry.current && work.availability.audio && (
                <span className="nn-carousel-play" aria-hidden="true">
                  <Play size={14} fill="currentColor" />
                </span>
              )}
            </div>
            <span className="nn-carousel-title" title={entry.title}>
              {entry.title}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
