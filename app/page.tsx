"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentItem, DeckResponse, PullMode } from "@/lib/types";
import { DeckStage } from "./components/DeckStage";
import { LogoIcon, GearIcon, ExpandIcon, CompressIcon, CloseIcon } from "./components/icons";
import {
  loadIndex,
  saveDeck,
  getDeck,
  getPasscode,
  setPasscode as persistPasscode,
  clearPasscode,
  getZoom,
  setZoom as persistZoom,
  type DeckIndexEntry,
} from "@/lib/storage";

type StatusClass = "" | "ok" | "err";

const MODE_LABEL: Record<PullMode, string> = {
  likes: "Most liked",
  youtube: "YouTube top",
  random: "Random",
};
const MODES: PullMode[] = ["likes", "youtube", "random"];
const COUNTS = [10, 25, 50, 100];
const DOTS_MAX = 16; // above this, dots become unreadable — use a jump box instead

const ZOOM_MIN = 0.8;
const ZOOM_MAX = 3.5;
const ZOOM_STEP = 0.2;
const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;

/** Recent-dropdown option label: truncated title + card count (when known). */
function recentLabel(x: DeckIndexEntry): string {
  const t = x.title.length > 44 ? x.title.slice(0, 44) + "…" : x.title;
  return x.count ? `${t} · ${x.count}` : t;
}

// --- Native Fullscreen API helpers (with a light webkit fallback for Safari) ---
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function fsElement(): Element | null {
  const d = document as FsDoc;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}
function requestFs(el: HTMLElement): void {
  const fn = el.requestFullscreen ?? (el as FsEl).webkitRequestFullscreen;
  const p = fn?.call(el);
  if (p && typeof (p as Promise<void>).then === "function") (p as Promise<void>).catch(() => {});
}
function exitFs(): void {
  const d = document as FsDoc;
  const fn = document.exitFullscreen ?? d.webkitExitFullscreen;
  const p = fn?.call(document);
  if (p && typeof (p as Promise<void>).then === "function") (p as Promise<void>).catch(() => {});
}

