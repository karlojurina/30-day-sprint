/**
 * Note-driven artifact unlock rules.
 *
 * The original WorkshopCabinet had 12 artifacts (3 per region) that
 * unlocked when their region completes. v10 layers in a SECOND axis:
 * "earned through journaling" — small badges that a student earns by
 * actually engaging with the notebook.
 *
 * Rules are computed client-side in StudentContext via this module
 * so we don't need a new table — the data is fully derived from
 * existing `lessonNotes` + `regionProgress`.
 *
 * If we ever want server-issued unique badges (NFT-style), promote
 * to a `student_artifacts` table.
 */

import type { Region } from "@/types/database";

export interface NoteArtifactDef {
  id: string;
  /** Title shown in the lore-card hover */
  name: string;
  /** Short description of what it represents */
  lore: string;
  /** Trigger description (shown to the student before they earn it) */
  unlockHint: string;
  /** Stylized icon — single SVG path string in 24x24 viewBox */
  iconPath: string;
}

export const NOTE_ARTIFACTS: NoteArtifactDef[] = [
  {
    id: "apprentice_scribe",
    name: "Apprentice Scribe",
    lore: "Notes are how knowledge sticks. Write five and the next five come naturally.",
    unlockHint: "Write notes on 5 lessons total.",
    iconPath:
      "M19 4H5a2 2 0 00-2 2v14l4-4h12a2 2 0 002-2V6a2 2 0 00-2-2zM7 12h10M7 8h6",
  },
  {
    id: "daily_habit",
    name: "Daily Habit",
    lore: "Show up daily. Even three sentences a day compounds.",
    unlockHint: "Write daily journal notes on 7 different days.",
    iconPath: "M12 2v20M2 12h20M5 5l14 14M19 5L5 19",
  },
  {
    id: "writer",
    name: "Writer",
    lore: "Real reflection isn't a checkbox — it's volume.",
    unlockHint: "Write 1000+ words across all your lesson notes.",
    iconPath:
      "M16.862 3.487a2.067 2.067 0 012.926 2.926l-12 12a2.067 2.067 0 01-2.926-2.926l12-12zM3 21l4-1 13-13-3-3L4 17l-1 4z",
  },
  {
    id: "field_marker_r1",
    name: "Field Marker · Base Camp",
    lore: "You took notes on every part of Base Camp. The map is yours now.",
    unlockHint: "Write a note on every lesson in Region 1.",
    iconPath:
      "M12 2L4 6v6c0 5 4 9 8 10 4-1 8-5 8-10V6l-8-4z M9 11l2 2 4-4",
  },
  {
    id: "field_marker_r2",
    name: "Field Marker · Creative Lab",
    lore: "You documented every step of the Creative Lab. The work has receipts.",
    unlockHint: "Write a note on every lesson in Region 2.",
    iconPath:
      "M3 3h18v6H3zm0 8h18v10H3zM7 14h4M7 18h4",
  },
  {
    id: "field_marker_r3",
    name: "Field Marker · Test Track",
    lore: "Notes from the Test Track — where strategy meets reality.",
    unlockHint: "Write a note on every lesson in Region 3.",
    iconPath:
      "M3 18l9-12 9 12H3zm6-3l3-4 3 4M5 18h14",
  },
  {
    id: "field_marker_r4",
    name: "Field Marker · The Market",
    lore: "Every bounty earned a note. That's the playbook for next month.",
    unlockHint: "Write a note on every lesson in Region 4.",
    iconPath:
      "M12 2L2 7v8c0 4 5 7 10 7s10-3 10-7V7L12 2zm0 4l6 3v6c0 2-3 4-6 4s-6-2-6-4V9l6-3z",
  },
];

interface ArtifactInputs {
  /** Map of lesson_id → note content (only non-empty notes) */
  lessonNotes: Record<string, string>;
  /** Daily-note dates the student has written on (YYYY-MM-DD strings) */
  dailyNoteDates: string[];
  /** Lessons by region */
  lessonsByRegion: Record<string, { id: string }[]>;
}

/**
 * Returns the set of artifact IDs the student has earned RIGHT NOW
 * given their notes data. Pure function — no side effects.
 */
export function computeNoteArtifacts(inputs: ArtifactInputs): Set<string> {
  const earned = new Set<string>();
  const noteCount = Object.keys(inputs.lessonNotes).filter(
    (id) => inputs.lessonNotes[id]?.trim().length > 0
  ).length;
  const wordCount = Object.values(inputs.lessonNotes)
    .map((s) => (s ?? "").trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => a + b, 0);

  if (noteCount >= 5) earned.add("apprentice_scribe");

  // Daily habit — 7 different days with daily notes
  const uniqueDays = new Set(inputs.dailyNoteDates);
  if (uniqueDays.size >= 7) earned.add("daily_habit");

  if (wordCount >= 1000) earned.add("writer");

  // Region field markers — every lesson in the region has a note
  for (const regionKey of ["r1", "r2", "r3", "r4"] as const) {
    const lessons = inputs.lessonsByRegion[regionKey] ?? [];
    if (lessons.length === 0) continue;
    const allWritten = lessons.every(
      (l) => (inputs.lessonNotes[l.id] ?? "").trim().length > 0
    );
    if (allWritten) earned.add(`field_marker_${regionKey}`);
  }

  return earned;
}
