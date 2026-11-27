import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, result } from "../api/client";
import { browseCache } from "../queryPolicies";

const GENRES = [
  { slug: "romance", label: "Romance", bg: "linear-gradient(135deg, #9b2c4e, #661932)" },
  { slug: "mystery", label: "Mystery", bg: "linear-gradient(135deg, #4b478b, #2a2757)" },
  { slug: "fantasy", label: "Fantasy", bg: "linear-gradient(135deg, #1e605b, #113936)" },
  { slug: "science-fiction", label: "Sci-Fi", bg: "linear-gradient(135deg, #2551a8, #142f69)" },
  { slug: "crime", label: "Crime", bg: "linear-gradient(135deg, #756252, #473b31)" },
  { slug: "horror", label: "Horror", bg: "linear-gradient(135deg, #3c414f, #20232b)" },
  { slug: "thriller", label: "Thriller", bg: "linear-gradient(135deg, #872329, #4c1114)" },
  { slug: "history", label: "History", bg: "linear-gradient(135deg, #736835, #453d1d)" },
] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

type HighlightAuthor = {
  name: string;
  external_id?: string | null;
  image_url?: string | null;
};

function AuthorAvatar({ author }: { author: HighlightAuthor }) {
  const [failed, setFailed] = useState(false);
  const src =
    author.image_url && !failed
      ? `/api/catalog/cover-image?url=${encodeURIComponent(author.image_url)}`
      : null;
  return (
    <span className="nn-author-avatar" aria-hidden="true">
      {src ? (
        <img
          className="nn-author-photo"
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(author.name)
      )}
    </span>
  );
}

/** NovelNest-style Authors avatar strip and 4x2 coloured Genre tiles. */
export default function DiscoverHighlights() {
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

  const items = trending.data?.items || [];
  const seen = new Map<string, HighlightAuthor>();
  for (const item of items) {
    const profiles = item.book.author_profiles || [];
    for (const profile of profiles) {
      const name = profile.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        if (seen.size >= 8) break;
        seen.set(key, {
          name,
          external_id: profile.external_id,
          image_url: profile.image_url,
        });
      } else {
        if (!existing.external_id && profile.external_id) {
          existing.external_id = profile.external_id;
        }
        if (!existing.image_url && profile.image_url) {
          existing.image_url = profile.image_url;
        }
      }
    }
    for (const raw of item.book.authors || []) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        if (seen.size >= 8) break;
        seen.set(key, { name });
      }
    }
  }
  const authors = Array.from(seen.values()).slice(0, 8);

  function coverForGenre(slug: string, idx: number) {
    const token = slug.replace(/-/g, " ");
    const match = items.find((i) =>
      i.book.genres.some((g) => g.toLowerCase().includes(token)),
    );
    return match?.book.cover_url || items[idx % Math.max(1, items.length)]?.book.cover_url || null;
  }

  return (
    <div className="nn-highlights">
      {authors.length > 0 && (
        <section className="nn-section" aria-label="Featured authors">
          <div className="nn-section-head">
            <h2>Authors</h2>
            <Link className="shelf-action" to="/discover?view=browse">
              view all
            </Link>
          </div>
          <div className="nn-authors">
            {authors.map((author) => (
              <Link
                key={author.name}
                className="nn-author"
                to={
                  author.external_id
                    ? `/authors/hardcover/${encodeURIComponent(author.external_id)}`
                    : `/search?q=${encodeURIComponent(author.name)}`
                }
              >
                <AuthorAvatar author={author} />
                <span className="nn-author-name">{author.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="nn-section" aria-label="Browse genres">
        <div className="nn-section-head">
          <h2>Genres</h2>
          <Link className="shelf-action" to="/discover?view=browse">
            view all
          </Link>
        </div>
        <div className="nn-genres">
          {GENRES.map((genre, idx) => {
            const cover = coverForGenre(genre.slug, idx);
            return (
              <Link
                key={genre.slug}
                className="nn-genre-tile"
                style={{ background: genre.bg }}
                to={`/discover?view=browse&genre=${encodeURIComponent(genre.slug)}`}
              >
                <span className="nn-genre-label">{genre.label}</span>
                {cover ? (
                  <img
                    className="nn-genre-cover"
                    src={cover}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="nn-genre-placeholder" aria-hidden="true" />
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
