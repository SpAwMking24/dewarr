import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  Type,
  X,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type {
  FoliateRelocateDetail,
  FoliateTocItem,
  FoliateViewElement,
} from "foliate-js/view.js";
import {
  fetchReaderBook,
  fetchReaderFile,
  saveReadingProgress,
} from "../api/reader";
import { Loading } from "../components";
import "../reader.css";

type ReaderTheme = "dark" | "light" | "sepia";
type ReaderFont = "publisher" | "serif" | "sans";
type ReaderFlow = "paginated" | "scrolled";

interface ReaderPrefs {
  theme: ReaderTheme;
  fontSize: number;
  font: ReaderFont;
  flow: ReaderFlow;
}

const PREFS_KEY = "dewarr:ebook-reader-prefs:v1";

const THEME_PALETTE: Record<
  ReaderTheme,
  { bg: string; fg: string; link: string }
> = {
  dark: { bg: "#11151d", fg: "#e5eaf2", link: "#7db4ff" },
  light: { bg: "#faf9f6", fg: "#1c1917", link: "#2563eb" },
  sepia: { bg: "#f5eedf", fg: "#3b2f1e", link: "#8b4513" },
};

const FONT_STACK: Record<ReaderFont, string | null> = {
  publisher: null,
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
      return {
        theme:
          parsed.theme === "light" ||
          parsed.theme === "sepia" ||
          parsed.theme === "dark"
            ? parsed.theme
            : "dark",
        fontSize:
          typeof parsed.fontSize === "number" &&
          parsed.fontSize >= 80 &&
          parsed.fontSize <= 180
            ? parsed.fontSize
            : 105,
        font:
          parsed.font === "serif" ||
          parsed.font === "sans" ||
          parsed.font === "publisher"
            ? parsed.font
            : "publisher",
        flow:
          parsed.flow === "scrolled" || parsed.flow === "paginated"
            ? parsed.flow
            : "paginated",
      };
    }
  } catch {
    // ignore storage errors
  }
  return { theme: "dark", fontSize: 105, font: "publisher", flow: "paginated" };
}

