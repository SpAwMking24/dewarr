import ContentSkeleton from "../components/ContentSkeleton";
import { AuthorFollows } from "../components/FollowCatalog";
import QuickAdd from "../components/QuickAdd";
import { EmbeddedAudiobook } from "./AudiobookPlayer";
import BookGrouping from "../components/BookGrouping";
import PartSets from "../components/CombineParts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Headphones } from "lucide-react";
import {
  Link,
  Navigate,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, result } from "../api/client";
import { fetchWorkEbook } from "../api/reader";
import { useListenableAudio } from "../hooks/useListenableAudio";
import {
  BookHero,
  releaseIsAhead,
} from "../components/BookPresentation";
import FollowRelease, { useReleaseWatch } from "../components/FollowRelease";
import BookReaderDetails, {
  useLocalBookMetadata,
  useReaderDetails,
} from "../components/BookReaderDetails";
import { LibraryAssets } from "./MyLibrary";
import { Loading, Notice } from "../components";
import BookMetadata from "./BookMetadata";
import WorkMerge from "./WorkMerge";
import Wanted, { type WantedVersion } from "./Wanted";
import ListChoice from "./ListChoice";
import BookDownloads from "../components/BookDownloads";
import BookDetailsStatus from "../components/BookDetailsStatus";
import BookDialog from "../components/BookDialog";
import CatalogEditions from "../components/CatalogEditions";
const BookSources = lazy(() => import("./BookSources"));
import RelatedCarousel from "../components/RelatedCarousel";
const tabs = [
  ["overview", "Overview"],
  ["library", "Library copies"],
  ["editions", "Editions"],
  ["authors", "Authors"],
  ["reviews", "Reviews"],
  ["downloads", "Downloads"],
] as const;

