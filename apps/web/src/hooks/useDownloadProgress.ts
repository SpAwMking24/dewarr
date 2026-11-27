import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, result, type Auth } from "../api/client";

export type MediaProgress = {
  ebook?: number;
  audio?: number;
  pending?: boolean;
};

type ProgressMap = {
  byWork: Record<string, MediaProgress>;
  byTitle: Record<string, MediaProgress>;
};

const ACTIVE_ATTEMPTS = new Set([
  "queued",
  "preflight",
  "submitting",
  "uncertain",
  "downloading",
]);

function normaliseTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

const pendingWorks = new Set<string>();
const pendingTitles = new Set<string>();
const listeners = new Set<() => void>();
let pendingVersion = 0;

function notifyPending() {
  pendingVersion += 1;
  for (const listener of listeners) listener();
}

function subscribePending(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPendingVersion() {
  return pendingVersion;
}

export function setPendingDownload(
  active: boolean,
  workId?: string | null,
  title?: string | null,
) {
  let changed = false;
  if (workId) {
    if (active && !pendingWorks.has(workId)) {
      pendingWorks.add(workId);
      changed = true;
    } else if (!active && pendingWorks.delete(workId)) {
      changed = true;
    }
  }
  const key = title ? normaliseTitle(title) : "";
  if (key) {
    if (active && !pendingTitles.has(key)) {
      pendingTitles.add(key);
      changed = true;
    } else if (!active && pendingTitles.delete(key)) {
      changed = true;
    }
  }
  if (changed) notifyPending();
}

/**
 * Live download progress (0 to 1) per work and medium. One shared query
 * serves every cover on the page, matching by work id or normalised title.
 */
export function useDownloadProgress(
  workId?: string | null,
  title?: string | null,
) {
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const query = useQuery<ProgressMap>({
    queryKey: ["download-progress"],
    enabled: !!session && (!!workId || !!title),
    retry: false,
    staleTime: 2000,
    refetchInterval: (q) =>
      Object.keys(q.state.data?.byWork || {}).length ? 2500 : 6000,
    queryFn: async () => {
      const page = result(
        await api.GET("/api/requests", {
          params: { query: { status: "downloading", limit: 100 } },
        }),
      );
      const byWork: Record<string, MediaProgress> = {};
      const byTitle: Record<string, MediaProgress> = {};
      for (const request of page.items) {
        const key = request.work_title
          ? normaliseTitle(request.work_title)
          : "";
        for (const target of request.targets) {
          if (target.state === "satisfied" || target.state === "cancelled")
            continue;
          const medium =
            target.slot === "audio"
              ? "audio"
              : target.slot === "ebook" || target.slot === "either"
                ? "ebook"
                : null;
          if (!medium) continue;
          let value: number | null = null;
          if (typeof target.progress === "number") {
            value = Math.max(0, Math.min(1, target.progress));
          } else if (
            (target.attempt_state &&
              ACTIVE_ATTEMPTS.has(target.attempt_state)) ||
            (target.import_state &&
              target.import_state !== "imported" &&
              target.import_state !== "failed")
          ) {
            value = 0;
          }
          if (value === null) continue;
          byWork[request.work_id] = {
            ...byWork[request.work_id],
            [medium]: value,
          };
          if (key) {
            byTitle[key] = {
              ...byTitle[key],
              [medium]: value,
            };
          }
        }
      }
      return { byWork, byTitle };
    },
  });
  useSyncExternalStore(subscribePending, getPendingVersion);
  const key = title ? normaliseTitle(title) : "";
  const isPending =
    (!!workId && pendingWorks.has(workId)) || (!!key && pendingTitles.has(key));
  const server =
    (workId && query.data?.byWork[workId]) ||
    (key ? query.data?.byTitle[key] : undefined);
  if (server) return isPending ? { ...server, pending: true } : server;
  if (isPending) return { pending: true };
  return undefined;
}
