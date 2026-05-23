"use client";

/**
 * Phase 5 (brief v3 + 23-05-2026 list) - Achievements UI.
 *
 * Three parts in one file because they're tightly coupled:
 *   - AchievementsButton: small pill that sits in the top-left
 *     floating bar area below StatsWidget. Shows unlocked/total.
 *   - AchievementsModal: Steam-style grid. Locked tiles render as
 *     silhouettes; unlocked tiles show the icon, name, description,
 *     and global unlock %.
 *   - AchievementUnlockToast: bottom-right notification fired when
 *     a new achievement lands during the active session.
 *
 * Data: fetched on first open via three queries (catalog, mine,
 * stats). Cached in component state - reopen reuses the cache.
 * Auto-refreshes when toasts indicate new unlocks landed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";
import type {
  Achievement,
  StudentAchievement,
  AchievementUnlockStats,
} from "@/types/database";

interface AchievementsButtonProps {
  studentId: string;
}

const RARITY_COLOR: Record<Achievement["rarity"], string> = {
  common: "#9CA3AF",
  uncommon: "#86EFAC",
  rare: "#7DD3FC",
  legendary: "#F4E2B6",
};

const RARITY_BORDER: Record<Achievement["rarity"], string> = {
  common: "rgba(156,163,175,0.5)",
  uncommon: "rgba(134,239,172,0.5)",
  rare: "rgba(125,211,252,0.5)",
  legendary: "rgba(244,226,182,0.65)",
};

export function AchievementsButton({ studentId }: AchievementsButtonProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Achievement[]>([]);
  const [mine, setMine] = useState<Map<string, string>>(new Map()); // id → unlocked_at
  const [stats, setStats] = useState<Map<string, number>>(new Map()); // id → pct
  const [loaded, setLoaded] = useState(false);
  const [toastAchievement, setToastAchievement] =
    useState<Achievement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const supabase = createClient();
    const [catalogRes, mineRes, statsRes] = await Promise.all([
      supabase
        .from("achievements")
        .select("*")
        .order("sort_order", { ascending: true }),
      supabase
        .from("student_achievements")
        .select("achievement_id, unlocked_at")
        .eq("student_id", studentId),
      supabase
        .from("achievement_unlock_stats")
        .select("id, unlock_pct"),
    ]);
    const cat = (catalogRes.data as Achievement[] | null) ?? [];
    const mineMap = new Map<string, string>();
    for (const r of (mineRes.data as Pick<
      StudentAchievement,
      "achievement_id" | "unlocked_at"
    >[] | null) ?? []) {
      mineMap.set(r.achievement_id, r.unlocked_at);
    }
    const statsMap = new Map<string, number>();
    for (const r of (statsRes.data as Pick<
      AchievementUnlockStats,
      "id" | "unlock_pct"
    >[] | null) ?? []) {
      statsMap.set(r.id, r.unlock_pct);
    }
    setCatalog(cat);
    setMine(mineMap);
    setStats(statsMap);
    setLoaded(true);
    // Seed the knownIds ref on first load so we don't toast for
    // unlocks the student already had.
    if (knownIdsRef.current.size === 0) {
      knownIdsRef.current = new Set(mineMap.keys());
    }
  }, [studentId]);

  // Load on mount so the button can show the count.
  useEffect(() => {
    void load();
  }, [load]);

  // Listen for the global "achievements may have changed" event
  // fired by the StudentContext after lesson toggles etc. Diff
  // against knownIds and fire a toast for any new ones.
  useEffect(() => {
    const handler = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("student_achievements")
        .select("achievement_id, unlocked_at")
        .eq("student_id", studentId);
      const rows =
        (data as Pick<
          StudentAchievement,
          "achievement_id" | "unlocked_at"
        >[] | null) ?? [];
      const fresh = new Map<string, string>();
      for (const r of rows) fresh.set(r.achievement_id, r.unlocked_at);
      // Newly unlocked = in fresh but not in knownIdsRef
      const newOnes: string[] = [];
      for (const id of fresh.keys()) {
        if (!knownIdsRef.current.has(id)) newOnes.push(id);
      }
      if (newOnes.length > 0) {
        // Fire toast for the first one; subsequent stack visually
        // not in v1 (rare enough to just stagger via setTimeout).
        for (const id of newOnes) knownIdsRef.current.add(id);
        const ach = catalog.find((a) => a.id === newOnes[0]);
        if (ach) {
          if (toastTimerRef.current != null)
            window.clearTimeout(toastTimerRef.current);
          setToastAchievement(ach);
          toastTimerRef.current = window.setTimeout(
            () => setToastAchievement(null),
            5200,
          );
        }
      }
      setMine(fresh);
    };
    window.addEventListener("et:achievements-changed", handler);
    return () =>
      window.removeEventListener("et:achievements-changed", handler);
  }, [studentId, catalog]);

  const unlockedCount = mine.size;
  const totalCount = catalog.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${unlockedCount} of ${totalCount} achievements unlocked`}
        style={{
          padding: "8px 14px",
          borderRadius: 999,
          background: "rgba(10,14,22,0.65)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          color: "rgba(255,255,255,0.86)",
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          boxShadow: "0 8px 22px rgba(0,0,0,0.38)",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 4H3v3a3 3 0 003 3M19 4h2v3a3 3 0 01-3 3" />
        </svg>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {loaded ? `${unlockedCount} / ${totalCount}` : "—"}
        </span>
      </button>

      <AchievementsModal
        open={open}
        loading={!loaded}
        catalog={catalog}
        mine={mine}
        stats={stats}
        onClose={() => setOpen(false)}
      />

      <AchievementUnlockToast
        achievement={toastAchievement}
        unlockPct={
          toastAchievement ? stats.get(toastAchievement.id) ?? null : null
        }
        onDismiss={() => setToastAchievement(null)}
      />
    </>
  );
}

interface AchievementsModalProps {
  open: boolean;
  loading: boolean;
  catalog: Achievement[];
  mine: Map<string, string>;
  stats: Map<string, number>;
  onClose: () => void;
}

function AchievementsModal({
  open,
  loading,
  catalog,
  mine,
  stats,
  onClose,
}: AchievementsModalProps) {
  // Group by rarity for the grid.
  const grouped: Record<Achievement["rarity"], Achievement[]> = {
    common: [],
    uncommon: [],
    rare: [],
    legendary: [],
  };
  for (const a of catalog) grouped[a.rarity].push(a);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="achievements-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Achievements"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[150] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(8,12,22,0.88) 0%, rgba(4,8,16,0.96) 100%)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(880px, 94vw)",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              background: "rgba(10,14,22,0.96)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              boxShadow:
                "0 40px 100px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                    marginBottom: 4,
                  }}
                >
                  Achievements
                </p>
                <h2
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: "-0.018em",
                    color: "rgba(255,255,255,0.96)",
                  }}
                >
                  {loading ? "Loading..." : `${mine.size} of ${catalog.length} unlocked`}
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.62)",
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  fontSize: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>

            {/* Grid */}
            <div
              style={{
                padding: "16px 24px 24px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 22,
              }}
            >
              {(["legendary", "rare", "uncommon", "common"] as const).map(
                (rarity) => {
                  if (grouped[rarity].length === 0) return null;
                  return (
                    <div key={rarity}>
                      <p
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.22em",
                          textTransform: "uppercase",
                          color: RARITY_COLOR[rarity],
                          marginBottom: 12,
                        }}
                      >
                        {rarity}
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(180px, 1fr))",
                          gap: 12,
                        }}
                      >
                        {grouped[rarity].map((a) => {
                          const unlocked = mine.has(a.id);
                          const pct = stats.get(a.id);
                          return (
                            <AchievementTile
                              key={a.id}
                              ach={a}
                              unlocked={unlocked}
                              unlockPct={pct}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AchievementTile({
  ach,
  unlocked,
  unlockPct,
}: {
  ach: Achievement;
  unlocked: boolean;
  unlockPct?: number;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: unlocked
          ? "rgba(255,255,255,0.04)"
          : "rgba(255,255,255,0.02)",
        border: unlocked
          ? `1px solid ${RARITY_BORDER[ach.rarity]}`
          : "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: unlocked ? 1 : 0.74,
        transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: unlocked
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.04)",
          border: unlocked
            ? `1px solid ${RARITY_BORDER[ach.rarity]}`
            : "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          filter: unlocked ? "none" : "grayscale(1) brightness(0.55)",
        }}
      >
        {unlocked ? ach.icon : "🔒"}
      </div>
      <div>
        <p
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: unlocked
              ? "rgba(255,255,255,0.94)"
              : "rgba(255,255,255,0.55)",
            marginBottom: 4,
          }}
        >
          {unlocked ? ach.name : "???"}
        </p>
        <p
          style={{
            fontSize: 11.5,
            lineHeight: 1.4,
            color: unlocked
              ? "rgba(255,255,255,0.62)"
              : "rgba(255,255,255,0.38)",
            minHeight: 30,
          }}
        >
          {unlocked ? ach.description : "Unlock to reveal."}
        </p>
      </div>
      {/* Unlock % - shown only when unlocked, per Karlo's request */}
      {unlocked && unlockPct != null && (
        <p
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: RARITY_COLOR[ach.rarity],
            marginTop: "auto",
          }}
        >
          {unlockPct}% earned
        </p>
      )}
    </div>
  );
}

function AchievementUnlockToast({
  achievement,
  unlockPct,
  onDismiss,
}: {
  achievement: Achievement | null;
  unlockPct: number | null;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {achievement && (
        <motion.div
          key={`ach-toast-${achievement.id}`}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          onClick={onDismiss}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            cursor: "pointer",
            padding: "14px 18px",
            background: "rgba(10,14,22,0.96)",
            border: `1px solid ${RARITY_BORDER[achievement.rarity]}`,
            borderRadius: 12,
            boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            minWidth: 280,
            maxWidth: "92vw",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${RARITY_BORDER[achievement.rarity]}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {achievement.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: RARITY_COLOR[achievement.rarity],
                marginBottom: 2,
              }}
            >
              Achievement unlocked
            </p>
            <p
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,0.96)",
                letterSpacing: "-0.011em",
                marginBottom: 2,
              }}
            >
              {achievement.name}
            </p>
            <p
              style={{
                fontSize: 11.5,
                color: "rgba(255,255,255,0.58)",
                lineHeight: 1.4,
              }}
            >
              {unlockPct != null
                ? `${achievement.description} · ${unlockPct}% earned`
                : achievement.description}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
