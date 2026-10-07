"use client";

import tokens from "@/components/world-v6/tokens.module.css";
import u from "@/components/world/world-ui.module.css";

/**
 * The layer a world route draws over the map: a full-screen scrim with one
 * card in it. The lesson page and the two "not here" messages use it.
 *
 * It scrolls by itself, and the scroll stops at its own edges
 * (overscroll-behavior): the page scroll underneath is the map's camera.
 *
 * The look is the map's own floating panel (.impeccable.md), from
 * world-ui.module.css. The scrim carries the tokens class so the map's
 * variables resolve out here, beside the map's root. `note` is the small
 * centred card a one-line message gets; without it the card is the wide one
 * the lesson page and its video need.
 */
export function Panel({
  children,
  note = false,
}: {
  children: React.ReactNode;
  note?: boolean;
}) {
  return (
    <div className={`${tokens.tokens} ${u.scrim}`}>
      <div className={note ? `${u.card} ${u.note}` : u.card}>{children}</div>
    </div>
  );
}
