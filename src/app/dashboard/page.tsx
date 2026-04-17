"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber, type Checkpoint, type StudentTitle } from "@/types/database";
import { ProgressHeader } from "@/components/student/ProgressHeader";
import { JourneyPath } from "@/components/student/JourneyPath";
import { DailyNoteInline } from "@/components/student/DailyNoteInline";
import { CheckpointCelebration } from "@/components/student/CheckpointCelebration";
import { TitleCelebration } from "@/components/student/TitleCelebration";
import { RewardModal } from "@/components/student/RewardModal";
import { MonthReviewCard } from "@/components/student/MonthReviewCard";
import { TOTAL_TASKS } from "@/lib/constants";

function celebrationKey(studentId: string, checkpointId: string) {
  return `ecom_celebrated_${studentId}_${checkpointId}`;
}

export default function DashboardPage() {
  const { student } = useAuth();
  const {
    overallProgress,
    completedTaskIds,
    loading,
    checkpoints,
    checkpointProgress,
    currentTitle,
    pendingReward,
    dismissReward,
    monthReview,
  } = useStudent();

  // Checkpoint celebration state
  const [celebrating, setCelebrating] = useState<Checkpoint | null>(null);
  // Title celebration state
  const [celebratingTitle, setCelebratingTitle] = useState<StudentTitle | null>(null);
  // Track which checkpoints we've already acknowledged on THIS mount to avoid
  // re-firing while the user toggles tasks during a session
  const seenCompleteRef = useRef<Set<string>>(new Set());
  const seenTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!student) return;
    // Seed the "already complete" set from checkpoints that were complete
    // on mount — we never celebrate for a pre-existing completion
    if (seenCompleteRef.current.size === 0) {
      for (const cp of checkpoints) {
        if (checkpointProgress[cp.id]?.isComplete) {
          seenCompleteRef.current.add(cp.id);
        }
      }
      return;
    }

    // Detect NEW completions
    for (const cp of checkpoints) {
      if (!checkpointProgress[cp.id]?.isComplete) continue;
      if (seenCompleteRef.current.has(cp.id)) continue;
      // New completion — check localStorage for persistent dedupe
      const key = celebrationKey(student.id, cp.id);
      if (localStorage.getItem(key)) {
        seenCompleteRef.current.add(cp.id);
        continue;
      }
      localStorage.setItem(key, new Date().toISOString());
      seenCompleteRef.current.add(cp.id);
      setCelebrating(cp);
      break; // only one celebration at a time
    }
  }, [student, checkpoints, checkpointProgress]);

  // Title celebration — fires when title changes (after checkpoint celebration)
  useEffect(() => {
    if (!student || currentTitle === "recruit") return;

    // Seed on first mount
    if (seenTitleRef.current === null) {
      seenTitleRef.current = currentTitle;
      return;
    }

    // Detect title change
    if (currentTitle !== seenTitleRef.current) {
      const key = `ecom_title_${student.id}_${currentTitle}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, new Date().toISOString());
        // Delay slightly so checkpoint celebration shows first
        setTimeout(() => setCelebratingTitle(currentTitle), 800);
      }
      seenTitleRef.current = currentTitle;
    }
  }, [student, currentTitle]);

  if (loading || !student) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const dayNumber = getDayNumber(student.joined_at);
  const firstName = student.name?.split(" ")[0] || "";
  const remainingTasks = TOTAL_TASKS - completedTaskIds.size;
  const isComplete = overallProgress === 100;

  const openingLine = isComplete
    ? "Journey done. Let's talk what's next."
    : dayNumber === 1
      ? `You're in${firstName ? `, ${firstName}` : ""}. Let's go.`
      : completedTaskIds.size === 0
        ? "Still haven't started. Tap the first node."
        : remainingTasks <= 3
          ? "Almost there. Don't stop now."
          : `${remainingTasks} left. Keep moving.`;

  return (
    <div className="relative min-h-screen">
      {/* Background radial glow */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 30%, var(--color-accent-glow) 0%, transparent 60%)",
          opacity: 0.3,
        }}
      />

      <div className="relative z-10">
        <ProgressHeader />

        <main className="max-w-[720px] mx-auto px-5 sm:px-6 pt-10 pb-24">
          {/* Hero */}
          <motion.section
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: { staggerChildren: 0.08, delayChildren: 0.05 },
              },
            }}
            className="mb-12 text-center sm:text-left"
          >
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mono-label-accent mb-3"
            >
              30-Day Sprint · Ad Creative
            </motion.div>
            <motion.h1
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="display-heading text-[40px] sm:text-[56px] leading-[0.95] mb-4"
            >
              {openingLine}
            </motion.h1>
            <motion.p
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="text-[15px] leading-relaxed text-[var(--color-text-secondary)] max-w-[440px] mx-auto sm:mx-0"
            >
              Tap any lesson to open it. Watch videos sync automatically from Whop — action items you check off yourself.
            </motion.p>
          </motion.section>

          <JourneyPath />

          {/* Day 28 Month in Review */}
          {monthReview && dayNumber >= 28 && (
            <section className="mt-16">
              <MonthReviewCard review={monthReview} />
            </section>
          )}

          <section className="mt-16">
            <DailyNoteInline />
          </section>

          {isComplete && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mt-16 mx-auto max-w-[560px] px-4"
            >
              <div className="p-6 sm:p-8 rounded-2xl bg-[var(--color-bg-card)] border border-[var(--color-accent)]/20">
                <div className="mono-label-accent mb-3">You finished.</div>
                <h3 className="display-heading text-[26px] mb-4">
                  Month 1: Get experience, not rich.
                </h3>
                <div className="space-y-4 text-[14px] leading-relaxed text-[var(--color-text-secondary)]">
                  <p>
                    You went through the program, submitted action items, started applying, sent in your first bounties. Here&apos;s where it goes from here.
                  </p>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    If you&apos;re new — your win is getting hired.
                  </p>
                  <p>
                    You&apos;re not earning money yet. You&apos;re earning experience, knowledge, and proof you can do the work.
                  </p>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    Month 2+: Bounties are your leverage.
                  </p>
                  <p>
                    Winning bounty? Screenshot the stats. Add it to your portfolio. Now when you apply, you&apos;re not saying &quot;I can make ads.&quot; You&apos;re saying &quot;here&apos;s the revenue it generated.&quot;
                  </p>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    The pattern:
                  </p>
                  <ul className="space-y-1.5 pl-4 list-disc marker:text-[var(--color-accent)]">
                    <li>Submit bounties every week</li>
                    <li>Apply to job board posts</li>
                    <li>Show up to weekly calls + Discord</li>
                    <li>Watch your portfolio grow, rates go up</li>
                  </ul>
                </div>
              </div>
            </motion.section>
          )}
        </main>
      </div>

      {/* Celebration overlay — fires once per checkpoint per student */}
      <CheckpointCelebration
        checkpoint={celebrating}
        onDismiss={() => setCelebrating(null)}
      />

      {/* Title upgrade celebration — fires once per title per student */}
      <TitleCelebration
        title={celebratingTitle}
        onDismiss={() => setCelebratingTitle(null)}
      />

      {/* Hidden reward loot drop */}
      <RewardModal
        reward={pendingReward}
        onDismiss={dismissReward}
      />
    </div>
  );
}
