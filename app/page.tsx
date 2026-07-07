"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommentItem, DeckResponse } from "@/lib/types";
import { CommentCard } from "./components/CommentCard";
import { LogoIcon, GearIcon, ChevronLeftIcon, ChevronRightIcon } from "./components/icons";
import {
  loadIndex,
  saveDeck,
  getDeck,
  getPasscode,
  setPasscode as persistPasscode,
  clearPasscode,
  type DeckIndexEntry,
} from "@/lib/storage";

type StatusClass = "" | "ok" | "err";

export default function Page() {
  const [videoInput, setVideoInput] = useState("");
  const [deck, setDeck] = useState<CommentItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [status, setStatus] = useState<{ msg: string; cls: StatusClass }>({ msg: "", cls: "" });
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<DeckIndexEntry[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [passcode, setPasscode] = useState("");

  const hasDeck = deck.length > 0;

  // --- one-time client bootstrap: recent decks, passcode, server config ---
  useEffect(() => {
    setRecent(loadIndex());
    setPasscode(getPasscode());

    let cancelled = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { passcodeRequired?: boolean }) => {
        if (cancelled) return;
        if (cfg.passcodeRequired) {
          setPasscodeRequired(true);
          // If protected but no passcode saved yet, nudge the user to the panel.
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

  // --- keyboard paging (ignored while typing in a field) ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(deck.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.length]);

  const setOk = (msg: string) => setStatus({ msg, cls: "ok" });
  const setErr = (msg: string) => setStatus({ msg, cls: "err" });

  // --- pull top 10 from our own API (never googleapis.com directly) ---
  const pull = useCallback(async () => {
    setLoading(true);
    setStatus({ msg: "Pulling comments…", cls: "" });
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: videoInput, passcode: passcode || undefined }),
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
      setRecent(saveDeck(data.videoId, data.title, data.comments));
      setOk(`Loaded ${data.comments.length} — ${data.title || data.videoId}`);
    } catch {
      setErr("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [videoInput, passcode]);

  // --- reopen a cached deck from the Recent dropdown ---
  const openRecent = useCallback((id: string) => {
    if (!id) return;
    const d = getDeck(id);
    if (!d) {
      setErr("That deck isn't saved anymore.");
      return;
    }
    setDeck(d.comments);
    setIdx(0);
    setTitle(d.title || id);
    setCurrentId(id);
    setOk(`Reopened — ${d.title || id}`);
  }, []);

  // --- copy all 10 as a plain-text numbered list (teleprompter-friendly) ---
  const copyAll = useCallback(() => {
    if (!deck.length) return;
    const lines = deck.map((c, i) => `${i + 1}. ${c.name} (${c.likes} likes)\n   ${c.text}`);
    const txt = `Top ${deck.length} comments — ${title}\n\n` + lines.join("\n\n");
    navigator.clipboard.writeText(txt).then(
      () => setOk(`Copied all ${deck.length} to clipboard.`),
      () => setErr("Couldn't copy — clipboard blocked."),
    );
  }, [deck, title]);

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

  return (
    <div className="wrap">
      <header>
        <div className="mark" aria-hidden="true">
          <LogoIcon />
        </div>
        <div>
          <h1>Comment Deck</h1>
          <div className="sub">Top 10 · by likes</div>
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
          {loading ? "Pulling…" : "Pull top 10"}
        </button>
      </div>

      <div className="recent-row">
        <span className="recent-lbl">Recent</span>
        {/* value pinned to "" so re-selecting the same deck fires onChange again */}
        <select value="" onChange={(e) => openRecent(e.target.value)} aria-label="Recent decks">
          <option value="">— pulled videos —</option>
          {recent.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title.length > 52 ? x.title.slice(0, 52) + "…" : x.title}
            </option>
          ))}
        </select>
      </div>

      <div className="stage">
        <button
          className="nav"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={!hasDeck || idx === 0}
          aria-label="Previous comment"
        >
          <ChevronLeftIcon />
        </button>

        <div className={`cardhold${hasDeck ? "" : " empty"}`}>
          {hasDeck ? (
            <CommentCard
              key={`${currentId}:${idx}`}
              comment={deck[idx]}
              index={idx}
              total={deck.length}
            />
          ) : (
            <div className="placeholder">
              <div className="big">No deck loaded</div>
              <div className="lil">Paste a video above and pull its top comments.</div>
            </div>
          )}
        </div>

        <button
          className="nav"
          onClick={() => setIdx((i) => Math.min(deck.length - 1, i + 1))}
          disabled={!hasDeck || idx === deck.length - 1}
          aria-label="Next comment"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="foot">
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
        <div className="counter">{counter}</div>
        <button className="copybtn" onClick={copyAll} disabled={!hasDeck}>
          Copy all 10
        </button>
      </div>

      <div className={`status${status.cls ? " " + status.cls : ""}`}>{status.msg}</div>
    </div>
  );
}
