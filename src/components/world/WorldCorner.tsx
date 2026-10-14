"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import type { Achievement } from "@/types/database";
import { useWorldBadges, useWorldSignOut, type WorldBadges } from "./useWorldBadges";
import c from "./corner.module.css";

/**
 * The map's top-left corner (2026-10-14): the student's streak, their
 * achievements and Sign out, in the header's row beside the wordmark
 * (WorldMap.tsx hands it to WorldV6 as `corner`; WorldV6 puts it after the
 * brand). It replaces the old dashboard's top-left card
 * (src/components/map/StatsWidget.tsx), whose other parts the map already
 * shows in its own places: progress in the header's course bar and the
 * timeline, the next lesson on the card, the discount at its checkpoint.
 *
 * ONE PILL, THE CHIP'S SHAPE. The discount chip sits at the header's right
 * end; the corner is its twin at the left: the streak (a flame, lit from day
 * 1 of a streak) and the achievements held (a hexagon, "4/10") in one button
 * that opens the list, then Sign out. Mono numbers, no glow, nothing pulses.
 *
 * THE LIST opens in the place panel's slot, under the header on the left,
 * on the panel's surface: the streak and the best, then every achievement by
 * tier, with the share of students who hold it. A place or the checkpoint can
 * be open under it: it is then solid, so their text does not show through.
 * Esc, Back to map or a click outside close it and leave the place open;
 * opening a place closes it. On phones it is a full sheet, and Sign out
 * moves into it.
 *
 * THE TOAST. An achievement unlocked while the map is open slides out of the
 * pill along the header's row, says its name for 6.5 s and goes, and the
 * count in the pill turns sand while it shows. One at a time, oldest first.
 * Under a lesson page (`paused`) the whole header is hidden, so it waits and
 * plays when the student is back on the map; the lesson page itself already
 * says "You unlocked 1 achievement." Clicking it opens the list, where the
 * new one is marked New.
 *
 * THE PLAYBOOK SLOT. `playbook` (a small link, CornerLink below fits it)
 * goes inside the pill between the achievements and Sign out, behind a
 * hairline. WorldMap.tsx is where it is passed.
 */

/** How long the toast stays up, ms. */
const TOAST_MS = 6500;

/** The four tiers, most common first, as the old list grouped them. */
const TIERS: readonly { rarity: Achievement["rarity"]; word: string }[] = [
  { rarity: "common", word: "Common" },
  { rarity: "uncommon", word: "Uncommon" },
  { rarity: "rare", word: "Rare" },
  { rarity: "legendary", word: "Legendary" },
];

/** Hidden until earned: the two strictest (the old list's SECRET_ACHIEVEMENT_IDS). */
const SECRET_IDS: ReadonlySet<string> = new Set(["unbroken", "perfect_run"]);

const days = (n: number) => (n === 1 ? "day" : "days");