export default function BookDetail({
  canEdit,
  admin,
}: {
  canEdit: boolean;
  admin: boolean;
}) {
  const { id = "" } = useParams();
  return <BookDetailContent key={id} id={id} canEdit={canEdit} admin={admin} />;
}
function BookDetailContent({
  id,
  canEdit,
  admin,
}: {
  id: string;
  canEdit: boolean;
  admin: boolean;
}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const legacy =
    location.hash.slice(1) === "library-copies"
      ? "library"
      : location.hash.slice(1);
  const selected = params.get("tab") || legacy || "overview";
  // Sources live inside the Downloads tab; ?tab=sources opens the release list there.
  const releasesOpen = selected === "sources";
  const tab = releasesOpen
    ? "downloads"
    : selected === "manage" || tabs.some(([key]) => key === selected)
      ? selected
      : "overview";
  const cache = useQueryClient();
  const [action, setAction] = useState<"request" | "list" | null>(null);
  const [listening, setListening] = useState(false);
  const [listId, setListId] = useState("");
  const [wantedVersion, setWantedVersion] = useState<WantedVersion | null>(
    null,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const book = useQuery({
    queryKey: ["work", id],
    queryFn: async () =>
      result(
        await api.GET("/api/catalog/works/{work_id}", {
          params: { path: { work_id: id } },
        }),
      ),
    staleTime: 0,
    gcTime: 10 * 60_000,
    refetchInterval: 15_000,
  });
  const metadata = useLocalBookMetadata(id);
  const acceptedHardcover = metadata.data?.sources.find(
    (item) => item.provider === "hardcover",
  );
  const match = useQuery({
    queryKey: ["work-reader-match", id],
    enabled: !!metadata.data && !acceptedHardcover,
    queryFn: async () =>
      result(
        await api.GET("/api/metadata/works/{work_id}/reader-match", {
          params: { path: { work_id: id } },
        }),
      ),
    staleTime: (query) =>
      query.state.data?.status === "pending" ? 0 : 300_000,
    retry: false,
  });
  const matchedBook = !acceptedHardcover ? match.data?.book : undefined;
  const source =
    acceptedHardcover ||
    (matchedBook
      ? {
          provider: matchedBook.provider,
          external_id: matchedBook.external_id,
          book: matchedBook,
          cover_url: matchedBook.cover_url,
          series: matchedBook.series,
        }
      : metadata.data?.sources[0]);
  const hardcover = acceptedHardcover || (matchedBook ? source : undefined);
  const matching = !!metadata.data && !acceptedHardcover && match.isPending;
  const community = useReaderDetails(hardcover?.external_id);
  const provider = useQuery({
    queryKey: ["provider-book", source?.provider, source?.external_id],
    enabled: !!source && !matchedBook,
    queryFn: async () =>
      result(
        await api.GET("/api/metadata/books/{provider}/{external_id}", {
          params: {
            path: {
              provider: source!.provider,
              external_id: source!.external_id,
            },
          },
        }),
      ),
    staleTime: 300_000,
    retry: false,
  });
  const add = useMutation({
    mutationFn: async () =>
      result(
        await api.POST("/api/lists/{list_id}/entries", {
          params: { path: { list_id: listId } },
          body: { work_id: id },
        }),
      ),
    onSuccess: () => {
      cache.invalidateQueries({ queryKey: ["lists"] });
    },
  });
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [book.data?.id]);
  const watch = useReleaseWatch(
    book.data?.id,
    !!book.data &&
      releaseIsAhead(community.data?.release_date, book.data.publication_year),
  );
  const watching =
    watch.data?.state === "waiting" || watch.data?.state === "wanted";
  const readableEbook = useQuery({
    queryKey: ["work-ebook", id],
    enabled: !!book.data?.availability.ebook,
    queryFn: ({ signal }) => fetchWorkEbook(id, signal),
    staleTime: 60_000,
    retry: false,
  });
  const listenableAudio = useListenableAudio(id, book.data?.availability.audio);
  if (book.isPending) return <ContentSkeleton kind="book" />;
  if (book.error || !book.data) return <Notice error={book.error} />;
  const work = book.data;
  if (work.id !== id)
    return (
      <Navigate
        to={`/books/${work.id}${location.search}${location.hash}`}
        replace
      />
    );
  // Display accepted provider details when local fields are empty, preserving explicit edits.
  const locked = (field: string) =>
    (metadata.data?.fields[field] as { locked?: boolean } | undefined)?.locked;
  const description =
    work.description?.trim() ||
    (locked("description")
      ? work.description
      : provider.data?.book?.description || source?.book?.description);
  const year =
    work.publication_year ??
    (locked("publication_year")
      ? null
      : provider.data?.book?.publication_year ||
        source?.book?.publication_year);
  const unreleased = releaseIsAhead(community.data?.release_date, year);
  const cover = locked("cover_url")
    ? undefined
    : provider.data?.book?.cover_url || source?.cover_url;
  const series = source?.series || [];
  const request = (version: WantedVersion) => {
    setWantedVersion(version);
    setAction("request");
  };
  const href = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    return `/books/${id}?${next}`;
  };
  return (
    <article
      className={`reader-page catalog-reader catalog-workspace ${["sources", "downloads", "manage"].includes(tab) ? "reader-operational" : ""}`}
    >
      <BookHero
        title={work.title}
        authors={work.authors}
        work={work}
        cover={cover}
        description={description}
        onAddToList={
          canEdit
            ? () => {
                add.reset();
                setAction("list");
              }
            : undefined
        }
        details={community.data}
        headingRef={heading}
        authorFollow={
          canEdit && !!community.data?.authors?.length ? (
            <AuthorFollows authors={community.data.authors} />
          ) : undefined
        }
        series={
          !!series.length && (
            <div className="reader-series">
              {series.map((item) =>
                source?.provider === "hardcover" ? (
                  <Link
                    key={item.external_id}
                    to={`/series/hardcover/${item.external_id}`}
                  >
                    {item.name}
                    {item.position ? ` · Book ${item.position}` : ""}
                  </Link>
                ) : (
                  <span key={item.external_id}>{item.name}</span>
                ),
              )}
            </div>
          )
        }
      >
        <div className="reader-actions nn-book-actions">
          {listenableAudio.data && (
            <button
              type="button"
              className="nn-pill-btn"
              aria-pressed={listening}
              onClick={() => setListening((open) => !open)}
            >
              <Headphones size={16} aria-hidden="true" />
              {listenableAudio.data.progress &&
              listenableAudio.data.progress.fraction > 0.01
                ? `Play Audio · ${Math.round(listenableAudio.data.progress.fraction * 100)}%`
                : "Play Audio"}
            </button>
          )}
          {readableEbook.data && (
            <Link
              className="nn-pill-btn"
              to={`/read/${readableEbook.data.asset_id}`}
            >
              <BookOpen size={16} aria-hidden="true" />
              {readableEbook.data.progress &&
              readableEbook.data.progress.fraction > 0.01
                ? `Continue Reading · ${Math.round(readableEbook.data.progress.fraction * 100)}%`
                : "Start Reading"}
            </Link>
          )}
          {canEdit &&
            (unreleased ? (
              <FollowRelease
                canEdit={canEdit}
                following={watching}
                workId={work.id}
                idleLabel="Request on release day"
                activeLabel="Waiting for release"
                body={{
                  work_id: work.id,
                  provider: hardcover ? "hardcover" : null,
                  external_id: hardcover?.external_id,
                  title: work.title,
                  authors: work.authors,
                  cover_url: cover,
                  release_date: community.data?.release_date,
                  basis: community.data?.release_date ? "work" : "unknown",
                }}
              />
            ) : (
              <QuickAdd
                workId={work.id}
                owned={{
                  ebook: !!work.availability.ebook,
                  audio: !!work.availability.audio,
                }}
              />
            ))}
        </div>
      </BookHero>
      {tab === "manage" && (
        <BookDetailsStatus
          reason={match.data?.reason}
          workId={id}
          error={
            metadata.error ||
            (!acceptedHardcover ? match.error : null) ||
            provider.error ||
            community.error
          }
          unmatched={
            !acceptedHardcover &&
            match.data?.status === "unmatched" &&
            !match.error
          }
          busy={
            metadata.isFetching ||
            match.isFetching ||
            provider.isFetching ||
            community.isFetching
          }
          retry={() => {
            if (metadata.error) metadata.refetch();
            if (!acceptedHardcover && match.error) match.refetch();
            if (source && provider.error) provider.refetch();
            if (hardcover && community.error) community.refetch();
          }}
        />
      )}
      {listening && listenableAudio.data ? (
        <EmbeddedAudiobook
          assetId={listenableAudio.data.asset_id}
          onClose={() => setListening(false)}
        />
      ) : tab === "overview" ? (
        <RelatedCarousel work={work} cover={cover} />
      ) : (
        <div
          id="book-tab-panel"
          role="tabpanel"
          aria-label={tab === "manage" ? "Book metadata" : "Book section"}
          tabIndex={0}
        >
            {tab === "library" && (
              <section className="book-tab-section">
                <div className="book-tab-heading">
                  <h2>Library copies</h2>
                </div>
                <div className="button-row" aria-label="Library formats">
                  <Link to={href("library")} state={location.state}>
                    All formats
                  </Link>
                  {work.availability.ebook && (
                    <Link to={`${href("library")}&format=ebook`}>Ebooks</Link>
                  )}
                  {work.availability.audio && (
                    <Link to={`${href("library")}&format=audio`}>
                      Audiobooks
                    </Link>
                  )}
                </div>
                {admin && <PartSets workId={id} />}
                <LibraryAssets
                  key={params.get("format") || "any"}
                  workId={id}
                  admin={admin}
                  compact
                  medium={
                    params.get("format") === "audio"
                      ? "audio"
                      : params.get("format") === "ebook"
                        ? "ebook"
                        : "any"
                  }
                />
              </section>
            )}
            {tab === "editions" && (
              <CatalogEditions
                admin={admin}
                work={work}
                readerBook={matchedBook}
                request={canEdit ? request : undefined}
              />
            )}
            {(tab === "authors" || tab === "reviews") &&
              (matching ? (
                <Loading />
              ) : hardcover ? (
                <BookReaderDetails
                  canEdit={canEdit}
                  externalId={hardcover.external_id}
                  section={tab}
                />
              ) : (
                <section className="book-tab-section">
                  <h2>
                    {tab === "authors" ? "About the authors" : "Reader reviews"}
                  </h2>
                  <p className="muted">
                    Match this book to Hardcover to show{" "}
                    {tab === "authors"
                      ? "author biographies"
                      : "ratings and reviews"}{" "}
                    here.
                  </p>
                  <Link to={href("manage")}>Book metadata →</Link>
                </section>
              ))}
            {tab === "downloads" && releasesOpen && (
              <section
                className="book-tab-section"
                aria-label="Download sources"
              >
                <Suspense fallback={<Loading />}>
                  <BookSources
                    key={`${id}:${params.get("request") || ""}`}
                    work={work}
                    canAcquire={canEdit}
                  />
                </Suspense>
              </section>
            )}
            {tab === "downloads" && (
              <BookDownloads
                workId={id}
                otherReleases={
                  canEdit && !releasesOpen && !unreleased
                    ? `/books/${id}?${new URLSearchParams({ tab: "sources", releaseAll: "1" })}`
                    : undefined
                }
              />
            )}
            {tab === "manage" && (
              <section className="book-tab-section book-management">
                <BookMetadata work={work} admin={admin} toolsOnly />
                <BookGrouping work={work} admin={admin} />
                {admin && (
                  <details className="book-management-advanced">
                    <summary>Merge a duplicate book</summary>
                    <WorkMerge work={work} />
                  </details>
                )}
              </section>
            )}
        </div>
      )}
      {canEdit && action && (
        <BookDialog
          title={action === "list" ? "Add to reading list" : "Request book"}
          close={() => setAction(null)}
        >
          {action === "request" ? (
            <Wanted
              key={wantedVersion?.id || id}
              workId={wantedVersion?.work_id || id}
              version={wantedVersion}
              clearVersion={() => setWantedVersion(null)}
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                add.mutate();
              }}
            >
              <h2>Add to a reading list</h2>
              <p className="muted book-dialog-book-title">{work.title}</p>
              <ListChoice
                value={listId}
                label="Reading list"
                disabled={add.isPending}
                onChange={(value) => {
                  setListId(value);
                  add.reset();
                }}
              />
              <Notice error={add.error} />
              <button className="primary" disabled={!listId || add.isPending}>
                Add to list
              </button>
              {add.isSuccess && (
                <p className="success" role="status">
                  Added to your list.
                </p>
              )}
            </form>
          )}
        </BookDialog>
      )}
    </article>
  );
}
