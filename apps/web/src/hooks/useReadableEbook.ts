import { useQuery } from "@tanstack/react-query";
import { fetchWorkEbook } from "../api/reader";

/** The best readable ebook asset the signed-in user can open for a work. */
export function useReadableEbook(workId?: string, owned?: boolean) {
  return useQuery({
    queryKey: ["work-ebook", workId],
    enabled: !!workId && !!owned,
    queryFn: ({ signal }) => fetchWorkEbook(workId!, signal),
    staleTime: 60_000,
    retry: false,
  });
}
