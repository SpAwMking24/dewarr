import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Check,
  ChevronDown,
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
import {
  PLAYER_SLEEP_OPTIONS,
  PLAYER_SPEEDS,
  useAudioPlayer,
} from "./AudioPlayerContext";
import "../listen.css";

function fmtTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return `${h}h ${m}m left`;
  if (h) return `${h}h left`;
  return `${m}m left`;
}

type PopoverKind = "speed" | "sleep";

interface PopoverState {
  kind: PopoverKind;
  left: number;
  top: number;
}

function PlayerCover({
  src,
  title,
  className,
}: {
  src: string | null;
  title: string;
  className: string;
}) {
  if (src) {
    return <img className={className} src={src} alt="" />;
  }
  return (
    <div className={`${className} nn-p-faux`} aria-hidden="true">
      <span>{title.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function AudioPlayerUI() {
  const player = useAudioPlayer();
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [draggingBook, setDraggingBook] = useState<number | null>(null);
  const [draggingChapter, setDraggingChapter] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeChapterRef = useRef<HTMLLIElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setPopover(null);
    };
    const timer = window.setTimeout(
      () => document.addEventListener("pointerdown", onPointerDown, true),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [popover]);

  // Auto-scroll active chapter into view when Now Playing sheet opens
  useEffect(() => {
    if (player.sheetOpen) {
      window.setTimeout(() => {
        activeChapterRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }, 120);
    }
  }, [player.sheetOpen, player.chapterIndex]);

  if (!player.book) return null;

  const { book, playing, buffering, finished, sheetOpen, duration, speed, sleep, chapters, chapterIndex, chapterBounds } =
    player;
  const activeChapter = chapterIndex >= 0 ? chapters[chapterIndex] : null;
  const [chStart, chEnd] = chapterBounds;
  const chDuration = Math.max(0, chEnd - chStart);

  const displayTime = draggingBook ?? player.time;
  const displayChapterTime =
    draggingChapter !== null ? draggingChapter : Math.max(0, player.time - chStart);

  const bookFrac = duration > 0 ? Math.min(1, Math.max(0, displayTime / duration)) : 0;
  const chFrac =
    chDuration > 0 ? Math.min(1, Math.max(0, displayChapterTime / chDuration)) : 0;

  const rate = speed || 1;
  const bookRemaining = Math.max(0, (duration - displayTime) / rate);
  const chRemaining = Math.max(0, (chDuration - displayChapterTime) / rate);

  const sleepLabel =
    sleep.mode === -1
      ? "End of chapter"
      : sleep.mode > 0
        ? `${Math.max(1, Math.ceil((sleep.until - Date.now()) / 60_000))}m left`
        : "Sleep";

  const openPopover = (kind: PopoverKind, e: ReactMouseEvent<HTMLButtonElement>) => {
    if (popover?.kind === kind) {
      setPopover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const estW = 176;
    const estH = kind === "speed" ? 280 : 280;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - estW / 2),
      window.innerWidth - estW - 8,
    );
    const top =
      rect.top - estH - 10 > 8
        ? rect.top - estH - 10
        : Math.min(rect.bottom + 10, window.innerHeight - estH - 8);
    setPopover({ kind, left, top });
  };

  return (
    <>
      {/* Persistent floating mini player bar */}
      <div
        id="nn-player"
        className={`nn-player${playing ? " is-playing" : ""}${buffering ? " buffering" : ""}`}
        role="region"
        aria-label="Audiobook player"
      >
        <button
          type="button"
          className="nn-p-book"
          onClick={player.openSheet}
          aria-label="Open Now Playing"
        >
          <PlayerCover
            src={book.cover_url}
            title={book.title}
            className="nn-p-cover"
          />
          <span className="nn-p-text">
            <b>{book.title}</b>
            <small>
              {activeChapter ? activeChapter.title : book.authors.join(", ")}
            </small>
          </span>
        </button>

        <div className="nn-p-center">
          <div className="nn-p-controls">
            <button
              type="button"
              className="nn-p-btn"
              onClick={() => player.skip(-15)}
              aria-label="Back 15 seconds"
              title="Back 15s (←)"
            >
              <RotateCcw size={20} strokeWidth={1.8} />
              <span className="nn-p-skip-num">15</span>
            </button>
            <button
              type="button"
              className="nn-p-btn nn-p-play"
              onClick={player.toggle}
              aria-label={playing ? "Pause" : "Play"}
              title="Play / Pause (Space)"
            >
              {playing ? (
                <Pause size={19} fill="currentColor" strokeWidth={1.8} />
              ) : (
                <Play size={19} fill="currentColor" strokeWidth={1.8} />
              )}
            </button>
            <button
              type="button"
              className="nn-p-btn"
              onClick={() => player.skip(30)}
              aria-label="Forward 30 seconds"
              title="Forward 30s (→)"
            >
              <RotateCw size={20} strokeWidth={1.8} />
              <span className="nn-p-skip-num">30</span>
            </button>
          </div>
          <div className="nn-p-scrub">
            <span>{fmtTime(displayTime)}</span>
            <input
              type="range"
              className="nn-range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(bookFrac * 1000)}
              style={{ "--fill": `${bookFrac * 100}%` } as CSSProperties}
              aria-label="Book position"
              onChange={(e) => {
                const frac = Number(e.target.value) / 1000;
                setDraggingBook(frac * duration);
              }}
              onPointerUp={(e) => {
                const frac = Number((e.target as HTMLInputElement).value) / 1000;
                setDraggingBook(null);
                void player.seek(frac * duration);
              }}
              onKeyUp={(e) => {
                const frac = Number((e.target as HTMLInputElement).value) / 1000;
                setDraggingBook(null);
                void player.seek(frac * duration);
              }}
            />
            <span>-{fmtTime(bookRemaining)}</span>
          </div>
        </div>

        <div className="nn-p-right">
          <button
            type="button"
            className="nn-p-chip"
            title="Playback speed"
            onClick={(e) => openPopover("speed", e)}
          >
            <span>{speed}×</span>
          </button>
          <button
            type="button"
            className="nn-p-btn sm"
            title="Sleep timer"
            aria-label="Sleep timer"
            onClick={(e) => openPopover("sleep", e)}
          >
            <Moon size={18} strokeWidth={1.8} />
            {sleep.mode !== 0 && <i className="nn-p-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="nn-p-btn sm"
            title="Chapters & Now Playing"
            aria-label="Chapters"
            onClick={player.openSheet}
          >
            <List size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="nn-p-btn sm"
            title="Close player"
            aria-label="Close player"
            onClick={player.close}
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="nn-p-mini-progress" aria-hidden="true">
          <i style={{ width: `${bookFrac * 100}%` }} />
        </div>
      </div>

      {/* Full-screen Now Playing sheet */}
      <section
        id="nn-np"
        className={`nn-np${sheetOpen ? " open" : ""}${playing ? " is-playing" : ""}`}
        role="dialog"
        aria-modal={sheetOpen}
        aria-label="Now playing"
        aria-hidden={!sheetOpen}
      >
        <div className="nn-np-bg" aria-hidden="true">
          <div
            style={
              book.cover_url
                ? { backgroundImage: `url(${JSON.stringify(book.cover_url)})` }
                : undefined
            }
          />
        </div>

        <header className="nn-np-top">
          <button
            type="button"
            className="nn-p-btn"
            onClick={player.closeSheet}
            aria-label="Minimise player"
            title="Minimise (Esc)"
          >
            <ChevronDown size={24} strokeWidth={2} />
          </button>
          <span>Now playing</span>
          <button
            type="button"
            className="nn-p-chip"
            onClick={player.toggleFinished}
          >
            {finished ? (
              <>
                <Check size={14} strokeWidth={2.4} /> Finished
              </>
            ) : (
              "Mark finished"
            )}
          </button>
        </header>

        <div
          className={`nn-np-main${chapters.length > 0 ? " has-chapters" : ""}`}
        >
          <div className="nn-np-art">
            <PlayerCover
              src={book.cover_url}
              title={book.title}
              className="nn-np-cover"
            />
          </div>

          <div className="nn-np-info">
            <div className="nn-np-chapter">
              {activeChapter
                ? `Chapter ${chapterIndex + 1} of ${chapters.length} · ${activeChapter.title}`
                : ""}
            </div>
            <h2>{book.title}</h2>
            <div className="nn-np-by">{book.authors.join(", ")}</div>

            {player.error && (
              <div className="nn-np-error" role="alert">
                <span>{player.error}</span>
                <button
                  type="button"
                  onClick={player.clearError}
                  aria-label="Dismiss error"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="nn-np-scrub">
              {chapters.length > 0 ? (
                <>
                  <input
                    type="range"
                    className="nn-range big"
                    min={0}
                    max={1000}
                    step={1}
                    value={Math.round(chFrac * 1000)}
                    style={{ "--fill": `${chFrac * 100}%` } as CSSProperties}
                    aria-label="Chapter position"
                    onChange={(e) => {
                      const frac = Number(e.target.value) / 1000;
                      setDraggingChapter(frac * chDuration);
                    }}
                    onPointerUp={(e) => {
                      const frac =
                        Number((e.target as HTMLInputElement).value) / 1000;
                      setDraggingChapter(null);
                      void player.seek(chStart + frac * chDuration);
                    }}
                    onKeyUp={(e) => {
                      const frac =
                        Number((e.target as HTMLInputElement).value) / 1000;
                      setDraggingChapter(null);
                      void player.seek(chStart + frac * chDuration);
                    }}
                  />
                  <div className="nn-np-times">
                    <span>{fmtTime(displayChapterTime)}</span>
                    <span>-{fmtTime(chRemaining)}</span>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="range"
                    className="nn-range big"
                    min={0}
                    max={1000}
                    step={1}
                    value={Math.round(bookFrac * 1000)}
                    style={{ "--fill": `${bookFrac * 100}%` } as CSSProperties}
                    aria-label="Book position"
                    onChange={(e) => {
                      const frac = Number(e.target.value) / 1000;
                      setDraggingBook(frac * duration);
                    }}
                    onPointerUp={(e) => {
                      const frac =
                        Number((e.target as HTMLInputElement).value) / 1000;
                      setDraggingBook(null);
                      void player.seek(frac * duration);
                    }}
                    onKeyUp={(e) => {
                      const frac =
                        Number((e.target as HTMLInputElement).value) / 1000;
                      setDraggingBook(null);
                      void player.seek(frac * duration);
                    }}
                  />
                  <div className="nn-np-times">
                    <span>{fmtTime(displayTime)}</span>
                    <span>-{fmtTime(bookRemaining)}</span>
                  </div>
                </>
              )}
            </div>

            <div className="nn-np-controls">
              {chapters.length > 0 && (
                <button
                  type="button"
                  className="nn-p-btn"
                  onClick={player.prevChapter}
                  aria-label="Previous chapter"
                  title="Previous chapter"
                >
                  <SkipBack size={22} strokeWidth={1.8} />
                </button>
              )}
              <button
                type="button"
                className="nn-p-btn lg"
                onClick={() => player.skip(-15)}
                aria-label="Back 15 seconds"
                title="Back 15s"
              >
                <RotateCcw size={28} strokeWidth={1.6} />
                <span className="nn-p-skip-num lg">15</span>
              </button>
              <button
                type="button"
                className="nn-p-btn nn-p-play xl"
                onClick={player.toggle}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <Pause size={30} fill="currentColor" strokeWidth={1.8} />
                ) : (
                  <Play size={30} fill="currentColor" strokeWidth={1.8} />
                )}
              </button>
              <button
                type="button"
                className="nn-p-btn lg"
                onClick={() => player.skip(30)}
                aria-label="Forward 30 seconds"
                title="Forward 30s"
              >
                <RotateCw size={28} strokeWidth={1.6} />
                <span className="nn-p-skip-num lg">30</span>
              </button>
              {chapters.length > 0 && (
                <button
                  type="button"
                  className="nn-p-btn"
                  onClick={player.nextChapter}
                  aria-label="Next chapter"
                  title="Next chapter"
                >
                  <SkipForward size={22} strokeWidth={1.8} />
                </button>
              )}
            </div>

            <div className="nn-np-extras">
              <button
                type="button"
                className="nn-p-chip"
                onClick={(e) => openPopover("speed", e)}
              >
                <span>{speed}×</span> speed
              </button>
              <button
                type="button"
                className="nn-p-chip"
                onClick={(e) => openPopover("sleep", e)}
              >
                <Moon size={14} strokeWidth={2} />
                <span>{sleepLabel}</span>
              </button>
              {duration > 0 && (
                <span className="nn-np-left">
                  {fmtLeft(bookRemaining)} in book
                </span>
              )}
            </div>
          </div>

          {chapters.length > 0 && (
            <aside className="nn-np-chapters" aria-label="Chapters">
              <h4>
                Chapters <small>{chapters.length}</small>
              </h4>
              <ol>
                {chapters.map((ch) => {
                  const isOn = ch.index === chapterIndex;
                  return (
                    <li
                      key={`${ch.trackIndex}:${ch.start}:${ch.index}`}
                      ref={isOn ? activeChapterRef : undefined}
                      className={isOn ? "on" : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => void player.seek(ch.start, true)}
                      >
                        <span className="n">{ch.index + 1}</span>
                        <span className="t">{ch.title}</span>
                        <span className="d">
                          {fmtTime(Math.max(0, ch.end - ch.start))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>
          )}
        </div>
      </section>

      {/* Speed / Sleep Popover Menu */}
      {popover && (
        <div
          ref={menuRef}
          className="nn-p-menu"
          style={{ left: `${popover.left}px`, top: `${popover.top}px` }}
          role="menu"
        >
          {popover.kind === "speed"
            ? PLAYER_SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === speed ? "on" : undefined}
                  onClick={() => {
                    player.setSpeed(s);
                    setPopover(null);
                  }}
                >
                  <span>{s}×</span>
                  {s === speed && <Check size={15} strokeWidth={2.4} />}
                </button>
              ))
            : PLAYER_SLEEP_OPTIONS.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === sleep.mode ? "on" : undefined}
                  onClick={() => {
                    player.setSleep(mode);
                    setPopover(null);
                  }}
                >
                  <span>{label}</span>
                  {mode === sleep.mode && <Check size={15} strokeWidth={2.4} />}
                </button>
              ))}
        </div>
      )}
    </>
  );
}
