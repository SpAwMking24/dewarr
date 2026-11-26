import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, result } from "../api/client";
import type { components } from "../api/schema";

type Filters = components["schemas"]["FollowFilters"];
type Follow = components["schemas"]["CatalogFollowView"];

export function FilterFields({
  value,
  change,
}: {
  value: Filters;
  change: (value: Filters) => void;
}) {
  const labels = {
    compilations: "Include compilations",
    box_sets: "Include box sets",
    anthologies: "Include anthologies",
    non_main_series: "Include non-main-series titles",
    coauthored: "Include co-authored books",
  } as const;
  return (
    <fieldset>
      <legend>Books to include</legend>
      {Object.entries(labels).map(([key, label]) => (
        <label className="check-label" key={key}>
          <input
            type="checkbox"
            checked={value[key as keyof typeof labels] ?? false}
            onChange={(e) => change({ ...value, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        Edition language (optional)
        <input
          value={value.language || ""}
          placeholder="en"
          pattern="[a-z]{2}"
          maxLength={2}
          onChange={(e) =>
            change({ ...value, language: e.target.value.toLowerCase() || null })
          }
        />
      </label>
      <p className="muted">
        Use a two-letter language code. Books without a matching edition are
        excluded. Collection filters use Hardcover series flags, titles and
        tags.
      </p>
    </fieldset>
  );
}

/** Edit which of an author's books a follow includes. */
export function FollowFilterEditor({ follow }: { follow: Follow }) {
  const cache = useQueryClient();
  const [filters, setFilters] = useState<Filters>(follow.filters);
  const edit = useMutation({
    mutationFn: async () =>
      result(
        await api.PATCH("/api/following/{list_id}", {
          params: { path: { list_id: follow.list_id } },
          body: {
            expected_generation: follow.subscription.generation,
            enabled: follow.subscription.enabled,
            filters,
          },
        }),
      ),
    onSuccess: () => {
      for (const key of [
        "following",
        "follow-observations",
        "list-policy",
        "list-policy-books",
        "list-policy-selected",
        "list-books",
      ])
        void cache.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <details className="follow-filter-editor">
      <summary>Edit follow filters</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          edit.mutate();
        }}
      >
        <FilterFields value={filters} change={setFilters} />
        <p>
          Saving pauses acquisition until you review a fresh policy preview.
          Exclusions are preserved.
        </p>
        {edit.error && <p role="alert">{edit.error.message}</p>}
        <button disabled={edit.isPending}>Save filters and refresh</button>
      </form>
    </details>
  );
}
