import { BookOpen, Headphones } from "lucide-react";
import { Link } from "react-router-dom";
import type { Work } from "../api/client";
import { useReadableEbook } from "../hooks/useReadableEbook";
import { useListenableAudio } from "../hooks/useListenableAudio";

export default function LibraryFormatBadges({ work }: { work: Work }) {
  const readable = useReadableEbook(work.id, work.availability.ebook);
  const listenable = useListenableAudio(work.id, work.availability.audio);
  const readHref = readable.data ? `/read/${readable.data.asset_id}` : null;
  return (
    <>
      {(["ebook", "audio"] as const).map((medium) => {
        if (!work.availability[medium]) return null;
        const count =
          work.availability[
            medium === "audio" ? "audio_versions" : "ebook_versions"
          ] || 1;
        const stale =
          work.availability[medium === "audio" ? "audio_stale" : "ebook_stale"];
        const Icon = medium === "audio" ? Headphones : BookOpen;
        const name = medium === "audio" ? "Audiobook" : "Ebook";
        const openHref =
          medium === "ebook"
            ? readHref
            : listenable.data
              ? `/listen/${listenable.data.asset_id}`
              : null;
        const label = (
          <>
            <Icon size={15} aria-hidden="true" /> {name}
          </>
        );
        return (
          <span
            className="status owned"
            key={medium}
            title={`${count} ${name.toLowerCase()} ${count === 1 ? "version" : "versions"} in your library`}
          >
            {openHref ? (
              <Link
                className="format-open"
                to={openHref}
                aria-label={`${medium === "audio" ? "Listen to" : "Read"} ${work.title} in Dewarr`}
              >
                {label}
              </Link>
            ) : (
              label
            )}
            {stale && <small>Last known</small>}
            {count > 1 && (
              <Link
                className="version-count"
                to={`/books/${work.id}?tab=library&format=${medium}`}
                aria-label={`View ${count - 1} additional ${name.toLowerCase()} ${count === 2 ? "version" : "versions"}`}
              >
                +{count - 1}
              </Link>
            )}
          </span>
        );
      })}
    </>
  );
}
