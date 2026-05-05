"use client";

import { useEffect, useRef, useState } from "react";
import { isSoundEnabled, setSoundEnabled, preloadSounds } from "@/lib/audio";

const PILL_HEIGHT = 52;

const pillBaseStyle: React.CSSProperties = {
  height: PILL_HEIGHT,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(230,192,122,0.18)",
  background: "transparent",
  color: "var(--color-ink-dim)",
  cursor: "pointer",
};

/**
 * Settings popover for the pilot dashboard. Currently houses the
 * sound toggle (more options will land here as Phase 5 lands).
 *
 * Click the gear → menu opens below the button. Click outside →
 * closes. Escape closes too.
 */
export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  // Click-outside + Escape to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) preloadSounds();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        className="btn-ghost"
        style={pillBaseStyle}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 z-50"
          style={{
            minWidth: 240,
            padding: "10px 12px",
            background: "linear-gradient(180deg, rgba(16,32,66,0.98) 0%, rgba(10,20,40,0.98) 100%)",
            border: "1px solid rgba(230,192,122,0.32)",
            borderRadius: 12,
            boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
            animation: "fade-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <p
            className="font-mono uppercase mb-2"
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              color: "rgba(230,192,122,0.7)",
              padding: "4px 4px 0",
            }}
          >
            Settings
          </p>

          <button
            role="menuitemcheckbox"
            aria-checked={soundOn}
            onClick={toggleSound}
            className="w-full flex items-center justify-between"
            style={{
              padding: "10px 8px",
              borderRadius: 8,
              background: "transparent",
              color: "var(--color-ink)",
              cursor: "pointer",
              border: "none",
            }}
          >
            <span className="flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                {soundOn ? (
                  <>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </>
                ) : (
                  <>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </>
                )}
              </svg>
              <span style={{ fontSize: 14 }}>Sound</span>
            </span>
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 20,
                borderRadius: 999,
                background: soundOn ? "var(--color-gold)" : "rgba(230,220,200,0.16)",
                position: "relative",
                transition: "background 200ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: soundOn ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: soundOn ? "var(--color-bg-primary)" : "rgba(230,220,200,0.85)",
                  transition: "left 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </span>
          </button>

          <p
            style={{
              fontSize: 11,
              color: "var(--color-ink-faint)",
              padding: "4px 8px 8px",
              fontStyle: "italic",
            }}
          >
            Quill scratches, paper rustles, and a low brass note when you finish a region.
          </p>
        </div>
      )}
    </div>
  );
}
