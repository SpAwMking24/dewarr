import { lazy, Suspense } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ContentSkeleton from "../components/ContentSkeleton";
import { useRequestCounts } from "../hooks/useRequestCounts";
import { requestFilter, type RequestFilter } from "./requestFilters";

const SavedRequests = lazy(() => import("./ActivityRequests"));

/** Four places a request can be: waiting on you, on its way, done, or closed. */
const filters: { id: RequestFilter; title: string }[] = [
  { id: "attention", title: "Needs you" },
  { id: "all", title: "In progress" },
  { id: "library", title: "In library" },
  { id: "closed", title: "Closed" },
];

/** Older links (and bookmarks) still open, under the tab they now belong to. */
function tabFor(status: RequestFilter): RequestFilter {
  if (status === "pending" || status === "review") return "attention";
  if (status === "downloading" || status === "open") return "all";
  if (status === "declined" || status === "withdrawn") return "closed";
  return status;
}

export default function Requests({
  admin,
  canRequest,
  canApprove,
}: {
  admin: boolean;
  canRequest: boolean;
  canApprove: boolean;
}) {
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const selected = requestFilter(hash, params.get("status"));
  const sort = params.get("sort") === "title" ? "title" : "newest";
  const counts = useRequestCounts().data;
  const attention =
    (canApprove ? (counts?.pending ?? 0) : 0) +
    (admin ? (counts?.review ?? 0) : 0);
  const status =
    (selected === "review" && !admin) || (selected === "pending" && !canApprove)
      ? "all"
      : selected;

  function queryFor(nextStatus: RequestFilter, nextSort = sort) {
    const next = new URLSearchParams(search);
    if (nextStatus === "all") next.delete("status");
    else next.set("status", nextStatus);
    if (nextSort === "newest") next.delete("sort");
    else next.set("sort", nextSort);
    const query = next.toString();
    return query ? `/requests?${query}` : "/requests";
  }

  const cleared = new URLSearchParams(search);
  cleared.delete("q");
  return (
    <div className="requests-page">
      <h1 className="workspace-title">Requests</h1>
      <div className="page-tabs-bar">
        <nav className="page-tabs" aria-label="Request filters">
          {filters.map((filter) => (
            <Link
              key={filter.id}
              aria-label={filter.title}
              to={queryFor(filter.id)}
              aria-current={tabFor(status) === filter.id ? "page" : undefined}
            >
              {filter.title}
              {filter.id === "attention" && attention > 0 && (
                <span className="requests-tab-count">{attention}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="page-tabs-tools">
          <label className="request-sort">
            <span className="sr-only">Sort</span>
            <select
              aria-label="Sort requests"
              value={sort}
              onChange={(event) =>
                navigate(
                  queryFor(
                    status,
                    event.target.value === "title" ? "title" : "newest",
                  ),
                )
              }
            >
              <option value="newest">Newest</option>
              <option value="title">Title</option>
            </select>
          </label>
          {admin && (
            <Link className="button-link" to="/organization/inspections">
              Import local files
            </Link>
          )}
          <Link className="button-link primary" to="/discover">
            Find books
          </Link>
        </div>
      </div>
      <form
        className="request-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(search);
          const q = String(
            new FormData(event.currentTarget).get("q") || "",
          ).trim();
          if (q) next.set("q", q);
          else next.delete("q");
          navigate(`/requests?${next}`);
        }}
      >
        <input
          type="search"
          name="q"
          aria-label="Search requests"
          placeholder="Search requests by title or author…"
          defaultValue={params.get("q") || ""}
          key={params.get("q") || ""}
          maxLength={200}
        />
        {params.get("q") && (
          <Link to={`/requests?${cleared}`}>Clear search</Link>
        )}
      </form>
      <Suspense fallback={<ContentSkeleton />}>
        <SavedRequests
          canManage={canRequest}
          admin={admin}
          status={status}
          sort={sort}
          q={params.get("q") || ""}
        />
      </Suspense>
    </div>
  );
}
