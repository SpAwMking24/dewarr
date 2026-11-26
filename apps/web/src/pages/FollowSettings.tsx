import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, result } from "../api/client";
import type { components } from "../api/schema";
import { Loading, Notice } from "../components";
import { randomUUID } from "../randomUUID";
import ListPolicy from "./ListPolicy";
import { FilterFields } from "../components/FollowFilters";
import ActivityRequests from "./ActivityRequests";
import type { Auth } from "../api/client";

type Follow = components["schemas"]["CatalogFollowView"];
type Filters = components["schemas"]["FollowFilters"];
const defaults: Filters = {
  compilations: false,
  box_sets: false,
  anthologies: false,
  non_main_series: false,
  coauthored: true,
  language: null,
};

export default function FollowSettings() {
  const [params, setParams] = useSearchParams();
  const cache = useQueryClient();
  const [filters, setFilters] = useState<Filters>(defaults);
  const kind = params.get("kind");
  const externalId = params.get("externalId");
  const name = params.get("name") || "";
  const query = useQuery({
    queryKey: ["following"],
    queryFn: async () => result(await api.GET("/api/following")),
    refetchInterval: (q) =>
      q.state.data?.some((f) =>
        ["queued", "running"].includes(f.subscription.state),
      )
        ? 1500
        : 30_000,
  });
  const create = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/following", {
          body: {
            source_kind: kind as "author" | "series",
            external_id: Number(externalId),
            name: name.slice(0, 200),
            filters,
          },
        }),
      ),
    onSuccess: (value) => {
      void cache.invalidateQueries({ queryKey: ["following"] });
      setParams({ list: value.list_id });
    },
  });
  const existing = query.data?.find(
    (f) => f.source_kind === kind && f.external_id === externalId,
  );
  const current =
    query.data?.find((f) => f.list_id === params.get("list")) || existing;
  return (
    <section className="reader-page">
      <Link className="back-link" to="/following">
        ← Back to following
      </Link>
      <h1>Manage following</h1>
      <p>
        Follow authors and series. Future books only is the default; no existing
        books are requested without a reviewed selection.
      </p>
      <Notice error={query.error || create.error} />
      {query.isPending ? <Loading /> : null}
      {query.error && (
        <button onClick={() => query.refetch()}>Retry following</button>
      )}
      {!query.isPending && !query.error && params.has("list") && !current && (
        <p className="notice">
          This follow is no longer available.{" "}
          <Link to="/following">Return to following</Link>
        </p>
      )}
      {(kind === "author" || kind === "series") && externalId && !existing ? (
        <form
          className="panel editor"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h2>Follow {name}</h2>
          <FilterFields value={filters} change={setFilters} />
          <p>
            First we verify the complete catalog. Then choose Browse, Manual or
            Automatic, media, and a download profile. Include back catalog by
            selecting up to 25 current books in the policy preview.
          </p>
          <button className="primary" disabled={create.isPending}>
            Follow and preview catalog
          </button>
        </form>
      ) : null}
      {query.data?.length === 0 && !kind ? (
        <p>Open an author or series page and choose Follow to get started.</p>
      ) : null}
      {current ? (
        <FollowEditor
          key={`${current.list_id}:${current.subscription.generation}`}
          follow={current}
        />
      ) : null}
    </section>
  );
}