function buildBookCss(prefs: ReaderPrefs): string {
  const palette = THEME_PALETTE[prefs.theme];
  const fontFamily = FONT_STACK[prefs.font];
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${prefs.theme === "dark" ? "dark" : "light"};
      background: ${palette.bg} !important;
      color: ${palette.fg} !important;
      font-size: ${prefs.fontSize}% !important;
      ${fontFamily ? `font-family: ${fontFamily} !important;` : ""}
    }
    body {
      background: ${palette.bg} !important;
      color: ${palette.fg} !important;
      line-height: 1.65;
      ${fontFamily ? `font-family: ${fontFamily} !important;` : ""}
    }
    a, a:link, a:visited {
      color: ${palette.link} !important;
    }
    p, li, blockquote, dd, dt {
      color: inherit;
    }
  `;
}

function flattenToc(
  items: FoliateTocItem[] | undefined,
  depth = 0,
): Array<{ label: string; href: string; depth: number }> {
  if (!items?.length) return [];
  const out: Array<{ label: string; href: string; depth: number }> = [];
  for (const item of items) {
    out.push({
      label: item.label?.trim() || "Untitled section",
      href: item.href,
      depth,
    });
    if (item.subitems?.length) {
      out.push(...flattenToc(item.subitems, depth + 1));
    }
  }
  return out;
}

export default function EbookReader() {
  const { assetId = "" } = useParams();
  const cache = useQueryClient();
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const [tocOpen, setTocOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [bookReady, setBookReady] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [toc, setToc] = useState<
    Array<{ label: string; href: string; depth: number }>
  >([]);
  const [fraction, setFraction] = useState(0);
  const [chapter, setChapter] = useState<string | null>(null);
  const [activeHref, setActiveHref] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateViewElement | null>(null);
  const latestPosRef = useRef<{
    cfi: string | null;
    fraction: number;
    chapter: string | null;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const book = useQuery({
    queryKey: ["reader-book", assetId],
    enabled: !!assetId,
    queryFn: ({ signal }) => fetchReaderBook(assetId, signal),
    staleTime: 60_000,
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  const applyAppearance = useCallback(
    (view: FoliateViewElement | null, nextPrefs: ReaderPrefs) => {
      if (!view?.renderer) return;
      view.renderer.setAttribute("flow", nextPrefs.flow);
      view.renderer.setAttribute("max-inline-size", "720px");
      view.renderer.setAttribute("gap", "5%");
      view.renderer.setStyles?.(buildBookCss(nextPrefs));
    },
    [],
  );

  useEffect(() => {
    if (bookReady) applyAppearance(viewRef.current, prefs);
  }, [bookReady, prefs, applyAppearance]);

  const flushProgress = useCallback(
    (keepalive = false) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const latest = latestPosRef.current;
      if (!latest || !assetId) return;
      void saveReadingProgress(assetId, latest, keepalive).then(() => {
        if (!keepalive) {
          void cache.invalidateQueries({ queryKey: ["continue-reading"] });
        }
      });
    },
    [assetId, cache],
  );

  useEffect(() => {
    const onHide = () => flushProgress(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushProgress(true);
    };
  }, [flushProgress]);

  useEffect(() => {
    if (!book.data || !mountRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const mount = mountRef.current;

    setBookReady(false);
    setRenderError(null);
    setToc([]);
    if (book.data.progress) {
      setFraction(book.data.progress.fraction);
      setChapter(book.data.progress.chapter);
    }

    async function load() {
      try {
        await import("foliate-js/view.js");
        const file = await fetchReaderFile(
          book.data!.asset_id,
          book.data!.filename,
          controller.signal,
        );
        if (cancelled) return;

        mount.innerHTML = "";
        const view = document.createElement(
          "foliate-view",
        ) as FoliateViewElement;
        mount.appendChild(view);
        viewRef.current = view;

        const onRelocate = (event: Event) => {
          const detail = (event as CustomEvent<FoliateRelocateDetail>).detail;
          if (!detail) return;
          const nextFraction = Number.isFinite(detail.fraction)
            ? Math.min(1, Math.max(0, detail.fraction))
            : 0;
          const nextChapter = detail.tocItem?.label?.trim() || null;
          setFraction(nextFraction);
          setChapter(nextChapter);
          setActiveHref(detail.tocItem?.href || null);
          latestPosRef.current = {
            cfi: detail.cfi || null,
            fraction: nextFraction,
            chapter: nextChapter,
          };
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            flushProgress(false);
          }, 1500);
        };

        const onLoad = (event: Event) => {
          const detail = (event as CustomEvent<{ doc?: Document }>).detail;
          const doc = detail?.doc;
          if (!doc) return;
          doc.addEventListener("keydown", (keyEvent) => {
            if (keyEvent.key === "ArrowRight" || keyEvent.key === "PageDown") {
              keyEvent.preventDefault();
              void view.next();
            } else if (
              keyEvent.key === "ArrowLeft" ||
              keyEvent.key === "PageUp"
            ) {
              keyEvent.preventDefault();
              void view.prev();
            } else if (keyEvent.key === "Escape") {
              setTocOpen(false);
              setPrefsOpen(false);
            }
          });
        };

        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoad);

        await view.open(file);
        if (cancelled) {
          view.close();
          return;
        }
        applyAppearance(view, prefsRef.current);
        setToc(flattenToc(view.book?.toc));

        const savedCfi = book.data?.progress?.cfi || undefined;
        await view.init({
          lastLocation: savedCfi,
          showTextStart: !savedCfi,
        });
        if (!cancelled) setBookReady(true);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setRenderError(
          err instanceof Error ? err.message : "Could not open this ebook.",
        );
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (viewRef.current) {
        try {
          viewRef.current.close();
        } catch {
          // ignore
        }
        viewRef.current = null;
      }
      mount.innerHTML = "";
    };
  }, [book.data, applyAppearance, flushProgress]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        void viewRef.current?.next();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        void viewRef.current?.prev();
      } else if (event.key === "Escape") {
        setTocOpen(false);
        setPrefsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  };

  const backHref = book.data?.work_id
    ? `/books/${book.data.work_id}`
    : "/library";
  const pct = Math.round(fraction * 100);

  return (
    <div
      ref={containerRef}
      className="ebook-reader"
      data-theme={prefs.theme}
      role="application"
      aria-label="Ebook reader"
    >
      <header className="ebook-reader-topbar">
        <div className="ebook-reader-brand">
          <Link
            to={backHref}
            className="ebook-reader-icon-btn"
            aria-label="Back to book"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </Link>
          <div className="ebook-reader-titles">
            <strong>{book.data?.title || "Loading book…"}</strong>
            <span>
              {chapter ||
                (book.data?.authors.length
                  ? book.data.authors.join(", ")
                  : book.data?.format.toUpperCase() || "")}
            </span>
          </div>
        </div>
        <div className="ebook-reader-controls">
          <button
            type="button"
            className="ebook-reader-icon-btn"
            aria-label="Table of contents"
            aria-expanded={tocOpen}
            onClick={() => {
              setTocOpen((open) => !open);
              setPrefsOpen(false);
            }}
          >
            <List size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ebook-reader-icon-btn"
            aria-label="Appearance settings"
            aria-expanded={prefsOpen}
            onClick={() => {
              setPrefsOpen((open) => !open);
              setTocOpen(false);
            }}
          >
            <Type size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ebook-reader-icon-btn"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? (
              <Minimize2 size={18} aria-hidden="true" />
            ) : (
              <Maximize2 size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <main className="ebook-reader-stage">
        {prefs.flow === "paginated" && bookReady && (
          <button
            type="button"
            className="ebook-reader-nav-edge prev"
            aria-label="Previous page"
            onClick={() => void viewRef.current?.prev()}
          >
            <ChevronLeft size={26} aria-hidden="true" />
          </button>
        )}

        <div ref={mountRef} className="ebook-reader-canvas" />

        {prefs.flow === "paginated" && bookReady && (
          <button
            type="button"
            className="ebook-reader-nav-edge next"
            aria-label="Next page"
            onClick={() => void viewRef.current?.next()}
          >
            <ChevronRight size={26} aria-hidden="true" />
          </button>
        )}

        {(book.isPending || (!bookReady && !renderError && !book.error)) && (
          <div className="ebook-reader-state" role="status">
            <Loading />
            <p>Opening ebook…</p>
          </div>
        )}

        {(book.error || renderError) && (
          <div className="ebook-reader-state" role="alert">
            <p>
              {renderError ||
                (book.error instanceof Error
                  ? book.error.message
                  : "Could not load this ebook.")}
            </p>
            <Link to={backHref} className="button-link">
              Return to library
            </Link>
          </div>
        )}

        {(tocOpen || prefsOpen) && (
          <div
            className="ebook-reader-backdrop"
            onClick={() => {
              setTocOpen(false);
              setPrefsOpen(false);
            }}
          />
        )}

        {tocOpen && (
          <aside className="ebook-reader-drawer" aria-label="Table of contents">
            <div className="ebook-reader-drawer-head">
              <h2>Contents</h2>
              <button
                type="button"
                className="ebook-reader-icon-btn"
                aria-label="Close contents"
                onClick={() => setTocOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {toc.length ? (
              <ul className="ebook-reader-toc">
                {toc.map((item, idx) => (
                  <li key={`${item.href}-${idx}`}>
                    <button
                      type="button"
                      data-active={activeHref === item.href}
                      style={{ paddingLeft: `${1 + item.depth * 0.9}rem` }}
                      onClick={() => {
                        void viewRef.current?.goTo(item.href);
                        setTocOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ebook-reader-state">No table of contents found.</p>
            )}
          </aside>
        )}

        {prefsOpen && (
          <section
            className="ebook-reader-popover"
            aria-label="Reading appearance"
          >
            <div className="ebook-reader-setting">
              <span className="ebook-reader-setting-label">Theme</span>
              <div className="ebook-reader-segmented">
                {(["light", "sepia", "dark"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={prefs.theme === mode}
                    onClick={() => setPrefs((p) => ({ ...p, theme: mode }))}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="ebook-reader-setting">
              <span className="ebook-reader-setting-label">Text size</span>
              <div className="ebook-reader-size-row">
                <button
                  type="button"
                  aria-label="Decrease text size"
                  disabled={prefs.fontSize <= 80}
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      fontSize: Math.max(80, p.fontSize - 10),
                    }))
                  }
                >
                  A−
                </button>
                <span>{prefs.fontSize}%</span>
                <button
                  type="button"
                  aria-label="Increase text size"
                  disabled={prefs.fontSize >= 180}
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      fontSize: Math.min(180, p.fontSize + 10),
                    }))
                  }
                >
                  A+
                </button>
              </div>
            </div>

            <div className="ebook-reader-setting">
              <span className="ebook-reader-setting-label">Font</span>
              <div className="ebook-reader-segmented">
                {(
                  [
                    ["publisher", "Book"],
                    ["serif", "Serif"],
                    ["sans", "Sans"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={prefs.font === value}
                    onClick={() => setPrefs((p) => ({ ...p, font: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ebook-reader-setting">
              <span className="ebook-reader-setting-label">Layout</span>
              <div className="ebook-reader-segmented">
                {(
                  [
                    ["paginated", "Pages"],
                    ["scrolled", "Scroll"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={prefs.flow === value}
                    onClick={() => setPrefs((p) => ({ ...p, flow: value }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="ebook-reader-bottombar">
        <button
          type="button"
          className="ebook-reader-icon-btn"
          aria-label="Previous"
          disabled={!bookReady}
          onClick={() => void viewRef.current?.prev()}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <div className="ebook-reader-scrubber">
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(fraction * 1000)}
            disabled={!bookReady}
            aria-label="Reading progress"
            onChange={(event) => {
              const next = Number(event.target.value) / 1000;
              setFraction(next);
              void viewRef.current?.goToFraction(next);
            }}
          />
          <span className="ebook-reader-pct">{pct}%</span>
        </div>
        <button
          type="button"
          className="ebook-reader-icon-btn"
          aria-label="Next"
          disabled={!bookReady}
          onClick={() => void viewRef.current?.next()}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
