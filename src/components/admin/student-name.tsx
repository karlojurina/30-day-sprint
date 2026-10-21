"use client";

import Link from "next/link";
import { bareUsername } from "@/lib/admin/people-common";

/**
 * A student's name, the same on every admin page (admin rebuild 2, the render
 * review's fix round: it was a link with an underline on the 30% page, a
 * button that opened the task on Tasks, plain bold words on All students, a
 * card on the journey and an Airy Blue link on Lesson feedback).
 *
 * The name is a link to the student's page, 600 weight in the primary ink
 * with a hairline underline, at the row's own size; then "@username" in the
 * dimmer words when there is one. `asText` draws the same name with no link,
 * inside something that already is one (All students' row is a link to the
 * same page). No student id: the name with no link.
 *
 * It renders two siblings and no box of its own, so the row around it lays
 * them out with what follows (a membership pill, "Day 9").
 */
export function StudentName({
  id,
  name,
  username,
  size = 15,
  asText = false,
}: {
  id: string | null | undefined;
  name: string;
  /** students.discord_username (a Whop or a Discord username), with or without its "@". */
  username?: string | null;
  /** The name's size in px: 15 in a row, 14 on a journey card, 20 as a heading. */
  size?: number;
  asText?: boolean;
}) {
  const look: React.CSSProperties = {
    fontSize: size,
    fontWeight: 600,
    letterSpacing: "-0.011em",
    lineHeight: 1.35,
    color: "var(--color-text-primary)",
    textDecoration: "underline",
    textDecorationColor: "var(--color-border-strong)",
    textUnderlineOffset: 3,
    overflowWrap: "anywhere",
    minWidth: 0,
    // Pressable where it sits even inside a box that passes clicks through to a button under it (a journey card).
    pointerEvents: "auto",
  };
  const handle = bareUsername(username);
  return (
    <>
      {asText || !id ? (
        <span data-student-name="" style={look}>
          {name}
        </span>
      ) : (
        <Link data-student-name="" href={`/admin/students/${encodeURIComponent(id)}`} style={look}>
          {name}
        </Link>
      )}
      {handle && (
        <span data-student-username="" style={{ fontSize: 13, color: "var(--color-text-secondary)", overflowWrap: "anywhere", minWidth: 0 }}>
          @{handle}
        </span>
      )}
    </>
  );
}
