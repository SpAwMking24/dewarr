import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchListenBook,
  parseListenPosition,
  saveListenProgress,
  type ListenBook,
} from "../api/reader";

export const PLAYER_SPEEDS = [
  0.75, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2, 2.5, 3,
] as const;

export const PLAYER_SLEEP_OPTIONS: ReadonlyArray<[number, string]> = [
  [0, "Off"],
  [5, "5 minutes"],
  [15, "15 minutes"],
  [30, "30 minutes"],
  [45, "45 minutes"],
  [60, "1 hour"],
  [-1, "End of chapter"],
];

const SAVE_EVERY_MS = 10_000;
const SPEED_STORAGE_KEY = "dewarr:listen-speed";

export interface UnifiedChapter {
  index: number;
  title: string;
  start: number;
  end: number;
  trackIndex: number;
}

export interface TrackSpan {
  index: number;
  offset: number;
  duration: number;
  format: string;
  filename: string;
}

export interface SleepState {
  /** 0 = off, >0 = minutes timer, -1 = end of chapter */
  mode: number;
  /** epoch ms when timer expires (for mode > 0) */
  until: number;
}

export interface AudioPlayerContextValue {
  book: ListenBook | null;
  loading: boolean;
  error: string | null;
  playing: boolean;
  buffering: boolean;
  finished: boolean;
  sheetOpen: boolean;
  time: number;
  duration: number;
  speed: number;
  sleep: SleepState;
  tracks: TrackSpan[];
  chapters: UnifiedChapter[];
  chapterIndex: number;
  chapterBounds: [number, number];
  openBook: (
    assetId: string,
    options?: { autoplay?: boolean; openSheet?: boolean },
  ) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number, shouldPlay?: boolean) => Promise<void>;
  skip: (deltaSeconds: number) => void;
  prevChapter: () => void;
  nextChapter: () => void;
  setSpeed: (rate: number) => void;
  setSleep: (mode: number) => void;
  toggleFinished: () => void;
  openSheet: () => void;
  closeSheet: () => void;
  close: () => void;
  clearError: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  }
  return ctx;
}

function readStoredSpeed(): number {
  try {
    const raw = Number(localStorage.getItem(SPEED_STORAGE_KEY));
    return Number.isFinite(raw) && raw >= 0.5 && raw <= 3.5 ? raw : 1;
  } catch {
    return 1;
  }
}

