import { useQuery } from "@tanstack/react-query";
import { fetchWorkAudio } from "../api/reader";

/** The best playable audiobook asset the signed-in user can open for a work. */
export function useListenableAudio(workId?: string, owned?: boolean) {
  return useQuery({
    queryKey: ["work-audio", workId],
    enabled: !!workId && !!owned,
    queryFn: ({ signal }) => fetchWorkAudio(workId!, signal),
    staleTime: 60_000,
    retry: false,
  });
}
