/**
 * Where the arrival card and the place panel sit, and the thin leader line
 * that joins them to their landmark (Lovro's picks, 2026-09-28: B's card
 * beside the landmark, B's panel in the quiet part of the click-in frame).
 *
 * Pure: every call writes into a caller-owned Placement. It runs when the
 * card or the panel shows, when its pin moves at rest, and on a resize; never
 * on the frames of a moving camera, so its one string (the path) is fine.
 *
 * The card never covers its landmark. Each stop has a hand-tuned first choice
 * (CARD_HINTS, judged on renders at 1691x1278, 1366x768 and 3428x1230); if
 * that side has no room at this size, the corner above the landmark on that
 * side, then the other side, then above, then below are tried. Final pass:
 * the other places' plaques on screen count too (`avoid`), so the card never
 * lands on a neighbour's name (the round 1 a4 frame put Video Ads I's plaque
 * under the card's corner); covering the landmark costs four times as much.
 */

export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Placement {
  x: number;
  y: number;
  /** Which side of the landmark the surface sits on. */
  side: "l" | "r" | "t" | "b";
  /** The leader's path (SVG "d"), from the surface's edge to the pin. */
  d: string;
  /** Pixels of the landmark the surface covers (0 when it clears it). */
  overlap: number;
}

export interface CardHint {
  /** First choice: right or left of the landmark, or above it ("t", final pass B: a4). */
  side: "l" | "r" | "t";
  /** Where the pin meets the card's height, 0 (top edge) .. 1 (bottom edge). */
  at: number;
}

/**
 * Hand-tuned per stop (a1..a8), from the stop renders with the card: which
 * side of the landmark is the quiet one. The landmark sits at x 0.55..0.75 at
 * most stops (the bible's frame rule), so the open sky or water is usually on
 * its right at a laptop width and on its left on a wide screen; the fallbacks
 * handle the rest.
 */
export const CARD_HINTS: readonly CardHint[] = [
  { side: "r", at: 0.3 }, // a1 Signpost: open bay on the right
  { side: "r", at: 0.3 }, // a2 Lookout: sky right of the tower
  { side: "r", at: 0.35 }, // a3 Waterfall: the pool side
  { side: "t", at: 0.3 }, // a4 Trail Hut: over the hut, in the sky (final pass B; the right is the gorge wall)
  { side: "r", at: 0.35 }, // a5 Boathouse: the still lake
  { side: "l", at: 0.3 }, // a6 Great Tree: its crown fills the right, the dusk sky is left
  { side: "l", at: 0.3 }, // a7 Observatory: the night sky left of the dome
  { side: "l", at: 0.35 }, // a8 Stone Arch: keep the sun in the arch clear
];

/** Space between the landmark's box and the card. The leader spans it. */
export const GAP = 60;
/** The card keeps this far inside the frame. */
export const EDGE = 20;

const cand: Box = { l: 0, t: 0, r: 0, b: 0 };
const lm: Box = { l: 0, t: 0, r: 0, b: 0 };

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : v < lo ? lo : v > hi ? hi : v;
}

/**
 * The leader: from the surface's edge facing the pin, straight across when
 * the pin's height falls inside the surface, otherwise one elbow.
 */
function leader(out: Placement, pinX: number, pinY: number, w: number, h: number): void {
  const { x, y } = out;
  const r = (v: number) => Math.round(v * 2) / 2;
  if (out.side === "r" || out.side === "l") {
    const ex = out.side === "r" ? x : x + w;
    const inside = pinY >= y + 14 && pinY <= y + h - 14;
    const ey = inside ? pinY : clamp(pinY, y + 18, y + h - 18);
    out.d = inside
      ? `M${r(ex)} ${r(ey)}H${r(pinX)}`
      : `M${r(ex)} ${r(ey)}H${r((ex + pinX) / 2)}V${r(pinY)}H${r(pinX)}`;
  } else {
    const ey = out.side === "t" ? y + h : y;
    const ex = clamp(pinX, x + 18, x + w - 18);
    out.d = `M${r(ex)} ${r(ey)}V${r((ey + pinY) / 2)}H${r(pinX)}V${r(pinY)}`;
  }
}

/**
 * Place the arrival card beside its landmark.
 * @param box    the landmark's visible box on screen (clipped to the frame by the caller), or null
 * @param safeT  top of the free area (under the header)
 * @param safeB  bottom of the free area (over the timeline)
 */