function computeTimeline(book: ListenBook | null, singleTrackFallbackDur: number) {
  if (!book || !book.tracks.length) {
    return {
      tracks: [] as TrackSpan[],
      chapters: [] as UnifiedChapter[],
      duration: 0,
    };
  }
  const tracks: TrackSpan[] = [];
  let offset = 0;
  for (const item of book.tracks) {
    const dur =
      item.duration && item.duration > 0
        ? item.duration
        : book.tracks.length === 1
          ? singleTrackFallbackDur
          : 0;
    tracks.push({
      index: item.index,
      offset,
      duration: dur,
      format: item.format,
      filename: item.filename,
    });
    offset += dur;
  }

  const rawChapters: Array<{ title: string; start: number; trackIndex: number }> =
    [];
  for (let i = 0; i < book.tracks.length; i++) {
    const item = book.tracks[i];
    const trackOffset = tracks[i].offset;
    if (item.chapters.length > 0) {
      for (const ch of item.chapters) {
        rawChapters.push({
          title: ch.title || `Chapter ${rawChapters.length + 1}`,
          start: trackOffset + Math.max(0, ch.start || 0),
          trackIndex: item.index,
        });
      }
    } else if (book.tracks.length > 1) {
      rawChapters.push({
        title: item.filename.replace(/\.[^.]+$/, "") || `Part ${i + 1}`,
        start: trackOffset,
        trackIndex: item.index,
      });
    }
  }

  const chapters: UnifiedChapter[] = rawChapters.map((ch, idx) => ({
    index: idx,
    title: ch.title,
    start: ch.start,
    end: rawChapters[idx + 1]?.start ?? offset,
    trackIndex: ch.trackIndex,
  }));

  return { tracks, chapters, duration: offset };
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current && typeof Audio !== "undefined") {
    const el = new Audio();
    el.preload = "auto";
    audioRef.current = el;
  }

  const [book, setBook] = useState<ListenBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [finished, setFinished] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [time, setTime] = useState(0);
  const [fallbackDuration, setFallbackDuration] = useState(0);
  const [speed, setSpeedState] = useState<number>(readStoredSpeed);
  const [sleep, setSleepState] = useState<SleepState>({ mode: 0, until: 0 });

  // Refs for synchronous access inside audio event listeners (Narratarr settle pattern)
  const bookRef = useRef<ListenBook | null>(null);
  const fileIdxRef = useRef<number>(-1);
  const targetRef = useRef<number | null>(null);
  const triesRef = useRef<number>(0);
  const speedRef = useRef<number>(speed);
  const sleepRef = useRef<SleepState>(sleep);
  const finishedRef = useRef<boolean>(finished);
  const lastSaveRef = useRef<number>(0);
  const loadTokenRef = useRef<number>(0);

  bookRef.current = book;
  speedRef.current = speed;
  sleepRef.current = sleep;
  finishedRef.current = finished;

  const { tracks, chapters, duration } = useMemo(
    () => computeTimeline(book, fallbackDuration),
    [book, fallbackDuration],
  );
  const tracksRef = useRef(tracks);
  const chaptersRef = useRef(chapters);
  const durationRef = useRef(duration);
  tracksRef.current = tracks;
  chaptersRef.current = chapters;
  durationRef.current = duration;

  const getHeard = useCallback(() => {
    const el = audioRef.current;
    const tr = tracksRef.current[fileIdxRef.current];
    return tr && el ? tr.offset + (el.currentTime || 0) : 0;
  }, []);

  const getCurrentTime = useCallback(() => {
    return targetRef.current ?? getHeard();
  }, [getHeard]);

  const fileAt = useCallback((t: number): number => {
    const list = tracksRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      if (t >= list[i].offset) return i;
    }
    return 0;
  }, []);

  const chapterIndexAt = useCallback((t: number): number => {
    const list = chaptersRef.current;
    let found = -1;
    for (let k = 0; k < list.length; k++) {
      if (list[k].start <= t + 0.5) found = k;
    }
    return found;
  }, []);

  const chapterBoundsAt = useCallback((idx: number): [number, number] => {
    const list = chaptersRef.current;
    const dur = durationRef.current;
    if (idx < 0 || !list[idx]) return [0, dur];
    return [list[idx].start, list[idx + 1]?.start ?? dur];
  }, []);

  const saveProgress = useCallback(
    (options?: { keepalive?: boolean; forceFinished?: boolean }) => {
      const currentBook = bookRef.current;
      const list = tracksRef.current;
      if (!currentBook || !list.length) return;
      const t = getCurrentTime();
      const dur = durationRef.current;
      const idx = fileAt(t);
      const tr = list[idx];
      if (!tr) return;
      const trackSeconds = Math.max(0, t - tr.offset);
      const isFin =
        options?.forceFinished !== undefined
          ? options.forceFinished
          : finishedRef.current && t <= 30;
      const fraction = isFin
        ? 1
        : dur > 0
          ? Math.min(0.999, Math.max(0, t / dur))
          : 0;
      const ci = chapterIndexAt(t);
      const chTitle = ci >= 0 ? chaptersRef.current[ci]?.title ?? null : null;
      lastSaveRef.current = Date.now();
      void saveListenProgress(
        currentBook.asset_id,
        {
          track: tr.index,
          seconds: isFin ? tr.duration : trackSeconds,
          fraction,
          chapter: chTitle,
        },
        options?.keepalive ?? false,
      ).catch(() => {});
    },
    [chapterIndexAt, fileAt, getCurrentTime],
  );

  const loadTrack = useCallback(async (trackArrayIndex: number) => {
    const el = audioRef.current;
    const currentBook = bookRef.current;
    const tr = tracksRef.current[trackArrayIndex];
    if (!el || !currentBook || !tr) return;

    fileIdxRef.current = trackArrayIndex;
    const src = `/api/listen/assets/${currentBook.asset_id}/tracks/${tr.index}`;
    el.src = src;

    await new Promise<void>((resolve, reject) => {
      const ok = () => {
        cleanup();
        if (
          tracksRef.current.length === 1 &&
          Number.isFinite(el.duration) &&
          el.duration > 0
        ) {
          setFallbackDuration(el.duration);
        }
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(
          new Error(
            `This audio file could not be played (${tr.format || "unknown"} format).`,
          ),
        );
      };
      const cleanup = () => {
        el.removeEventListener("loadedmetadata", ok);
        el.removeEventListener("error", bad);
      };
      el.addEventListener("loadedmetadata", ok);
      el.addEventListener("error", bad);
      el.load();
    });

    el.playbackRate = speedRef.current;
  }, []);

  const play = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Playback was blocked by the browser. Press play to start.");
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused && !el.ended) {
      el.pause();
    } else {
      void play();
    }
  }, [play]);

  const seek = useCallback(
    async (rawSeconds: number, shouldPlay?: boolean) => {
      const el = audioRef.current;
      if (!el || !bookRef.current || !tracksRef.current.length) return;
      const wantPlay =
        shouldPlay !== undefined ? shouldPlay : !el.paused && !el.ended;
      const dur = durationRef.current;
      const t = Math.max(0, dur ? Math.min(rawSeconds, dur - 0.25) : rawSeconds);
      targetRef.current = t;
      triesRef.current = 0;
      setTime(t);

      const nextIdx = fileAt(t);
      if (nextIdx !== fileIdxRef.current) {
        try {
          await loadTrack(nextIdx);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not load audio track.",
          );
          return;
        }
      }
      if (targetRef.current !== t) return;
      const tr = tracksRef.current[fileIdxRef.current];
      if (!tr) return;
      el.currentTime = Math.max(0, t - tr.offset);
      if (wantPlay) await play();
      setTime(targetRef.current ?? getHeard());
    },
    [fileAt, getHeard, loadTrack, play],
  );

  const settle = useCallback(() => {
    const t = targetRef.current;
    const el = audioRef.current;
    const tr = tracksRef.current[fileIdxRef.current];
    if (
      t === null ||
      !el ||
      !tr ||
      el.readyState < 1 ||
      el.seeking ||
      fileAt(t) !== fileIdxRef.current
    ) {
      return;
    }
    if (Math.abs(getHeard() - t) < 3) {
      targetRef.current = null;
      return;
    }
    if (++triesRef.current > 8) {
      targetRef.current = null;
      return;
    }
    el.currentTime = Math.max(0, t - tr.offset);
  }, [fileAt, getHeard]);

  const skip = useCallback(
    (deltaSeconds: number) => {
      void seek(getCurrentTime() + deltaSeconds);
    },
    [getCurrentTime, seek],
  );

  const prevChapter = useCallback(() => {
    const t = getCurrentTime();
    const ci = chapterIndexAt(t);
    const [start] = chapterBoundsAt(ci);
    if (t - start > 4 || ci <= 0) {
      void seek(start);
    } else {
      const prev = chaptersRef.current[ci - 1];
      if (prev) void seek(prev.start);
    }
  }, [chapterBoundsAt, chapterIndexAt, getCurrentTime, seek]);

  const nextChapter = useCallback(() => {
    const ci = chapterIndexAt(getCurrentTime());
    const next = chaptersRef.current[ci + 1];
    if (next) void seek(next.start);
  }, [chapterIndexAt, getCurrentTime, seek]);

  const setSpeed = useCallback((rate: number) => {
    setSpeedState(rate);
    speedRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    try {
      localStorage.setItem(SPEED_STORAGE_KEY, String(rate));
    } catch {
      // ignore storage failure
    }
  }, []);

  const setSleep = useCallback((mode: number) => {
    const next: SleepState = {
      mode,
      until: mode > 0 ? Date.now() + mode * 60_000 : 0,
    };
    setSleepState(next);
    sleepRef.current = next;
    if (audioRef.current) audioRef.current.volume = 1;
  }, []);

  const toggleFinished = useCallback(() => {
    const next = !finishedRef.current;
    setFinished(next);
    finishedRef.current = next;
    saveProgress({ forceFinished: next });
  }, [saveProgress]);

  const updateMediaSession = useCallback(
    (loadedBook: ListenBook) => {
      if (!("mediaSession" in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: loadedBook.title,
        artist: loadedBook.authors.join(", "),
        album: "Dewarr",
        artwork: loadedBook.cover_url
          ? [{ src: loadedBook.cover_url, sizes: "512x512" }]
          : [],
      });
      const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
        ["play", () => void play()],
        ["pause", () => pause()],
        ["seekbackward", (d) => skip(-(d.seekOffset || 15))],
        ["seekforward", (d) => skip(d.seekOffset || 30)],
        [
          "seekto",
          (d) => {
            if (typeof d.seekTime === "number") void seek(d.seekTime);
          },
        ],
        ["previoustrack", () => prevChapter()],
        ["nexttrack", () => nextChapter()],
      ];
      for (const [action, handler] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch {
          // unsupported action
        }
      }
    },
    [nextChapter, pause, play, prevChapter, seek, skip],
  );

  const openBook = useCallback(
    async (
      assetId: string,
      options?: { autoplay?: boolean; openSheet?: boolean },
    ) => {
      const autoplay = options?.autoplay ?? true;
      const shouldOpenSheet = options?.openSheet ?? true;

      if (bookRef.current?.asset_id === assetId) {
        if (shouldOpenSheet) setSheetOpen(true);
        if (autoplay && audioRef.current?.paused) void play();
        return;
      }

      const token = ++loadTokenRef.current;
      saveProgress();
      audioRef.current?.pause();
      setLoading(true);
      setError(null);

      let loaded: ListenBook;
      try {
        loaded = await fetchListenBook(assetId);
      } catch (err) {
        if (token === loadTokenRef.current) {
          setLoading(false);
          setError(
            err instanceof Error
              ? err.message
              : "Could not load this audiobook.",
          );
        }
        return;
      }
      if (token !== loadTokenRef.current) return;

      const isDone = (loaded.progress?.fraction ?? 0) >= 0.99;
      const parsed = parseListenPosition(loaded.progress?.cfi);

      // Compute timeline synchronously so seek() works immediately
      const timeline = computeTimeline(loaded, 0);
      bookRef.current = loaded;
      tracksRef.current = timeline.tracks;
      chaptersRef.current = timeline.chapters;
      durationRef.current = timeline.duration;
      fileIdxRef.current = -1;
      targetRef.current = null;
      finishedRef.current = isDone;

      setBook(loaded);
      setFallbackDuration(0);
      setFinished(isDone);
      setLoading(false);
      if (shouldOpenSheet) setSheetOpen(true);

      let resumeSeconds = 0;
      if (!isDone && parsed) {
        const matchTrack = timeline.tracks.find((tr) => tr.index === parsed.track);
        if (matchTrack) {
          resumeSeconds = Math.max(0, matchTrack.offset + parsed.seconds - 2);
        }
      }

      updateMediaSession(loaded);
      await seek(resumeSeconds, autoplay);
    },
    [play, saveProgress, seek, updateMediaSession],
  );

  const close = useCallback(() => {
    saveProgress({ keepalive: true });
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.volume = 1;
    }
    bookRef.current = null;
    tracksRef.current = [];
    chaptersRef.current = [];
    durationRef.current = 0;
    fileIdxRef.current = -1;
    targetRef.current = null;
    setBook(null);
    setPlaying(false);
    setBuffering(false);
    setSheetOpen(false);
    setTime(0);
    setError(null);
    setSleepState({ mode: 0, until: 0 });
    sleepRef.current = { mode: 0, until: 0 };
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
    }
  }, [saveProgress]);

  // Body class for bottom clearance + scroll lock when Now Playing sheet is open
  useEffect(() => {
    document.body.classList.toggle("has-audio-player", Boolean(book));
    return () => {
      document.body.classList.remove("has-audio-player");
    };
  }, [book]);

  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  // Wire audio element events
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => {
      settle();
      if (!bookRef.current) return;
      const nowTime = targetRef.current ?? getHeard();
      setTime(nowTime);

      if (!el.paused && Date.now() - lastSaveRef.current > SAVE_EVERY_MS) {
        saveProgress();
      }

      // Sleep timer with gentle 15-second volume fade-out
      const currentSleep = sleepRef.current;
      if (currentSleep.mode > 0) {
        const left = currentSleep.until - Date.now();
        if (left <= 0) {
          el.pause();
          el.volume = 1;
          const off = { mode: 0, until: 0 };
          sleepRef.current = off;
          setSleepState(off);
        } else {
          el.volume = Math.min(1, Math.max(0.05, left / 15_000));
        }
      } else if (currentSleep.mode === -1) {
        const ci = chapterIndexAt(nowTime);
        const [, end] = chapterBoundsAt(ci);
        if (end > 0 && nowTime >= end - 0.6) {
          el.pause();
          const off = { mode: 0, until: 0 };
          sleepRef.current = off;
          setSleepState(off);
        }
      }

      if (
        "mediaSession" in navigator &&
        durationRef.current > 0 &&
        navigator.mediaSession.setPositionState
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: durationRef.current,
            position: Math.min(nowTime, durationRef.current),
            playbackRate: speedRef.current,
          });
        } catch {
          // ignore during load
        }
      }
    };

    const onSettle = () => settle();
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      saveProgress();
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      settle();
    };
    const onEnded = async () => {
      if (fileIdxRef.current < tracksRef.current.length - 1) {
        try {
          await loadTrack(fileIdxRef.current + 1);
          await play();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not load next track.",
          );
        }
      } else {
        setPlaying(false);
        setFinished(true);
        finishedRef.current = true;
        saveProgress({ forceFinished: true });
      }
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onSettle);
    el.addEventListener("canplay", onSettle);
    el.addEventListener("seeked", onSettle);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onSettle);
      el.removeEventListener("canplay", onSettle);
      el.removeEventListener("seeked", onSettle);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnded);
    };
  }, [
    chapterBoundsAt,
    chapterIndexAt,
    getHeard,
    loadTrack,
    play,
    saveProgress,
    settle,
  ]);

  // Save on pagehide / visibilitychange
  useEffect(() => {
    const flush = () => saveProgress({ keepalive: true });
    const onVisibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveProgress]);

  // Global keyboard shortcuts (Space, Left -15s, Right +30s, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!bookRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable]")) return;
      if (window.location.pathname.startsWith("/read/")) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        skip(-15);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip(30);
      } else if (e.key === "Escape" && sheetOpen) {
        e.stopPropagation();
        setSheetOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [sheetOpen, skip, toggle]);

  const chapterIndex = useMemo(() => chapterIndexAt(time), [chapterIndexAt, time]);
  const chapterBounds = useMemo(
    () => chapterBoundsAt(chapterIndex),
    [chapterBoundsAt, chapterIndex],
  );

  const value: AudioPlayerContextValue = {
    book,
    loading,
    error,
    playing,
    buffering,
    finished,
    sheetOpen,
    time,
    duration,
    speed,
    sleep,
    tracks,
    chapters,
    chapterIndex,
    chapterBounds,
    openBook,
    play,
    pause,
    toggle,
    seek,
    skip,
    prevChapter,
    nextChapter,
    setSpeed,
    setSleep,
    toggleFinished,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    close,
    clearError: () => setError(null),
  };

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
    </AudioPlayerContext.Provider>
  );
}
