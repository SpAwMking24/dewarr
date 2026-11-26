import { useQuery } from "@tanstack/react-query";
import { api, result, type Auth } from "../api/client";

export type MediaProgress = { ebook?: number; audio?: number };

/**
 * Live download progress (0 to 1) per work and medium. One shared query
 * serves every cover on the page.
 */
export function useDownloadProgress(workId?: string | null) {
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const query = useQuery({
    queryKey: ["download-progress"],
    enabled: !!session && !!workId,
    retry: false,
    staleTime: 2000,
    refetchInterval: (q) =>
      Object.keys(q.state.data || {}).length ? 3000 : 12_000,
    queryFn: async () => {
      const page = result(
        await api.GET("/api/requests", {
          params: { query: { status: "downloading", limit: 100 } },
        }),
      );
      const byWork: Record<string, MediaProgress> = {};
      for (const request of page.items) {
        for (const target of request.targets) {
          if (typeof target.progress !== "number" || target.progress >= 1)
            continue;
          const medium =
            target.slot === "audio"
              ? "audio"
              : target.slot === "ebook"
                ? "ebook"
                : null;
          if (!medium) continue;
          byWork[request.work_id] = {
            ...byWork[request.work_id],
            [medium]: Math.max(0, Math.min(1, target.progress)),
          };
        }
      }
      return byWork;
    },
  });
  return workId ? query.data?.[workId] : undefined;
}
