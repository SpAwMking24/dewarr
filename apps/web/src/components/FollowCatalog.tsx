import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import ListPolicy from "../pages/ListPolicy";
import { BookOpen, Check, Download, Headphones, Plus } from "lucide-react";
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
}: {
  kind: "author" | "series";
  externalId: string;
  name: string;
}) {
  const followedButton = useRef<HTMLButtonElement>(null);
  const cache = useQueryClient();
  const query = useFollowing();
  const mutationKey = ["follow-catalog", kind, externalId];
  const saving = useIsMutating({ mutationKey }) > 0;
  const existing = query.data?.find(
    (f) => f.source_kind === kind && f.external_id === externalId,
  );
  const follow = useMutation({
    mutationKey,
    mutationFn: async () =>
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
    onSuccess: (value) => {
      cache.setQueryData<CatalogFollow[]>(["following"], (old) => [
        ...(old || []).filter((f) => f.list_id !== value.list_id),
        value,
      ]);
      void cache.invalidateQueries({ queryKey: ["following"] });
    },
  });
  const unfollow = useMutation({
    mutationKey,
    mutationFn: async (listId: string) =>
      result(
        await api.DELETE("/api/following/{list_id}", {
          params: { path: { list_id: listId } },
        }),
      ),
    onSuccess: (_value, listId) => {
      cache.setQueryData<CatalogFollow[]>(["following"], (old) =>
        (old || []).filter((f) => f.list_id !== listId),
      );
      void cache.invalidateQueries({ queryKey: ["following"] });
    },
  });
  useEffect(() => {
    if (follow.isSuccess)
      followedButton.current?.focus({ preventScroll: true });
  }, [follow.isSuccess]);
  const error = follow.error || unfollow.error || query.error;
  return (
    <span className="catalog-follow-control">
      {existing ? (
        <button
          ref={followedButton}
          type="button"
          className="reader-action-link following-toggle"
          disabled={saving}
          onClick={() => unfollow.mutate(existing.list_id)}
          aria-label={"Unfollow " + name}
          title={"Unfollow " + name}
        >
          <Check size={14} aria-hidden="true" />
          {unfollow.isPending
            ? "Unfollowing…"
            : existing.subscription.enabled
              ? "Following"
              : "Following · Updates paused"}
        </button>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={query.isPending || !!query.error || saving}
          onClick={() => follow.mutate()}
        >
          <Plus size={14} aria-hidden="true" />
          {saving
            ? "Following…"
            : kind === "author"
              ? "Follow author"
              : "Follow future additions"}
        </button>
      )}
      {follow.isSuccess && existing && (
        <span className="follow-feedback" role="status">
          Following {name}.
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

export function DownloadAllChoice({
  externalId,
  name,
}: {
  externalId: string;
  name: string;
}) {
  const cache = useQueryClient();
  const query = useFollowing();
  const follow = query.data?.find(
    (f) => f.source_kind === "author" && f.external_id === externalId,
  );
  const create = useMutation({
    mutationKey: ["follow-catalog", "author", externalId],
    mutationFn: async () =>
      result(
        await api.POST("/api/following", {
          body: {
            source_kind: "author",
            external_id: Number(externalId),
            name: name.slice(0, 200),
            filters: followDefaults,
          },
        }),
      ),
    onSuccess: (value) => {
      cache.setQueryData<CatalogFollow[]>(["following"], (old) => [
        ...(old || []).filter((f) => f.list_id !== value.list_id),
        value,
      ]);
      void cache.invalidateQueries({ queryKey: ["following"] });
    },
  });
  const [medium, setMedium] = useState<"ebook" | "audio" | "both" | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const live = useQuery({
    queryKey: ["following"],
    queryFn: async () => result(await api.GET("/api/following")),
    enabled: !!listId,
    refetchInterval: 1500,
  });
  const current = live.data?.find((f) => f.list_id === (listId || ""));
  const ready =
    !!current &&
    current.subscription.enabled &&
    current.subscription.completeness === "verified-observation";
  const disabled = query.isPending || !!query.error || create.isPending;
  if (done)
    return (
      <span className="follow-feedback" role="status">
        Added to your requests. <Link to="/requests">View requests</Link>
      </span>
    );
  const start = async (value: "ebook" | "audio" | "both") => {
    setFailed(false);
    setMedium(value);
    try {
      setListId(follow?.list_id || (await create.mutateAsync()).list_id);
    } catch {
      setMedium(null);
      setFailed(true);
    }
  };
  return (
    <div
      className="download-all-bar"
      role="group"
      aria-label={"Download all books by " + name}
    >
      {medium === null ? (
        <>
          <span className="download-all-label">
            <Download size={14} aria-hidden="true" />
            Download all
          </span>
          <div className="download-all-buttons">
            <button
              type="button"
              className="download-all-btn"
              disabled={disabled}
              onClick={() => void start("ebook")}
            >
              <BookOpen size={13} aria-hidden="true" />
              Ebooks
            </button>
            <button
              type="button"
              className="download-all-btn"
              disabled={disabled}
              onClick={() => void start("audio")}
            >
              <Headphones size={13} aria-hidden="true" />
              Audiobooks
            </button>
            <button
              type="button"
              className="download-all-btn download-all-btn-both"
              disabled={disabled}
              onClick={() => void start("both")}
            >
              Both
            </button>
          </div>
        </>
      ) : ready && listId ? (
        <ListPolicy
          key={listId + medium}
          listId={listId}
          follow
          downloadAll
          medium={medium}
          onActivated={() => setDone(true)}
        />
      ) : (
        <span className="download-all-status" role="status">
          Checking the author's books…
        </span>
      )}
      {failed && (
        <span className="follow-feedback" role="alert">
          Could not start. Try again.
        </span>
      )}
    </div>
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