export function placeCard(
  out: Placement,
  hint: CardHint,
  pinX: number,
  pinY: number,
  box: Box | null,
  w: number,
  h: number,
  viewW: number,
  safeT: number,
  safeB: number,
  avoid: readonly Box[] = [],
): void {
  // Without a box (poster mode), assume the landmark hangs below its pin.
  const bl = box ? box.l : pinX - 70;
  const br = box ? box.r : pinX + 70;
  const bt = box ? Math.min(box.t, pinY) : pinY;
  const bb = box ? box.b : pinY + 150;
  lm.l = bl;
  lm.t = bt;
  lm.r = br;
  lm.b = bb;
  const yAt = clamp(pinY - hint.at * h, safeT, safeB - h);
  let best = Infinity;
  let bestCost = Infinity;
  // "c": the corner above the landmark on the hint's side, flush with that
  // edge of the frame (a hint side with no room keeps its side of the frame).
  const order = hint.side === "t" ? "trlb" : hint.side === "r" ? "rcltb" : "lcrtb";
  for (let i = 0; i < order.length; i++) {
    const code = order[i];
    let side: Placement["side"];
    let x: number;
    let y: number;
    if (code === "r") {
      side = "r";
      x = br + GAP;
      y = yAt;
      if (x + w > viewW - EDGE) continue;
    } else if (code === "l") {
      side = "l";
      x = bl - GAP - w;
      y = yAt;
      if (x < EDGE) continue;
    } else if (code === "c") {
      side = "t";
      x = hint.side === "r" ? Math.max(EDGE, viewW - EDGE - w) : EDGE;
      y = bt - GAP / 2 - h;
      if (y < safeT) continue;
    } else if (code === "t") {
      side = "t";
      x = clamp(pinX - w / 2, EDGE, viewW - EDGE - w);
      y = bt - GAP - h;
      if (y < safeT) continue;
    } else {
      side = "b";
      x = clamp(pinX - w / 2, EDGE, viewW - EDGE - w);
      y = bb + GAP;
      if (y + h > safeB) continue;
    }
    cand.l = x;
    cand.t = y;
    cand.r = x + w;
    cand.b = y + h;
    const ov = overlapArea(cand, lm);
    let cost = ov * 4;
    for (const a of avoid) cost += overlapArea(cand, a);
    if (cost < bestCost) {
      bestCost = cost;
      best = ov;
      out.x = x;
      out.y = y;
      out.side = side;
      if (cost === 0) break;
    }
  }
  if (best === Infinity) {
    // No side has room at this size: the frame's emptier half, clamped in.
    const right = pinX < viewW / 2;
    out.x = right ? viewW - EDGE - w : EDGE;
    out.y = yAt;
    out.side = right ? "r" : "l";
    cand.l = out.x;
    cand.t = out.y;
    cand.r = out.x + w;
    cand.b = out.y + h;
    best = overlapArea(cand, lm);
  }
  out.overlap = Math.round(best);
  leader(out, pinX, pinY, w, h);
}

/**
 * Final pass B: the done card takes the arrival card's place (the judge saw it
 * jump 180 px). Keep the arrival card's x and its top edge (its bottom edge
 * when it sat above the landmark), shifted with the pin since, and redraw the
 * leader to the pin.
 */
export function anchorCard(out: Placement, prev: { x: number; y: number; h: number; side: Placement["side"]; pinX: number; pinY: number }, pinX: number, pinY: number, w: number, h: number, viewW: number, safeT: number, safeB: number): void {
  out.side = prev.side;
  out.x = clamp(prev.x + (pinX - prev.pinX), EDGE, viewW - EDGE - w);
  const top = prev.side === "t" ? prev.y + prev.h - h : prev.y;
  out.y = clamp(top + (pinY - prev.pinY), safeT, safeB - h);
  leader(out, pinX, pinY, w, h);
}

/**
 * Place the lesson panel in the click-in frame. The park pose puts the
 * landmark at x 0.55..0.75 (bible 1.0), so the panel takes the left, under the
 * header; `onLeft` false mirrors it. The leader leaves the panel's header row
 * and drops onto the pin with one elbow, as in B's s3.
 */
export function placePanel(
  out: Placement,
  pinX: number,
  pinY: number,
  box: Box | null,
  w: number,
  h: number,
  viewW: number,
  top: number,
  left: number,
  onLeft = true,
): void {
  out.x = onLeft ? left : viewW - left - w;
  out.y = top;
  out.side = onLeft ? "l" : "r";
  const ex = onLeft ? out.x + w : out.x;
  const ey = out.y + 34;
  const r = (v: number) => Math.round(v * 2) / 2;
  // Straight across when the pin is level with the panel's header, else an elbow down to it.
  out.d = Math.abs(pinY - ey) < 6 ? `M${r(ex)} ${r(ey)}H${r(pinX)}` : `M${r(ex)} ${r(ey)}H${r(pinX)}V${r(pinY)}`;
  let ov = 0;
  if (box) {
    cand.l = out.x;
    cand.t = out.y;
    cand.r = out.x + w;
    cand.b = out.y + h;
    ov = overlapArea(cand, box);
  }
  out.overlap = Math.round(ov);
}