export default function Page() {
  const [videoInput, setVideoInput] = useState("");
  const [deck, setDeck] = useState<CommentItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [loadedMode, setLoadedMode] = useState<PullMode>("likes");
  const [status, setStatus] = useState<{ msg: string; cls: StatusClass }>({ msg: "", cls: "" });
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<DeckIndexEntry[]>([]);

  // Pull options
  const [mode, setMode] = useState<PullMode>("likes");
  const [count, setCount] = useState(10);

  // Reading aids
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [passcode, setPasscode] = useState("");

  const hasDeck = deck.length > 0;

  // --- one-time client bootstrap: recent decks, passcode, zoom, server config ---
  useEffect(() => {
    setRecent(loadIndex());
    setPasscode(getPasscode());
    setZoom(getZoom());

    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { passcodeRequired?: boolean }) => {
        if (cancelled) return;
        if (cfg.passcodeRequired) {
          setPasscodeRequired(true);
          if (!getPasscode()) setSettingsOpen(true);
        }
      })
      .catch(() => {
        /* config is best-effort; the API still enforces the real gate */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist zoom whenever it changes.
  useEffect(() => {
    persistZoom(zoom);
  }, [zoom]);

  // Keep isFullscreen in sync with the browser (covers Esc/F11 exits too).
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(fsElement()));
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as EventListener);
    };
  }, []);

  // Leaving Big read also leaves native fullscreen.
  useEffect(() => {
    if (!focus && fsElement()) exitFs();
  }, [focus]);

  const toggleFullscreen = () => {
    if (fsElement()) exitFs();
    else if (overlayRef.current) requestFs(overlayRef.current);
  };

  // --- keyboard: paging, zoom (+/-), and Escape to leave focus mode ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // In native fullscreen, let the browser handle Esc (exit fullscreen) and
      // keep Big read open; a second Esc then closes Big read.
      if (e.key === "Escape") {
        if (!fsElement()) setFocus(false);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(deck.length - 1, i + 1));
      else if (e.key === "+" || e.key === "=") setZoom((z) => clampZoom(z + ZOOM_STEP));
      else if (e.key === "-" || e.key === "_") setZoom((z) => clampZoom(z - ZOOM_STEP));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.length]);

  const setOk = (msg: string) => setStatus({ msg, cls: "ok" });
  const setErr = (msg: string) => setStatus({ msg, cls: "err" });

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => setIdx((i) => Math.min(deck.length - 1, i + 1));

  // --- pull from our own API (never googleapis.com directly) ---
  const pull = useCallback(async () => {
    setLoading(true);
    setStatus({ msg: "Pulling comments…", cls: "" });
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: videoInput, passcode: passcode || undefined, count, mode }),
      });
      const data = (await res.json()) as DeckResponse & { error?: string };

      if (!res.ok) {
        if (res.status === 401) setSettingsOpen(true);
        setErr(data.error || "Something went wrong.");
        return;
      }

      setDeck(data.comments);
      setIdx(0);
      setTitle(data.title || data.videoId);
      setCurrentId(data.videoId);
      setCommentCount(data.commentCount ?? null);
      setLoadedMode(mode);
      setRecent(
        saveDeck(data.videoId, data.title, data.comments, {
          commentCount: data.commentCount ?? null,
          mode,
          count,
        }),
      );
      const total = data.commentCount != null ? ` of ${data.commentCount.toLocaleString()}` : "";
      setOk(`${MODE_LABEL[mode]} · loaded ${data.comments.length}${total}`);
    } catch {
      setErr("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [videoInput, passcode, count, mode]);

  // --- reopen a cached deck from the Recent dropdown ---
  const openRecent = useCallback(
    (key: string) => {
      if (!key) return;
      const entry = recent.find((x) => x.key === key);
      const d = getDeck(key);
      if (!d || !entry) {
        setErr("That deck isn't saved anymore.");
        return;
      }
      const m = d.mode ?? entry.mode;
      setDeck(d.comments);
      setIdx(0);
      setTitle(d.title || entry.id);
      setCurrentId(entry.id);
      setCommentCount(d.commentCount ?? entry.commentCount ?? null);
      setLoadedMode(m);
      setOk(`Reopened — ${MODE_LABEL[m]} · ${d.comments.length} — ${d.title || entry.id}`);
    },
    [recent],
  );

  // --- copy the whole deck as a plain-text numbered list (teleprompter-friendly) ---
  const copyAll = useCallback(() => {
    if (!deck.length) return;
    const lines = deck.map((c, i) => `${i + 1}. ${c.name} (${c.likes} likes)\n   ${c.text}`);
    const header = `${MODE_LABEL[loadedMode]} — ${deck.length} comments — ${title}`;
    const txt = `${header}\n\n` + lines.join("\n\n");
    navigator.clipboard.writeText(txt).then(
      () => setOk(`Copied all ${deck.length} to clipboard.`),
      () => setErr("Couldn't copy — clipboard blocked."),
    );
  }, [deck, title, loadedMode]);

  const savePasscode = () => {
    const v = passcode.trim();
    persistPasscode(v);
    setPasscode(v);
    setSettingsOpen(false);
    setOk(v ? "Passcode saved." : "Passcode cleared.");
  };
  const forgetPasscode = () => {
    clearPasscode();
    setPasscode("");
    setErr("Passcode removed.");
  };

  const counter = useMemo(
    () =>
      hasDeck
        ? `${String(idx + 1).padStart(2, "0")} / ${String(deck.length).padStart(2, "0")}`
        : "",
    [hasDeck, idx, deck.length],
  );

  const zoomControls = () => (
    <div className="zoom" role="group" aria-label="Comment text size">
      <button
        className="zoombtn"
        onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
        disabled={zoom <= ZOOM_MIN}
        aria-label="Smaller text"
      >
        −
      </button>
      <button className="zoomval" onClick={() => setZoom(1)} title="Reset text size">
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="zoombtn"
        onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
        disabled={zoom >= ZOOM_MAX}
        aria-label="Larger text"
      >
        +
      </button>
    </div>
  );

  return (
    <div className="wrap">
      <header>
        <div className="mark" aria-hidden="true">
          <LogoIcon />
        </div>
        <div>
          <h1>Comment Deck</h1>
          <div className="sub">Read comments on camera</div>
        </div>
        <button
          className="gear"
          title="Settings"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <GearIcon />
        </button>
      </header>

      <div className={`keypanel${settingsOpen ? " show" : ""}`}>
        <p>
          The <strong>YouTube Data API key</strong> lives safely on the server — you don&apos;t
          enter it here.{" "}
          {passcodeRequired
            ? "This deployment is passcode-protected. Enter the passcode below to pull comments; it's stored only on this device."
            : "This deployment isn't passcode-protected, so there's nothing to configure."}
        </p>
        {passcodeRequired && (
          <div className="krow">
            <input
              type="text"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode"
              autoComplete="off"
              spellCheck={false}
              aria-label="Passcode"
            />
            <button className="act" onClick={savePasscode}>
              Save
            </button>
            <button className="btn-ghost" onClick={forgetPasscode}>
              Forget
            </button>
          </div>
        )}
      </div>

      <div className="controls">
        <input
          type="text"
          value={videoInput}
          onChange={(e) => setVideoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") pull();
          }}
          placeholder="Paste video URL or ID — the one you're pulling comments from"
          autoComplete="off"
          spellCheck={false}
          aria-label="YouTube video URL or ID"
        />
        <button className="act" onClick={pull} disabled={loading}>
          {loading ? "Pulling…" : `Pull ${count}`}
        </button>
      </div>

      <div className="options">
        <select
          className="count-sel"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="How many comments to pull"
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n} comments
            </option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="Pull mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={`seg-btn${mode === m ? " on" : ""}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="recent-row">
        <span className="recent-lbl">Recent</span>
        {/* value pinned to "" so re-selecting the same deck fires onChange again */}
        <select value="" onChange={(e) => openRecent(e.target.value)} aria-label="Recent decks">
          <option value="">— pulled videos —</option>
          {MODES.map((m) => {
            const items = recent.filter((x) => x.mode === m);
            if (!items.length) return null;
            return (
              <optgroup key={m} label={MODE_LABEL[m]}>
                {items.map((x) => (
                  <option key={x.key} value={x.key}>
                    {recentLabel(x)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>

      {hasDeck && (
        <div className="deckbar">
          <div className="vidmeta">
            <span className="vidmeta-mode">
              {MODE_LABEL[loadedMode]} · {deck.length}
            </span>
            <span className="vidmeta-title" title={title}>
              {title}
            </span>
            {commentCount != null && (
              <span className="vidmeta-count">· {commentCount.toLocaleString()} comments</span>
            )}
          </div>
          <div className="tools">
            {zoomControls()}
            <button className="toolbtn" onClick={() => setFocus(true)} aria-label="Big read — fill the window for filming">
              <ExpandIcon />
              <span>Big read</span>
            </button>
          </div>
        </div>
      )}

      <DeckStage
        variant="main"
        deckId={`${currentId}:${loadedMode}`}
        comment={hasDeck ? deck[idx] : null}
        index={idx}
        total={deck.length}
        zoom={zoom}
        onPrev={goPrev}
        onNext={goNext}
      />

      <div className="foot">
        {deck.length > DOTS_MAX ? (
          <div className="jump">
            <span className="jump-lbl">Card</span>
            <input
              type="number"
              min={1}
              max={deck.length}
              value={idx + 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setIdx(Math.min(deck.length - 1, Math.max(0, n - 1)));
              }}
              aria-label="Jump to card number"
            />
          </div>
        ) : (
          <div className="dots">
            {deck.map((_, i) => (
              <button
                key={i}
                className={`dot${i === idx ? " on" : ""}`}
                aria-label={`Go to comment ${i + 1}`}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        )}
        <div className="counter">{counter}</div>
        <button className="copybtn" onClick={copyAll} disabled={!hasDeck}>
          Copy all{hasDeck ? ` ${deck.length}` : ""}
        </button>
      </div>

      <div className={`status${status.cls ? " " + status.cls : ""}`}>{status.msg}</div>

      {focus && hasDeck && (
        <div
          className="focus-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Big read reader"
          ref={overlayRef}
        >
          <div className="focus-bar">
            {zoomControls()}
            <button
              className="toolbtn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen — hide the browser UI"}
            >
              {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
              <span>{isFullscreen ? "Windowed" : "Full screen"}</span>
            </button>
            <button
              className="toolbtn"
              onClick={() => {
                if (fsElement()) exitFs();
                setFocus(false);
              }}
              aria-label="Exit Big read"
            >
              <CloseIcon />
              <span>Exit</span>
            </button>
          </div>
          <DeckStage
            variant="focus"
            deckId={`${currentId}:${loadedMode}`}
            comment={deck[idx]}
            index={idx}
            total={deck.length}
            zoom={zoom}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div className="focus-counter">{counter}</div>
        </div>
      )}
    </div>
  );
}
