import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Work } from "../api/client";
import type { components } from "../api/schema";
import BookCover from "./BookCover";
import { HardcoverRating } from "./BookReaderDetails";

type ReaderDetails = components["schemas"]["ReaderDetails"];

export function releaseIsAhead(
  releaseDate?: string | null,
  year?: number | null,
) {
  const today = new Date().toISOString().slice(0, 10);
  const dated =
    releaseDate && releaseDate.length >= 10 ? releaseDate.slice(0, 10) : null;
  if (dated) return dated > today;
  return typeof year === "number" && year > Number(today.slice(0, 4));
}

export function BookHero({
  title,
  providerBook,
  authors,
  work,
  cover,
  series,
  details,
  description,
  onAddToList,
  headingRef,
  authorFollow,
  children,
}: {
  providerBook?: { provider: string; external_id: string };
  title: string;
  authors: string[];
  work?: Work | null;
  cover?: string | null;
  caption?: string;
  eyebrow?: string;
  series?: ReactNode;
  details?: ReaderDetails;
  description?: string | null;
  onAddToList?: () => void;
  year?: number | null;
  language?: string | null;
  editions?: number;
  editionsMore?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Follow control shown beside the author name. */
  authorFollow?: ReactNode;
  children: ReactNode;
}) {
  const longTitle = title.length > 90;
  const colon = title.indexOf(": ");
  const splitTitle = longTitle && colon > 5 && colon < 90;
  const headline = splitTitle ? title.slice(0, colon) : title;
  const subtitle = splitTitle ? title.slice(colon + 2) : null;
  const blurb = description || work?.description || null;
  return (
    <header className="reader-hero book-detail-hero nn-book-card">
      <div className="reader-cover-wrap">
        <BookCover
          detail
          actions={false}
          title={title}
          providerBook={providerBook}
          cover={cover}
          work={work}
          rating={details?.rating}
        />
      </div>
      <div className="reader-hero-copy">
        {series}
        <div className="nn-book-title-row">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={longTitle && !splitTitle ? "reader-title-long" : undefined}
            title={title}
            aria-label={title}
          >
            {headline}
          </h1>
          {onAddToList && (
            <button
              type="button"
              className="nn-book-diamond"
              onClick={onAddToList}
              aria-label="Add to reading list"
              title="Add to reading list"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {subtitle && <p className="reader-subtitle">{subtitle}</p>}
        <div className="author-line nn-book-author">
          <span>Written by : </span>
          {authors.length
            ? authors.map((name, index) => (
                <span key={`${name}:${index}`}>
                  {index > 0 ? ", " : ""}
                  <Link
                    to={
                      details?.authors?.find(
                        (author) =>
                          author.name.toLocaleLowerCase() ===
                          name.toLocaleLowerCase(),
                      )
                        ? `/authors/hardcover/${details.authors.find((author) => author.name.toLocaleLowerCase() === name.toLocaleLowerCase())!.external_id}`
                        : `/search?q=${encodeURIComponent(name)}`
                    }
                  >
                    {name}
                  </Link>
                </span>
              ))
            : "Author unknown"}
          {authorFollow}
        </div>
        {work?.availability.audio && work.availability.primary_audio_narrators?.length ? (
          <p className="narrator-line">
            Narrated by {work.availability.primary_audio_narrators.join(", ")}
          </p>
        ) : null}
        <HardcoverRating details={details} />
        {blurb && <p className="nn-book-synopsis">{blurb}</p>}
        {children}
      </div>
    </header>
  );
}

export function BookOverview({
  description,
  subjects = [],
}: {
  description?: string | null;
  subjects?: string[];
}) {
  return (
    <section
      id="overview"
      className="reader-section"
      aria-labelledby="overview-heading"
    >
      <p className="eyebrow">BETWEEN THE COVERS</p>
      <h2 id="overview-heading">About this book</h2>
      <p className="reader-prose reader-synopsis">
        {description || "No synopsis is available for this book yet."}
      </p>
      {!!subjects.length && (
        <div className="status-row">
          {subjects.slice(0, 12).map((subject) => (
            <span className="status" key={subject}>
              {subject}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
