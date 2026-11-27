import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Download, Headphones } from "lucide-react";
import { Link } from "react-router-dom";
import { api, result, type Auth } from "../api/client";
import type { components } from "../api/schema";
import { canStartDownload } from "../permissions";
import { randomUUID } from "../randomUUID";
import BookCover from "./BookCover";
import BookLink from "./BookLink";

type Book = components["schemas"]["BookData"];
type Work = components["schemas"]["WorkView"];

const sourceNames: Record<string, string> = {
  hardcover: "Hardcover",
  openlibrary: "Open Library",
  audible: "Audible",
  custom: "Custom catalogue",
};

/** Audible recordings cannot be added directly; find the matching catalogue book. */
async function catalogueWork(book: Book): Promise<string> {
  let target: { provider: "hardcover" | "openlibrary" | "custom"; id: string };
  if (book.provider === "audible") {
    const q = `${book.title} ${(book.authors || [])[0] || ""}`.trim();
    const found = result(
      await api.GET("/api/metadata/search", {
        params: { query: { q, page: 1, provider: "automatic" } },
      }),
    ).items.find((item) => item.provider !== "audible");
    if (!found)
      throw new Error("No matching catalogue entry. Open the book to choose.");
    target = { provider: found.provider as never, id: found.external_id };
  } else if (
    book.provider === "hardcover" ||
    book.provider === "openlibrary" ||
    book.provider === "custom"
  )
    target = { provider: book.provider, id: book.external_id };
  else throw new Error("Open this book to choose a catalogue edition.");
  return result(
    await api.POST("/api/metadata/books/{provider}/{external_id}/import", {
      params: { path: { provider: target.provider, external_id: target.id } },
    }),
  ).id;
}

export default function SearchResultRow({
  book,
  known,
  format,
  to,
  state,
}: {
  book: Book;
  known?: Work;
  format: "ebook" | "audio";
  to: string;
  state?: unknown;
}) {
  const cache = useQueryClient();
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const allowed =
    !!session &&
    canStartDownload(session.user.permissions, session.user.role, format);
  const key = useRef(randomUUID());
  const [workId, setWorkId] = useState(known?.id);
  const have = known?.availability?.[format];
  const add = useMutation({
    mutationFn: async () => {
      const work = workId || (await catalogueWork(book));
      setWorkId(work);
      return result(
        await api.POST("/api/requests/quick-add", {
          params: { header: { "idempotency-key": key.current } },
          body: { work_id: work, specification: { mode: format } },
        }),
      );
    },
    onSuccess: () => {
      key.current = randomUUID();
      for (const name of ["requests", "activity", "downloads", "works"])
        void cache.invalidateQueries({ queryKey: [name] });
    },
  });
  const Icon = format === "audio" ? Headphones : BookOpen;
  const quality = [
    book.publication_year,
    book.language && book.language.toUpperCase(),
  ].filter(Boolean);
  return (
    <BookLink
      aria-label={`View ${book.title}`}
      className="result-row"
      to={to}
      state={state}
    >
      <div className="result-cover">
        <BookCover
          title={book.title}
          cover={book.cover_url}
          work={known}
          providerBook={book}
          actions={false}
        />
      </div>
      <div className="result-text">
        <strong>{book.title}</strong>
        <span>{(book.authors || []).join(", ") || "Author unknown"}</span>
        <small>
          <span className="result-kind">
            <Icon size={13} aria-hidden="true" />
            {format === "audio" ? "Audiobook" : "E-book"}
          </span>
          {quality.length > 0 && <span>{quality.join(" · ")}</span>}
          <span>{sourceNames[book.provider] || book.provider}</span>
        </small>
        {add.error && (
          <small className="result-error" role="alert">
            {add.error.message}
          </small>
        )}
      </div>
      <div className="result-action">
        {have ? (
          <span className="result-state owned">
            <Check size={15} aria-hidden="true" /> In library
          </span>
        ) : add.isSuccess ? (
          <Link
            className="result-state"
            to={
              add.data.request_id
                ? `/requests#request-${add.data.request_id}`
                : "/requests"
            }
          >
            <Check size={15} aria-hidden="true" /> Queued
          </Link>
        ) : allowed ? (
          <button
            type="button"
            className="hero-button solid"
            disabled={add.isPending}
            onClick={() => add.mutate()}
          >
            <Download size={16} aria-hidden="true" />
            {add.isPending ? "Adding…" : add.error ? "Retry" : "Download"}
          </button>
        ) : null}
      </div>
    </BookLink>
  );
}