function FollowEditor({ follow }: { follow: Follow }) {
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const downloadAll = params.get("download") === "all";
  const session = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const admin = session.data?.user.role === "admin";
  const filters = follow.filters;
  const [offset, setOffset] = useState(0);
  const path = { list_id: follow.list_id };
  const changed = () => {
    for (const key of [
      "following",
      "follow-observations",
      "list-policy",
      "list-policy-books",
      "list-policy-selected",
      "list-books",
    ])
      void cache.invalidateQueries({ queryKey: [key] });
  };
  const edit = useMutation({
    mutationFn: async (enabled: boolean) =>
      result(
        await api.PATCH("/api/following/{list_id}", {
          params: { path },
          body: {
            expected_generation: follow.subscription.generation,
            enabled,
            filters,
          },
        }),
      ),
    onSuccess: changed,
  });
  const unfollow = useMutation({
    mutationFn: async () =>
      result(
        await api.DELETE("/api/following/{list_id}", { params: { path } }),
      ),
    onSuccess: () => {
      changed();
      setParams({});
    },
  });
  const sync = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/lists/{list_id}/subscription/sync", {
          params: { path, header: { "idempotency-key": randomUUID() } },
        }),
      ),
    onSuccess: changed,
  });
  const observations = useQuery({
    queryKey: [
      "follow-observations",
      follow.list_id,
      follow.subscription.last_success_at,
      offset,
    ],
    queryFn: async () =>
      result(
        await api.GET("/api/lists/{list_id}/subscription/observations", {
          params: { path, query: { offset, limit: 50 } },
        }),
      ),
  });
  const exclude = useMutation({
    mutationFn: async (book: { id: string; excluded: boolean }) =>
      result(
        await api.PATCH(
          "/api/lists/{list_id}/subscription/observations/{observation_id}",
          {
            params: { path: { ...path, observation_id: book.id } },
            body: { excluded: !book.excluded },
          },
        ),
      ),
    onSuccess: changed,
  });
  const ready =
    follow.subscription.enabled &&
    follow.subscription.completeness === "verified-observation";
  return (
    <article className="follow-settings">
      <h2>{follow.name}</h2>
      <Link
        to={`/${follow.source_kind === "author" ? "authors" : "series"}/hardcover/${follow.external_id}`}
      >
        Open {follow.source_kind}
      </Link>
      <p role="status">{follow.subscription.message}</p>
      <p>
        {follow.subscription.observed_count} observed ·{" "}
        {follow.subscription.excluded_count} excluded by you
      </p>
      <Notice
        error={
          edit.error ||
          unfollow.error ||
          sync.error ||
          observations.error ||
          exclude.error
        }
      />
      <p className="muted">
        Pausing or resuming catalog updates pauses downloads. Review download
        settings before activating them again.
      </p>
      <div className="button-row">
        <button
          disabled={edit.isPending}
          onClick={() => edit.mutate(!follow.subscription.enabled)}
        >
          {follow.subscription.enabled ? "Pause follow" : "Resume follow"}
        </button>
        <button
          disabled={sync.isPending || !follow.subscription.enabled}
          onClick={() => sync.mutate()}
        >
          Refresh catalog
        </button>
        <button disabled={unfollow.isPending} onClick={() => unfollow.mutate()}>
          Unfollow
        </button>
      </div>
      <p className="muted">
        Unfollowing keeps your library books and exclusions. Independently
        requested books stay requested.
      </p>
      <Link to="/settings#notifications">Notification settings</Link>
      {downloadAll && ready ? (
        <ListPolicy
          key={`${follow.list_id}:${follow.subscription.last_success_at}`}
          listId={follow.list_id}
          follow
          downloadAll
          onActivated={() => setParams({ list: follow.list_id })}
        />
      ) : !ready ? (
        <p>
          Downloads stay paused until the author's complete catalogue is
          verified.
          {downloadAll
            ? " Download all will start once the author's books have loaded."
            : ""}
        </p>
      ) : (
        <div className="button-row">
          <button
            className="primary"
            onClick={() => setParams({ list: follow.list_id, download: "all" })}
          >
            Download all missing books
          </button>
        </div>
      )}
      <section
        className="follow-progress"
        aria-label={`${follow.name} requests`}
      >
        <h3>Progress</h3>
        <ActivityRequests
          canManage
          admin={admin}
          status="all"
          sort="newest"
          q={follow.name}
        />
        <p>
          <Link to={`/requests?q=${encodeURIComponent(follow.name)}`}>
            All requests for {follow.name}
          </Link>
        </p>
      </section>
      <section className="panel editor">
        <h3>Books and exclusions</h3>
        <div className="button-row">
          {offset > 0 ? (
            <button onClick={() => setOffset(Math.max(0, offset - 50))}>
              Previous books
            </button>
          ) : null}
          {offset + 50 < (observations.data?.total || 0) ? (
            <button onClick={() => setOffset(offset + 50)}>Next books</button>
          ) : null}
        </div>
        {observations.data?.items.map((book) => (
          <article className="source-attribution" key={book.id}>
            <div>
              {book.work_id ? (
                <Link to={`/books/${book.work_id}`}>{book.title}</Link>
              ) : (
                <strong>{book.title}</strong>
              )}
              <p>
                {book.excluded
                  ? "Excluded by you"
                  : book.filter_reason ||
                    (book.present ? "Included" : "No longer listed")}
              </p>
              <button
                disabled={exclude.isPending}
                onClick={() => exclude.mutate(book)}
              >
                {book.excluded ? "Remove exclusion" : "Exclude book"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </article>
  );
}
