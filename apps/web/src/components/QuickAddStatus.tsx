import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { components } from "../api/schema";

export default function QuickAddStatus({
  receipt,
  starting,
}: {
  receipt?: components["schemas"]["QuickAddView"];
  workId?: string;
  starting?: string;
}) {
  const active =
    !!starting || ["queued", "running"].includes(receipt?.status || "");
  const held =
    !starting &&
    ["held", "failed", "cancelled"].includes(receipt?.status || "");
  const checks = receipt?.source_checks || [];
  const failure = [
    receipt?.message,
    ...checks.flatMap((check) => check.reasons),
  ].join(" ");
  const routeProblem =
    held &&
    /download route|download client|downloader|qBittorrent|SABnzbd|import destination|library destination/i.test(
      failure,
    );
  const noMatch =
    held &&
    /no (eligible|automatic|matching) release|no results|title and author/i.test(
      failure,
    );
  const owned = !!receipt?.message?.startsWith("Already available");
  const queued =
    !starting &&
    !active &&
    !held &&
    !owned &&
    /queued/i.test(receipt?.message || "");
  const message = starting
    ? "Submitting your request. Search progress will appear here."
    : active
      ? "Finding the best match using your saved preferences."
      : routeProblem
        ? "Check your download client and library folder settings, then try again."
        : noMatch
          ? "No matching download found for one or more requested formats. Your request is saved."
          : held
            ? "Open downloads to see what needs attention."
            : receipt?.message;
  const Icon = active ? LoaderCircle : held ? CircleAlert : CircleCheck;
  return (
    <section
      className="quick-add-status"
      data-tone={held ? "review" : active ? "active" : "success"}
      aria-label="Download progress"
    >
      <div
        className="quick-add-status-heading"
        role="status"
        aria-live="polite"
      >
        <Icon
          size={17}
          aria-hidden
          className={active ? "source-download-spinner" : undefined}
        />
        <strong>
          {starting
            ? starting
            : active
              ? "Finding your download"
              : held
                ? noMatch
                  ? "No matching download found yet"
                  : "Download paused"
                : owned
                  ? "In library"
                  : queued
                    ? "Downloading"
                    : "Queued"}
        </strong>
      </div>
      <p>{message}</p>
      {queued && (
        <p className="muted">
          It will be added to your library automatically when it finishes.
        </p>
      )}
      <div
        className="quick-add-status-actions"
        role="group"
        aria-label="Download actions"
      >
        {routeProblem && (
          <Link to="/settings#downloaders">Check download settings</Link>
        )}
        <Link
          to={
            receipt?.request_id
              ? `/requests#request-${receipt.request_id}`
              : "/requests"
          }
        >
          View downloads
        </Link>
      </div>
    </section>
  );
}
