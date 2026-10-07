"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STUDY_AREAS, pad2, type LockMode } from "./study";
import { DEFAULT_TUNING, TAIL_MIN, VH_MAX, VH_MIN, pacingJson, routeVh, sameTuning, type Tuning } from "./tuning";
import s from "./world.module.css";

/**
 * Dev only: the tuning panel for /dev/world-v5. Collapsed to one small
 * "Tune" button in the footer. Opened, it lets Lovro (and Karlo) feel the
 * things still undecided on his own screen: the locking mode, where the
 * student is, how many places are finished, the scroll length of every
 * stretch, and a row to jump straight to any stop.
 * Every control says what it does in plain words; none of this ships.
 *
 * The flight has its own slider (grey pass 3): it sits in the stretch that
 * ends at 08, on top of 08's own budget. The rope bridge has none; the panel
 * shows how much of 08 it takes (rideRef, written by the parent from the rail
 * after every pacing change).
 */

const LOCK_HELP: Record<LockMode, string> = {
  open: "Scroll anywhere, open anything.",
  look: "See the whole map. Places after the student's sit in mist and won't open.",
  locked: "Scrolling stops just past the student's place, with a view of what's next.",
};
const LOCK_NAMES: Record<LockMode, string> = { open: "Open", look: "Look", locked: "Locked" };
const LOCKS: readonly LockMode[] = ["open", "look", "locked"];

