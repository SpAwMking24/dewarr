import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";
import { Check, Download, Plus } from "lucide-react";
import { api, ApiError, result } from "../api/client";
import type { components } from "../api/schema";

export type CatalogFollow = components["schemas"]["CatalogFollowView"];
export const followDefaults: components["schemas"]["FollowFilters"] = {
  compilations: false,
  box_sets: false,
  anthologies: false,
  non_main_series: false,
  coauthored: true,
  language: null,
};

export function useFollowing() {
  return useQuery({
    queryKey: ["following"],
    queryFn: async () => result(await api.GET("/api/following")),
    staleTime: 30_000,
  });
}

export default function FollowCatalog({
  kind,
  externalId,
  name,
  downloadAll = false,
}: {
  kind: "author" | "series";
  externalId: string;
  name: string;
  /** Offer "Download all"; only the author's own page does. */
  downloadAll?: boolean;
}) {
  const followedLink = useRef<HTMLAnchorElement>(null);
  const navigate = useNavigate();
  const downloadAllHref = (listId: string) =>
    "/following?list=" + listId + "&download=all";
  const cache = useQueryClient();
  const query = useFollowing();
  const mutationKey = ["follow-catalog", kind, externalId];
  const saving = useIsMutating({ mutationKey }) > 0;
  const existing = query.data?.find(
    (f) => f.source_kind === kind && f.external_id === externalId,
  );
  const follow = useMutation({
    mutationKey,
    mutationFn: async (_downloadAll?: boolean) =>
      result(
        await api.POST("/api/following", {
          body: {
            source_kind: kind,
            external_id: Number(externalId),
            name: name.slice(0, 200),
            filters: followDefaults,
          },
        }),
      ),
    onSuccess: (value, downloadAll?: boolean) => {
      if (downloadAll) navigate(downloadAllHref(value.list_id));
      cache.setQueryData<CatalogFollow[]>(["following"], (old) => [
        ...(old || []).filter((f) => f.list_id !== value.list_id),
        value,
      ]);
      void cache.invalidateQueries({ queryKey: ["following"] });
    },
  });
  useEffect(() => {
    if (follow.isSuccess) followedLink.current?.focus({ preventScroll: true });
  }, [follow.isSuccess]);
  const error = follow.error || query.error;
  const href = existing ? "/following?list=" + existing.list_id : "/following";
  return (
    <span className="catalog-follow-control">
      {existing ? (
        <Link
          ref={followedLink}
          className="reader-action-link"
          to={href}
          aria-label={"Manage following " + name}
        >
          <Check size={14} aria-hidden="true" /> Following
          {!existing.subscription.enabled ? " · Updates paused" : ""}
        </Link>
      ) : null}
      {downloadAll && existing && kind === "author" ? (
        <Link
          className="reader-action-link"
          to={downloadAllHref(existing.list_id)}
          aria-label={"Download all books by " + name}
        >
          <Download size={14} aria-hidden="true" /> Download all
        </Link>
      ) : null}
      {existing ? null : (
        <button
          type="button"
          className="primary"
          disabled={query.isPending || !!query.error || saving}
          onClick={() => follow.mutate(false)}
        >
          <Plus size={14} aria-hidden="true" />
          {saving
            ? "Following…"
            : kind === "author"
              ? "Follow author"
              : "Follow future additions"}
        </button>
      )}
      {downloadAll && !existing && kind === "author" ? (
        <button
          type="button"
          disabled={query.isPending || !!query.error || saving}
          onClick={() => follow.mutate(true)}
        >
          <Download size={14} aria-hidden="true" /> Follow and download all
        </button>
      ) : null}
      {follow.isSuccess && existing && (
        <span className="follow-feedback" role="status">
          Following {name}. <Link to={href}>View follow</Link>
        </span>
      )}
      {error && (
        <span className="follow-feedback" role="alert">
          {error.message}{" "}
          {error instanceof ApiError && error.status === 409 && !existing ? (
            <Link to="/metadata">Connection settings</Link>
          ) : null}
          {query.error && (
            <button type="button" onClick={() => query.refetch()}>
              Retry follow status
            </button>
          )}
        </span>
      )}
    </span>
  );
}

export function AuthorFollows({
  authors,
}: {
  authors: components["schemas"]["AuthorDetails"][];
}) {
  // Author-only provider contributions, never display-name matching.
  if (!authors.length) return null;
  if (authors.length === 1)
    return (
      <FollowCatalog
        kind="author"
        externalId={authors[0].external_id}
        name={authors[0].name}
      />
    );
  return (
    <details className="book-author-follows">
      <summary className="reader-action-link">Follow authors</summary>
      <ul>
        {authors.map((author) => (
          <li key={author.external_id}>
            <Link to={"/authors/hardcover/" + author.external_id}>
              {author.name}
            </Link>
            <FollowCatalog
              kind="author"
              externalId={author.external_id}
              name={author.name}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