/** A share of students, as the list prints it: whole percent, under 1 as "<1%", none as nothing. */
function share(pct: number | undefined): string | null {
  if (pct === undefined || !(pct > 0)) return null;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function WorldCorner({
  paused,
  placeOpen,
  playbook,
}: {
  /** A lesson page is open over the map: the list closes and the toast waits. */
  paused: boolean;
  /** A place is open (its address): the list gives way to it. */
  placeOpen: boolean;
  /** The Playbook link's slot, inside the pill before Sign out. */
  playbook?: ReactNode;
}) {
  const { streak } = useStudent();
  const { student } = useAuth();
  const badges = useWorldBadges();
  const signOut = useWorldSignOut();

  const current = streak?.current ?? 0;
  const longest = Math.max(streak?.longest ?? 0, current);
  const { status, book } = badges;
  const total = book.catalog.length;
  const held = book.catalog.reduce((n, a) => n + (book.mine.has(a.id) ? 1 : 0), 0);

  const [open, setOpen] = useState(false);
  /** Full sheet (the map's list view), read from the map's root when the list opens. */
  const [sheet, setSheet] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const panelId = useId();
  const titleId = useId();

  // A place opening, or a lesson page, closes the list.
  const [wasPlace, setWasPlace] = useState(placeOpen);
  if (wasPlace !== placeOpen) {
    setWasPlace(placeOpen);
    if (placeOpen && open) setOpen(false);
  }
  if (paused && open) setOpen(false);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) pillRef.current?.focus({ preventScroll: true });
  }, []);

  const toggle = () => {
    if (open) {
      close(false);
      return;
    }
    setSheet(rootRef.current?.closest("[data-view]")?.getAttribute("data-view") === "list");
    setOpen(true);
  };

  // Open: the keyboard starts on the list's heading. Esc (before the map's own
  // Esc, which would close the place under it) and a click outside close it.
  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close]);

  // The toast: the oldest unannounced unlock, while the map is in view.
  const head = badges.fresh[0] ?? null;
  const toast = head !== null && !paused ? head : null;
  const { announced } = badges;
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(announced, TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast, announced]);

  // Not a `finally`: the React compiler gives up on a component that has one
  // (LessonPlayer.tsx says the same). Signed out, the guard sends them to /login.
  const doSignOut = async () => {
    if (leaving) return;
    setLeaving(true);
    await signOut().catch(() => {});
    setLeaving(false);
  };

  const count = status === "ready" && total > 0;
  const statsLabel =
    `Streak ${current} ${days(current)}${longest > 0 ? `, best ${longest}` : ""}. ` +
    (status === "ready" ? `${held} of ${total} achievements` : "Achievements") +
    `. ${open ? "Hide" : "Show"} them`;

  return (
    <div ref={rootRef} className={c.corner} data-open={open || undefined}>
      <div className={c.pill}>
        <button
          ref={pillRef}
          type="button"
          className={c.seg}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={statsLabel}
          onClick={toggle}
        >
          <span className={c.streak}>
            <Flame className={c.flame} lit={current > 0} />
            <b>{current}</b>
            <span className={c.unit}>{days(current)}</span>
          </span>
          <span className={c.rule} aria-hidden="true" />
          <span className={c.count} data-fresh={toast ? "" : undefined}>
            <Hex className={c.hex} lit={held > 0} />
            {count && (
              <span>
                <b>{held}</b>/{total}
              </span>
            )}
          </span>
        </button>
        {playbook && <span className={c.slot}>{playbook}</span>}
        <button type="button" className={`${c.seg} ${c.out}`} aria-label="Sign out" disabled={leaving} onClick={doSignOut}>
          <ExitGlyph />
          <span className={c.tip} aria-hidden="true">
            Sign out
          </span>
        </button>
      </div>

      {/* Read out once, from a region that is always on the page. */}
      <span className={c.srOnly} role="status">
        {toast ? `Achievement unlocked: ${toast.name}.` : ""}
      </span>

      {toast && (
        <button
          key={toast.id}
          type="button"
          className={c.toast}
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => {
            announced();
            if (!open) toggle();
          }}
        >
          <Hex className={c.toastHex} lit />
          <span className={c.toastEyebrow}>Achievement unlocked</span>
          <span className={c.toastName}>{toast.name}</span>
        </button>
      )}

      {open && (
        <div
          id={panelId}
          className={c.panel}
          role="dialog"
          aria-modal={sheet || undefined}
          aria-labelledby={titleId}
          data-sheet={sheet || undefined}
        >
          <div className={c.panelInner}>
            {/* First, so the first Tab from it is Back, never Sign out at the bottom. */}
            <h2 ref={headingRef} id={titleId} tabIndex={-1} className={c.srOnly}>
              Your streak and achievements
            </h2>
            <div className={c.top}>
              <button type="button" className={c.back} onClick={() => close(true)}>
                <BackArrow />
                {sheet ? "Back" : "Back to map"}
              </button>
              <kbd className={c.esc}>Esc</kbd>
            </div>
            <ListBody badges={badges} current={current} longest={longest} held={held} />
            <div className={c.foot}>
              <span className={c.who}>{student?.name ? `Signed in as ${student.name}` : null}</span>
              <button type="button" className={c.signOut} disabled={leaving} onClick={doSignOut}>
                <ExitGlyph />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListBody({
  badges,
  current,
  longest,
  held,
}: {
  badges: WorldBadges;
  current: number;
  longest: number;
  held: number;
}) {
  const { status, book, newIds, retry } = badges;
  const total = book.catalog.length;
  const hint =
    current > 0
      ? "Watch a lesson every day to keep it going."
      : longest > 0
        ? "Watch a lesson today to start a new one."
        : "Watch a lesson today to start one.";
  // The first tier shown carries the shares' column head.
  const firstTier = TIERS.find((t) => book.catalog.some((a) => a.rarity === t.rarity))?.rarity;
  return (
    <>
      <div className={c.hero}>
        <div className={c.stat}>
          <p className={c.eyebrow}>
            <Flame className={c.eyebrowFlame} lit={current > 0} />
            Streak
          </p>
          <p className={c.big}>
            {current}{" "}
            <span>{days(current)}</span>
          </p>
          {longest > 0 && (
            <p className={c.sub}>
              Best <b>{longest}</b> {days(longest)}
            </p>
          )}
        </div>
        <div className={c.stat}>
          <p className={c.eyebrow}>
            <Hex className={c.eyebrowHex} lit={held > 0} />
            Achievements
          </p>
          {status === "ready" ? (
            <>
              <p className={c.big}>
                {held}{" "}
                <span>of {total}</span>
              </p>
              {/* A count, so it fills from the left (the list below says which). */}
              <span className={c.ticks} aria-hidden="true">
                {book.catalog.map((a, i) => (
                  <i key={a.id} data-t={i < held ? "d" : undefined} />
                ))}
              </span>
            </>
          ) : (
            <p className={c.sub}>{status === "loading" ? "Loading" : "Not loaded"}</p>
          )}
        </div>
      </div>
      <p className={c.hint}>{hint}</p>

      {status === "error" && (
        <div className={c.note}>
          <p>Your achievements didn&apos;t load.</p>
          <button type="button" className={c.signOut} onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {status === "ready" && total === 0 && <p className={c.note}>No achievements yet.</p>}

      {status === "ready" && total > 0 && (
        <div className={c.list}>
          {TIERS.map(({ rarity, word }) => {
            const items = book.catalog.filter((a) => a.rarity === rarity);
            if (items.length === 0) return null;
            const have = items.filter((a) => book.mine.has(a.id)).length;
            const withShares = rarity === firstTier && book.stats.size > 0;
            return (
              <div key={rarity} className={c.group}>
                <p className={c.groupHead}>
                  {word}
                  <span className={c.groupCount}>
                    {have}/{items.length}
                  </span>
                  {withShares && <span className={c.groupEnd}>% of students</span>}
                </p>
                <ul className={c.rows}>
                  {items.map((a) => {
                    const mine = book.mine.has(a.id);
                    const shown = mine || !SECRET_IDS.has(a.id);
                    const isNew = newIds.has(a.id);
                    const pct = share(book.stats.get(a.id));
                    return (
                      <li key={a.id} className={c.row} data-held={mine || undefined} data-new={isNew || undefined}>
                        <Hex className={c.rowHex} lit={mine} />
                        <span className={c.rowText}>
                          <span className={c.rowName}>
                            {shown ? a.name : "Hidden"}
                            {isNew && <span className={c.newTag}>New</span>}
                            <span className={c.srOnly}>{mine ? ", earned" : ", not earned yet"}</span>
                          </span>
                          <span className={c.rowDesc}>{shown ? a.description : "Shows once you earn it."}</span>
                        </span>
                        {pct && (
                          <span className={c.rowPct}>
                            {pct}
                            <span className={c.srOnly}> of students have it</span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * A small link for the pill's Playbook slot: the pill's type, its hover, a
 * hairline before it. `<WorldCorner playbook={<CornerLink href="/dashboard/playbook">Playbook</CornerLink>} />`
 */
export function CornerLink({ href, children, label }: { href: string; children: ReactNode; label?: string }) {
  return (
    <Link href={href} className={c.link} aria-label={label}>
      {children}
    </Link>
  );
}

/** The streak: a campfire's flame, its tip leaning, a tongue on the left and a pale core. Lit sand while a streak runs, an outline when it is 0. */
function Flame({ className, lit = true }: { className?: string; lit?: boolean }) {
  return (
    <svg className={className} data-lit={lit || undefined} width="11" height="13" viewBox="0 0 12 14" aria-hidden="true">
      <path d="M7 .5C8.5 3 11 5 11 8.5c0 3.1-2.2 5-5 5s-5-1.9-5-4.8c0-1.9.9-3.4 2.2-4.4.1 1.3.7 2.2 1.5 2.7C4.6 4.4 5.5 2.3 7 .5Z" />
      <path className={c.core} d="M6 8.1c.8 1.1 2 1.8 2 3.1 0 1.1-.9 1.7-2 1.7s-2-.6-2-1.7c0-1.3 1.2-2 2-3.1Z" />
    </svg>
  );
}

/** An achievement: a hexagon, filled once earned (the world's other shapes: circle lesson, diamond action). */
function Hex({ className, lit }: { className?: string; lit: boolean }) {
  return (
    <svg className={className} data-lit={lit || undefined} width="12" height="13" viewBox="0 0 12 13" aria-hidden="true">
      <path d="M6 .9 10.9 3.7v5.6L6 12.1 1.1 9.3V3.7Z" />
    </svg>
  );
}

function ExitGlyph() {
  return (
    <svg className={c.exit} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.5 2.2H3.3a1.1 1.1 0 0 0-1.1 1.1v7.4a1.1 1.1 0 0 0 1.1 1.1h2.2M9.2 4.4 11.8 7l-2.6 2.6M11.6 7H5.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackArrow() {
  return (
    <svg className={c.backArrow} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8H3M6.5 4.5 3 8l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
