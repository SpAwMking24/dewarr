import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  List,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  fetchListenBook,
  parseListenPosition,
  saveListenProgress,
  type ListenBook,
} from "../api/reader";
import { Loading } from "../components";
import "../listen.css";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_MINUTES = [0, 15, 30, 45, 60];

function clock(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudiobookPlayer() {
  const { assetId = "" } = useParams();
  const book = useQuery({
    queryKey: ["listen-book", assetId],
    queryFn: ({ signal }) => fetchListenBook(assetId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (book.isPending) return <Loading />;
  if (book.error || !book.data)
    return (
      <div className="listen-page">
        <p role="alert">
          {book.error instanceof Error
            ? book.error.message
            : "Could not open this audiobook."}
        </p>
        <Link to="/library">Return to library</Link>
      </div>
    );
  return <Player book={book.data} />;
}

/** The player and its chapter list, shown on the book page in place of the tabs. */
export function EmbeddedAudiobook({
  assetId,
  onClose,
}: {
  assetId: string;
  onClose: () => void;
}) {
  const book = useQuery({
    queryKey: ["listen-book", assetId],
    queryFn: ({ signal }) => fetchListenBook(assetId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (book.isPending) return <Loading />;
  if (book.error || !book.data)
    return (
      <p role="alert">
        {book.error instanceof Error
          ? book.error.message
          : "Could not open this audiobook."}
      </p>
    );
  return <Player book={book.data} embedded onClose={onClose} />;
}

function Player({
  book,
  embedded = false,
  onClose,
}: {
  book: ListenBook;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const resume = useRef(parseListenPosition(book.progress?.cfi));
  const lastSave = useRef(0);
  const sleepTimer = useRef<number | null>(null);
  const [track, setTrack] = useState(
    Math.min(resume.current?.track ?? 0, book.tracks.length - 1),
  );
  const [time, setTime] = useState(resume.current?.seconds ?? 0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(
    () => Number(localStorage.getItem("dewarr:listen-speed")) || 1,
  );
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const current = book.tracks[track];
  const chapters = useMemo(
    () =>
      book.tracks.flatMap((item) =>
        item.chapters.length
          ? item.chapters.map((chapter) => ({ ...chapter, track: item.index }))
          : [
              {
                title: book.tracks.length > 1 ? item.filename : "Start",
                start: 0,
                end: item.duration,
                track: item.index,
              },
            ],
      ),
    [book.tracks],
  );
  const chapterNow = useMemo(() => {
    let found = chapters[0];
    for (const chapter of chapters) {
      if (
        chapter.track < track ||
        (chapter.track === track && chapter.start <= time + 0.25)
      )
        found = chapter;
    }
    return found;
  }, [chapters, track, time]);

  const totalDuration = book.tracks.reduce(
    (sum, item) => sum + (item.duration ?? 0),
    0,
  );
  const before = book.tracks
    .slice(0, track)
    .reduce((sum, item) => sum + (item.duration ?? 0), 0);
  const knownLength = totalDuration || duration;
  const overall = before + time;
  const fraction = knownLength > 0 ? Math.min(1, overall / knownLength) : 0;

  const save = useCallback(
    (keepalive = false) => {
      const el = audio.current;
      if (!el) return;
      void saveListenProgress(
        book.asset_id,
        {
          track,
          seconds: el.currentTime || 0,
          fraction,
          chapter: chapterNow?.title ?? null,
        },
        keepalive,
      );
    },
    [book.asset_id, track, fraction, chapterNow],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = speed;
    localStorage.setItem("dewarr:listen-speed", String(speed));
  }, [speed, track]);

  useEffect(() => {
    const flush = () => saveRef.current(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      if (sleepTimer.current) window.clearInterval(sleepTimer.current);
    };
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setTime(el.currentTime);
  }, []);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused)
      void el.play().catch(() => setError("Playback was blocked."));
    else el.pause();
  }, []);

  const goTo = useCallback(
    (nextTrack: number, seconds: number, autoplay: boolean) => {
      if (nextTrack === track) {
        seek(seconds);
        if (autoplay) void audio.current?.play();
        return;
      }
      resume.current = { track: nextTrack, seconds };
      setTrack(nextTrack);
      setTime(seconds);
      if (autoplay)
        audio.current?.addEventListener(
          "loadedmetadata",
          () => void audio.current?.play(),
          { once: true },
        );
    },
    [track, seek],
  );

  const jumpChapter = (direction: -1 | 1) => {
    const index = chapters.indexOf(chapterNow);
    if (direction === -1 && time - (chapterNow?.start ?? 0) > 3) {
      goTo(chapterNow.track, chapterNow.start, playing);
      return;
    }
    const next = chapters[index + direction];
    if (next) goTo(next.track, next.start, playing);
  };

  function startSleep(minutes: number) {
    if (sleepTimer.current) window.clearInterval(sleepTimer.current);
    sleepTimer.current = null;
    setSleepLeft(minutes * 60);
    if (!minutes) return;
    sleepTimer.current = window.setInterval(() => {
      setSleepLeft((left) => {
        if (left <= 1) {
          audio.current?.pause();
          if (sleepTimer.current) window.clearInterval(sleepTimer.current);
          sleepTimer.current = null;
          return 0;
        }
        return left - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapterNow?.title || book.title,
      artist: book.authors.join(", "),
      album: book.title,
      artwork: book.cover_url
        ? [{ src: book.cover_url, sizes: "512x512" }]
        : [],
    });
    const el = audio.current;
    navigator.mediaSession.setActionHandler("play", () => void el?.play());
    navigator.mediaSession.setActionHandler("pause", () => el?.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () =>
      seek((el?.currentTime ?? 0) - 15),
    );
    navigator.mediaSession.setActionHandler("seekforward", () =>
      seek((el?.currentTime ?? 0) + 30),
    );
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      jumpChapter(-1),
    );
    navigator.mediaSession.setActionHandler("nexttrack", () => jumpChapter(1));
  });

  const src = `/api/listen/assets/${book.asset_id}/tracks/${track}`;

  const chapterList = (
    <ol>
      {chapters.map((chapter, index) => (
        <li key={`${chapter.track}:${chapter.start}:${index}`}>
          <button
            type="button"
            aria-current={chapter === chapterNow ? "true" : undefined}
            onClick={() => {
              goTo(chapter.track, chapter.start, true);
              if (!embedded) setChaptersOpen(false);
            }}
          >
            <span>{chapter.title}</span>
            <small>{clock(chapter.start)}</small>
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className={embedded ? "listen-page listen-embedded" : "listen-page"}>
      {embedded && (
        <header className="listen-embedded-head">
          <strong>Listening</strong>
          <button type="button" onClick={onClose}>
            Close player
          </button>
        </header>
      )}
      {!embedded && (
        <header className="listen-top">
          <Link
            to={book.work_id ? `/books/${book.work_id}` : "/library"}
            className="listen-back"
          >
            <ArrowLeft size={18} aria-hidden /> Back
          </Link>
          <button
            type="button"
            className="listen-icon"
            aria-label="Chapters"
            aria-expanded={chaptersOpen}
            onClick={() => setChaptersOpen((open) => !open)}
          >
            <List size={18} aria-hidden />
          </button>
        </header>
      )}
      <main className="listen-main">
        {!embedded && book.cover_url && (
          <img className="listen-cover" src={book.cover_url} alt="" />
        )}
        {!embedded && <h1>{book.title}</h1>}
        {!embedded && (
          <p className="listen-authors">{book.authors.join(", ")}</p>
        )}
        <p className="listen-chapter" aria-live="polite">
          {chapterNow?.title}
        </p>
        {error && <p role="alert">{error}</p>}
        <audio
          key={track}
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const el = event.currentTarget;
            setDuration(el.duration);
            if (resume.current && resume.current.track === track) {
              el.currentTime = resume.current.seconds;
              resume.current = null;
            }
            el.playbackRate = speed;
            setError(null);
          }}
          onTimeUpdate={(event) => {
            const el = event.currentTarget;
            setTime(el.currentTime);
            if (Date.now() - lastSave.current > 15000) {
              lastSave.current = Date.now();
              saveRef.current();
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            saveRef.current();
          }}
          onEnded={() => {
            if (track + 1 < book.tracks.length) goTo(track + 1, 0, true);
            else saveRef.current();
          }}
          onError={() => {
            const fallback = `This audio file could not be played (${current?.format ?? "unknown"} format).`;
            void fetch(src, { headers: { Range: "bytes=0-0" } })
              .then(async (res) => {
                if (res.ok) return setError(fallback);
                const body = await res.json().catch(() => null);
                setError(body?.detail ?? `Server returned ${res.status}.`);
              })
              .catch(() => setError(fallback));
          }}
        />
        <input
          className="listen-seek"
          type="range"
          min={0}
          max={duration || current?.duration || 0}
          step={1}
          value={Math.min(time, duration || current?.duration || 0)}
          aria-label="Seek"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <div className="listen-times">
          <span>{clock(time)}</span>
          <span>{Math.round(fraction * 100)}% of book</span>
          <span>-{clock(Math.max(0, (duration || 0) - time))}</span>
        </div>
        <div className="listen-controls">
          <button
            type="button"
            aria-label="Previous chapter"
            onClick={() => jumpChapter(-1)}
          >
            <SkipBack size={22} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Back 15 seconds"
            onClick={() => seek(time - 15)}
          >
            <RotateCcw size={24} aria-hidden />
          </button>
          <button
            type="button"
            className="listen-play"
            aria-label={playing ? "Pause" : "Play"}
            onClick={toggle}
          >
            {playing ? (
              <Pause size={30} aria-hidden />
            ) : (
              <Play size={30} aria-hidden />
            )}
          </button>
          <button
            type="button"
            aria-label="Forward 30 seconds"
            onClick={() => seek(time + 30)}
          >
            <RotateCw size={24} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next chapter"
            onClick={() => jumpChapter(1)}
          >
            <SkipForward size={22} aria-hidden />
          </button>
        </div>
        <div className="listen-options">
          <label>
            Speed
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}x
                </option>
              ))}
            </select>
          </label>
          <label>
            <Moon size={14} aria-hidden /> Sleep
            <select
              value={sleepLeft ? "on" : "0"}
              onChange={(event) => startSleep(Number(event.target.value) || 0)}
            >
              <option value="0">
                {sleepLeft ? `${clock(sleepLeft)} left` : "Off"}
              </option>
              {SLEEP_MINUTES.filter(Boolean).map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
              {sleepLeft > 0 && <option value="0">Cancel</option>}
            </select>
          </label>
        </div>
      </main>
      {embedded ? (
        <aside className="listen-chapters-inline" aria-label="Chapters">
          <strong>Chapters</strong>
          {chapterList}
        </aside>
      ) : (
        chaptersOpen && (
          <aside className="listen-chapters" aria-label="Chapters">
            <div className="listen-chapters-head">
              <strong>Chapters</strong>
              <button
                type="button"
                className="listen-icon"
                aria-label="Close chapters"
                onClick={() => setChaptersOpen(false)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            {chapterList}
          </aside>
        )
      )}
    </div>
  );
}