export function TuningPanel({
  inert,
  tuning,
  ready,
  readoutRef,
  rideRef,
  onChange,
  onJump,
}: {
  inert: boolean;
  tuning: Tuning;
  ready: boolean;
  /** The parent's frame loop writes the live rail position here while the panel is open. */
  readoutRef: (el: HTMLSpanElement | null) => void;
  /** The parent writes the scroll the rope bridge takes here, after every pacing change. */
  rideRef: (el: HTMLSpanElement | null) => void;
  onChange: (patch: Partial<Tuning> | "reset") => void;
  onJump: (k: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const copyTimer = useRef(0);
  const jsonRef = useRef<HTMLTextAreaElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const changed = !sameTuning(tuning, DEFAULT_TUNING);
  const total = routeVh(tuning);
  const here = STUDY_AREAS[tuning.frontier];

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // Escape closes the panel when focus is inside it, and hands focus back to the button.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  const copy = async () => {
    const text = pacingJson(tuning);
    window.clearTimeout(copyTimer.current);
    try {
      // A clipboard write can hang instead of failing (no focus, no permission), so it gets a second.
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("clipboard timed out")), 1000)),
      ]);
      setCopied("yes");
    } catch {
      // No clipboard (permissions, an http origin): show the JSON selected, ready for Cmd+C.
      setCopied("failed");
      requestAnimationFrame(() => jsonRef.current?.select());
      return;
    }
    copyTimer.current = window.setTimeout(() => setCopied("no"), 1600);
  };

  return (
    <div className={s.tune} data-open={open || undefined} onKeyDown={onKeyDown} inert={inert}>
      <button
        ref={buttonRef}
        type="button"
        className={s.tuneButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        Tune
        {tuning.lock !== "open" && <span className={s.tuneFlag}>{LOCK_NAMES[tuning.lock]}</span>}
        {changed && <span className={s.tuneDot} aria-label="changed from the defaults" />}
      </button>

      {open && (
        <section id={panelId} className={s.tunePanel} aria-label="Tuning (dev only)">
          <header className={s.tuneHead}>
            <p className={s.tuneTitle}>Tuning · dev only</p>
            <p className={s.tuneReadout}>
              At <span ref={readoutRef}>{ready ? "…" : "loading"}</span>
            </p>
          </header>

          <fieldset className={s.tuneGroup}>
            <legend>Locking</legend>
            <div className={s.seg} role="radiogroup" aria-label="Locking mode">
              {LOCKS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={tuning.lock === m}
                  className={s.segItem}
                  onClick={() => onChange({ lock: m })}
                >
                  {LOCK_NAMES[m]}
                </button>
              ))}
            </div>
            <p className={s.tuneHelp}>{LOCK_HELP[tuning.lock]}</p>
            <label className={s.tuneRow}>
              <span>Student is at</span>
              <select value={tuning.frontier} onChange={(e) => onChange({ frontier: Number(e.target.value) })}>
                {STUDY_AREAS.map((a, k) => (
                  <option key={a.id} value={k}>
                    {pad2(k + 1)} {a.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className={s.tuneGroup}>
            <legend>Progress</legend>
            <label className={s.tuneRow}>
              <span>Places finished</span>
              <input
                type="range"
                min={0}
                max={STUDY_AREAS.length}
                step={1}
                value={tuning.finished}
                onChange={(e) => onChange({ finished: Number(e.target.value) })}
              />
              <output className={s.tuneVal}>{tuning.finished}</output>
            </label>
            <label className={s.tuneRow}>
              <span>Lessons done at {pad2(tuning.frontier + 1)}</span>
              <input
                type="range"
                min={0}
                max={here.lessons - 1}
                step={1}
                value={Math.min(tuning.partial, here.lessons - 1)}
                onChange={(e) => onChange({ partial: Number(e.target.value) })}
              />
              <output className={s.tuneVal}>{Math.min(tuning.partial, here.lessons - 1)}</output>
            </label>
            <p className={s.tuneHelp}>
              A lantern lights at every finished place. At 7 your airship waits at the bounty isle, ready to fly
              you to the Harbour Isle.
            </p>
            <button
              type="button"
              className={s.tuneLink}
              onClick={() => onChange({ finished: tuning.frontier })}
              disabled={tuning.finished === tuning.frontier}
            >
              Match the student&apos;s place ({tuning.frontier})
            </button>
          </fieldset>

          <fieldset className={s.tuneGroup}>
            <legend>Pacing</legend>
            <p className={s.tuneHelp}>
              How much scrolling each stretch takes, in screen heights × 100. Each slider is the stretch that ends
              at that place. Whole route: <b>{total} vh</b>, about {Math.round(total / 100)} screens.
            </p>
            {STUDY_AREAS.map((a, k) => (
              <label key={a.id} className={s.tuneRow}>
                <span>
                  <span className={s.tuneNum}>{pad2(k + 1)}</span> {a.name}
                </span>
                <input
                  type="range"
                  min={VH_MIN}
                  max={VH_MAX}
                  step={10}
                  value={tuning.scrollVh[k]}
                  onChange={(e) => {
                    const vh = tuning.scrollVh.slice();
                    vh[k] = Number(e.target.value);
                    onChange({ scrollVh: vh });
                  }}
                />
                <output className={s.tuneVal}>{tuning.scrollVh[k]}</output>
              </label>
            ))}
            <label className={s.tuneRow}>
              <span>
                <span className={s.tuneNum}>08</span> The flight
              </span>
              <input
                type="range"
                min={VH_MIN}
                max={VH_MAX}
                step={10}
                value={tuning.flightVh}
                onChange={(e) => onChange({ flightVh: Number(e.target.value) })}
              />
              <output className={s.tuneVal}>{tuning.flightVh}</output>
            </label>
            <p className={s.tuneHelp}>
              The flight to the Harbour Isle has its own slider and adds to 08. The rest of 08 is the star look, the
              rope bridge and boarding: <span ref={rideRef}>{ready ? "…" : "loading"}</span>.
            </p>
            <label className={s.tuneRow}>
              <span>After the last place</span>
              <input
                type="range"
                min={TAIL_MIN}
                max={VH_MAX}
                step={10}
                value={tuning.tailVh}
                onChange={(e) => onChange({ tailVh: Number(e.target.value) })}
              />
              <output className={s.tuneVal}>{tuning.tailVh}</output>
            </label>
            <div className={s.tuneActions}>
              <button type="button" className={s.tuneAction} onClick={copy}>
                {copied === "yes" ? "Copied" : "Copy values"}
              </button>
              <button type="button" className={s.tuneAction} onClick={() => onChange("reset")} disabled={!changed}>
                Reset everything
              </button>
            </div>
            {copied === "failed" && (
              <textarea
                ref={jsonRef}
                className={s.tuneJson}
                readOnly
                rows={8}
                value={pacingJson(tuning)}
                aria-label="Pacing values as JSON; the clipboard was blocked, so copy them from here"
              />
            )}
          </fieldset>

          <fieldset className={s.tuneGroup}>
            <legend>Jump to</legend>
            <div className={s.jumps}>
              {STUDY_AREAS.map((a, k) => {
                const blocked = tuning.lock === "locked" && k > tuning.frontier;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={s.jump}
                    title={a.name}
                    aria-label={`Jump to ${a.name}`}
                    disabled={!ready || blocked}
                    onClick={() => onJump(k)}
                  >
                    {pad2(k + 1)}
                  </button>
                );
              })}
            </div>
            <p className={s.tuneHelp}>Puts the camera straight on a stop, no glide.</p>
          </fieldset>
        </section>
      )}
    </div>
  );
}
