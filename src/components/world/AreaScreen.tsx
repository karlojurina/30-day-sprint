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
 * the lesson page and its video need. `centred` puts the wide card in the
 * middle of the screen (the lesson page, from Lovro's review of 2026-10-15);
 * taller than the screen, it starts at the top and the scrim scrolls. Without
 * it the wide card hangs from the top (the dev area page).
 */
export function Panel({
  children,
  note = false,
  centred = false,
}: {
  children: React.ReactNode;
  note?: boolean;
  centred?: boolean;
}) {
  const card = note ? `${u.card} ${u.note}` : centred ? `${u.card} ${u.centred}` : u.card;
  return (
    <div className={`${tokens.tokens} ${u.scrim}`}>
      <div className={card}>{children}</div>
    </div>
  );
}
